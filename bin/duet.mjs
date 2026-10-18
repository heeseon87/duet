#!/usr/bin/env node
// duet [path] — opens Duet on a git working tree, starting the local server when it is not running.
//   duet            this folder
//   duet ~/repo     another folder
//   duet --status   show the server
//   duet --stop     stop the server (agent sessions resume on the next prompt)
//   duet --no-open  print the address instead of opening the browser
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, openSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(realpathSync(fileURLToPath(import.meta.url))), '..')
const HOME = process.env.DUET_HOME ?? join(homedir(), '.duet')
const args = process.argv.slice(2)
const flag = f => args.includes(f)
const portArg = args.indexOf('--port')
const PORT = Number(portArg >= 0 ? args[portArg + 1] : process.env.DUET_PORT ?? 7979)
const target = resolve(args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--port') ?? process.cwd())
const BASE = `http://127.0.0.1:${PORT}`

const say = s => process.stdout.write(`${s}\n`)
const token = () => { try { return readFileSync(join(HOME, 'token'), 'utf8').trim() } catch { return '' } }

async function health() {
  try {
    const r = await fetch(`${BASE}/api/health`, { headers: { 'x-duet-token': token() }, signal: AbortSignal.timeout(1500) })
    return r.ok ? await r.json() : { foreign: true }
  } catch {
    return null
  }
}

/** Same hash the server reports: changed code means the running server is stale. */
async function localHash() {
  const { createHash } = await import('node:crypto')
  const h = createHash('sha1')
  const walk = dir => {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.(ts|mjs)$/.test(name)) h.update(name).update(readFileSync(p))
    }
  }
  walk(join(ROOT, 'server'))
  walk(join(ROOT, 'shared'))
  return h.digest('hex').slice(0, 12)
}

function newestMtime(dir) {
  let newest = 0
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    newest = Math.max(newest, st.isDirectory() ? newestMtime(p) : st.mtimeMs)
  }
  return newest
}

function buildIfStale() {
  const index = join(ROOT, 'dist', 'web', 'index.html')
  const stale = !existsSync(index) || statSync(index).mtimeMs < Math.max(newestMtime(join(ROOT, 'web')), newestMtime(join(ROOT, 'shared')))
  if (!stale) return
  say('웹 화면을 빌드하는 중…')
  const r = spawnSync(join(ROOT, 'node_modules', '.bin', 'vite'), ['build', '--logLevel', 'error'], { cwd: ROOT, stdio: 'inherit' })
  if (r.status !== 0) { say('빌드에 실패했어.'); process.exit(1) }
}

function stopServer() {
  try {
    const { pid } = JSON.parse(readFileSync(join(HOME, 'server.json'), 'utf8'))
    process.kill(pid, 'SIGTERM')
    return true
  } catch {
    return false
  }
}

async function startServer() {
  mkdirSync(HOME, { recursive: true })
  const log = openSync(join(HOME, 'server.log'), 'a')
  const child = spawn(join(ROOT, 'node_modules', '.bin', 'tsx'), [join(ROOT, 'server', 'main.ts'), '--port', String(PORT)], {
    cwd: ROOT, detached: true, stdio: ['ignore', log, log], env: process.env,
  })
  child.unref()
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 250))
    const h = await health()
    if (h && !h.foreign) return h
  }
  say(`서버가 뜨지 않았어. 로그: ${join(HOME, 'server.log')}`)
  process.exit(1)
}

async function main() {
  if (flag('--stop')) { say(stopServer() ? 'Duet 서버를 멈췄어.' : '떠 있는 서버가 없어.'); return }
  let h = await health()
  if (flag('--status')) {
    say(h && !h.foreign ? `Duet ${h.version} · ${BASE} · 코드 ${h.codeHash} · 일하는 대화 ${h.running}` : '떠 있는 서버가 없어.')
    return
  }
  if (h?.foreign) { say(`포트 ${PORT}를 다른 프로그램이 쓰고 있어. --port로 다른 포트를 골라 줘.`); process.exit(1) }
  buildIfStale()
  const hash = await localHash()
  if (h && h.codeHash !== hash) {
    if (h.running) say(`서버 코드가 바뀌었지만 일하는 대화가 ${h.running}개 있어서 그대로 둘게. 다 끝나면 duet --stop 후 다시 실행해 줘.`)
    else { say('서버 코드가 바뀌어서 다시 띄울게.'); stopServer(); await new Promise(r => setTimeout(r, 600)); h = null }
  }
  if (!h) h = await startServer()
  const url = `${BASE}/?t=${token()}&ws=${encodeURIComponent(target)}`
  if (flag('--no-open')) { say(url); return }
  const opener = process.platform === 'darwin' ? 'open' : 'xdg-open'
  spawn(opener, [url], { stdio: 'ignore', detached: true }).unref()
  say(`Duet → ${target}`)
}

void main()
