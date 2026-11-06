import { EntityStatsPage, type StatsConfig } from "../stats/EntityStatsPage";
import { count, decade, decadeCol, score, scoreScatter, yearCol } from "../stats/common";

const natCols = [{ key: "nationality", label: "Author nationality" }, count("book_count", "Books"), score("avg_book_score", "Avg Book Score")];
const genreCols = [
  { key: "genre_name", label: "Genre" }, count("book_count", "Books"), count("book_count_direct", "Books (direct)"),
  score("avg_book_score", "Avg Book Score"),
];

const BOOKS: StatsConfig = {
  slug: "book-stats",
  title: "Book stats",
  summary: [
    { title: "Totals", stats: [
      { label: "Books", key: "total_books", fmt: "int" },
      { label: "Authors", key: "total_authors", fmt: "int" },
      { label: "Avg books / author", key: "avg_books_per_author", fmt: "num" },
    ] },
    { title: (s) => `Words (${s.books_with_word_count ?? 0} of ${s.total_books ?? 0} books have a count)`, stats: [
      { label: "Unique words", key: "unique_words", fmt: "int" },
      { label: "Avg words / book", key: "avg_book_words", fmt: "int" },
      { label: "Words read (with re-reads)", key: "total_words_read", fmt: "int" },
      { label: "Avg read / book", key: "avg_words_read", fmt: "int" },
    ] },
    { title: "Best & worst years", stats: [
      { label: "Best year", key: "best_year_books" }, { label: "Worst year", key: "worst_year_books" },
      decade("best_decade_books", "Best decade"), decade("worst_decade_books", "Worst decade"),
    ] },
    { title: "Core nationality", stats: [
      { label: "Best (books)", key: "best_core_nationality_books" }, { label: "Best (authors)", key: "best_core_nationality_authors" },
      { label: "Worst (books)", key: "worst_core_nationality_books" }, { label: "Worst (authors)", key: "worst_core_nationality_authors" },
    ] },
    { title: "Birth nationality", stats: [
      { label: "Best (books)", key: "best_birth_nationality_books" }, { label: "Best (authors)", key: "best_birth_nationality_authors" },
      { label: "Worst (books)", key: "worst_birth_nationality_books" }, { label: "Worst (authors)", key: "worst_birth_nationality_authors" },
    ] },
  ],
  tables: [
    { title: "By year", from: "by_year", keyCol: "year", cols: [yearCol, count("book_count", "Books"), score("avg_score", "Avg Book Score")] },
    { title: "By decade", from: "by_decade", keyCol: "decade", cols: [decadeCol, count("book_count", "Books"), score("avg_score", "Avg Book Score")] },
    { title: "By author's core nationality", from: "by_nationality.core_nationality", keyCol: "nationality", cols: natCols },
    { title: "By author's birth nationality", from: "by_nationality.birth_nationality", keyCol: "nationality", cols: natCols },
    { title: "By root genre", from: "by_genre.by_root_genre", keyCol: "genre_name", cols: genreCols },
    { title: "By genre", from: "by_genre.by_genre", keyCol: "genre_name", cols: genreCols },
  ],
  bars: [
    { title: "Avg book score by decade", from: "by_decade", x: "decade", xFmt: "decade", fmt: "score", series: [{ key: "avg_score", label: "Avg score" }] },
    { title: "Books by decade", from: "by_decade", x: "decade", xFmt: "decade", fmt: "int", series: [{ key: "book_count", label: "Books" }] },
    { title: "Avg book score by year", from: "by_year", x: "year", fmt: "score", series: [{ key: "avg_score", label: "Avg score" }] },
    { title: "Books by root genre", from: "by_genre.by_root_genre", x: "genre_name", horizontal: true, fmt: "int", series: [{ key: "book_count", label: "Books" }] },
    { title: "Avg book score by root genre", from: "by_genre.by_root_genre", x: "genre_name", horizontal: true, fmt: "score", series: [{ key: "avg_book_score", label: "Avg score" }] },
    { title: "Books by author's nationality", from: "by_nationality.core_nationality", x: "nationality", horizontal: true, fmt: "int", series: [{ key: "book_count", label: "Books" }] },
  ],
  scatters: [
    scoreScatter("Book score vs word count", "scatter.book_score_vs_words", { key: "word_count", label: "Words" }),
    scoreScatter("Author avg score vs avg word count", "scatter.author_score_vs_words", { key: "avg_word_count", label: "Avg words" }, "avg_score"),
  ],
};

export function BookStatsPage() {
  return <EntityStatsPage config={BOOKS} />;
}
