import type { CastRole, TmdbTvImportPersonIn, TmdbTvPerson } from "../api/types";
import { CAST_ROLE_LABELS } from "../api/types";
import { tmdbCreditDescription, type TmdbRowPerson } from "./TmdbPersonRow";

/** Shared by the show, season and episode TMDB import dialogs. */
export const ACTOR_ROLES: CastRole[] = ["lead_actor", "actor", "cameo_actor"];

export function toRow(p: TmdbTvPerson): TmdbRowPerson {
  return {
    tmdb_id: p.tmdb_id,
    name: p.name,
    description: tmdbCreditDescription(p),
    suggested_role: p.suggested_role,
    suggestion_reason: p.suggestion_reason,
    top_credits: p.top_credits,
    nationality_guess: p.nationality_guess,
    roleLocked: p.credit_type === "crew",
    matches: p.db_matches.map((m) => ({
      person_id: m.person_id,
      person_name: m.person_name,
      has_entries: m.has_screen_entries,
      filmography_overlap: m.filmography_overlap,
      artist_summary: m.artist_summary,
      game_summary: m.game_summary,
    })),
  };
}

/** TMDB id -> existing person: whoever they already are on the parent, else a
 *  filmography-verified match. Never overwrites an earlier pick. */
export function seedResolutions(people: TmdbTvPerson[], into: Record<number, number | null>) {
  for (const p of people) {
    if (p.tmdb_id in into) continue;
    const id = p.parent_person_id ?? p.db_matches.find((m) => m.filmography_overlap)?.person_id;
    if (id != null) into[p.tmdb_id] = id;
  }
}

/** "Already on the show as Creator, Lead Actor" — or undefined if they aren't. */
export function parentNote(p: TmdbTvPerson, parent: "show" | "season"): string | undefined {
  if (p.parent_roles.length === 0) return undefined;
  return `Already on the ${parent} as ${p.parent_roles.map((r) => CAST_ROLE_LABELS[r]).join(", ")} — preselected`;
}

export function personIn(
  p: TmdbTvPerson,
  role: CastRole,
  resolutions: Record<number, number | null>,
): TmdbTvImportPersonIn {
  return {
    tmdb_id: p.tmdb_id,
    name: p.name,
    role,
    nationality: p.nationality_guess,
    existing_person_id: resolutions[p.tmdb_id] ?? null,
  };
}

/** The director/composer credits the show/season step attaches automatically. */
export function autoCrewLabel(people: TmdbTvPerson[]): string {
  const by = (role: CastRole) => people.filter((p) => p.suggested_role === role).map((p) => p.name);
  const bits: string[] = [];
  const dirs = by("director");
  const comps = by("composer");
  if (dirs.length) bits.push(`Dir: ${dirs.join(", ")}`);
  if (comps.length) bits.push(`Comp: ${comps.join(", ")}`);
  return bits.join(" · ") || "no director/composer credited";
}
