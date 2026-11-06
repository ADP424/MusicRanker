const BASE = import.meta.env.VITE_API_URL ?? "/api";
/** For plain links to the API, e.g. file downloads. */
export const API_BASE = BASE;

function cookie(name: string): string | null {
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Set by AuthProvider; lets a 401 anywhere tear down the session cleanly. */
let onUnauthorized: () => void = () => {};
export const setUnauthorizedHandler = (fn: () => void) => { onUnauthorized = fn; };

/** FastAPI's `detail`: a string, a list of validation errors, or (from /batch)
 *  `{op, path, detail}` wrapping the failing step's own detail. */
function detailText(d: unknown): string | undefined {
  if (d == null) return undefined;
  if (typeof d === "string") return d;
  if (Array.isArray(d)) return d.map((e) => (e && typeof e === "object" && "msg" in e ? String(e.msg) : String(e))).join("; ");
  if (typeof d === "object" && "detail" in d) return detailText((d as { detail: unknown }).detail);
  return JSON.stringify(d);
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    // Double-submit: the server compares this against the csrftoken cookie.
    const csrf = cookie("csrftoken");
    if (csrf) headers["X-CSRF-Token"] = csrf;
  }
  const res = await fetch(`${BASE}${path}`, { credentials: "include", ...init, headers: { ...headers, ...init.headers } });
  if (res.status === 401) {
    // /auth/me's 401 *is* "not logged in" — the normal, expected answer for a
    // logged-out visitor, not a session that just expired. Routing it through
    // onUnauthorized (which clears the query cache, including this very query)
    // made AuthProvider's own useQuery observe a wiped cache mid-resolution and
    // immediately refetch, which 401s again and clears again: an infinite loop
    // on every logged-out page load.
    if (path !== "/auth/me") onUnauthorized();
    throw new ApiError(401, "Not authenticated");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, detailText(body.detail) ?? `${res.status} ${res.statusText}`);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

export const api = {
  get:    <T>(p: string)              => req<T>(p),
  post:   <T>(p: string, b?: unknown) => req<T>(p, { method: "POST",  body: b === undefined ? undefined : JSON.stringify(b) }),
  patch:  <T>(p: string, b: unknown)  => req<T>(p, { method: "PATCH", body: JSON.stringify(b) }),
  put:    <T>(p: string, b?: unknown) => req<T>(p, { method: "PUT",   body: b === undefined ? undefined : JSON.stringify(b) }),
  delete:     (p: string)             => req<void>(p, { method: "DELETE" }),
};

/** The app boots with a GET so the server mints a csrftoken cookie before the
 *  first login POST. Login CSRF is a real attack; it is not exempt. */
export const primeCsrf = () => fetch(`${BASE}/nationalities`, { credentials: "include" });

type BatchOp = { method: "POST" | "PUT" | "PATCH" | "DELETE"; path: string; body?: unknown };

/** Records writes and sends them as one `POST /batch`: one transaction, so a
 *  form's create-then-link steps all happen or none do. A later op can use an
 *  earlier op's response id as "{0.id}" (see `Batch.ref`). */
export class Batch {
  readonly ops: BatchOp[] = [];
  post(path: string, body?: unknown) { this.ops.push({ method: "POST", path, body }); return this; }
  put(path: string, body?: unknown) { this.ops.push({ method: "PUT", path, body }); return this; }
  patch(path: string, body?: unknown) { this.ops.push({ method: "PATCH", path, body }); return this; }
  delete(path: string) { this.ops.push({ method: "DELETE", path }); return this; }
  /** The id of op `i`'s result, to use in a later op's path. */
  static ref(i: number) { return `{${i}.id}`; }
  /** -> each op's response, in order. */
  async run(): Promise<unknown[]> {
    return (await api.post<{ results: unknown[] }>("/batch", { ops: this.ops })).results;
  }
}
