import { useCallback, useMemo } from "react";
import { Link } from "react-router-dom";

import { useArtistCatalog, useGuildApi, useMusicGenres, useRankedArtists } from "../api/hooks";
import type { Artist, RankedArtist } from "../api/types";
import { ArtistForm } from "../components/ArtistForm";
import { DetailRows, EntityListPage } from "../components/EntityListPage";
import { safeHref } from "../lib/url";
import { matchesAny, personNamed, taxonIdsMatching } from "../search/textMatch";
import { taxonomyNames } from "../lib/facets";

const SEARCH_BY = ["all", "title", "genre", "person", "album"] as const;

export function ArtistsPage() {
  const { guildId } = useGuildApi();
  const { data: genres = [] } = useMusicGenres();

  const facets = useMemo(() => {
    const names = taxonomyNames(genres);
    return [
      { key: "genre", label: "genres", values: (a: Artist) => (a.primary_genre != null ? names([a.primary_genre]) : []) },
      { key: "nationality", label: "nationalities", values: (a: Artist) => [a.core_nationality] },
    ];
  }, [genres]);
  const genreName = Object.fromEntries(genres.map((g) => [g.id, g.name]));

  const matches = useCallback((a: Artist, needle: string, by: string) => {
    if ((by === "title" || by === "all") && matchesAny(needle, a.name, a.name_en)) return true;
    if (by === "genre" || by === "all") {
      const ids = taxonIdsMatching(needle, genres);
      if (a.primary_genre != null && ids.has(a.primary_genre)) return true;
      if (a.albums.some((al) => al.genre_ids.some((id) => ids.has(id)))) return true;
    }
    if ((by === "person" || by === "all") && personNamed(needle, a.persons)) return true;
    return (by === "album" || by === "all") && a.albums.some((al) => matchesAny(needle, al.name, al.name_en, al.alias));
  }, [genres]);

  const meta = (a: Artist) => {
    const nat = a.birth_nationality !== a.core_nationality ? `${a.core_nationality} (${a.birth_nationality})` : a.core_nationality;
    return `${nat} · ${a.album_count} album${a.album_count === 1 ? "" : "s"}`;
  };

  const detail = (a: Artist) => (
    <DetailRows rows={[
      ["Primary genre", a.primary_genre != null && genreName[a.primary_genre] && (
        <Link className="hover:underline" to={`/g/${guildId}/music/genres/${a.primary_genre}`}>{genreName[a.primary_genre]}</Link>
      )],
      ["Members", a.persons.length > 0 && a.persons.map((p, i) => (
        <span key={`${p.id}-${i}`}>
          {i > 0 && ", "}
          <Link className="hover:underline" to={`/g/${guildId}/people/${p.id}`}>{p.name}</Link>
        </span>
      ))],
      ["Links", a.links.length > 0 && a.links.map((l, i) => (
        <span key={l.id}>
          {i > 0 && ", "}
          <a className="hover:underline" href={safeHref(l.url)} target="_blank" rel="noreferrer">{l.label ?? l.url}</a>
        </span>
      ))],
      ["Notes", a.notes],
    ]} />
  );

  return (
    <EntityListPage<Artist, RankedArtist>
      title="Artists"
      noun={["artist", "artists"]}
      section="artists"
      route="music/artists"
      entityKey="artist"
      ranked={useRankedArtists}
      catalog={useArtistCatalog}
      searchBy={SEARCH_BY}
      facets={facets}
      countsSection="music"
      matches={matches}
      meta={meta}
      detail={detail}
      restoreBody={() => ({})}
      form={(initial, close) => <ArtistForm initial={initial} onClose={close} />}
    />
  );
}
