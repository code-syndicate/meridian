import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto"

const ALGORITHM = "aes-256-gcm"
const IV_BYTES = 12

function keyFrom(key: string): Buffer {
  // The configured key is a passphrase, not raw bytes. Derive a fixed 32-byte
  // key from it so any sufficiently long configured value works.
  return createHash("sha256").update(key).digest()
}

export function encryptSecret(plaintext: string, key: string): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, keyFrom(key), iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv, ciphertext, tag].map((b) => b.toString("base64url")).join(".")
}

export function decryptSecret(payload: string, key: string): string {
  const [ivPart, ciphertextPart, tagPart] = payload.split(".")
  if (!ivPart || !ciphertextPart || !tagPart) {
    throw new Error("Malformed encrypted payload")
  }
  const decipher = createDecipheriv(ALGORITHM, keyFrom(key), Buffer.from(ivPart, "base64url"))
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"))
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextPart, "base64url")),
    decipher.final(),
  ]).toString("utf8")
}
