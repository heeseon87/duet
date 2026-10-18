import { diffWordsWithSpace } from 'diff'
import type { DiffFile, DiffLine } from '../../../shared/protocol.ts'

export type Seg = { text: string; changed: boolean }

export type URow =
  | { t: 'gap'; gap: number; hidden: number; canUp: boolean; canDown: boolean; from: number; to: number }
  | { t: 'hunk'; hunk: number; header: string }
  | { t: 'line'; type: 'ctx' | 'add' | 'del'; oldNo?: number; newNo?: number; text: string; words?: Seg[]; hunk: number; expanded?: boolean }

export type Side = { type: 'ctx' | 'add' | 'del' | 'blank'; no?: number; text: string; words?: Seg[] }
export type SRow =
  | { t: 'gap'; gap: number; hidden: number; canUp: boolean; canDown: boolean; from: number; to: number }
  | { t: 'hunk'; hunk: number; header: string }
  | { t: 'pair'; left: Side; right: Side; hunk: number; expanded?: boolean }

/** Lines revealed in each gap: `top` from the gap's start, `bottom` from its end. */
export type Expansion = Record<number, { top: number; bottom: number }>

type Gap = { index: number; newFrom: number; newTo: number; offset: number }

/** The unchanged stretches between hunks (and before the first, after the last), in new-file numbers. */
export function gapsOf(file: DiffFile, newTotal: number): Gap[] {
  const gaps: Gap[] = []
  let prevNewEnd = 1, prevOldEnd = 1
  file.hunks.forEach((h, i) => {
    const newStart = h.newLines === 0 ? h.newStart + 1 : h.newStart
    const oldStart = h.oldLines === 0 ? h.oldStart + 1 : h.oldStart
    gaps.push({ index: i, newFrom: prevNewEnd, newTo: newStart - 1, offset: oldStart - newStart })
    prevNewEnd = newStart + h.newLines
    prevOldEnd = oldStart + h.oldLines
  })
  gaps.push({ index: file.hunks.length, newFrom: prevNewEnd, newTo: newTotal, offset: prevOldEnd - prevNewEnd })
  return gaps
}

/** How alike two lines are, ignoring indentation: 0 (nothing shared) to 1 (same). */
function likeness(a: string, b: string): number {
  const x = a.trim(), y = b.trim()
  if (!x || !y) return 0
  if (x === y) return 1
  let same = 0
  for (const p of diffWordsWithSpace(x, y)) if (!p.added && !p.removed) same += p.value.replace(/\s/g, '').length
  return (2 * same) / (x.replace(/\s/g, '').length + y.replace(/\s/g, '').length)
}

/** Word-level changes for a deleted line and the added line that replaced it. */
function wordPair(a: string, b: string): [Seg[], Seg[]] | undefined {
  if (a.length > 500 || b.length > 500) return undefined
  const left: Seg[] = [], right: Seg[] = []
  for (const p of diffWordsWithSpace(a, b)) {
    // Re-indenting is not a change worth a mark.
    const real = p.value.trim() !== ''
    if (p.added) right.push({ text: p.value, changed: real })
    else if (p.removed) left.push({ text: p.value, changed: real })
    else { left.push({ text: p.value, changed: false }); right.push({ text: p.value, changed: false }) }
  }
  return [left, right]
}

/**
 * Pairs each deleted line with the added line that most likely replaced it (in order), and
 * marks the changed words of each pair. Lines too different stay whole.
 */
export function withWords(lines: DiffLine[]): (DiffLine & { words?: Seg[] })[] {
  const out: (DiffLine & { words?: Seg[] })[] = lines.map(l => ({ ...l }))
  for (let i = 0; i < out.length; i++) {
    if (out[i].type !== 'del') continue
    let j = i
    while (j < out.length && out[j].type === 'del') j++
    let k = j
    while (k < out.length && out[k].type === 'add') k++
    let from = j
    for (let d = i; d < j; d++) {
      let best = -1, score = 0.45
      for (let a = from; a < k; a++) {
        const s = likeness(out[d].text, out[a].text)
        if (s > score) { score = s; best = a }
      }
      if (best < 0) continue
      const w = wordPair(out[d].text, out[best].text)
      if (w) { out[d].words = w[0]; out[best].words = w[1] }
      from = best + 1
    }
    i = k - 1
  }
  return out
}

