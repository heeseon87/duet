import { execFile } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync, appendFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'

export const DUET_HOME = process.env.DUET_HOME ?? join(homedir(), '.duet')

export function ensureDir(path: string): string {
  mkdirSync(path, { recursive: true })
  return path
}

export function readJson<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch {
    return fallback
  }
}

/** Write through a temp file and rename, so a crash never leaves half a file. */
export function writeJson(path: string, value: unknown): void {
  ensureDir(dirname(path))
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
  writeFileSync(tmp, JSON.stringify(value, null, 2))
  renameSync(tmp, path)
}

export function appendJsonl(path: string, value: unknown): void {
  ensureDir(dirname(path))
  appendFileSync(path, JSON.stringify(value) + '\n')
}

export function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return []
  const out: T[] = []
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line) continue
    try {
      out.push(JSON.parse(line) as T)
    } catch {
      // A line cut by a crash; skip it.
    }
  }
  return out
}

/** A folder name for a working tree: readable, and unique by path. */
export function slugOf(path: string): string {
  const hash = createHash('sha1').update(path).digest('hex').slice(0, 10)
  return `${basename(path).replace(/[^A-Za-z0-9._-]/g, '_')}-${hash}`
}

export function newId(prefix = ''): string {
  return prefix + Date.now().toString(36) + randomBytes(4).toString('hex')
}

export type RunResult = { stdout: string; stderr: string; code: number }

export function run(cmd: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv; input?: string; maxBuffer?: number; timeout?: number } = {}): Promise<RunResult> {
  return new Promise(resolve => {
    const child = execFile(cmd, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      maxBuffer: opts.maxBuffer ?? 64 * 1024 * 1024,
      timeout: opts.timeout ?? 30_000,
      encoding: 'utf8',
    }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : 1) : 0
      // A missing program (ENOENT) leaves stderr empty: the error's own message says what happened.
      resolve({ stdout: stdout ?? '', stderr: stderr || (err ? String(err.message) : ''), code })
    })
    if (opts.input !== undefined) child.stdin?.end(opts.input)
  })
}

/** git without a shell; never writes the work tree or the real index. */
export async function git(cwd: string, args: string[], opts: { env?: NodeJS.ProcessEnv; maxBuffer?: number; timeout?: number; allowFail?: boolean } = {}): Promise<string> {
  const res = await run('git', ['-c', 'core.quotepath=off', '-c', 'color.ui=never', ...args], {
    cwd,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', ...opts.env },
    maxBuffer: opts.maxBuffer,
    timeout: opts.timeout,
  })
  if (res.code !== 0 && !opts.allowFail) throw new Error(`git ${args.slice(0, 3).join(' ')} failed: ${res.stderr.trim().slice(0, 400)}`)
  return res.stdout
}

export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}
