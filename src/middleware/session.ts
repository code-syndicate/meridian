import type { Response, RequestHandler } from "express"
import type { SessionRepository } from "../db/repositories/sessions"
import type { UserRepository, User } from "../db/repositories/users"

// The __Host- prefix requires Secure, which requires HTTPS. Local development
// is HTTP, so the prefixed name is used only where it can actually work.
export const SESSION_COOKIE_SECURE = "__Host-meridian_session"
export const SESSION_COOKIE_PLAIN = "meridian_session"

export function sessionCookieName(secure: boolean): string {
  return secure ? SESSION_COOKIE_SECURE : SESSION_COOKIE_PLAIN
}

export function setSessionCookie(res: Response, id: string, secure: boolean): void {
  res.cookie(sessionCookieName(secure), id, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 86_400_000,
  })
}

export function clearSessionCookie(res: Response, secure: boolean): void {
  res.clearCookie(sessionCookieName(secure), { path: "/" })
}

declare global {
  namespace Express {
    interface Request {
      user?: User
      sessionId?: string
    }
  }
}

export function sessionMiddleware(deps: {
  sessions: SessionRepository
  users: UserRepository
  secure: boolean
}): RequestHandler {
  return async (req, res, next) => {
    const id = req.cookies?.[sessionCookieName(deps.secure)] as string | undefined
    if (!id) return next()

    const session = await deps.sessions.find(id)
    if (!session) {
      clearSessionCookie(res, deps.secure)
      return next()
    }

    const user = await deps.users.findById(session.userId)
    if (!user || user.status !== "active") {
      await deps.sessions.revoke(id)
      clearSessionCookie(res, deps.secure)
      return next()
    }

    await deps.sessions.touch(id)
    req.user = user
    req.sessionId = id
    res.locals.user = user
    next()
  }
}

export function requireAuth(): RequestHandler {
  return (req, res, next) => {
    if (!req.user) {
      res.redirect(303, "/login")
      return
    }
    next()
  }
}
