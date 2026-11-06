import { useMutation } from "@tanstack/react-query";
import { Pencil, Plus, Scale, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { api } from "../api/client";
import { useAlbumCatalog, useArtist, useGuildApi, useMusicGenres, useRankedAlbums } from "../api/hooks";
import { rk } from "../api/keys";
import type { Album, RankedAlbum } from "../api/types";
import { BAND_ROLE_LABELS, BAND_ROLES } from "../api/types";
import { AddAllButton } from "../components/AddAllButton";
import { AlbumForm } from "../components/AlbumForm";
import { ArtistForm } from "../components/ArtistForm";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ChildList, RowCounter } from "../components/detail/ChildList";
import { DetailHeader, ExternalLinks, Facts, fmtMinutes, RefLinks, Section } from "../components/detail/DetailKit";
import { MyEntrySection } from "../components/detail/MyEntrySection";
import { PeopleSection } from "../components/detail/PeopleSection";
import { GuildHolders } from "../components/GuildHolders";
import { LinksSection } from "../components/LinksSection";
import { LoadFailed } from "../components/LoadFailed";
import { LoadingState } from "../components/Spinner";
import { useCan } from "../guild/GuildProvider";
import { usePageTitle } from "../shell/pageTitle";

/** An album's runtime from seconds: "52m", "1h 12m". */
export const albumRuntime = (seconds: number) => fmtMinutes(Math.round(seconds / 60));

/** Everything about an album in one expandable block (used on the artist page). */
export function AlbumFacts({ album, genreNames }: { album: Album; genreNames: Map<number, string> }) {
  const genres = album.genre_ids.filter((id) => genreNames.has(id)).map((id) => ({ id, name: genreNames.get(id)! }));
  return (
    <Facts items={[
      ["Alias", album.alias],
      ["Genres", genres.length > 0 && <RefLinks items={genres} to={(id) => `music/genres/${id}`} />],
      ["Artists", album.artists.length > 1 && <RefLinks items={album.artists} to={(id) => `music/artists/${id}`} />],
      ["Soundtrack for", (album.soundtrack_movies.length + album.soundtrack_television_shows.length + album.soundtrack_games.length > 0) && (
        <span className="flex flex-wrap gap-x-2">
          <RefLinks items={album.soundtrack_movies} to={(id) => `movies/${id}`} />
          <RefLinks items={album.soundtrack_television_shows} to={(id) => `television/shows/${id}`} />
          <RefLinks items={album.soundtrack_games} to={(id) => `games/${id}`} />
        </span>
      )],
      ["Links", album.links.length > 0 && <ExternalLinks links={album.links} />],
      ["Notes", album.notes],
    ]} />
  );
}

