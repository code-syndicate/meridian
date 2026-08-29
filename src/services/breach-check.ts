export interface BreachCheck {
  isBreached(password: string): Promise<boolean>
}

/**
 * Have I Been Pwned range API, using k-anonymity: only the first five
 * characters of the SHA-1 hash leave this process, and the full password
 * never does. A network failure must not block a registration, so this
 * fails open and says "not breached".
 */
export class HibpBreachCheck implements BreachCheck {
  constructor(private readonly timeoutMs = 3000) {}

  async isBreached(password: string): Promise<boolean> {
    const digest = new Bun.CryptoHasher("sha1").update(password).digest("hex").toUpperCase()
    const prefix = digest.slice(0, 5)
    const suffix = digest.slice(5)

    try {
      const response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
        signal: AbortSignal.timeout(this.timeoutMs),
        headers: { "add-padding": "true" },
      })
      if (!response.ok) return false
      const body = await response.text()
      for (const line of body.split("\n")) {
        const [hashSuffix, countRaw] = line.trim().split(":")
        if (hashSuffix === suffix && Number(countRaw ?? "0") > 0) return true
      }
      return false
    } catch {
      return false
    }
  }
}

export class NeverBreached implements BreachCheck {
  async isBreached(): Promise<boolean> {
    return false
  }
}

export class AlwaysBreached implements BreachCheck {
  async isBreached(): Promise<boolean> {
    return true
  }
}
