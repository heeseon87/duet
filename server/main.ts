import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createReadStream, existsSync, readFileSync, realpathSync, statSync, watch, writeFileSync, type FSWatcher } from 'node:fs'
import { codeHash } from './version.ts'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { homedir } from 'node:os'
import { extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import type { CanvasThread, ContextItem, DiffSource, PermissionDecision, PermissionMode, ReviewComment, ReviewRepo, ServerEvent, SessionEvent, TerminalInfo, Workspace } from '../shared/protocol.ts'
import { deliveryOf, fileOfRef, type CanvasPatch, type CanvasRevision, type Delivery } from '../shared/canvas.ts'
import { DUET_HOME, HttpError, readJson, writeJson, ensureDir, newId } from './util.ts'
import { gitInfo, grep, listFiles, log as gitLog, readAt, toplevel, workspaceName, currentBranch, mainRoot } from './git/repo.ts'
import { computeDiff } from './git/diff.ts'
import { findRepos } from './fs/repos.ts'
import { prList, prView } from './git/pr.ts'
import { SessionManager } from './agent/manager.ts'
import { composePrompt, type Session } from './agent/session.ts'
import { CANVAS_TOOLS, runCanvasTool, type CanvasToolName } from './agent/canvasTools.ts'
import { Terminals, workspaceFor } from './terminals.ts'
import { repoOf } from './agent/repos.ts'
import { CanvasStore } from './canvas/store.ts'
import { readComments, reviewPrompt, sourceKey, writeComments } from './review/comments.ts'

const VERSION = '0.1.0'
const args = new Map<string, string>()
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i]
  if (a.startsWith('--')) args.set(a.slice(2), process.argv[i + 1]?.startsWith('--') ? 'true' : (process.argv[++i] ?? 'true'))
}
const PORT = Number(args.get('port') ?? process.env.DUET_PORT ?? 7979)
const WEB_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', 'dist', 'web')
ensureDir(DUET_HOME)
// The token outlives restarts, so an open tab stays signed in when the server comes back.
const TOKEN_FILE = join(DUET_HOME, 'token')
const TOKEN = process.env.DUET_TOKEN ?? (existsSync(TOKEN_FILE) ? readFileSync(TOKEN_FILE, 'utf8').trim() : (() => {
  const t = randomBytes(24).toString('hex')
  writeFileSync(TOKEN_FILE, t, { mode: 0o600 })
  return t
})())
const CODE_HASH = codeHash()

// ------------------------------------------------------------------ events

const clients = new Set<ServerResponse>()
function broadcast(ev: ServerEvent) {
  const data = `data: ${JSON.stringify(ev)}\n\n`
  for (const c of clients) c.write(data)
}

// A rebuilt web bundle reaches the open tab at once, but this process keeps its old code until `duet` restarts
// it; the two then disagree (a new context chip once reached the agent as "- undefined"). Say so in the tab.
let stale = false
setInterval(() => {
  if (stale || codeHash() === CODE_HASH) return
  stale = true
  broadcast({ topic: 'stale' })
}, 10_000).unref()

const terminals = new Terminals(() => broadcast({ topic: 'terminals', terminals: terminals.list() }))
const canvas = new CanvasStore(
  (workspace, name, revision, by) => { broadcast({ topic: 'canvas', workspace, name, revision, by }); terminals.canvasChanged(workspace) },
  workspace => { broadcast({ topic: 'canvas-list', workspace }); terminals.canvasChanged(workspace) },
)
// A turn's final answer goes back to the canvas thread of every prompt it answered (a prompt sent
// while a turn runs can join that turn).
function trackTurns(sessionId: string, event: SessionEvent) {
  if (event.kind !== 'turn-end') return
  const text = event.summary?.result?.trim()
  const ws = sessions.find(sessionId)?.info.workspace
  if (text && ws) for (const messageId of event.prompts ?? []) replyOnCanvas(ws, messageId, text, { sessionId })
}
function replyOnCanvas(ws: string, messageId: string, text: string, from: { sessionId?: string; terminal?: string }) {
  try {
    for (const m of canvas.list(ws)) {
      const thread = canvas.threads(ws, m.name).find(t => t.items.some(i => i.messageId === messageId))
      if (!thread) continue
      // The agent already answered on the thread itself (canvas_reply) during this turn.
      const asked = thread.items.findIndex(i => i.messageId === messageId)
      if (thread.items.slice(asked + 1).some(i => i.who === 'agent')) return
      const short = text.length > 1500 ? `${text.slice(0, 1500)}…` : text
      canvas.addThreadItem(ws, m.name, { threadId: thread.id, target: thread.target, who: 'agent', text: short, ...from })
      return
    }
  } catch (e) {
    console.error('canvas reply failed', e)
  }
}

