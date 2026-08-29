export type IdentityErrorCode =
  | "weak_password"
  | "breached_password"
  | "invalid_credentials"
  | "email_taken"
  | "token_invalid"
  | "token_expired"
  | "token_consumed"
  | "totp_invalid"
  | "totp_not_enabled"
  | "rate_limited"
  | "csrf_invalid"
  | "session_invalid"

export class IdentityError extends Error {
  constructor(
    readonly code: IdentityErrorCode,
    message: string,
  ) {
    super(message)
    this.name = "IdentityError"
  }
}
