import type { CastRole, TmdbPerson, TmdbTvPerson } from "../api/types";
import { CAST_ROLE_LABELS } from "../api/types";

const TMDB_ACTOR_ROLES: CastRole[] = ["lead_actor", "actor", "cameo_actor"];

/** Media-agnostic shape a `TmdbPersonRow` renders — movie and TV credits both
 * adapt down to this via a small `toRow` mapper in their own dialog. */
export interface TmdbRowMatch {
  person_id: number;
  person_name: string;
  /** Has movie or TV credits — the "we can verify this" signal. */
  has_entries: boolean;
  /** True iff has_entries and a credit's title overlaps this filmography.
   * False with has_entries=true means a name-only match against a differing
   * filmography (e.g. a title mismatch between our catalog and TMDB's). */
  filmography_overlap: boolean;
  artist_summary: string;
  game_summary: string;
}

export interface TmdbRowPerson {
  tmdb_id: number;
  name: string;
  description: string;
  suggested_role: CastRole;
  suggestion_reason: string;
  top_credits: string[];
  nationality_guess: string;
  /** Crew rows show a fixed role instead of a picker (e.g. Director, Creator). */
  roleLocked: boolean;
  matches: TmdbRowMatch[];
}

/** The `desc` line: "as <character> (#N)" for cast, the job for crew/guests. */
export function tmdbCreditDescription(p: TmdbPerson | TmdbTvPerson): string {
  if (p.credit_type !== "cast" && p.credit_type !== "guest") {
    return p.job ?? "Crew";
  }
  const billing = `#${(p.billing_order ?? 0) + 1}`;
  const base = `as ${p.character ?? "?"} (${billing})`;
  if ("episode_count" in p && p.episode_count != null) {
    return `${base} — ${p.episode_count} episode${p.episode_count !== 1 ? "s" : ""}`;
  }
  return p.credit_type === "guest" ? `${base} — guest star` : base;
}

export function TmdbPersonRow({
  person,
  groupName,
  checked,
  role,
  resolution,
  roleOptions = TMDB_ACTOR_ROLES,
  onToggle,
  onRoleChange,
  onResolve,
}: {
  person: TmdbRowPerson;
  groupName: string;
  checked: boolean;
  role: CastRole;
  resolution: number | null | undefined;
  /** Actor-role choices; crew rows are locked to their suggestion. */
  roleOptions?: CastRole[];
  onToggle: () => void;
  onRoleChange: (r: CastRole) => void;
  onResolve: (personId: number | null) => void;
}) {
  const verifiedMatch = person.matches.find((m) => m.filmography_overlap);
  const unverifiedMatches = person.matches.filter((m) => !m.filmography_overlap);

  // Overridden = verified match exists but user explicitly changed away from it
  const isOverridden =
    verifiedMatch != null &&
    resolution !== undefined &&
    resolution !== verifiedMatch.person_id;

  return (
    <div className={`tip-row${checked ? " tip-row--checked" : ""}`}>
      <label className="tip-check">
        <input type="checkbox" checked={checked} onChange={onToggle} />
      </label>

      <div className="tip-body">
        <div className="tip-main">
          <strong className="tip-name">{person.name}</strong>
          <span className="tip-desc">{person.description}</span>
          {person.roleLocked ? (
            <span className="tip-role-fixed">{CAST_ROLE_LABELS[role]}</span>
          ) : (
            <select
              className="tip-role-select"
              value={role}
              onChange={(e) => onRoleChange(e.target.value as CastRole)}
            >
              {roleOptions.map((r) => (
                <option key={r} value={r}>
                  {CAST_ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          )}
          <span className="tip-nat">{person.nationality_guess}</span>
        </div>

        {person.top_credits.length > 0 && (
          <div className="tip-credits">
            {person.top_credits.slice(0, 3).join("  ·  ")}
          </div>
        )}

        <div className="tip-suggestion">💡 {person.suggestion_reason}</div>

        {/* Verified match, not overridden — compact green badge with override button */}
        {verifiedMatch && !isOverridden && (
          <div className="tip-match tip-match--ok">
            ✓ Matched: {verifiedMatch.person_name} (#{verifiedMatch.person_id})
            <button
              type="button"
              className="tip-override"
              onClick={() => onResolve(null)}
            >
              Not this person
            </button>
          </div>
        )}

        {/* Verified match overridden — show all candidates as radio group */}
        {verifiedMatch && isOverridden && (
          <div className="tip-match tip-match--warn">
            <p>⚠ Match overridden — select alternative:</p>
            {person.matches.map((m) => (
              <div key={m.person_id} className="tip-conflict-option">
                <label>
                  <input
                    type="radio"
                    name={`resolve-${groupName}`}
                    checked={resolution === m.person_id}
                    onChange={() => onResolve(m.person_id)}
                  />
                  Use <strong>{m.person_name}</strong> (#{m.person_id})
                  {!m.has_entries && " — no screen credits"}
                  {m.has_entries && !m.filmography_overlap && " — differing filmography, name match only"}
                </label>
                {!m.filmography_overlap && (
                  <>
                    <div className="tip-artist-summary">{m.artist_summary}</div>
                    <div className="tip-artist-summary">{m.game_summary}</div>
                  </>
                )}
              </div>
            ))}
            <label className="tip-conflict-option">
              <input
                type="radio"
                name={`resolve-${groupName}`}
                checked={resolution === null}
                onChange={() => onResolve(null)}
              />
              Create new person
            </label>
          </div>
        )}

        {/* No verified match, unverified matches exist */}
        {!verifiedMatch && unverifiedMatches.length > 0 && (
          <div className="tip-match tip-match--warn">
            <p>⚠ Name match only — not verified against this filmography:</p>
            {unverifiedMatches.map((m) => (
              <div key={m.person_id} className="tip-conflict-option">
                <label>
                  <input
                    type="radio"
                    name={`resolve-${groupName}`}
                    checked={resolution === m.person_id}
                    onChange={() => onResolve(m.person_id)}
                  />
                  Use existing <strong>{m.person_name}</strong> (#{m.person_id})
                  {m.has_entries
                    ? " — has movie/TV credits, but a different filmography"
                    : " — no movie or TV credits"}
                </label>
                <div className="tip-artist-summary">{m.artist_summary}</div>
                <div className="tip-artist-summary">{m.game_summary}</div>
              </div>
            ))}
            <label className="tip-conflict-option">
              <input
                type="radio"
                name={`resolve-${groupName}`}
                checked={resolution === null || resolution === undefined}
                onChange={() => onResolve(null)}
              />
              Create new person
            </label>
          </div>
        )}
      </div>
    </div>
  );
}
