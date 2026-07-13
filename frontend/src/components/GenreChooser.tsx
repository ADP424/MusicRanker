import { GenreChooser as GenreChooserBase } from "../genre/GenreChooser";
import { MUSIC_GENRES } from "../genre/config";

/** Music-genre picker. Thin wrapper binding the shared chooser to the music domain. */
export function GenreChooser(props: {
  selected: Set<number>;
  onChange: (next: Set<number>) => void;
  single?: boolean;
  excludeId?: number;
}) {
  return <GenreChooserBase domain={MUSIC_GENRES} {...props} />;
}
