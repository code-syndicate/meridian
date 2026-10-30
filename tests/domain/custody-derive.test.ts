import { test, expect, describe } from "bun:test"
import { base58 } from "@scure/base"
import { sha256 } from "@noble/hashes/sha2.js"
import { ed25519 } from "@noble/curves/ed25519.js"
import {
  deriveAddress, derivationPath, derivePrivateKey, seedFromMnemonic, isValidMnemonic, newMnemonic,
} from "../../src/domain/custody/derive"

// The canonical BIP39 test phrase. Every address below is the value a standard
// wallet shows for this phrase, so a wrong derivation fails here rather than
// after someone has sent funds to an address we cannot spend.
const VECTOR = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
const seed = seedFromMnemonic(VECTOR)

describe("derivation matches standard wallets", () => {
  const cases: Array<[string, string]> = [
    ["bitcoin", "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu"],
    ["ethereum", "0x9858EfFD232B4033E47d90003D41EC34EcaEda94"],
    ["bsc", "0x9858EfFD232B4033E47d90003D41EC34EcaEda94"],
    ["tron", "TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH"],
    ["solana", "HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk"],
  ]
  for (const [chain, expected] of cases) {
    test(chain, () => {
      expect(deriveAddress(seed, chain, 0)).toBe(expected)
    })
  }
})

describe("paths", () => {
  test("bitcoin uses BIP84, because the address is native segwit", () => {
    expect(derivationPath("bitcoin", 0)).toBe("m/84'/0'/0'/0/0")
  })

  test("an unknown chain throws rather than inventing a path", () => {
    expect(() => derivationPath("dogecoin", 0)).toThrow()
    expect(() => deriveAddress(seed, "dogecoin", 0)).toThrow()
  })
})

describe("addresses", () => {
  test("differ per index, so two users never share one", () => {
    const seen = new Set([0, 1, 2, 3].map((i) => deriveAddress(seed, "bitcoin", i)))
    expect(seen.size).toBe(4)
  })

  test("are stable for the same index", () => {
    expect(deriveAddress(seed, "ethereum", 7)).toBe(deriveAddress(seed, "ethereum", 7))
  })

  test("differ per chain for the same index", () => {
    expect(deriveAddress(seed, "bitcoin", 1)).not.toBe(deriveAddress(seed, "tron", 1))
  })

  test("ethereum and bsc share an address, which is how the chains work", () => {
    expect(deriveAddress(seed, "ethereum", 3)).toBe(deriveAddress(seed, "bsc", 3))
  })

  test("ethereum carries an EIP-55 checksum, not all lower case", () => {
    const address = deriveAddress(seed, "ethereum", 0)
    expect(address).not.toBe(address.toLowerCase())
  })
})

describe("mnemonics", () => {
  test("a valid phrase is accepted", () => {
    expect(isValidMnemonic(VECTOR)).toBe(true)
  })

  test("a phrase with a bad checksum is refused", () => {
    const broken = VECTOR.replace(/about$/, "abandon")
    expect(isValidMnemonic(broken)).toBe(false)
    expect(() => seedFromMnemonic(broken)).toThrow()
  })

  test("nonsense is refused", () => {
    expect(isValidMnemonic("not a real phrase at all")).toBe(false)
  })

  test("a generated phrase is 24 words and valid", () => {
    const generated = newMnemonic()
    expect(generated.split(" ")).toHaveLength(24)
    expect(isValidMnemonic(generated)).toBe(true)
  })
})

describe("private keys", () => {
  // Published vectors for the same phrase: BIP84's first receive key, and the
  // key every Ethereum wallet shows for m/44'/60'/0'/0/0.
  test("bitcoin is the BIP84 vector, as compressed mainnet WIF", () => {
    expect(derivePrivateKey(seed, "bitcoin", 0)).toBe("KyZpNDKnfs94vbrwhJneDi77V6jF64PWPF8x5cdJb8ifgg2DUc9d")
  })

  test("ethereum is the standard vector, as 0x hex", () => {
    expect(derivePrivateKey(seed, "ethereum", 0))
      .toBe("0x1ab42cc412b618bdea3a599e3c9bae199ebf030895b039e9db1e30dafb12b727")
  })

  test("bsc shares the ethereum key, as it shares the address", () => {
    expect(derivePrivateKey(seed, "bsc", 3)).toBe(derivePrivateKey(seed, "ethereum", 3))
  })

  test("a bitcoin WIF carries a valid checksum and the compressed flag", () => {
    const raw = base58.decode(derivePrivateKey(seed, "bitcoin", 2))
    expect(raw).toHaveLength(38)
    expect(raw[0]).toBe(0x80)
    expect(raw[33]).toBe(0x01)
    expect([...sha256(sha256(raw.slice(0, 34))).slice(0, 4)]).toEqual([...raw.slice(34)])
  })

  test("a tron key is 64 hex characters with no prefix, as TronLink imports it", () => {
    expect(derivePrivateKey(seed, "tron", 0)).toMatch(/^[0-9a-f]{64}$/)
  })

  test("a solana key is the 64-byte secret Phantom imports, ending in the address", () => {
    for (const index of [0, 1, 7]) {
      const secret = base58.decode(derivePrivateKey(seed, "solana", index))
      expect(secret).toHaveLength(64)
      expect(base58.encode(ed25519.getPublicKey(secret.slice(0, 32)))).toBe(deriveAddress(seed, "solana", index))
      expect(base58.encode(secret.slice(32))).toBe(deriveAddress(seed, "solana", index))
    }
  })

  test("differs per index", () => {
    for (const chain of ["bitcoin", "ethereum", "tron", "solana"]) {
      expect(derivePrivateKey(seed, chain, 1)).not.toBe(derivePrivateKey(seed, chain, 2))
    }
  })

  test("an unknown chain throws", () => {
    expect(() => derivePrivateKey(seed, "dogecoin", 0)).toThrow()
  })
})
