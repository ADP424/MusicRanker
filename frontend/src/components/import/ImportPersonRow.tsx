import { CircleCheck, Lightbulb, Pin, TriangleAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import type { CastRole, TmdbPerson, TmdbTvPerson } from "../../api/types";
import { CAST_ROLE_LABELS } from "../../api/types";

/** An existing catalog person an imported credit might be. */
export interface ImportRowMatch {
  person_id: number;
  person_name: string;
  /** Has credits of the kind being imported: the "we can verify this" signal. */
  has_entries: boolean;
  /** has_entries, and one of them is on this title's credits / filmography. */
  filmography_overlap: boolean;
  /** What else they're credited on ("Artist: …", "Games: …"), to tell namesakes apart. */
  summaries: string[];
}

/** Media-agnostic shape an `ImportPersonRow` renders; each dialog maps its API's credit to it. */
export interface ImportRowPerson<R extends string> {
  name: string;
  description: string;
  suggested_role: R;
  suggestion_reason: string;
  top_credits: string[];
  nationality_guess: string;
  /** Crew rows show a fixed role instead of a picker (e.g. Director, Creator). */
  roleLocked: boolean;
  matches: ImportRowMatch[];
}

/** The `desc` line for a TMDB credit: "as <character> (#N)" for cast, the job for crew. */
export function tmdbCreditDescription(p: TmdbPerson | TmdbTvPerson): string {
  if (p.credit_type !== "cast" && p.credit_type !== "guest") return p.job ?? "Crew";
  const base = `as ${p.character ?? "?"} (#${(p.billing_order ?? 0) + 1})`;
  if ("episode_count" in p && p.episode_count != null) {
    return `${base} · ${p.episode_count} episode${p.episode_count !== 1 ? "s" : ""}`;
  }
  return p.credit_type === "guest" ? `${base} · guest star` : base;
}

/**
 * One credit in an import review: tick to include, pick the role, and decide
 * which catalog person it is (a verified match is preselected; a name-only
 * match asks).
 */
export function ImportPersonRow<R extends string>({
  person, groupName, checked, role, resolution, roleOptions, roleLabels, credits, note,
  onToggle, onRoleChange, onResolve,
}: {
  person: ImportRowPerson<R>;
  /** Unique per row: names its radio group. */
  groupName: string;
  /** Omitted: the credit isn't optional, only who it is. */
  checked?: boolean;
  role: R;
  /** Chosen catalog person: an id, null for "create new", undefined for untouched. */
  resolution: number | null | undefined;
  roleOptions: readonly R[];
  roleLabels: Record<R, string>;
  /** What counts as corroborating credits, e.g. "movie or TV credits". */
  credits: string;
  /** Highlighted context line, e.g. "Already on the show as Lead Actor". */
  note?: string;
  onToggle?: () => void;
  onRoleChange: (r: R) => void;
  onResolve: (personId: number | null) => void;
}) {
  const verified = person.matches.find((m) => m.filmography_overlap);
  const overridden = verified != null && resolution !== undefined && resolution !== verified.person_id;
  const choices = verified ? (overridden ? person.matches : []) : person.matches;
  const radio = `resolve-${groupName}`;

  return (
    <div className={cn("flex gap-3 rounded-md border px-3 py-2 transition-colors", checked ? "border-primary/40 bg-primary/5" : "bg-card")}>
      {onToggle && <Checkbox className="mt-1" checked={checked} onCheckedChange={onToggle} aria-label={`Include ${person.name}`} />}
      <div className="grid min-w-0 flex-1 gap-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium">{person.name}</span>
          <span className="text-sm text-muted-foreground">{person.description}</span>
          <span className="ml-auto flex items-center gap-2">
            {person.nationality_guess && <Badge variant="outline" className="font-normal">{person.nationality_guess}</Badge>}
            {person.roleLocked ? (
              <Badge variant="secondary">{roleLabels[role]}</Badge>
            ) : (
              <select aria-label={`Role for ${person.name}`} className="h-7 py-0 text-xs" value={role}
                      onChange={(e) => onRoleChange(e.target.value as R)}>
                {roleOptions.map((r) => <option key={r} value={r}>{roleLabels[r]}</option>)}
              </select>
            )}
          </span>
        </div>
        {person.top_credits.length > 0 && (
          <p className="truncate text-xs text-muted-foreground">Known for {person.top_credits.slice(0, 3).join(" · ")}</p>
        )}
        {person.suggestion_reason && (
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <Lightbulb className="mt-px size-3.5 shrink-0" />{person.suggestion_reason}
          </p>
        )}
        {note && <p className="flex items-start gap-1.5 text-xs text-success"><Pin className="mt-px size-3.5 shrink-0" />{note}</p>}

        {verified && !overridden && (
          <p className="flex flex-wrap items-center gap-1.5 text-xs text-success">
            <CircleCheck className="size-3.5" />
            Same person as <span className="font-medium">{verified.person_name}</span> (#{verified.person_id})
            <button type="button" data-slot="link" className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
                    onClick={() => onResolve(null)}>
              Not them?
            </button>
          </p>
        )}

        {choices.length > 0 && (
          <fieldset className="grid gap-1.5 rounded-md border border-warning/50 bg-warning/5 px-2.5 py-2 text-xs">
            <legend className="flex items-center gap-1.5 px-1 font-medium">
              <TriangleAlert className="size-3.5 text-warning" />
              {overridden ? "Which person is this?" : "Same name as someone in the catalog, but not verified"}
            </legend>
            {choices.map((m) => (
              <label key={m.person_id} className="flex cursor-pointer items-start gap-2">
                <input type="radio" className="mt-0.5 accent-primary" name={radio} checked={resolution === m.person_id}
                       onChange={() => onResolve(m.person_id)} />
                <span className="grid gap-0.5">
                  <span>
                    Use <span className="font-medium">{m.person_name}</span> (#{m.person_id})
                    <span className="text-muted-foreground">
                      {m.filmography_overlap ? ": verified" : m.has_entries ? `: has ${credits}, none of them this one` : `: no ${credits}`}
                    </span>
                  </span>
                  {!m.filmography_overlap && m.summaries.filter(Boolean).map((s) => (
                    <span key={s} className="text-muted-foreground">{s}</span>
                  ))}
                </span>
              </label>
            ))}
            <label className="flex cursor-pointer items-center gap-2">
              <input type="radio" className="accent-primary" name={radio}
                     checked={overridden ? resolution === null : resolution == null}
                     onChange={() => onResolve(null)} />
              Create a new person
            </label>
          </fieldset>
        )}
      </div>
    </div>
  );
}

const TMDB_ACTOR_ROLES: CastRole[] = ["lead_actor", "actor", "cameo_actor"];

/** `ImportPersonRow` for TMDB movie / TV credits. */
export function TmdbPersonRow(props: Omit<Parameters<typeof ImportPersonRow<CastRole>>[0], "roleOptions" | "roleLabels" | "credits">
  & { roleOptions?: CastRole[] }) {
  return <ImportPersonRow {...props} roleOptions={props.roleOptions ?? TMDB_ACTOR_ROLES} roleLabels={CAST_ROLE_LABELS} credits="movie or TV credits" />;
}
