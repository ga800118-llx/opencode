import path from "node:path"

export async function sha256(file: string) {
  const hasher = new Bun.CryptoHasher("sha256")
  for await (const chunk of Bun.file(file).stream()) hasher.update(chunk)
  return hasher.digest("hex")
}

export function formatChecksumManifest(entries: readonly { file: string; sha256: string }[]) {
  return [...entries]
    .sort((a, b) => path.basename(a.file).localeCompare(path.basename(b.file)))
    .map((entry) => `${entry.sha256}  ${path.basename(entry.file)}`)
    .join("\n")
    .concat("\n")
}
