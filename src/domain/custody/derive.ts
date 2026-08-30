import { HDKey } from "@scure/bip32"
import { mnemonicToSeedSync, validateMnemonic, generateMnemonic } from "@scure/bip39"
import { wordlist } from "@scure/bip39/wordlists/english.js"
import { bech32, base58 } from "@scure/base"
import { sha256 } from "@noble/hashes/sha2.js"
import { ripemd160 } from "@noble/hashes/legacy.js"
import { keccak_256 } from "@noble/hashes/sha3.js"
import { ed25519 } from "@noble/curves/ed25519.js"
import { secp256k1 } from "@noble/curves/secp256k1.js"

/**
 * BIP44 coin types. Every asset on a chain shares that chain's account, which
 * is what a wallet does: one Ethereum address receives ETH and every ERC20.
 */
const COIN_TYPE: Record<string, number> = {
  bitcoin: 0,
  ethereum: 60,
  bsc: 60,
  tron: 195,
  solana: 501,
}

export function isValidMnemonic(mnemonic: string): boolean {
  return validateMnemonic(mnemonic.trim(), wordlist)
}

export function newMnemonic(): string {
  return generateMnemonic(wordlist, 256)
}

export function seedFromMnemonic(mnemonic: string): Uint8Array {
  if (!isValidMnemonic(mnemonic)) {
    throw new Error("Mnemonic is not a valid BIP39 phrase")
  }
  return mnemonicToSeedSync(mnemonic.trim())
}

function hash160(bytes: Uint8Array): Uint8Array {
  return ripemd160(sha256(bytes))
}

/** P2WPKH, the bc1q form: the cheapest address type every wallet supports. */
function bitcoinAddress(publicKey: Uint8Array): string {
  const words = bech32.toWords(hash160(publicKey))
  return bech32.encode("bc", [0, ...words])
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")
}

/** EIP-55: capitalisation carries a checksum, so a typo is caught on paste. */
function toChecksumAddress(hex: string): string {
  const lower = hex.toLowerCase()
  const hash = bytesToHex(keccak_256(new TextEncoder().encode(lower)))
  let out = "0x"
  for (let i = 0; i < lower.length; i++) {
    out += parseInt(hash[i]!, 16) >= 8 ? lower[i]!.toUpperCase() : lower[i]!
  }
  return out
}

function ethereumAddress(uncompressed: Uint8Array): string {
  // Keccak of the uncompressed key without its 0x04 prefix, last 20 bytes.
  return toChecksumAddress(bytesToHex(keccak_256(uncompressed.slice(1)).slice(-20)))
}

/** Base58Check over 0x41 followed by the same 20 bytes Ethereum uses. */
function tronAddress(uncompressed: Uint8Array): string {
  const body = new Uint8Array(21)
  body[0] = 0x41
  body.set(keccak_256(uncompressed.slice(1)).slice(-20), 1)
  const checksum = sha256(sha256(body)).slice(0, 4)
  const full = new Uint8Array(25)
  full.set(body)
  full.set(checksum, 21)
  return base58.encode(full)
}

function hmacSha512(key: Uint8Array, data: Uint8Array): Uint8Array {
  const hmac = new Bun.CryptoHasher("sha512", key)
  hmac.update(data)
  return new Uint8Array(hmac.digest())
}

/**
 * Solana keys are ed25519, which has no public-key derivation, so every level
 * is hardened under SLIP-0010 rather than BIP32.
 */
function solanaAddress(seed: Uint8Array, index: number): string {
  let key = hmacSha512(new TextEncoder().encode("ed25519 seed"), seed)
  let privateKey = key.slice(0, 32)
  let chainCode = key.slice(32)
  for (const segment of [44, 501, 0, index]) {
    const data = new Uint8Array(37)
    data[0] = 0
    data.set(privateKey, 1)
    new DataView(data.buffer, data.byteOffset, data.byteLength)
      .setUint32(33, (segment + 0x80000000) >>> 0, false)
    key = hmacSha512(chainCode, data)
    privateKey = key.slice(0, 32)
    chainCode = key.slice(32)
  }
  return base58.encode(ed25519.getPublicKey(privateKey))
}

export function derivationPath(chain: string, index: number): string {
  const coinType = COIN_TYPE[chain]
  if (coinType === undefined) {
    throw new Error(`No derivation path defined for chain "${chain}"`)
  }
  // Bitcoin uses BIP84 because the addresses are native segwit. Deriving a
  // bech32 address under BIP44 would produce something no standard wallet
  // shows you when the seed is restored, which defeats the point of holding
  // the phrase.
  const purpose = chain === "bitcoin" ? 84 : 44
  return chain === "solana"
    ? `m/44'/501'/0'/${index}'`
    : `m/${purpose}'/${coinType}'/0'/0/${index}`
}

/**
 * One address per user per chain. The index is the user id, so every address
 * is reproducible from the seed alone: lose the database and the funds are
 * still recoverable by re-deriving.
 */
export function deriveAddress(seed: Uint8Array, chain: string, index: number): string {
  const coinType = COIN_TYPE[chain]
  if (coinType === undefined) {
    throw new Error(`No derivation path defined for chain "${chain}"`)
  }
  if (chain === "solana") return solanaAddress(seed, index)

  const node = HDKey.fromMasterSeed(seed).derive(derivationPath(chain, index))
  if (!node.publicKey) {
    throw new Error(`Derivation produced no public key for ${chain}`)
  }
  if (chain === "bitcoin") return bitcoinAddress(node.publicKey)

  if (!node.privateKey) throw new Error(`No private key for ${chain}`)
  const uncompressed = secp256k1.getPublicKey(node.privateKey, false)
  return chain === "tron" ? tronAddress(uncompressed) : ethereumAddress(uncompressed)
}
