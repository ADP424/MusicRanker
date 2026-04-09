from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..api_models import PersonDetail, PersonGraphOut, PersonIn, PersonOut, PersonPatch
from ..api_models.person import (
    GraphEdge,
    GraphPersonOut,
    PersonArtistRef,
    PersonMovieRoleRef,
)
from ..database import get_database
from ..database_models import Artist, ArtistPerson, Person

router = APIRouter(prefix="/persons", tags=["persons"])


def _get(db: Session, pid: int) -> Person:
    if p := db.get(Person, pid):
        return p
    raise HTTPException(404, "Person not found")


def _build_out(person: Person) -> PersonOut:
    return PersonOut(
        id=person.id,
        name=person.name,
        birth_nationality=person.birth_nationality,
        core_nationality=person.core_nationality,
        notes=person.notes,
        artist_ids=[link.artist_id for link in person.artist_links],
    )


@router.get("/graph", response_model=PersonGraphOut)
def get_person_graph(db: Session = Depends(get_database)):
    persons = db.scalars(select(Person).order_by(Person.name)).all()

    # Build lookup: movie_id → [person_id, ...]  and  artist_id → [person_id, ...]
    movie_persons: dict[int, list[int]] = defaultdict(list)
    artist_persons: dict[int, list[int]] = defaultdict(list)
    movie_names: dict[int, str] = {}
    artist_names: dict[int, str] = {}

    for person in persons:
        for link in person.movie_links:
            movie_persons[link.movie_id].append(person.id)
            movie_names[link.movie_id] = link.movie.name
        for link in person.artist_links:
            artist_persons[link.artist_id].append(person.id)
            artist_names[link.artist_id] = link.artist.name

    # Build edges: pair of person ids → (via_movies, via_artists)
    edge_map: dict[tuple[int, int], tuple[list[int], list[int]]] = defaultdict(lambda: ([], []))

    for movie_id, pids in movie_persons.items():
        for i in range(len(pids)):
            for j in range(i + 1, len(pids)):
                key = (min(pids[i], pids[j]), max(pids[i], pids[j]))
                edge_map[key][0].append(movie_id)

    for artist_id, pids in artist_persons.items():
        for i in range(len(pids)):
            for j in range(i + 1, len(pids)):
                key = (min(pids[i], pids[j]), max(pids[i], pids[j]))
                edge_map[key][1].append(artist_id)

    edges = [
        GraphEdge(person_a=a, person_b=b, via_movie_ids=via_m, via_artist_ids=via_a)
        for (a, b), (via_m, via_a) in edge_map.items()
    ]

    # Only include movies/artists referenced in edges
    used_movie_ids = {mid for e in edges for mid in e.via_movie_ids}
    used_artist_ids = {aid for e in edges for aid in e.via_artist_ids}

    graph_persons = [
        GraphPersonOut(
            id=p.id,
            name=p.name,
            artist_ids=[link.artist_id for link in p.artist_links],
            movie_roles=list({link.role.value for link in p.movie_links}),
        )
        for p in persons
    ]

    return PersonGraphOut(
        persons=graph_persons,
        edges=edges,
        movies={k: v for k, v in movie_names.items() if k in used_movie_ids},
        artists={k: v for k, v in artist_names.items() if k in used_artist_ids},
    )


@router.get("", response_model=list[PersonOut])
def list_persons(db: Session = Depends(get_database)):
    persons = db.scalars(select(Person).order_by(Person.name)).all()
    return [_build_out(p) for p in persons]


@router.get("/{pid}", response_model=PersonOut)
def get_person(pid: int, db: Session = Depends(get_database)):
    return _build_out(_get(db, pid))


@router.get("/{pid}/detail", response_model=PersonDetail)
def get_person_detail(pid: int, db: Session = Depends(get_database)):
    person = _get(db, pid)
    artists = sorted(
        [
            PersonArtistRef(
                id=link.artist.id,
                name=link.artist.name,
                discography_link=link.artist.discography_link,
            )
            for link in person.artist_links
        ],
        key=lambda a: a.name,
    )
    movie_roles = sorted(
        [
            PersonMovieRoleRef(
                movie_id=link.movie.id,
                movie_name=link.movie.name,
                role=link.role.value,
            )
            for link in person.movie_links
        ],
        key=lambda r: r.movie_name,
    )
    return PersonDetail(
        id=person.id,
        name=person.name,
        birth_nationality=person.birth_nationality,
        core_nationality=person.core_nationality,
        notes=person.notes,
        artists=artists,
        movie_roles=movie_roles,
    )


@router.post("", response_model=PersonOut, status_code=201)
def create_person(body: PersonIn, db: Session = Depends(get_database)):
    person = Person(**body.model_dump())
    db.add(person)
    db.flush()
    return _build_out(person)


@router.patch("/{pid}", response_model=PersonOut)
def update_person(pid: int, body: PersonPatch, db: Session = Depends(get_database)):
    person = _get(db, pid)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(person, k, v)
    return _build_out(person)


@router.delete("/{pid}", status_code=204)
def delete_person(pid: int, db: Session = Depends(get_database)):
    db.delete(_get(db, pid))


# ── Artist links ───────────────────────────────────────────────────────────────


@router.put("/{pid}/artists/{aid}", status_code=204)
def link_artist(pid: int, aid: int, db: Session = Depends(get_database)):
    _get(db, pid)
    if not db.get(Artist, aid):
        raise HTTPException(404, "Artist not found")
    if not db.get(ArtistPerson, (aid, pid)):
        db.add(ArtistPerson(artist_id=aid, person_id=pid))


@router.delete("/{pid}/artists/{aid}", status_code=204)
def unlink_artist(pid: int, aid: int, db: Session = Depends(get_database)):
    if link := db.get(ArtistPerson, (aid, pid)):
        db.delete(link)
