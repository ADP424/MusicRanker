const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? `${res.status} ${res.statusText}`);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

export const api = {
  get:    <T>(p: string)               => req<T>(p),
  post:   <T>(p: string, b: unknown)   => req<T>(p, { method: "POST",  body: JSON.stringify(b) }),
  patch:  <T>(p: string, b: unknown)   => req<T>(p, { method: "PATCH", body: JSON.stringify(b) }),
  put:    <T>(p: string, b?: unknown)  => req<T>(p, { method: "PUT",   body: b ? JSON.stringify(b) : undefined }),
  delete:     (p: string)              => req<void>(p, { method: "DELETE" }),
};