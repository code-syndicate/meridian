import { test, expect, describe } from "bun:test"
import * as OTPAuth from "otpauth"
import {
  encryptSecret,
  decryptSecret,
  generateTotpSecret,
  totpUri,
  verifyTotp,
  generateRecoveryCodes,
  hashRecoveryCode,
  verifyRecoveryCode,
} from "../../../src/domain/identity/totp"

const KEY = "k".repeat(32)

describe("secret encryption at rest", () => {
  test("round trips", () => {
    const secret = generateTotpSecret()
    expect(decryptSecret(encryptSecret(secret, KEY), KEY)).toBe(secret)
  })

  test("ciphertext does not contain the plaintext", () => {
    const secret = generateTotpSecret()
    expect(encryptSecret(secret, KEY)).not.toContain(secret)
  })

  test("uses a fresh iv, so the same input encrypts differently", () => {
    const secret = generateTotpSecret()
    expect(encryptSecret(secret, KEY)).not.toBe(encryptSecret(secret, KEY))
  })

  test("rejects decryption under the wrong key", () => {
    const payload = encryptSecret(generateTotpSecret(), KEY)
    expect(() => decryptSecret(payload, "j".repeat(32))).toThrow()
  })

  test("rejects a tampered ciphertext, because GCM authenticates", () => {
    const payload = encryptSecret(generateTotpSecret(), KEY)
    const parts = payload.split(".")
    const flipped = parts[1]!.slice(0, -2) + (parts[1]!.endsWith("AA") ? "BB" : "AA")
    expect(() => decryptSecret(`${parts[0]}.${flipped}.${parts[2]}`, KEY)).toThrow()
  })
})

describe("generateTotpSecret", () => {
  test("returns a base32 secret of at least 32 characters", () => {
    const secret = generateTotpSecret()
    expect(secret).toMatch(/^[A-Z2-7]+$/)
    expect(secret.length).toBeGreaterThanOrEqual(32)
  })

  test("returns a different secret each time", () => {
    expect(generateTotpSecret()).not.toBe(generateTotpSecret())
  })
})

describe("totpUri", () => {
  test("builds a provisioning uri an authenticator app understands", () => {
    const uri = totpUri("JBSWY3DPEHPK3PXP", "user@example.com")
    expect(uri).toStartWith("otpauth://totp/")
    expect(uri).toContain("Meridian")
    expect(uri).toContain("user%40example.com")
    expect(uri).toContain("secret=JBSWY3DPEHPK3PXP")
  })
})

describe("verifyTotp", () => {
  function currentToken(secret: string): string {
    return new OTPAuth.TOTP({
      issuer: "Meridian",
      label: "test",
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(secret),
    }).generate()
  }

  test("accepts the current token", () => {
    const secret = generateTotpSecret()
    expect(verifyTotp(secret, currentToken(secret))).toBe(true)
  })

  test("rejects a wrong token", () => {
    const secret = generateTotpSecret()
    expect(verifyTotp(secret, "000000")).toBe(false)
  })

  test("rejects a malformed token", () => {
    const secret = generateTotpSecret()
    expect(verifyTotp(secret, "abc")).toBe(false)
    expect(verifyTotp(secret, "")).toBe(false)
    expect(verifyTotp(secret, "1234567")).toBe(false)
  })

  test("tolerates whitespace a user pastes in", () => {
    const secret = generateTotpSecret()
    const token = currentToken(secret)
    expect(verifyTotp(secret, `${token.slice(0, 3)} ${token.slice(3)}`)).toBe(true)
  })

  test("returns false rather than throwing on a malformed secret", () => {
    expect(verifyTotp("not base32!!!", "123456")).toBe(false)
  })
})

describe("recovery codes", () => {
  test("issues ten codes by default", () => {
    expect(generateRecoveryCodes()).toHaveLength(10)
  })

  test("issues codes that are unique", () => {
    const codes = generateRecoveryCodes()
    expect(new Set(codes).size).toBe(codes.length)
  })

  test("formats codes so a person can read them back", () => {
    for (const code of generateRecoveryCodes()) {
      expect(code).toMatch(/^[a-z0-9]{5}-[a-z0-9]{5}$/)
    }
  })

  test("hashes so a database leak does not hand over the codes", async () => {
    const [code] = generateRecoveryCodes()
    const hash = await hashRecoveryCode(code!)
    expect(hash).not.toContain(code!)
    expect(hash).toStartWith("$argon2id$")
  })

  test("verifies a correct code", async () => {
    const [code] = generateRecoveryCodes()
    expect(await verifyRecoveryCode(code!, await hashRecoveryCode(code!))).toBe(true)
  })

  test("rejects a wrong code", async () => {
    const [a, b] = generateRecoveryCodes()
    expect(await verifyRecoveryCode(b!, await hashRecoveryCode(a!))).toBe(false)
  })
})
