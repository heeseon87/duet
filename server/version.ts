import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')

/** A hash of the server's own code: the launcher restarts a server whose code is older than this. */
export function codeHash(root = ROOT): string {
  const h = createHash('sha1')
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.(ts|mjs)$/.test(name)) h.update(name).update(readFileSync(p))
    }
  }
  walk(join(root, 'server'))
  walk(join(root, 'shared'))
  return h.digest('hex').slice(0, 12)
}
