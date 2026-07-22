import { GenreChooser as GenreChooserBase } from "../genre/GenreChooser";
import { GAME_GENRES } from "../genre/config";

/** Game-genre picker. Thin wrapper binding the shared chooser to the game domain. */
export function GameGenreChooser(props: {
  selected: Set<number>;
  onChange: (next: Set<number>) => void;
  single?: boolean;
  excludeId?: number;
}) {
  return <GenreChooserBase domain={GAME_GENRES} {...props} />;
}
