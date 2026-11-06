import { useMutation, useQuery } from "@tanstack/react-query";
import { Pencil, Plus, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "../api/client";
import { useGuildApi, useMusicGenres } from "../api/hooks";
import { gk } from "../api/keys";
import type { Album } from "../api/types";
import { AlbumForm } from "../components/AlbumForm";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { DetailHeader, Empty, Section } from "../components/detail/DetailKit";
import { LinkedWorksSection } from "../components/detail/LinkedWorksSection";
import { MyEntrySection } from "../components/detail/MyEntrySection";
import { TaxonomySection } from "../components/detail/TaxonomySection";
import { LinksSection } from "../components/LinksSection";
import { LoadFailed } from "../components/LoadFailed";
import { LoadingState } from "../components/Spinner";
import { MUSIC_GENRES } from "../genre/config";
import { GenreChooser } from "../genre/GenreChooser";
import { useCan } from "../guild/GuildProvider";
import { usePageTitle } from "../shell/pageTitle";
import { albumRuntime } from "./ArtistDetailPage";

interface Hit { id: number; name: string; name_en: string | null }

/** The album's artists; editors add more from the guild search. Unlinking an
 *  artist drops the album from everyone's ranking of that artist's discography. */
function AlbumArtistsSection({ album }: { album: Album }) {
  const { guildId, base } = useGuildApi();
  const canEdit = useCan("catalog_edit");
  const [editing, setEditing] = useState(false);
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  const [unlinking, setUnlinking] = useState<Hit | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 200);
    return () => clearTimeout(t);
  }, [q]);

  const hits = useQuery({
    queryKey: gk(guildId, "search", "artist", term),
    queryFn: () => api.get<Hit[]>(`${base}/search?kinds=artist&limit=10&q=${encodeURIComponent(term)}`),
    enabled: editing && term.length > 0,
    placeholderData: (prev) => prev,
  });
  const link = useMutation({ mutationFn: (id: number) => api.put(`${base}/albums/${album.id}/artists/${id}`) });
  const unlink = useMutation({ mutationFn: (id: number) => api.delete(`${base}/albums/${album.id}/artists/${id}`) });
  const linked = new Set(album.artists.map((a) => a.id));

  return (
    <Section
      title={album.artists.length === 1 ? "Artist" : "Artists"}
      busy={link.isPending || unlink.isPending}
      actions={canEdit && (
        <Button variant={editing ? "default" : "outline"} size="sm" onClick={() => setEditing((e) => !e)}>
          {editing ? "Done" : <><Pencil className="size-4" /> Edit</>}
        </Button>
      )}
    >
      {album.artists.length === 0 ? <Empty>No artists linked.</Empty> : (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {album.artists.map((a) => (
            <span key={a.id} className="inline-flex items-center gap-1">
              <Link to={`/g/${guildId}/music/artists/${a.id}`} className="font-medium hover:underline">
                {a.name}{a.name_en && <span className="font-normal text-muted-foreground"> ({a.name_en})</span>}
              </Link>
              {editing && album.artists.length > 1 && (
                <button type="button" aria-label={`Unlink ${a.name}`} data-slot="icon"
                        className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                        onClick={() => setUnlinking(a)}>
                  <X className="size-3.5" />
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      {editing && (
        <div className="grid gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input type="search" className="pl-8" placeholder="Find an artist in the catalog…" aria-label="Find an artist"
                   value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {term && (
            <ul className="divide-y rounded-md border text-sm">
              {(hits.data ?? []).length === 0 && !hits.isFetching && <li className="px-3 py-2 text-muted-foreground">No artist matches.</li>}
              {(hits.data ?? []).filter((h) => !linked.has(h.id)).map((h) => (
                <li key={h.id} className="flex items-center gap-2 px-3 py-1.5">
                  <span className="min-w-0 flex-1 truncate">{h.name}{h.name_en && <span className="text-muted-foreground"> ({h.name_en})</span>}</span>
                  <Button size="sm" variant="outline" disabled={link.isPending} onClick={() => link.mutate(h.id)}>
                    <Plus className="size-3.5" /> Add
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {unlinking && (
        <ConfirmDialog
          message={`Remove ${unlinking.name} from this album? It also leaves everyone's ranking of ${unlinking.name}'s albums.`}
          confirmLabel="Remove"
          busy={unlink.isPending}
          onConfirm={() => unlink.mutate(unlinking.id, { onSettled: () => setUnlinking(null) })}
          onCancel={() => setUnlinking(null)}
        />
      )}
    </Section>
  );
}

export function AlbumDetailPage() {
  const albumId = Number(useParams<{ id: string }>().id);
  const { guildId, base } = useGuildApi();
  const canEdit = useCan("catalog_edit");
  const [editing, setEditing] = useState(false);
  const { data: genres = [] } = useMusicGenres();
  const genreNames = useMemo(() => new Map(genres.map((g) => [g.id, g.name])), [genres]);

  const { data: album, isLoading, isError, error, refetch } = useQuery({
    queryKey: gk(guildId, "albums", albumId),
    queryFn: () => api.get<Album>(`${base}/albums/${albumId}`),
    enabled: !isNaN(albumId),
  });

  usePageTitle(album?.name);
  if (isLoading) return <LoadingState label="Loading album…" />;
  if (isError || !album) return <LoadFailed what="album" error={error} onRetry={() => void refetch()} />;

  const firstArtist = album.artists[0];

  return (
    <div className="grid gap-5">
      {firstArtist && (
        <Link to={`/g/${guildId}/music/artists/${firstArtist.id}`} className="text-sm text-muted-foreground hover:underline">
          ← {firstArtist.name}
        </Link>
      )}
      <DetailHeader
        title={album.name}
        altTitle={album.name_en}
        facts={[album.release_year, albumRuntime(album.runtime_seconds), album.alias && `also “${album.alias}”`]}
        actions={canEdit && firstArtist && <Button variant="outline" size="sm" onClick={() => setEditing(true)}><Pencil className="size-4" /> Edit</Button>}
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="grid content-start gap-5">
          <AlbumArtistsSection album={album} />
          <LinkedWorksSection title="Soundtrack for" path={`albums/${album.id}/soundtracks`}
                              emptyText="Not the soundtrack of anything in the catalog."
                              linked={{ movie: album.soundtrack_movies, television_show: album.soundtrack_television_shows, game: album.soundtrack_games }} />
          {album.notes && <Section title="Notes"><p className="text-sm whitespace-pre-line">{album.notes}</p></Section>}
        </div>
        <div className="grid content-start gap-5">
          {/* Albums rank within an artist's discography: the list entry is the first artist's. */}
          {firstArtist && (
            <MyEntrySection entryPath={`artists/${firstArtist.id}/albums/${album.id}`} noun="album"
                            counter={{ key: "listens", label: "Listens" }} />
          )}
          <TaxonomySection path="albums" ownerId={album.id} ids={album.genre_ids} names={genreNames}
                           linkTo={(id) => `music/genres/${id}`}
                           chooser={(sel, change) => <GenreChooser domain={MUSIC_GENRES} selected={sel} onChange={change} />} />
          <LinksSection path="albums" section="albums" ownerId={album.id} />
        </div>
      </div>

      {editing && firstArtist && (
        <>
          <AlbumForm artistId={firstArtist.id} initial={album} onClose={() => setEditing(false)} />
        </>
      )}
    </div>
  );
}
