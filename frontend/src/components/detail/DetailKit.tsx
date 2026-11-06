import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useGuildApi } from "../../api/hooks";
import { safeHref } from "../../lib/url";
import { InlineBusy } from "../Spinner";

/** The top of a detail page: title (+ original-language name), a line of facts, actions. */
export function DetailHeader({ title, altTitle, eyebrow, facts, actions }: {
  title: string;
  altTitle?: string | null;
  /** Small line above the title, e.g. the show a season belongs to. */
  eyebrow?: ReactNode;
  facts?: ReactNode[];
  actions?: ReactNode;
}) {
  const shown = (facts ?? []).filter((f) => f != null && f !== false && f !== "");
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        {eyebrow && <p className="mb-1 text-sm text-muted-foreground">{eyebrow}</p>}
        <h1 className="break-words">
          {title}
          {altTitle && <span className="font-normal text-muted-foreground"> ({altTitle})</span>}
        </h1>
        {shown.length > 0 && (
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
            {shown.map((f, i) => (
              <span key={i} className="flex items-center gap-2">{i > 0 && <span aria-hidden>·</span>}{f}</span>
            ))}
          </p>
        )}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/** A titled card on a detail page. */
export function Section({ title, count, busy, actions, children, className }: {
  title: string;
  count?: number;
  busy?: boolean;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("gap-3 px-5 py-4", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base">
          {title}
          {count != null && <span className="text-sm font-normal text-muted-foreground">{count}</span>}
          {busy && <InlineBusy label="Saving…" />}
        </h2>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </Card>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

/** Label/value pairs, e.g. "Soundtrack: …", "Based on: …", "Notes: …". */
export function Facts({ items }: { items: Array<[label: string, value: ReactNode] | null | false | undefined> }) {
  const rows = items.filter((r): r is [string, ReactNode] => !!r && r[1] != null && r[1] !== false && r[1] !== "");
  if (!rows.length) return null;
  return (
    <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="min-w-0 whitespace-pre-line">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** "A, B and C" as links into the guild. */
export function RefLinks({ items, to }: {
  items: Array<{ id: number; name: string; name_en?: string | null }>;
  to: (id: number) => string;
}) {
  const { guildId } = useGuildApi();
  if (!items.length) return null;
  return (
    <span>
      {items.map((x, i) => (
        <span key={x.id}>
          {i > 0 && ", "}
          <Link to={`/g/${guildId}/${to(x.id)}`} className="font-medium hover:underline">
            {x.name}{x.name_en && <span className="font-normal text-muted-foreground"> ({x.name_en})</span>}
          </Link>
        </span>
      ))}
    </span>
  );
}

/** Minutes as "1h 52m". */
export function fmtMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** External links inline: "Wikipedia, Official site". */
export function ExternalLinks({ links }: { links: Array<{ id: number; label: string | null; url: string }> }) {
  return (
    <span>
      {links.map((l, i) => (
        <span key={l.id}>
          {i > 0 && ", "}
          <a href={safeHref(l.url)} target="_blank" rel="noreferrer" className="font-medium hover:underline">{l.label ?? l.url}</a>
        </span>
      ))}
    </span>
  );
}
