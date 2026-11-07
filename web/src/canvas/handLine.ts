type Command = { cmd: string; nums: number[]; text: string }
type Wave = { amp: number; freq: number; phase: number }

const AMP = 0.9
const STEP = 6
const MIN_RUN = 24
const EASE = 12
const ARITY: Record<string, number> = { M: 2, L: 2, Q: 4, C: 6, A: 7 }
const COMMAND = /([A-DF-Za-df-z])([^A-DF-Za-df-z]*)/g
const NUMBER = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g

/**
 * The geometry bends instead of taking a filter, which breaks a thin line into dashes and has no area on a straight one.
 * Seeded, so a redraw keeps the same hand. Only straight runs wave, still at both ends, so corners and heads stay put.
 */
export function handDrawn(d: string, seed: string): string {
  const path = parse(d)
  if (!path) return d
  const waves = wavesFor(seed)
  let out = '', x = 0, y = 0, s = 0, waved = false
  for (const { cmd, nums, text } of path) {
    if (cmd !== 'L') { out += text; [x, y] = nums.slice(-2); continue }
    for (let k = 0; k < nums.length; k += 2) {
      const X = nums[k], Y = nums[k + 1], len = Math.hypot(X - x, Y - y)
      if (len < MIN_RUN) out += `L${X},${Y}`
      else { out += wavyRun(x, y, X, Y, s, waves); waved = true }
      s += len; x = X; y = Y
    }
  }
  return waved ? out : d
}

function parse(d: string): Command[] | undefined {
  if (!/^\s*M/.test(d)) return undefined
  const path: Command[] = []
  for (const [text, cmd, args] of d.matchAll(COMMAND)) {
    const nums = (args.match(NUMBER) ?? []).map(Number)
    const arity = ARITY[cmd]
    if (!arity || !nums.length || nums.length % arity || (cmd === 'M' && nums.length !== 2)) return undefined
    if (!/^[\s,]*$/.test(args.replace(NUMBER, ' '))) return undefined
    path.push({ cmd, nums, text })
  }
  return path
}

function wavesFor(seed: string): Wave[] {
  const r = mulberry32(fnv1a(seed))
  return [[1, 1 / (60 + r() * 30)], [0.4, 1 / (20 + r() * 8)], [0.15, 1 / (8 + r() * 3)]]
    .map(([amp, f]) => ({ amp: amp * AMP / 1.55, freq: 2 * Math.PI * f, phase: r() * 2 * Math.PI }))
}

function wavyRun(x0: number, y0: number, x1: number, y1: number, s0: number, waves: Wave[]): string {
  const len = Math.hypot(x1 - x0, y1 - y0), ux = (x1 - x0) / len, uy = (y1 - y0) / len, n = Math.ceil(len / STEP)
  const pts = Array.from({ length: n + 1 }, (_, i) => {
    const t = len * i / n
    const o = waves.reduce((sum, w) => sum + w.amp * Math.sin(w.freq * (s0 + t) + w.phase), 0) * ease(t / EASE) * ease((len - t) / EASE)
    return [x0 + ux * t - uy * o, y0 + uy * t + ux * o]
  })
  // The outer handles lie on the run, so the line leaves and meets a corner or a head along it.
  const h = len / n / 3
  let out = ''
  for (let i = 0; i < n; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n, i + 2)]
    const c1 = i === 0 ? [x0 + ux * h, y0 + uy * h] : [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6]
    const c2 = i === n - 1 ? [x1 - ux * h, y1 - uy * h] : [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6]
    const end = i === n - 1 ? `${x1},${y1}` : `${round(p2[0])},${round(p2[1])}`
    out += `C${round(c1[0])},${round(c1[1])} ${round(c2[0])},${round(c2[1])} ${end}`
  }
  return out
}

const ease = (t: number) => (t >= 1 ? 1 : t * t * (3 - 2 * t))
const round = (n: number) => Math.round(n * 10) / 10

function fnv1a(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

function mulberry32(seed: number): () => number {
  let a = seed | 0
  return () => {
    a = a + 0x6D2B79F5 | 0
    let t = Math.imul(a ^ a >>> 15, 1 | a)
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
    return ((t ^ t >>> 14) >>> 0) / 4294967296
  }
}
