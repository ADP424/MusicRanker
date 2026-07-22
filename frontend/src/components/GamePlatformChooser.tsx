import { GenreChooser as GenreChooserBase } from "../genre/GenreChooser";
import { GAME_PLATFORMS } from "../genre/config";

/** Game-platform picker. Thin wrapper binding the shared chooser to the game-platform domain. */
export function GamePlatformChooser(props: {
  selected: Set<number>;
  onChange: (next: Set<number>) => void;
  single?: boolean;
  excludeId?: number;
}) {
  return <GenreChooserBase domain={GAME_PLATFORMS} {...props} />;
}
