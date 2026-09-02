import type { Request, RequestHandler } from "express"
import type { RateLimitRepository } from "../db/repositories/rate-limits"
import type { AuditRepository } from "../db/repositories/audit"

export interface RateLimitOptions {
  repo: RateLimitRepository
  audit: AuditRepository
  bucket: (req: Request) => string
  capacity: number
  refillPerSecond: number
  lockSeconds: number
  action: string
}

export function rateLimit(options: RateLimitOptions): RequestHandler {
  return async (req, res, next) => {
    const key = options.bucket(req)
    const result = await options.repo.consume(
      key,
      options.capacity,
      options.refillPerSecond,
      options.lockSeconds,
    )

    if (result.allowed) return next()

    await options.audit.record({
      actorType: "system",
      action: `rate_limited.${options.action}`,
      target: key,
      ip: req.ip ?? null,
      userAgent: req.get("user-agent") ?? null,
    })

    res.status(429).render("error", {
      title: "Too many attempts | Meridian",
      description: "Too many attempts.",
      path: req.path,
      heading: "Too many attempts.",
      message: "Wait a few minutes and try again.",
    })
  }
}
