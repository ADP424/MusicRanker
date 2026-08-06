import { GenreChooser as GenreChooserBase } from "../genre/GenreChooser";
import { TELEVISION_GENRES } from "../genre/config";

/** Television-genre picker. Thin wrapper binding the shared chooser to the television domain. */
export function TelevisionGenreChooser(props: {
  selected: Set<number>;
  onChange: (next: Set<number>) => void;
  single?: boolean;
  excludeId?: number;
}) {
  return <GenreChooserBase domain={TELEVISION_GENRES} {...props} />;
}
