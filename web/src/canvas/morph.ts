// Folding a package redraws the whole diagram. To keep the eye on what moved, the new drawing
// starts where the old one was and slides into place (FLIP): boxes glide to their new spots, the
// folded package's contents shrink into its box, an unfolded package's contents grow out of it,
// and the lines cross-fade.

import type { CanvasMap } from '../../../shared/canvas.ts'

export const DURATION = 420
const EASE = 'cubic-bezier(.2, .75, .2, 1)'
const BOXES = '.cv-node[data-target], .cv-cluster[data-target], .cv-actor[data-target]'
// Lines fade as whole layers (a few groups), not one animation per line.
const LINES = 'g.edgePaths, g.edgeLabels'

/** Where each box of the drawing sits on screen, by map id; `frame` marks an open package (its outline). */
export type Spot = DOMRect & { frame?: boolean }
export function measure(svg: SVGSVGElement | null | undefined): Map<string, Spot> {
  const out = new Map<string, Spot>()
  if (!svg) return out
  for (const el of svg.querySelectorAll<SVGGraphicsElement>(BOXES)) {
    const r: Spot = el.getBoundingClientRect()
    r.frame = el.classList.contains('cv-cluster')
    out.set(el.getAttribute('data-target')!, r)
  }
  return out
}

export function reducedMotion(): boolean {
  return matchMedia('(prefers-reduced-motion: reduce)').matches
}

type Placement = { ax: number; ay: number; box: DOMRect }

/** The element's own translate (Mermaid's `transform` attribute) and its box in local units; undefined if it uses more than a translate. */
function placement(el: SVGGraphicsElement): Placement | undefined {
  const attr = el.getAttribute('transform') ?? ''
  let ax = 0, ay = 0
  if (attr.trim()) {
    const m = /^\s*translate\(\s*(-?[\d.e+-]+)(?:[\s,]+(-?[\d.e+-]+))?\s*\)\s*$/.exec(attr)
    if (!m) return undefined
    ax = Number(m[1]); ay = Number(m[2] ?? 0)
  }
  const b = el.getBBox()
  return { ax, ay, box: new DOMRect(b.x, b.y, b.width, b.height) }
}

/** A CSS transform that puts the element's box at (x, y) in its parent's units, scaled by s, the same shape as the resting one so they interpolate. */
function at(p: Placement, x: number, y: number, sx = 1, sy = 1): string {
  return `translate(${x}px, ${y}px) scale(${sx}, ${sy}) translate(${-p.box.x}px, ${-p.box.y}px)`
}

const rest = (p: Placement) => at(p, p.ax + p.box.x, p.ay + p.box.y)

/** The nearest package (or the element itself) that has a box in `rects`. */
function anchorIn(id: string, rects: Map<string, Spot>, parentOf: Map<string, string | undefined>): Spot | undefined {
  for (let p = parentOf.get(id); p; p = parentOf.get(p)) {
    const r = rects.get(p)
    if (r) return r
  }
  return undefined
}

export type Morph = { cancel: () => void }

/**
 * Animate from the drawing that was on screen (`before`, measured just before the swap, and the
 * old svg itself) to the one now in `stage`. `k` is the zoom: screen pixels per drawing unit.
 * `offset` is how far the camera moved after the swap, in screen pixels (the old picture must stay put).
 */