const sessions = new SessionManager({
  emit: (sessionId, event) => { broadcast({ topic: 'session', sessionId, event }); trackTurns(sessionId, event) },
  delta: (sessionId, msg) => broadcast({ topic: 'delta', sessionId, msg }),
  changed: () => broadcast({ topic: 'sessions', sessions: sessions.list() }),
  canvas,
})

/** Where each sent canvas message stands, worked out from the live sessions and the map's history on every read. */
function deliveries(ws: string, name: string, threads: CanvasThread[], known?: CanvasRevision[]): Record<string, Delivery> {
  let revisions = known
  const history = () => (revisions ??= canvas.history(ws, name))
  const out: Record<string, Delivery> = {}
  for (const t of threads) {
    t.items.forEach((item, i) => {
      const live = !item.messageId ? undefined
        : item.terminal ? terminals.promptState(item.terminal, item.messageId)
        : item.sessionId ? sessions.find(item.sessionId)?.promptState(item.messageId) : undefined
      const d = deliveryOf(t.items, i, live, history)
      if (d) out[item.id] = d
    })
  }
  return out
}

// ------------------------------------------------------------------ workspaces

const WS_FILE = join(DUET_HOME, 'workspaces.json')
function workspaces(): Workspace[] {
  return readJson<Workspace[]>(WS_FILE, []).sort((a, b) => b.lastOpened - a.lastOpened)
}
async function openWorkspace(path: string): Promise<Workspace> {
  const { homedir } = await import('node:os')
  const root = await toplevel(path.trim().replace(/^~(?=$|\/)/, homedir()).replace(/\/+$/, '') || homedir())
  const ws: Workspace = { path: root, name: await workspaceName(root), mainRoot: await mainRoot(root), branch: await currentBranch(root), lastOpened: Date.now() }
  writeJson(WS_FILE, [ws, ...workspaces().filter(w => w.path !== root)].slice(0, 30))
  watchRepo(root)
  return ws
}
/**
 * A tree the review may show: a workspace, or a repo that one of its conversations wrote in (a
 * worktree under it, a sibling repo). `home` is the workspace it belongs to.
 */
function reviewRoot(path: string | null): { root: string; home: string } {
  if (!path) throw new HttpError(400, 'workspace is required')
  if (workspaces().some(w => w.path === path)) return { root: path, home: path }
  const home = sessions.ownerOf(path) ?? mapRepos.get(path)
  if (!home) throw new HttpError(403, '열린 적 없는 작업 공간이야. 먼저 열어 줘.')
  watchRepo(path)
  return { root: path, home }
}
function knownWorkspace(path: string | null): string {
  if (!path) throw new HttpError(400, 'workspace is required')
  const ws = workspaces().find(w => w.path === path)
  if (!ws) throw new HttpError(403, '열린 적 없는 작업 공간이야. 먼저 열어 줘.')
  return ws.path
}

/** The open workspace a folder (a terminal's cwd) belongs to, worked out from what Duet knows of each workspace. */
async function workspaceOfPath(path: string): Promise<string | undefined> {
  const real = (() => { try { return realpathSync(path) } catch { return resolve(path) } })()
  const all = []
  for (const w of workspaces()) {
    const maps = canvas.list(w.path).flatMap(m => canvas.get(w.path, m.name).map.elements.flatMap(e => (e.files ?? []).map(f => resolve(w.path, fileOfRef(f)))))
    all.push({ path: w.path, reaches: [...(await sessions.touchedRepos(w.path)).keys(), ...maps] })
  }
  return workspaceFor(real, await repoOf(real), all)
}

// ------------------------------------------------------------------ where what the person sends goes

/** A conversation, or a terminal the person picked in the agent panel. */
type Target = { session: Session } | { terminal: TerminalInfo }

/**
 * The target a request names, checked before anything is written: a terminal that closed, or one working
 * in another workspace, is refused. No target named means a new conversation.
 */
