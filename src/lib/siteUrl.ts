/**
 * The public address of the app, for redirects after sign-in and sign-out.
 *
 * Behind a host such as Render the app only sees an internal address (for example http://localhost:10000), so the
 * request URL alone can't be trusted. Order of preference:
 *   1. SITE_URL            - set explicitly on the host (read at run time, no rebuild needed)
 *   2. x-forwarded-* headers - what the host's proxy says the visitor actually used
 *   3. NEXT_PUBLIC_SITE_URL - fixed into the build, fine for local development
 *   4. the request's own address
 */
export function siteOrigin(request: Request): string {
  const explicit = clean(process.env.SITE_URL);
  if (explicit) return explicit;

  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  if (request.headers.get("x-forwarded-host") && host && /^[a-z0-9.-]+(:\d+)?$/i.test(host)) {
    return `${proto === "http" ? "http" : "https"}://${host}`;
  }

  const fromBuild = clean(process.env.NEXT_PUBLIC_SITE_URL);
  if (fromBuild) return fromBuild;

  return new URL(request.url).origin;
}

function clean(v: string | undefined): string | null {
  const t = v?.trim().replace(/\/+$/, "");
  return t ? t : null;
}
