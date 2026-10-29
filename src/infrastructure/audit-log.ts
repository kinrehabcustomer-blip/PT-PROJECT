/**
 * Security-relevant events as one JSON line each, so they can be searched in
 * the host's logs (Vercel → Logs: search for `"audit":true`). Never pass
 * passwords, tokens or message bodies here.
 */
export function audit(event: string, fields: Record<string, string | number | boolean | undefined> = {}): void {
  console.info(JSON.stringify({ audit: true, at: new Date().toISOString(), event, ...fields }));
}

/** The caller's address as the platform reports it (the first hop of x-forwarded-for). */
export function clientIp(request: Request): string | undefined {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || undefined;
}
