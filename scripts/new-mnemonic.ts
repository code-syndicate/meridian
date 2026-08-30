import { newMnemonic, deriveAddress, seedFromMnemonic, derivationPath } from "../src/domain/custody/derive"

const mnemonic = process.argv[2] ?? newMnemonic()
const seed = seedFromMnemonic(mnemonic)

console.log("\nCUSTODY_MNEMONIC=\"" + mnemonic + "\"\n")
console.log("First address on each chain, index 0:\n")
for (const chain of ["bitcoin", "ethereum", "bsc", "tron", "solana"]) {
  console.log(`  ${chain.padEnd(9)} ${derivationPath(chain, 0).padEnd(22)} ${deriveAddress(seed, chain, 0)}`)
}
console.log(
  "\nRestore this phrase in any BIP39 wallet to see the same addresses.\n" +
  "Anything sent to them is spendable with the phrase, so treat it as live keys.\n",
)
