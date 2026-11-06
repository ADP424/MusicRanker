import { useQuery } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { api } from "../api/client";
import { useBookGenres, useGuildApi } from "../api/hooks";
import { gk } from "../api/keys";
import type { Book } from "../api/types";
import { BOOK_ROLE_LABELS, BOOK_ROLES } from "../api/types";
import { BookForm } from "../components/BookForm";
import { DetailHeader, Facts, Section } from "../components/detail/DetailKit";
import { LinkedWorksSection } from "../components/detail/LinkedWorksSection";
import { MyEntrySection } from "../components/detail/MyEntrySection";
import { PeopleSection } from "../components/detail/PeopleSection";
import { TaxonomySection } from "../components/detail/TaxonomySection";
import { GuildHolders } from "../components/GuildHolders";
import { LinksSection } from "../components/LinksSection";
import { LoadFailed } from "../components/LoadFailed";
import { LoadingState } from "../components/Spinner";
import { BOOK_GENRES } from "../genre/config";
import { GenreChooser } from "../genre/GenreChooser";
import { useCan } from "../guild/GuildProvider";
import { usePageTitle } from "../shell/pageTitle";

export function BookDetailPage() {
  const bookId = Number(useParams<{ id: string }>().id);
  const { guildId, base } = useGuildApi();
  const canEdit = useCan("catalog_edit");
  const [editing, setEditing] = useState(false);
  const { data: genres = [] } = useBookGenres();
  const genreNames = useMemo(() => new Map(genres.map((g) => [g.id, g.name])), [genres]);

  const { data: book, isLoading, isError, error, refetch } = useQuery({
    queryKey: gk(guildId, "books", bookId),
    queryFn: () => api.get<Book>(`${base}/books/${bookId}`),
    enabled: !isNaN(bookId),
  });

  usePageTitle(book?.name);
  if (isLoading) return <LoadingState label="Loading book…" />;
  if (isError || !book) return <LoadFailed what="book" error={error} onRetry={() => void refetch()} />;

  return (
    <div className="grid gap-5">
      <DetailHeader
        title={book.name}
        altTitle={book.name_en}
        facts={[
          book.release_year,
          book.word_count != null && `${book.word_count.toLocaleString()} words`,
          book.alias && `also “${book.alias}”`,
        ]}
        actions={canEdit && <Button variant="outline" size="sm" onClick={() => setEditing(true)}><Pencil className="size-4" /> Edit</Button>}
      />
      <GuildHolders vertical="books" id={book.id} />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="grid content-start gap-5">
          <PeopleSection path="books" ownerId={book.id} persons={book.persons} roles={BOOK_ROLES}
                         roleLabels={BOOK_ROLE_LABELS} defaultRole="author" />
          <LinkedWorksSection title="Adaptations" path={`books/${book.id}/adaptations`}
                              emptyText="No movies, shows or games adapted from it in the catalog."
                              linked={{ movie: book.adaptation_movies, television_show: book.adaptation_television_shows, game: book.adaptation_games }} />
          {book.notes && <Section title="Notes"><Facts items={[["Notes", book.notes]]} /></Section>}
        </div>
        <div className="grid content-start gap-5">
          <MyEntrySection entryPath={`books/${book.id}`} noun="book" counter={{ key: "reads", label: "Reads" }} />
          <TaxonomySection path="books" ownerId={book.id} ids={book.genre_ids} names={genreNames}
                           linkTo={(id) => `books/genres/${id}`}
                           chooser={(sel, change) => <GenreChooser domain={BOOK_GENRES} selected={sel} onChange={change} />} />
          <LinksSection path="books" section="books" ownerId={book.id} />
        </div>
      </div>

      {editing && (
        <>
          <BookForm initial={book} onClose={() => setEditing(false)} />
        </>
      )}
    </div>
  );
}
