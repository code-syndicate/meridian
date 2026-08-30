import { test, expect, describe } from "bun:test"
import {
  deriveAddress, derivationPath, seedFromMnemonic, isValidMnemonic, newMnemonic,
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