function targetOf(ws: string, b: { sessionId?: string; terminalId?: string }): Target {
  if (b.terminalId) {
    const terminal = terminals.get(b.terminalId)
    if (terminal.workspace !== ws) throw new HttpError(400, '그 터미널은 다른 작업 공간에서 일해')
    return { terminal }
  }
  return { session: b.sessionId ? sessions.get(b.sessionId) : sessions.create({ workspace: ws }) }
}
const sender = (to: Target) => ('terminal' in to ? { terminal: to.terminal.id } : { sessionId: to.session.info.id })
/** A terminal gets the very prompt a Duet conversation would read. */
async function deliver(to: Target, text: string, context: ContextItem[], messageId: string, display?: string): Promise<{ sessionId?: string; terminalId?: string }> {
  if ('session' in to) {
    await to.session.send(text, context, messageId, display)
    return { sessionId: to.session.info.id }
  }
  terminals.send(to.terminal.id, composePrompt(text, context), messageId)
  return { terminalId: to.terminal.id }
}

// Repo watchers: tell the browser which paths changed, so the review refreshes itself.
const watchers = new Map<string, { w: FSWatcher; timer?: NodeJS.Timeout; paths: Set<string>; last: number }>()
const IGNORED = /(^|\/)(node_modules|\.gradle|build|dist|out|target|\.idea|\.next|\.turbo|\.cache)(\/|$)/
function watchRepo(root: string) {
  const existing = watchers.get(root)
  if (existing) { existing.last = Date.now(); return }
  if (watchers.size >= 6) {
    const oldest = [...watchers.entries()].sort((a, b) => a[1].last - b[1].last)[0]
    oldest[1].w.close()
    watchers.delete(oldest[0])
  }
  try {
    const entry = { w: watch(root, { recursive: true }), paths: new Set<string>(), last: Date.now(), timer: undefined as NodeJS.Timeout | undefined }
    entry.w.on('change', (_type, name) => {
      const p = String(name ?? '')
      if (!p || IGNORED.test(p)) return
      if (p.startsWith('.git/') && !/^\.git\/(index|HEAD|refs\/)/.test(p)) return
      entry.paths.add(p)
      clearTimeout(entry.timer)
      entry.timer = setTimeout(() => {
        broadcast({ topic: 'repo-changed', workspace: root, paths: [...entry.paths].slice(0, 200) })
        entry.paths.clear()
      }, 350)
    })
    entry.w.on('error', () => { entry.w.close(); watchers.delete(root) })
    watchers.set(root, entry)
  } catch {
    // Some filesystems refuse recursive watch; the review still has its refresh button.
  }
}

// ------------------------------------------------------------------ http plumbing

type Ctx = { req: IncomingMessage; res: ServerResponse; url: URL; params: Record<string, string> }
type Handler = (ctx: Ctx) => Promise<unknown> | unknown
const routes: { method: string; pattern: RegExp; keys: string[]; handler: Handler }[] = []
function route(method: string, path: string, handler: Handler) {
  const keys: string[] = []
  const pattern = new RegExp('^' + path.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)' }) + '$')
  routes.push({ method, pattern, keys, handler })
}

async function body<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const c of req) {
    size += (c as Buffer).length
    // Pasted screenshots ride in JSON as base64; leave room for a few.
    if (size > 32 * 1024 * 1024) throw new HttpError(413, 'body too large')
    chunks.push(c as Buffer)
  }
  if (!size) return {} as T
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T
  } catch {
    throw new HttpError(400, 'invalid JSON')
  }
}

function send(res: ServerResponse, status: number, value: unknown) {
  const text = JSON.stringify(value ?? null)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(text)
}

function tokenOk(req: IncomingMessage): boolean {
  const header = req.headers['x-duet-token']
  const cookie = /(?:^|;\s*)duet=([^;]+)/.exec(req.headers.cookie ?? '')?.[1]
  const given = typeof header === 'string' ? header : cookie
  if (!given || given.length !== TOKEN.length) return false
  return timingSafeEqual(Buffer.from(given), Buffer.from(TOKEN))
}

