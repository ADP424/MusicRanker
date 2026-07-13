import { GenreChooser as GenreChooserBase } from "../genre/GenreChooser";
import { MOVIE_GENRES } from "../genre/config";

/** Movie-genre picker. Thin wrapper binding the shared chooser to the movie domain. */
export function MovieGenreChooser(props: {
  selected: Set<number>;
  onChange: (next: Set<number>) => void;
  single?: boolean;
  excludeId?: number;
}) {
  return <GenreChooserBase domain={MOVIE_GENRES} {...props} />;
}
