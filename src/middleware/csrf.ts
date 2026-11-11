import type { RequestHandler } from "express"
import { timingSafeEqual } from "node:crypto"
import { randomToken } from "../domain/identity/tokens"

const COOKIE = "meridian_csrf"
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"])

function matches(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length || left.length === 0) return false
  return timingSafeEqual(left, right)
}

/**
 * Double-submit cookie. SameSite=Lax already blocks most cross-site POSTs,
 * but it is a browser policy rather than a check we perform, so we perform
 * the check too.
 */
export function csrfMiddleware(secure: boolean): RequestHandler {
  return (req, res, next) => {
    let token = req.cookies?.[COOKIE] as string | undefined

    if (!token) {
      token = randomToken(24)
      res.cookie(COOKIE, token, { httpOnly: false, secure, sameSite: "lax", path: "/" })
    }
    res.locals.csrfToken = token

    if (SAFE_METHODS.has(req.method)) return next()

    const submitted = String(
      (req.body as Record<string, unknown> | undefined)?._csrf ?? req.get("x-csrf-token") ?? "",
    )
    if (!matches(submitted, token)) {
      res.status(403).render("error", {
        title: "Request rejected | Meridian Exchanger",
        description: "The form could not be submitted.",
        path: req.path,
        heading: "That form has expired.",
        message: "Go back, reload the page, and try again.",
      })
      return
    }
    next()
  }
}
