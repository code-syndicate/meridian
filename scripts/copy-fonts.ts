import { mkdir, copyFile } from "node:fs/promises"
import { existsSync } from "node:fs"

const FACES: Array<{ from: string; to: string }> = [
  {
    from: "node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2",
    to: "public/fonts/inter-variable.woff2",
  },
  {
    from: "node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2",
    to: "public/fonts/jetbrains-mono-400.woff2",
  },
  {
    from: "node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-500-normal.woff2",
    to: "public/fonts/jetbrains-mono-500.woff2",
  },
]

await mkdir("public/fonts", { recursive: true })
for (const face of FACES) {
  if (!existsSync(face.from)) {
    throw new Error(`Font file missing: ${face.from}. Run bun install first.`)
  }
  await copyFile(face.from, face.to)
  console.log(`copied ${face.to}`)
}
