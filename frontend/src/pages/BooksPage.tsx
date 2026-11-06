import { useCallback, useMemo } from "react";

import { useBookCatalog, useBookGenres, useGuildApi, useRankedBooks, useUpdateBookEntry } from "../api/hooks";
import type { Book, BookRole, RankedBook } from "../api/types";
import { BOOK_ROLE_LABELS, BOOK_ROLES } from "../api/types";
import { BookForm } from "../components/BookForm";
import { DetailRows, EntityListPage, LinkList } from "../components/EntityListPage";
import { matchesAny, personNamed, taxonIdsMatching } from "../search/textMatch";
import { CountControl } from "./MoviesPage";
import { taxonomyNames } from "../lib/facets";

const SEARCH_BY = ["all", "title", "genre", "person"] as const;

const ADAPTATIONS = [
  { label: "Adapted as (movie)", field: "adaptation_movies", route: "movies" },
  { label: "Adapted as (TV)", field: "adaptation_television_shows", route: "television/shows" },
  { label: "Adapted as (game)", field: "adaptation_games", route: "games" },
] as const;

function bookMeta(b: Book) {
  const authors = b.persons.filter((p) => p.role === "author").map((p) => p.name);
  return [
    String(b.release_year),
    b.word_count != null ? `${b.word_count.toLocaleString()} words` : null,
    authors.length ? authors.join(", ") : null,
  ].filter(Boolean).join(" · ");
}

function ReadCount({ entry }: { entry: RankedBook }) {
  const update = useUpdateBookEntry(entry.book.id);
  return <CountControl value={entry.reads} unit="read" busy={update.isPending} onChange={(reads) => update.mutate({ reads })} />;
}

export function BooksPage() {
  const { guildId } = useGuildApi();
  const { data: genres = [] } = useBookGenres();

  const facets = useMemo(() => {
    const names = taxonomyNames(genres);
    return [{ key: "genre", label: "genres", values: (t: Book) => names(t.genre_ids) }];
  }, [genres]);
  const genreName = Object.fromEntries(genres.map((g) => [g.id, g.name]));

  const matches = useCallback((b: Book, needle: string, by: string) => {
    if ((by === "title" || by === "all") && matchesAny(needle, b.name, b.name_en, b.alias)) return true;
    if (by === "genre" || by === "all") {
      const ids = taxonIdsMatching(needle, genres);
      if (b.genre_ids.some((id) => ids.has(id))) return true;
    }
    return (by === "person" || by === "all") && personNamed(needle, b.persons);
  }, [genres]);

  const detail = (b: Book) => {
    const byRole: Partial<Record<BookRole, Book["persons"]>> = {};
    for (const p of b.persons) (byRole[p.role] ??= []).push(p);
    const genreRefs = b.genre_ids.filter((id) => genreName[id]).map((id) => ({ id, name: genreName[id] }))
      .sort((a, c) => a.name.localeCompare(c.name));
    return (
      <DetailRows rows={[
        ...BOOK_ROLES.filter((r) => byRole[r]?.length).map((role): [string, React.ReactNode] => [
          BOOK_ROLE_LABELS[role], <LinkList items={byRole[role]!} to={(id) => `/g/${guildId}/people/${id}`} />,
        ]),
        ["Alias", b.alias],
        ["Genres", genreRefs.length > 0 && <LinkList items={genreRefs} to={(id) => `/g/${guildId}/books/genres/${id}`} />],
        ...ADAPTATIONS.map((k): [string, React.ReactNode] => [
          k.label, b[k.field].length > 0 && <LinkList items={b[k.field]} to={(id) => `/g/${guildId}/${k.route}/${id}`} />,
        ]),
        ["Notes", b.notes],
      ]} />
    );
  };

  return (
    <EntityListPage<Book, RankedBook>
      title="Books"
      noun={["book", "books"]}
      section="books"
      route="books"
      entityKey="book"
      ranked={useRankedBooks}
      catalog={useBookCatalog}
      searchBy={SEARCH_BY}
      facets={facets}
      countsSection="books"
      sorts={[{ key: "words", label: "Longest", value: (b) => b.word_count }]}
      matches={matches}
      meta={bookMeta}
      year={(b) => b.release_year}
      detail={detail}
      entryControls={(r) => <ReadCount entry={r} />}
      restoreBody={(r) => ({ reads: r.reads })}
      form={(initial, close) => <BookForm initial={initial} onClose={close} />}
    />
  );
}
