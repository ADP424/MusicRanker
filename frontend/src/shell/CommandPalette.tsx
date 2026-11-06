import { useQuery } from "@tanstack/react-query";
import {
  BookOpen, Clapperboard, Disc3, Gamepad2, Layers, ListVideo, Music, Search, Tag, Tv, User,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { api } from "../api/client";
import { gk } from "../api/keys";
import { useGuild } from "../guild/GuildProvider";
import { Spinner } from "../components/Spinner";
import { SECTIONS } from "./sections";

type Kind = "artist" | "album" | "book" | "movie" | "game" | "show" | "season" | "episode" | "person" | "genre";
interface Hit { kind: Kind; id: number; name: string; name_en: string | null; year: number | null; context: string | null }

const KINDS: Record<Kind, { label: string; icon: typeof Music; path: (h: Hit) => string }> = {
  artist: { label: "Artists", icon: Music, path: (h) => `music/artists/${h.id}` },
  album: { label: "Albums", icon: Disc3, path: (h) => `music/albums/${h.id}` },
  book: { label: "Books", icon: BookOpen, path: (h) => `books/${h.id}` },
  movie: { label: "Movies", icon: Clapperboard, path: (h) => `movies/${h.id}` },
  game: { label: "Games", icon: Gamepad2, path: (h) => `games/${h.id}` },
  show: { label: "TV shows", icon: Tv, path: (h) => `television/shows/${h.id}` },
  season: { label: "Seasons", icon: Layers, path: (h) => `television/seasons/${h.id}` },
  episode: { label: "Episodes", icon: ListVideo, path: (h) => `television/episodes/${h.id}` },
  person: { label: "People", icon: User, path: (h) => `people/${h.id}` },
  genre: {
    label: "Genres", icon: Tag,
    // A genre can span media; open it under the first one it belongs to.
    path: (h) => {
      const first = (h.context ?? "music").split(", ")[0];
      const section = { music: "music", books: "books", movies: "movies", TV: "television", games: "games" }[first] ?? "music";
      return `${section}/genres/${h.id}`;
    },
  },
};
const ORDER = Object.keys(KINDS) as Kind[];

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Ctrl/⌘-K (or "/") anywhere in a guild: jump to anything in it. */
export function CommandPalette() {
  const guild = useGuild();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const term = useDebounced(q.trim(), 150);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (/^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName) || t.isContentEditable);
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const hits = useQuery({
    queryKey: gk(guild.id, "search", term),
    queryFn: () => api.get<Hit[]>(`/guilds/${guild.id}/search?q=${encodeURIComponent(term)}&limit=6`),
    enabled: open && term.length > 0,
    staleTime: 10_000,
    placeholderData: (prev) => prev,
  });

  const go = (path: string) => {
    setOpen(false);
    setQ("");
    navigate(`/g/${guild.id}/${path}`);
  };

  const grouped = ORDER.map((k) => [k, (hits.data ?? []).filter((h) => h.kind === k)] as const).filter(([, l]) => l.length);

  // Results arrive from the server, so cmdk never re-picks a first item by
  // itself: point the selection at the top hit whenever the results change.
  const [selected, setSelected] = useState("");
  const first = term && grouped.length ? `${grouped[0][0]}-${grouped[0][1][0].id}` : SECTIONS[0].path;
  useEffect(() => { setSelected(first); }, [first]);

  return (
    <>
      <Button variant="outline" size="sm" aria-label="Search" className="gap-2 text-muted-foreground sm:w-64 sm:justify-start"
              onClick={() => setOpen(true)}>
        <Search className="size-4" />
        <span className="hidden flex-1 truncate text-left sm:inline">Search {guild.name}…</span>
        <kbd className="pointer-events-none hidden rounded border bg-muted px-1.5 text-[10px] font-medium sm:inline">Ctrl K</kbd>
      </Button>
      <CommandDialog open={open} onOpenChange={setOpen} title="Search" description="Search this guild"
                     commandProps={{ shouldFilter: false, value: selected, onValueChange: setSelected }}>
        <CommandInput placeholder="Movies, shows, people, genres…" value={q} onValueChange={setQ} />
        <CommandList>
          {term && !hits.isFetching && grouped.length === 0 && <CommandEmpty>Nothing matches “{term}”.</CommandEmpty>}
          {term && hits.isFetching && grouped.length === 0 && (
            <div className="flex justify-center py-6"><Spinner size="sm" /></div>
          )}
          {!term && (
            <CommandGroup heading="Go to">
              {SECTIONS.map((s) => (
                <CommandItem key={s.path} value={s.path} onSelect={() => go(s.path)}>
                  <s.icon /> {s.label}
                </CommandItem>
              ))}
              <CommandItem value="members" onSelect={() => go("members")}><User /> Members</CommandItem>
            </CommandGroup>
          )}
          {term && grouped.map(([kind, list]) => {
            const K = KINDS[kind];
            return (
              <CommandGroup key={kind} heading={K.label}>
                {list.map((h) => (
                  <CommandItem key={`${kind}-${h.id}`} value={`${kind}-${h.id}`} onSelect={() => go(K.path(h))}>
                    <K.icon />
                    <span className="truncate">
                      {h.name}{h.name_en && <span className="text-muted-foreground"> ({h.name_en})</span>}
                    </span>
                    <span className="ml-auto shrink-0 truncate text-xs text-muted-foreground">
                      {[h.context, h.year].filter(Boolean).join(" · ")}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            );
          })}
        </CommandList>
      </CommandDialog>
    </>
  );
}