const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`])

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.json': 'application/json', '.ico': 'image/x-icon',
}

function serveStatic(res: ServerResponse, pathname: string) {
  let file = resolve(WEB_ROOT, '.' + decodeURIComponent(pathname))
  if (!file.startsWith(WEB_ROOT + sep) && file !== WEB_ROOT) { res.writeHead(403).end(); return }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(WEB_ROOT, 'index.html')
  if (!existsSync(file)) { res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' }).end('웹 빌드가 없어. `npm run build`를 먼저 실행해.'); return }
  const immutable = pathname.startsWith('/assets/')
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-store' })
  createReadStream(file).pipe(res)
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
  // DNS rebinding: only our own host names reach the app.
  if (!ALLOWED_HOSTS.has(req.headers.host ?? '')) { res.writeHead(421).end('bad host'); return }
  const origin = req.headers.origin
  if (origin && !ALLOWED_HOSTS.has(origin.replace(/^https?:\/\//, ''))) { res.writeHead(403).end('bad origin'); return }

  if (!url.pathname.startsWith('/api/')) {
    if (url.searchParams.get('t')) {
      const t = url.searchParams.get('t')!
      if (t.length === TOKEN.length && timingSafeEqual(Buffer.from(t), Buffer.from(TOKEN))) {
        res.writeHead(302, { 'set-cookie': `duet=${TOKEN}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`, location: '/' + (url.searchParams.get('ws') ? `?ws=${encodeURIComponent(url.searchParams.get('ws')!)}` : '') })
        res.end()
        return
      }
    }
    if (!url.pathname.startsWith('/assets/') && !tokenOk(req)) {
      res.writeHead(401, { 'content-type': 'text/html; charset=utf-8' })
      res.end('<meta charset="utf-8"><body style="font:15px system-ui;padding:40px;color:#333">Duet은 <code>duet</code> 명령이 여는 주소로만 들어올 수 있어.</body>')
      return
    }
    serveStatic(res, url.pathname)
    return
  }

  if (!tokenOk(req)) { send(res, 401, { error: 'unauthorized' }); return }
  const r = routes.find(x => x.method === req.method && x.pattern.test(url.pathname))
  if (!r) { send(res, 404, { error: 'not found' }); return }
  const m = r.pattern.exec(url.pathname)!
  const params: Record<string, string> = {}
  r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]) })
  try {
    const out = await r.handler({ req, res, url, params })
    if (!res.headersSent) send(res, 200, out ?? { ok: true })
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500
    if (status === 500) console.error(e)
    if (!res.headersSent) send(res, status, { error: (e as Error).message })
  }
})

// ------------------------------------------------------------------ routes

route('GET', '/api/health', () => ({ app: 'duet', version: VERSION, codeHash: CODE_HASH, running: sessions.list().filter(s => s.status === 'running' || s.status === 'waiting').length }))

route('GET', '/api/events', ({ req, res }) => {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
  res.write(`data: ${JSON.stringify({ topic: 'hello', version: VERSION, stale } satisfies ServerEvent)}\n\n`)
  clients.add(res)
  const ping = setInterval(() => res.write(': ping\n\n'), 20_000)
  req.on('close', () => { clearInterval(ping); clients.delete(res) })
})

route('GET', '/api/workspaces', () => workspaces())
route('GET', '/api/workspaces/for', async ({ url }) => {
  const path = url.searchParams.get('path')
  if (!path) throw new HttpError(400, 'path is required')
  // null, not a 404: a 404 here means a server too old to know this route.
  return { workspace: (await workspaceOfPath(path)) ?? null }
})
/** Folder suggestions for the path box: sub-folders under the home folder only, git repos marked. */
route('GET', '/api/fs/dirs', async ({ url }) => {
  const { homedir } = await import('node:os')
  const { readdir } = await import('node:fs/promises')
  const home = homedir()
  const raw = (url.searchParams.get('prefix') ?? '').replace(/^~(?=$|\/)/, home)
  const full = resolve(raw || home)
  const endsWithSlash = raw.endsWith('/')
  const dir = endsWithSlash ? full : resolve(full, '..')
  const stem = endsWithSlash ? '' : full.slice(dir.length + 1)
  if (dir !== home && !dir.startsWith(home + sep)) return { dirs: [] }
  const display = (p: string) => (p.startsWith(home) ? '~' + p.slice(home.length) : p)
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    const here = endsWithSlash && dir !== home ? { path: dir, name: dir.split(sep).pop() ?? dir, display: display(dir), repo: entries.some(e => e.name === '.git') } : undefined
    const out = entries
      .filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name.toLowerCase().startsWith(stem.toLowerCase()))
      .slice(0, 400)
      .map(e => ({ path: join(dir, e.name), name: e.name, repo: existsSync(join(dir, e.name, '.git')) }))
      .sort((a, b) => Number(b.repo) - Number(a.repo) || a.name.localeCompare(b.name))
    return { here, dirs: out.map(e => ({ ...e, display: display(e.path) })) }
  } catch {
    return { dirs: [] }
  }
})
route('GET', '/api/fs/repos', async () => findRepos())
route('POST', '/api/workspaces', async ({ req }) => openWorkspace((await body<{ path: string }>(req)).path))

route('GET', '/api/git/info', async ({ url }) => gitInfo(reviewRoot(url.searchParams.get('ws')).root))
route('GET', '/api/git/files', async ({ url }) => listFiles(reviewRoot(url.searchParams.get('ws')).root))
route('GET', '/api/git/log', async ({ url }) => gitLog(reviewRoot(url.searchParams.get('ws')).root, url.searchParams.get('ref') ?? 'HEAD', Number(url.searchParams.get('limit') ?? 60)))
route('GET', '/api/git/grep', async ({ url }) => grep(reviewRoot(url.searchParams.get('ws')).root, url.searchParams.get('q') ?? ''))
route('GET', '/api/git/file', async ({ url }) => {
  const { root } = reviewRoot(url.searchParams.get('ws'))
  const text = await readAt(root, url.searchParams.get('ref') ?? 'WORKTREE', url.searchParams.get('path') ?? '')
  return { exists: text !== undefined, text: text ?? '' }
})

route('GET', '/api/git/pr', async ({ url }) => {
  const n = url.searchParams.get('number')
  return { pr: await prView(reviewRoot(url.searchParams.get('ws')).root, n ? Number(n) : undefined) }
})
route('GET', '/api/git/prs', async ({ url }) => prList(reviewRoot(url.searchParams.get('ws')).root))
/** Repos that a workspace's maps point at (their boxes' files), with the workspace: reviewable from it. */
const mapRepos = new Map<string, string>()
/** Repos other than the workspace that its conversations wrote in or its maps point at, so the review can show them. */
route('GET', '/api/review/repos', async ({ url }) => {
  const ws = knownWorkspace(url.searchParams.get('ws'))
  const found = new Map<string, { sessions: string[]; maps: string[] }>()
  for (const [path, ids] of await sessions.touchedRepos(ws)) found.set(path, { sessions: ids, maps: [] })
  for (const m of canvas.list(ws)) {
    const map = canvas.get(ws, m.name).map
    const roots = new Set<string>()
    for (const ref of new Set(map.elements.flatMap(e => (e.files ?? []).map(fileOfRef)))) {
      const top = await repoOf(resolve(ws, ref))
      if (top && top !== ws) roots.add(top)
    }
    for (const r of roots) {
      const entry = found.get(r) ?? { sessions: [], maps: [] }
      entry.maps.push(m.name)
      found.set(r, entry)
      mapRepos.set(r, ws)
    }
  }
  const repos: ReviewRepo[] = []
  for (const [path, via] of found) {
    if (!existsSync(path)) continue
    repos.push({ path, name: await workspaceName(path), branch: await currentBranch(path), label: path.startsWith(ws + '/') ? path.slice(ws.length + 1) : path.replace(homedir(), '~'), ...via })
  }
  return repos
})
route('POST', '/api/review/diff', async ({ req }) => {
  const b = await body<{ ws: string; source: DiffSource; context?: number; ignoreWhitespace?: boolean; path?: string }>(req)
  const { root } = reviewRoot(b.ws)
  return computeDiff(root, b.source, { context: b.context, ignoreWhitespace: b.ignoreWhitespace, path: b.path }, (sessionId, turnId) => sessions.get(sessionId).turnSnapshots(turnId, root))
})
route('POST', '/api/review/comments/get', async ({ req }) => {
  const b = await body<{ ws: string; source: DiffSource }>(req)
  return readComments(reviewRoot(b.ws).root, sourceKey(b.source))
})
route('POST', '/api/review/comments/put', async ({ req }) => {
  const b = await body<{ ws: string; source: DiffSource; comments: ReviewComment[] }>(req)
  writeComments(reviewRoot(b.ws).root, sourceKey(b.source), b.comments)
  return { ok: true }
})
/** Sends the chosen comments to a session as one prompt and marks them sent. */
route('POST', '/api/review/send', async ({ req }) => {
  const b = await body<{ ws: string; source: DiffSource; sessionId?: string; terminalId?: string; ids: string[]; header: string; extra?: string }>(req)
  const { root: ws, home } = reviewRoot(b.ws)
  const key = sourceKey(b.source)
  const all = readComments(ws, key)
  const chosen = all.filter(c => b.ids.includes(c.id))
  if (!chosen.length) throw new HttpError(400, '보낼 코멘트가 없어')
  const to = targetOf(home, b)
  const display = `코멘트 ${chosen.length}개 · ${chosen[0].body.split('\n')[0].slice(0, 80)}${chosen.length > 1 ? ' 외' : ''}`
  const messageId = newId('m-')
  const sent = await deliver(to, reviewPrompt(chosen, b.header, b.extra), chosen.map(c => ({ kind: 'review' as const, path: c.path, lines: c.startLine === c.endLine ? `${c.startLine}` : `${c.startLine}-${c.endLine}`, label: c.body.split('\n')[0].slice(0, 60) })), messageId, display)
  for (const c of all) if (b.ids.includes(c.id)) { c.state = 'sent'; c.sentTo = 'terminal' in to ? { terminal: to.terminal.id, messageId } : { sessionId: to.session.info.id, messageId } }
  writeComments(ws, key, all)
  return { ...sent, messageId }
})

route('GET', '/api/sessions', async ({ url }) => {
  const ws = url.searchParams.get('ws') ?? undefined
  if (ws) await sessions.learnWorkTrees(ws)
  return sessions.list(ws)
})
route('POST', '/api/sessions', async ({ req }) => {
  const b = await body<{ ws: string; model?: string; permissionMode?: PermissionMode; effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'; resume?: string; title?: string }>(req)
  const ws = knownWorkspace(b.ws)
  const s = b.resume ? await sessions.importClaude(ws, b.resume, b.title) : sessions.create({ workspace: ws, model: b.model, permissionMode: b.permissionMode, effort: b.effort })
  return s.info
})
route('GET', '/api/sessions/:id', ({ params }) => {
  const s = sessions.get(params.id)
  return { info: s.info, log: s.log(), pending: s.pendingRequests(), init: s.init ?? null }
})
route('PATCH', '/api/sessions/:id', async ({ req, params }) => {
  const s = sessions.get(params.id)
  await s.configure(await body(req))
  return s.info
})
route('DELETE', '/api/sessions/:id', ({ params }) => { sessions.remove(params.id) })
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
route('POST', '/api/sessions/:id/messages', async ({ req, params }) => {
  const b = await body<{ text: string; context?: import('../shared/protocol.ts').ContextItem[]; images?: import('../shared/protocol.ts').ImageUpload[] }>(req)
  const images = (b.images ?? []).filter(i => IMAGE_TYPES.has(i.mediaType) && typeof i.data === 'string').slice(0, 6)
  if (!b.text?.trim() && !images.length) throw new HttpError(400, '빈 메시지야')
  return { id: await sessions.get(params.id).send(b.text?.trim() || '이 이미지를 봐 줘.', b.context, undefined, undefined, images) }
})
route('GET', '/api/sessions/:id/files/:file', ({ params, res }) => {
  const s = sessions.get(params.id)
  if (!/^[\w.-]+$/.test(params.file)) throw new HttpError(400, 'bad file')
  const path = join(s.filesDir, params.file)
  if (!existsSync(path)) throw new HttpError(404, 'no such file')
  res.writeHead(200, { 'content-type': MIME[extname(path)] ?? (path.endsWith('.jpg') ? 'image/jpeg' : path.endsWith('.webp') ? 'image/webp' : path.endsWith('.gif') ? 'image/gif' : 'application/octet-stream'), 'cache-control': 'private, max-age=86400' })
  createReadStream(path).pipe(res)
})
route('GET', '/api/sessions/:id/turns', async ({ url, params }) => sessions.get(params.id).turns(reviewRoot(url.searchParams.get('root')).root))
route('POST', '/api/sessions/:id/interrupt', async ({ params }) => { await sessions.get(params.id).interrupt() })
route('POST', '/api/sessions/:id/permissions/:pid', async ({ req, params }) => {
  const ok = sessions.get(params.id).decide(params.pid, await body<PermissionDecision>(req))
  if (!ok) throw new HttpError(409, '이미 처리된 요청이야')
})
route('GET', '/api/claude-sessions', async ({ url }) => sessions.claudeSessions(knownWorkspace(url.searchParams.get('ws'))))

route('GET', '/api/canvas', ({ url }) => canvas.list(knownWorkspace(url.searchParams.get('ws'))))
route('GET', '/api/canvas/:name', ({ url, params }) => {
  const ws = knownWorkspace(url.searchParams.get('ws'))
  const cur = canvas.get(ws, params.name)
  const revisions = canvas.history(ws, params.name)
  const history = revisions.map(r => ({ revision: r.revision, by: r.by, note: r.note, ts: r.ts }))
  const threads = canvas.threads(ws, params.name)
  return { ...cur, history, threads, deliveries: deliveries(ws, params.name, threads, revisions) }
})
route('GET', '/api/canvas/:name/threads', ({ url, params }) => {
  const ws = knownWorkspace(url.searchParams.get('ws'))
  const threads = canvas.threads(ws, params.name)
  return { threads, deliveries: deliveries(ws, params.name, threads) }
})
route('GET', '/api/canvas/:name/rev/:rev', ({ url, params }) => canvas.revision(knownWorkspace(url.searchParams.get('ws')), params.name, Number(params.rev)))
route('POST', '/api/canvas', async ({ req }) => {
  const b = await body<{ ws: string; name: string; diagram: 'class' | 'sequence'; title: string; context?: string }>(req)
  return canvas.create(knownWorkspace(b.ws), b.name, b.diagram, b.title, b.context, 'person')
})
route('POST', '/api/canvas/:name/patch', async ({ req, params }) => {
  const b = await body<{ ws: string; patch: CanvasPatch; note?: string; baseRevision?: number }>(req)
  return canvas.update(knownWorkspace(b.ws), params.name, b.patch, 'person', b.note, b.baseRevision)
})
/** The person's choice. With `notify` it also goes to a conversation, kept like a comment as a thread on the decision. */
route('POST', '/api/canvas/:name/choose', async ({ req, params }) => {
  const b = await body<{ ws: string; decision: string; option: string | null; rationale?: string; notify?: boolean; sessionId?: string; terminalId?: string }>(req)
  const ws = knownWorkspace(b.ws)
  const asked = b.notify && b.option && (b.sessionId || b.terminalId) ? targetOf(ws, b) : undefined
  const cur = canvas.choose(ws, params.name, b.decision, b.option, b.rationale)
  if (!b.notify || !b.option) return cur
  const d = cur.map.decisions?.find(x => x.id === b.decision)
  const opt = d?.options.find(o => o.id === b.option)
  const letter = b.option.replace(`${b.decision}-`, '')
  const said = `${letter}로 정함${b.rationale ? ` · 이유 ${b.rationale}` : ''}`
  const to = asked ?? targetOf(ws, {})
  const messageId = newId('m-')
  const last = canvas.threads(ws, params.name).filter(t => t.target === b.decision).pop()
  const thread = canvas.addThreadItem(ws, params.name, { threadId: last?.id, target: b.decision, who: 'person', text: said, ...sender(to), messageId })
  const sent = await deliver(
    to,
    [
      `[캔버스 결정] 지도 "${cur.map.title}" (${params.name}, rev ${cur.revision})에서 결정 하나를 정했어.`,
      `- 질문: ${b.decision} ${d?.question ?? ''}`,
      `- 고른 선택지: ${b.option} ${opt?.text ?? ''}`,
      ...(b.rationale ? [`- 이유: ${b.rationale}`] : []),
      '',
      '다른 선택지에 딸린 요소는 지도에서 정리했고, 고른 쪽 요소에는 결정 표시가 남아 있어. 이 결정에 맞게 다음 작업을 이어 가 줘.',
      `(thread ${thread.id}: 답은 채팅으로 하고, 설계가 바뀌면 canvas_update로 지도도 고쳐 줘.)`,
    ].join('\n'),
    [{ kind: 'canvas', map: params.name, target: b.decision, label: `${b.decision} → ${letter}` }],
    messageId,
    `${b.decision} ${said}`,
  )
  return { ...cur, ...sent, thread }
})
route('POST', '/api/canvas/:name/restore', async ({ req, params }) => {
  const b = await body<{ ws: string; revision: number }>(req)
  return canvas.restore(knownWorkspace(b.ws), params.name, b.revision)
})
route('DELETE', '/api/canvas/:name', ({ url, params }) => { canvas.remove(knownWorkspace(url.searchParams.get('ws')), params.name) })
/** A comment on the canvas: kept as a thread on the target, and sent to the session as a prompt. */
route('POST', '/api/canvas/:name/comment', async ({ req, params }) => {
  const b = await body<{ ws: string; target: string; text: string; threadId?: string; sessionId?: string; terminalId?: string }>(req)
  const ws = knownWorkspace(b.ws)
  const cur = canvas.get(ws, params.name)
  const to = targetOf(ws, b)
  const messageId = newId('m-')
  const thread = canvas.addThreadItem(ws, params.name, { threadId: b.threadId, target: b.target, who: 'person', text: b.text, ...sender(to), messageId })
  const where = b.target ? `"${thread.targetLabel}" (${b.target})` : '지도 전체'
  const sent = await deliver(
    to,
    `[캔버스 코멘트] 지도 "${cur.map.title}" (${params.name}, rev ${cur.revision})의 ${where}에 대해:\n\n${b.text}\n\n(thread ${thread.id}: 답은 채팅으로 하고, 설계가 바뀌면 canvas_update로 지도도 고쳐 줘.)`,
    [{ kind: 'canvas', map: params.name, target: b.target, label: thread.targetLabel }],
    messageId,
    b.text,
  )
  return { thread, ...sent, messageId }
})
route('POST', '/api/canvas/:name/threads/:tid', async ({ req, params }) => {
  const b = await body<{ ws: string; state: 'open' | 'resolved' }>(req)
  canvas.setThreadState(knownWorkspace(b.ws), params.name, params.tid, b.state)
})

// ------------------------------------------------------------------ terminals

/** What the terminal mod relays: the canvas tools of Duet's own conversations. */
const TERMINAL_TOOLS = new Set<CanvasToolName>(['canvas_list', 'canvas_read', 'canvas_create', 'canvas_update', 'canvas_reply'])

route('GET', '/api/terminals', ({ url }) => terminals.list(knownWorkspace(url.searchParams.get('ws'))))
route('POST', '/api/terminals', async ({ req }) => {
  const b = await body<{ id: string; workspace: string; cwd: string; label: string; map?: unknown }>(req)
  if (!/^[\w-]{8,64}$/.test(b.id ?? '')) throw new HttpError(400, 'bad terminal id')
  const map = typeof b.map === 'string' && b.map !== '' ? b.map : undefined
  return terminals.register({ id: b.id, workspace: knownWorkspace(b.workspace), cwd: String(b.cwd ?? ''), label: String(b.label ?? b.id.slice(0, 8)), map })
})
route('DELETE', '/api/terminals/:id', ({ params }) => { terminals.remove(params.id) })
/** The mod's heartbeat and inbox: held open until a message or a map change comes, or `wait` ms pass. */
route('GET', '/api/terminals/:id/poll', ({ url, params, res }) => {
  const wait = Math.min(25_000, Math.max(0, Number(url.searchParams.get('wait') ?? 20_000) || 0))
  return terminals.poll(params.id, wait, gone => res.on('close', () => { if (!res.writableEnded) gone() }))
})
route('POST', '/api/terminals/:id/messages', async ({ req, params }) => {
  const b = await body<{ text: string; context?: ContextItem[]; images?: unknown[] }>(req)
  if (b.images?.length) throw new HttpError(400, '터미널에는 이미지를 보낼 수 없어. 글로만 보내 줘.')
  if (!b.text?.trim()) throw new HttpError(400, '빈 메시지야')
  const id = newId('m-')
  terminals.send(params.id, composePrompt(b.text.trim(), b.context), id)
  return { id }
})
/** Where the terminal is with a message: its turn started, or ended (with the answer, which goes to the canvas thread). */
route('POST', '/api/terminals/:id/messages/:mid', async ({ req, params }) => {
  const b = await body<{ state: 'working' | 'done'; answer?: string }>(req)
  const t = terminals.get(params.id)
  if (b.state === 'working') { terminals.working(t.id, params.mid); return }
  const answer = b.answer?.trim()
  if (answer) replyOnCanvas(t.workspace, params.mid, answer, { terminal: t.id })
  terminals.release(t.id, params.mid)
})
route('POST', '/api/terminals/:id/tools/:tool', async ({ req, params }) => {
  const t = terminals.get(params.id)
  const name = params.tool as CanvasToolName
  if (!TERMINAL_TOOLS.has(name)) throw new HttpError(404, `no tool ${params.tool}`)
  const args = z.object(CANVAS_TOOLS[name].shape).safeParse(await body(req))
  if (!args.success) return { isError: true, text: z.prettifyError(args.error) }
  return runCanvasTool(canvas, t.workspace, name, args.data, { terminal: t })
})

// ------------------------------------------------------------------ start

const STATE = join(DUET_HOME, 'server.json')
server.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`${PORT}번 포트를 이미 쓰고 있어. 떠 있는 Duet이 있으면 그걸 써.`)
    process.exit(2)
  }
  throw e
})
server.listen(PORT, '127.0.0.1', () => {
  // The token file is written only after the port is ours, so a losing second server never overwrites it.
  writeJson(STATE, { port: PORT, pid: process.pid, version: VERSION, codeHash: CODE_HASH, started: Date.now(), id: newId() })
  console.log(`Duet ${VERSION} → http://127.0.0.1:${PORT}/?t=${TOKEN}`)
})

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    sessions.shutdown()
    for (const w of watchers.values()) w.w.close()
    process.exit(0)
  })
}