export function ArtistDetailPage() {
  const aid = Number(useParams<{ id: string }>().id);
  const { guildId, userId: me, base } = useGuildApi();
  const canCreate = useCan("catalog_create");
  const canEdit = useCan("catalog_edit");
  const canDelete = useCan("catalog_delete");
  const [dialog, setDialog] = useState<{ kind: "artist" } | { kind: "album"; album?: Album } | null>(null);
  const [deleting, setDeleting] = useState<{ album: Album; rankings: number } | null>(null);
  const [viewingUser, setViewingUser] = useState(me);

  const { data: genres = [] } = useMusicGenres();
  const genreNames = useMemo(() => new Map(genres.map((g) => [g.id, g.name])), [genres]);
  const { data: artist, isLoading, isError, error, refetch } = useArtist(aid);
  const { data: ranked = [], isLoading: rankedLoading } = useRankedAlbums(aid, viewingUser);
  const { data: catalog = [], isLoading: catalogLoading } = useAlbumCatalog(aid);

  const listens = useMutation({
    mutationFn: (v: { id: number; listens: number }) => api.put(`${base}/artists/${aid}/albums/${v.id}/entry`, { listens: v.listens }),
  });
  const impact = useMutation({
    mutationFn: (a: Album) => api.get<{ rankings_destroyed: number }>(`${base}/albums/${a.id}/impact`),
    meta: { invalidates: false },
    onSuccess: (r, album) => setDeleting({ album, rankings: r.rankings_destroyed }),
  });
  const remove = useMutation({ mutationFn: (id: number) => api.delete(`${base}/albums/${id}`) });

  usePageTitle(artist?.name);
  if (isLoading) return <LoadingState label="Loading artist…" />;
  if (isError || !artist) return <LoadFailed what="artist" error={error} onRetry={() => void refetch()} />;

  const primaryGenre = artist.primary_genre != null ? genres.find((g) => g.id === artist.primary_genre) : undefined;

  return (
    <div className="grid gap-5">
      <DetailHeader
        title={artist.name}
        altTitle={artist.name_en}
        facts={[
          artist.birth_nationality !== artist.core_nationality
            ? `${artist.core_nationality} (formed/born ${artist.birth_nationality})` : artist.core_nationality,
          primaryGenre && <Link to={`/g/${guildId}/music/genres/${primaryGenre.id}`} className="hover:underline">{primaryGenre.name}</Link>,
          `${artist.album_count} album${artist.album_count === 1 ? "" : "s"}`,
        ]}
        actions={canEdit && <Button variant="outline" size="sm" onClick={() => setDialog({ kind: "artist" })}><Pencil className="size-4" /> Edit</Button>}
      />
      <GuildHolders vertical="artists" id={artist.id} />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="grid content-start gap-5">
          <ChildList<Album, RankedAlbum>
            title="Albums"
            noun={["album", "albums"]}
            field="album"
            ranked={ranked}
            rankedLoading={rankedLoading}
            rankKey={rk(guildId, me, "artists", aid, "albums", "ranked")}
            catalog={catalog}
            catalogLoading={catalogLoading}
            viewingUser={viewingUser}
            onViewingUser={setViewingUser}
            href={(a) => `music/albums/${a.id}`}
            entryPath={(a) => `artists/${aid}/albums/${a.id}`}
            meta={(a) => [a.release_year, albumRuntime(a.runtime_seconds), a.artists.length > 1 && `with ${a.artists.filter((x) => x.id !== aid).map((x) => x.name).join(", ")}`]
              .filter(Boolean).join(" · ")}
            rankedExtra={(a, r) => (
              <RowCounter value={r.listens} label="listens" busy={listens.isPending && listens.variables?.id === a.id}
                          onChange={(n) => listens.mutate({ id: a.id, listens: n })} />
            )}
            detail={(a) => <AlbumFacts album={a} genreNames={genreNames} />}
            catalogMenu={canEdit || canDelete ? (a) => (
              <>
                {canEdit && <DropdownMenuItem onSelect={() => setDialog({ kind: "album", album: a })}><Pencil /> Edit</DropdownMenuItem>}
                {canDelete && <DropdownMenuItem variant="destructive" onSelect={() => impact.mutate(a)}><Trash2 /> Delete from catalog</DropdownMenuItem>}
              </>
            ) : undefined}
            headerActions={
              <>
                {ranked.length >= 2 && viewingUser === me && (
                  <Button variant="ghost" size="sm" asChild><Link to="rank"><Scale className="size-4" /> Rank</Link></Button>
                )}
                <AddAllButton path={`artists/${artist.id}/albums/add-all`} noun="albums" />
                {canCreate && <Button variant="outline" size="sm" onClick={() => setDialog({ kind: "album" })}><Plus className="size-4" /> Add</Button>}
              </>
            }
          />
          <PeopleSection path="artists" ownerId={artist.id} persons={artist.persons} roles={BAND_ROLES}
                         roleLabels={BAND_ROLE_LABELS} defaultRole="core_member" title="Members" />
          {artist.notes && <Section title="Notes"><p className="text-sm whitespace-pre-line">{artist.notes}</p></Section>}
        </div>
        <div className="grid content-start gap-5">
          <MyEntrySection entryPath={`artists/${artist.id}`} noun="artist" />
          <LinksSection path="artists" section="artists" ownerId={artist.id} />
        </div>
      </div>

      {deleting && (
        <ConfirmDialog
          message={`Delete “${deleting.album.name}” from the guild catalog? ${deleting.rankings} member ranking(s) of it go with it.`}
          busy={remove.isPending}
          onConfirm={() => remove.mutate(deleting.album.id, { onSettled: () => setDeleting(null) })}
          onCancel={() => setDeleting(null)}
        />
      )}
      {dialog && (
        <>
          {dialog.kind === "artist" ? (
            <ArtistForm initial={artist} onClose={() => setDialog(null)} />
          ) : (
            <AlbumForm artistId={aid} initial={dialog.album} onClose={() => setDialog(null)} />
          )}
        </>
      )}
    </div>
  );
}