export function morph(o: { stage: HTMLElement; oldSvg: SVGSVGElement; before: Map<string, Spot>; k: number; map: CanvasMap; offset?: { x: number; y: number } }): Morph {
  const anims: Animation[] = []
  const svg = o.stage.querySelector<SVGSVGElement>(':scope > svg')
  const parentOf = new Map(o.map.elements.map(e => [e.id, e.parent]))
  let overlay: HTMLDivElement | undefined
  const cancel = () => {
    for (const a of anims) a.cancel()
    overlay?.remove()
  }
  if (!svg) return { cancel }
  const after = measure(svg)
  const k = o.k || 1

  // New drawing: every box starts where it was (or inside the package it came out of).
  for (const el of svg.querySelectorAll<SVGGraphicsElement>(BOXES)) {
    const id = el.getAttribute('data-target')!
    const now = after.get(id)
    const p = placement(el)
    if (!now || !p || !p.box.width || !p.box.height) continue
    const old = o.before.get(id)
    if (old && old.frame !== now.frame && !now.frame) {
      // Folded: the box with its title appears in place once the frame has shrunk onto it (text is never stretched).
      anims.push(el.animate([{ opacity: 0 }, { opacity: 0, offset: 0.45 }, { opacity: 1 }], { duration: DURATION, easing: 'ease-out' }))
      continue
    }
    if (old) {
      const dx = (old.left - now.left) / k, dy = (old.top - now.top) / k
      const sx = old.width / now.width, sy = old.height / now.height
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01) continue
      anims.push(el.animate([
        { transform: at(p, p.ax + p.box.x + dx, p.ay + p.box.y + dy, sx, sy), transformOrigin: '0 0' },
        { transform: rest(p), transformOrigin: '0 0' },
      ], { duration: DURATION, easing: EASE }))
    } else {
      const from = anchorIn(id, o.before, parentOf)
      if (from) {
        // Grows out of the box of the package that was folded.
        const dx = (from.left + from.width / 2 - (now.left + now.width / 2)) / k
        const dy = (from.top + from.height / 2 - (now.top + now.height / 2)) / k
        const s = 0.25
        const cx = p.ax + p.box.x + p.box.width / 2, cy = p.ay + p.box.y + p.box.height / 2
        const centered = (x: number, y: number, sc: number) => `translate(${x}px, ${y}px) scale(${sc}, ${sc}) translate(${-(p.box.x + p.box.width / 2)}px, ${-(p.box.y + p.box.height / 2)}px)`
        anims.push(el.animate([
          { transform: centered(cx + dx, cy + dy, s), transformOrigin: '0 0', opacity: 0 },
          { transform: centered(cx, cy, 1), transformOrigin: '0 0', opacity: 1 },
        ], { duration: DURATION, easing: EASE }))
      } else {
        anims.push(el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: DURATION, easing: EASE }))
      }
    }
  }
  // Lines are re-routed, so they fade in once the boxes are mostly in place.
  for (const el of svg.querySelectorAll<SVGElement>(LINES)) {
    anims.push(el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, delay: DURATION * 0.55, easing: 'ease-out', fill: 'backwards' }))
  }

  // Old drawing on top, exactly where it was: what disappears shrinks into its package; old lines fade out.
  overlay = document.createElement('div')
  overlay.className = 'morph-overlay'
  if (o.offset) overlay.style.transform = `translate(${-o.offset.x / k}px, ${-o.offset.y / k}px)`
  overlay.appendChild(o.oldSvg)
  o.stage.appendChild(overlay)
  for (const el of o.oldSvg.querySelectorAll<SVGGraphicsElement>(BOXES)) {
    const id = el.getAttribute('data-target')!
    const was = o.before.get(id)
    const now = after.get(id)
    const ox = o.offset?.x ?? 0, oy = o.offset?.y ?? 0
    if (now && was && was.frame && !now.frame) {
      // Folded: the open frame shrinks onto the new box and fades as the box appears.
      const p = placement(el)
      if (p && p.box.width && p.box.height) {
        const dx = (now.left - ox - was.left) / k, dy = (now.top - oy - was.top) / k
        anims.push(el.animate([
          { transform: rest(p), transformOrigin: '0 0', opacity: 1 },
          { transform: at(p, p.ax + p.box.x + dx, p.ay + p.box.y + dy, now.width / was.width, now.height / was.height), transformOrigin: '0 0', opacity: 0.6, offset: 0.7 },
          { transform: at(p, p.ax + p.box.x + dx, p.ay + p.box.y + dy, now.width / was.width, now.height / was.height), transformOrigin: '0 0', opacity: 0 },
        ], { duration: DURATION, easing: EASE, fill: 'forwards' }))
        continue
      }
    }
    if (now && was && !was.frame && now.frame) {
      // Unfolded: the old box fades while the new frame grows out of it.
      anims.push(el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: DURATION * 0.4, easing: 'ease-out', fill: 'forwards' }))
      continue
    }
    // Boxes that live on are drawn by the new picture.
    if (now) { el.style.visibility = 'hidden'; continue }
    const into = anchorIn(id, after, parentOf)
    const p = placement(el)
    if (!was || !p || !p.box.width || !p.box.height) { el.style.visibility = 'hidden'; continue }
    if (into) {
      // `into` is where the package box is now; on the old picture's layer that is shifted back by the camera move.
      const dx = (into.left + into.width / 2 - ox - (was.left + was.width / 2)) / k
      const dy = (into.top + into.height / 2 - oy - (was.top + was.height / 2)) / k
      const cx = p.ax + p.box.x + p.box.width / 2, cy = p.ay + p.box.y + p.box.height / 2
      const centered = (x: number, y: number, sc: number) => `translate(${x}px, ${y}px) scale(${sc}, ${sc}) translate(${-(p.box.x + p.box.width / 2)}px, ${-(p.box.y + p.box.height / 2)}px)`
      anims.push(el.animate([
        { transform: centered(cx, cy, 1), transformOrigin: '0 0', opacity: 1 },
        { transform: centered(cx + dx, cy + dy, 0.25), transformOrigin: '0 0', opacity: 0 },
      ], { duration: DURATION * 0.85, easing: EASE, fill: 'forwards' }))
    } else {
      anims.push(el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: DURATION * 0.6, easing: 'ease-out', fill: 'forwards' }))
    }
  }
  for (const el of o.oldSvg.querySelectorAll<SVGElement>(LINES)) {
    anims.push(el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, easing: 'ease-out', fill: 'forwards' }))
  }
  // Package frames of the old picture that are gone fade with everything else on that layer.
  const timer = setTimeout(() => overlay?.remove(), DURATION + 60)
  return {
    cancel: () => {
      clearTimeout(timer)
      cancel()
    },
  }
}
