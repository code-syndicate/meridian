import type { Request, RequestHandler, Response } from "express"
import { createHmac, timingSafeEqual } from "node:crypto"

const COOKIE = "meridian_flash"
const TTL_MS = 60_000

function sign(message: string, key: string): string {
  const payload = `${Buffer.from(message, "utf8").toString("base64url")}.${Date.now() + TTL_MS}`
  return `${payload}.${createHmac("sha256", key).update(payload).digest("base64url")}`
}

function read(value: string | undefined, key: string): string | null {
  if (!value) return null
  const parts = value.split(".")
  if (parts.length !== 3) return null
  const [encoded, expiry, mac] = parts as [string, string, string]
  const expected = createHmac("sha256", key).update(`${encoded}.${expiry}`).digest("base64url")
  const a = Buffer.from(mac)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  if (Number(expiry) < Date.now()) return null
  return Buffer.from(encoded, "base64url").toString("utf8")
}

declare global {
  namespace Express {
    interface Response {
      flash(message: string): void
    }
  }
}

/**
 * A confirmation carried across a redirect in a signed cookie and rendered
 * server-side. Chosen over a JavaScript toast because a confirmation that
 * vanishes when a script fails to load leaves the user asking "did that
 * save?", and for a password change that is the wrong question to leave open.
 *
 * Signed so a user cannot inject arbitrary text into their own page, and
 * cleared on read so it shows exactly once.
 */
export function flashMiddleware(secret: string, secure: boolean): RequestHandler {
  return (req: Request, res: Response, next) => {
    const message = read(req.cookies?.[COOKIE] as string | undefined, secret)
    if (message !== null) {
      res.locals.flash = message
      res.clearCookie(COOKIE, { path: "/" })
    } else {
      res.locals.flash = null
    }

    res.flash = (text: string): void => {
      res.cookie(COOKIE, sign(text, secret), {
        httpOnly: true,
        secure,
        sameSite: "lax",
        path: "/",
        maxAge: TTL_MS,
      })
    }

    next()
  }
}
