import { api, q } from '../api.ts'

let cache: { ws: string; files: string[]; at: number } | undefined

/** The repo's files (tracked and untracked, ignored left out), cached for half a minute. */
export async function repoFiles(ws: string): Promise<string[]> {
  if (cache && cache.ws === ws && Date.now() - cache.at < 30_000) return cache.files
  const files = await api.get<string[]>(`/api/git/files${q({ ws })}`)
  cache = { ws, files, at: Date.now() }
  return files
}

export function cachedFiles(ws: string | undefined): string[] {
  return cache && cache.ws === ws ? cache.files : []
}

/** Subsequence match with a score: consecutive hits and hits after `/` count more, the file name most. */
export function fuzzy(text: string, query: string): number {
  if (!query) return 1
  const t = text.toLowerCase(), qq = query.toLowerCase()
  let ti = 0, score = 0, streak = 0
  for (const ch of qq) {
    const found = t.indexOf(ch, ti)
    if (found < 0) return 0
    streak = found === ti ? streak + 1 : 0
    score += 1 + streak * 2 + (found === 0 || t[found - 1] === '/' || t[found - 1] === '-' || t[found - 1] === '_' ? 3 : 0)
    ti = found + 1
  }
  const base = t.slice(t.lastIndexOf('/') + 1)
  if (base.includes(qq)) score += 20
  return score - t.length * 0.02
}
