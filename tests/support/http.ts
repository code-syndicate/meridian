import type { App } from "../../src/server"

export function cookiesFrom(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ")
}

export function mergeCookies(existing: string, res: Response): string {
  const jar = new Map<string, string>()
  for (const pair of existing.split("; ").filter(Boolean)) {
    const [name, ...rest] = pair.split("=")
    jar.set(name!, rest.join("="))
  }
  for (const raw of res.headers.getSetCookie()) {
    const [name, ...rest] = raw.split(";")[0]!.split("=")
    jar.set(name!, rest.join("="))
  }
  return [...jar].map(([k, v]) => `${k}=${v}`).join("; ")
}

export function csrfFrom(html: string): string {
  return html.match(/name="_csrf" value="([^"]+)"/)?.[1] ?? ""
}

/**
 * Fetches a page to pick up a CSRF cookie and token, then posts with both.
 * Pass an existing jar to stay signed in across requests.
 *
 * `tokenPath` exists because some endpoints are POST-only (/logout), so there
 * is no form on that path to read a token from. Fetch it from a page that has
 * one; the token is per-session, not per-form.
 */
export async function post(
  app: App,
  path: string,
  fields: Record<string, string>,
  cookie = "",
  tokenPath = path,
): Promise<Response> {
  const page = await app.inject(tokenPath, cookie ? { headers: { cookie } } : undefined)
  const jar = mergeCookies(cookie, page)
  const token = csrfFrom(await page.text())

  return app.inject(path, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: jar },
    body: new URLSearchParams({ ...fields, _csrf: token }).toString(),
    redirect: "manual",
  })
}

/** Strips the per-request CSRF token so two rendered pages can be compared. */
export function withoutCsrf(html: string): string {
  return html.replace(/name="_csrf" value="[^"]*"/g, 'name="_csrf" value="TOKEN"')
}
