import type { ServerEvent } from '../../shared/protocol.ts'

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  })
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) throw new ApiError(res.status, (data && data.error) || res.statusText)
  return data as T
}

export const api = {
  get: <T>(path: string) => call<T>('GET', path),
  post: <T>(path: string, body?: unknown) => call<T>('POST', path, body ?? {}),
  patch: <T>(path: string, body: unknown) => call<T>('PATCH', path, body),
  del: <T>(path: string) => call<T>('DELETE', path),
}

export const q = (params: Record<string, string | number | undefined>) =>
  '?' + Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&')

type Listener = (ev: ServerEvent) => void
const listeners = new Set<Listener>()
let source: EventSource | undefined
let onReconnect: (() => void) | undefined
let everConnected = false

/** One EventSource for the whole app; listeners filter by topic. */
export function subscribe(fn: Listener): () => void {
  listeners.add(fn)
  if (!source) connect()
  return () => listeners.delete(fn)
}

export function setReconnectHandler(fn: () => void) {
  onReconnect = fn
}

export const connection = { online: false, stale: false, listeners: new Set<(online: boolean) => void>() }

function connect() {
  source = new EventSource('/api/events')
  source.onmessage = e => {
    const ev = JSON.parse(e.data) as ServerEvent
    if (ev.topic === 'hello') {
      if (everConnected) onReconnect?.()
      everConnected = true
      connection.online = true
      connection.stale = Boolean(ev.stale)
      connection.listeners.forEach(l => l(true))
    }
    if (ev.topic === 'stale') connection.stale = true
    for (const l of listeners) l(ev)
  }
  source.onerror = () => {
    connection.online = false
    connection.listeners.forEach(l => l(false))
  }
}