function gapRows<T>(gap: Gap, hunkCount: number, exp: Expansion, newLines: string[], make: (newNo: number, oldNo: number, text: string) => T, gapRow: (hidden: number, canUp: boolean, canDown: boolean, from: number, to: number) => T): T[] {
  const size = gap.newTo - gap.newFrom + 1
  if (size <= 0) return []
  const e = exp[gap.index] ?? { top: 0, bottom: 0 }
  // A small gap is not worth a button: show it.
  if (size <= 4 && newLines.length) return range(gap.newFrom, gap.newTo).map(n => make(n, n + gap.offset, newLines[n - 1] ?? ''))
  const top = Math.min(e.top, size), bottom = Math.min(e.bottom, size - top)
  const out: T[] = []
  for (const n of range(gap.newFrom, gap.newFrom + top - 1)) out.push(make(n, n + gap.offset, newLines[n - 1] ?? ''))
  const hidden = size - top - bottom
  // "Up" grows from the next hunk upward, "down" from the previous hunk downward.
  // `from`..`to` are the hidden lines, in new-file numbers.
  if (hidden > 0) out.push(gapRow(hidden, gap.index < hunkCount, gap.index > 0, gap.newFrom + top, gap.newTo - bottom))
  for (const n of range(gap.newTo - bottom + 1, gap.newTo)) out.push(make(n, n + gap.offset, newLines[n - 1] ?? ''))
  return out
}

function range(a: number, b: number): number[] {
  const out: number[] = []
  for (let i = a; i <= b; i++) out.push(i)
  return out
}

export function unifiedRows(file: DiffFile, newLines: string[], exp: Expansion): URow[] {
  const rows: URow[] = []
  const gaps = newLines.length ? gapsOf(file, newLines.length) : []
  const addGap = (i: number) => {
    const gap = gaps[i]
    if (!gap) return
    rows.push(...gapRows<URow>(gap, file.hunks.length, exp, newLines,
      (newNo, oldNo, text) => ({ t: 'line', type: 'ctx', newNo, oldNo, text, hunk: i, expanded: true }),
      (hidden, canUp, canDown, from, to) => ({ t: 'gap', gap: gap.index, hidden, canUp, canDown, from, to })))
  }
  file.hunks.forEach((h, i) => {
    addGap(i)
    rows.push({ t: 'hunk', hunk: i, header: h.header })
    for (const l of withWords(h.lines)) rows.push({ t: 'line', type: l.type, oldNo: l.oldNo, newNo: l.newNo, text: l.text, words: l.words, hunk: i })
  })
  if (file.hunks.length) addGap(file.hunks.length)
  return rows
}

export function splitRows(file: DiffFile, newLines: string[], exp: Expansion): SRow[] {
  const rows: SRow[] = []
  const gaps = newLines.length ? gapsOf(file, newLines.length) : []
  const addGap = (i: number) => {
    const gap = gaps[i]
    if (!gap) return
    rows.push(...gapRows<SRow>(gap, file.hunks.length, exp, newLines,
      (newNo, oldNo, text) => ({ t: 'pair', left: { type: 'ctx', no: oldNo, text }, right: { type: 'ctx', no: newNo, text }, hunk: i, expanded: true }),
      (hidden, canUp, canDown, from, to) => ({ t: 'gap', gap: gap.index, hidden, canUp, canDown, from, to })))
  }
  file.hunks.forEach((h, i) => {
    addGap(i)
    rows.push({ t: 'hunk', hunk: i, header: h.header })
    const lines = withWords(h.lines)
    for (let k = 0; k < lines.length; k++) {
      const l = lines[k]
      if (l.type === 'ctx') { rows.push({ t: 'pair', left: { type: 'ctx', no: l.oldNo, text: l.text }, right: { type: 'ctx', no: l.newNo, text: l.text }, hunk: i }); continue }
      let j = k
      const dels: typeof lines = [], adds: typeof lines = []
      while (j < lines.length && lines[j].type === 'del') dels.push(lines[j++])
      while (j < lines.length && lines[j].type === 'add') adds.push(lines[j++])
      for (let n = 0; n < Math.max(dels.length, adds.length); n++) {
        const d = dels[n], a = adds[n]
        rows.push({
          t: 'pair',
          left: d ? { type: 'del', no: d.oldNo, text: d.text, words: d.words } : { type: 'blank', text: '' },
          right: a ? { type: 'add', no: a.newNo, text: a.text, words: a.words } : { type: 'blank', text: '' },
          hunk: i,
        })
      }
      k = j - 1
    }
  })
  if (file.hunks.length) addGap(file.hunks.length)
  return rows
}

export const TAB_SIZE = 4

/** How many monospace columns a line takes on screen: tabs to the next stop, CJK and emoji as two. */
export function visualCols(text: string): number {
  let n = 0
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0
    if (c === 9) n += TAB_SIZE - (n % TAB_SIZE)
    else if (isWide(c)) n += 2
    else n += 1
  }
  return n
}

function isWide(c: number): boolean {
  return (c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff)
    || (c >= 0xfe30 && c <= 0xfe4f) || (c >= 0xff00 && c <= 0xff60) || (c >= 0xffe0 && c <= 0xffe6) || (c >= 0x1f300 && c <= 0x1faff) || (c >= 0x20000 && c <= 0x3fffd)
}

/** The widest line among `texts`, in columns. */
export function widestCols(texts: Iterable<string>): number {
  let max = 0
  // A line can never be wider than four columns a character (all tabs), so short ones are skipped.
  for (const t of texts) if (t.length * TAB_SIZE > max) max = Math.max(max, visualCols(t))
  return max
}
