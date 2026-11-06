/** Only ever hand a user-entered URL to `href` if it's http(s). React 18 doesn't
 *  block `javascript:` URLs, and links saved before the server validated them
 *  may still hold one. */
export function safeHref(url: string): string | undefined {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : undefined;
  } catch {
    return undefined;
  }
}
