import type { RequestHandler } from "express"

/**
 * Skips the whole admin router for anyone who is not an active admin, so those
 * paths land in the ordinary 404. A signed-in customer should not learn the
 * back office exists, which a 403 would tell them.
 */
export function requireAdmin(): RequestHandler {
  return (req, res, next) => {
    if (!req.user) {
      res.redirect(303, "/login")
      return
    }
    if (req.user.role !== "admin" || req.user.status !== "active") {
      next("router")
      return
    }
    res.locals.isAdmin = true
    next()
  }
}
