from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..api_models import PersonDetail, PersonGraphOut, PersonIn, PersonOut, PersonPatch
from ..api_models.person import (
    GraphArtistNode,
    GraphEdge,
    GraphMovieNode,
    GraphPersonNode,
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

    # Collect movies and artists referenced by at least one person
    movie_names: dict[int, str] = {}
    artist_names: dict[int, str] = {}

    edges: list[GraphEdge] = []

    graph_persons = []
    for person in persons:
        for link in person.movie_links:
            movie_names[link.movie_id] = link.movie.name
            edges.append(GraphEdge(person_id=person.id, target_id=link.movie_id, target_type="movie"))
        for link in person.artist_links:
            artist_names[link.artist_id] = link.artist.name
            edges.append(GraphEdge(person_id=person.id, target_id=link.artist_id, target_type="artist"))
        graph_persons.append(
            GraphPersonNode(
                id=person.id,
                name=person.name,
                artist_ids=[link.artist_id for link in person.artist_links],
                movie_roles=list({link.role.value for link in person.movie_links}),
            )
        )

    movies = [GraphMovieNode(id=mid, name=name) for mid, name in movie_names.items()]
    artists = [GraphArtistNode(id=aid, name=name) for aid, name in artist_names.items()]

    return PersonGraphOut(
        persons=graph_persons,
        movies=movies,
        artists=artists,
        edges=edges,
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
