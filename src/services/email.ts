import nodemailer from "nodemailer"
import type { Transporter } from "nodemailer"

export interface OutboundEmail {
  to: string
  subject: string
  text: string
}

export interface EmailSender {
  send(email: OutboundEmail): Promise<void>
}

/**
 * Development fallback. Prints the body so a verification link is reachable
 * with no vendor configured. Never selected when SMTP is configured, because
 * printing message bodies to a log is not acceptable in production.
 */
export class ConsoleEmailSender implements EmailSender {
  async send(email: OutboundEmail): Promise<void> {
    console.log(
      JSON.stringify({
        msg: "email_sent",
        transport: "console",
        to: email.to,
        subject: email.subject,
      }),
    )
    console.log(email.text)
  }
}

export class SmtpEmailSender implements EmailSender {
  constructor(
    private readonly transport: Transporter,
    private readonly from: string,
  ) {}

  async send(email: OutboundEmail): Promise<void> {
    await this.transport.sendMail({
      from: this.from,
      to: email.to,
      subject: email.subject,
      text: email.text,
    })
    // Subject and recipient only. The body carries verification tokens.
    console.log(
      JSON.stringify({
        msg: "email_sent",
        transport: "smtp",
        to: email.to,
        subject: email.subject,
      }),
    )
  }
}

export class CapturingEmailSender implements EmailSender {
  readonly sent: OutboundEmail[] = []
  async send(email: OutboundEmail): Promise<void> {
    this.sent.push(email)
  }
}

export interface EmailConfig {
  env: string
  smtpHost: string | null
  smtpPort: number
  smtpUser: string | null
  smtpPassword: string | null
  emailFrom: string
}

/**
 * SMTP when it is fully configured, console otherwise. Production refuses to
 * fall back: silently printing verification links to a log while believing
 * mail is being delivered is worse than failing at startup.
 */
export function createEmailSender(config: EmailConfig): EmailSender {
  const configured = Boolean(config.smtpHost && config.smtpUser && config.smtpPassword)

  if (!configured) {
    if (config.env === "production") {
      throw new Error(
        "SMTP is not configured. Set SMTP_HOST, SMTP_USER, and SMTP_PASSWORD, or run outside production.",
      )
    }
    console.log(
      JSON.stringify({
        msg: "email_transport",
        transport: "console",
        reason: "smtp_not_configured",
      }),
    )
    return new ConsoleEmailSender()
  }

  return new SmtpEmailSender(
    nodemailer.createTransport({
      host: config.smtpHost!,
      port: config.smtpPort,
      secure: config.smtpPort === 465,
      auth: { user: config.smtpUser!, pass: config.smtpPassword! },
    }),
    config.emailFrom,
  )
}
