import { describe, expect, it } from 'vitest'
import { handDrawn } from '../web/src/canvas/handLine.ts'

const NUM = String.raw`-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?`
const pairs = (d: string) => [...d.matchAll(new RegExp(`(${NUM}),(${NUM})`, 'g'))].map(m => [Number(m[1]), Number(m[2])])
/** The points the line passes through: the start, then each cubic's end. */
const onCurve = (d: string) => d.split('C').map(part => pairs(part).at(-1)!)

describe('handDrawn', () => {
  it('waves a long straight line within 0.9 of it, from its start to exactly its end', () => {
    for (let i = 0; i < 20; i++) {
      const out = handDrawn('M0,0L300,0', `OrderService->OrderRepository:association#${i}`)
      expect(out).not.toBe('M0,0L300,0')
      expect(out.startsWith('M0,0')).toBe(true)
      expect(pairs(out).at(-1)).toEqual([300, 0])
      const xs = pairs(out).map(([x]) => x)
      expect(xs).toEqual([...xs].sort((a, b) => a - b))
      for (const [, y] of onCurve(out)) expect(Math.abs(y)).toBeLessThanOrEqual(0.9)
      expect(onCurve(out).some(([, y]) => y !== 0)).toBe(true)
    }
  })

  it('fades the wave out over 12 units at each end of a run, so the line meets corners and heads along the run', () => {
    const envelope = (t: number) => (t >= 1 ? 1 : t * t * (3 - 2 * t))
    for (let i = 0; i < 20; i++) {
      for (const [x, y] of onCurve(handDrawn('M0,0L300,0', `seed${i}`))) {
        const t = Math.min(x, 300 - x)
        if (t < 12) expect(Math.abs(y)).toBeLessThanOrEqual(0.9 * envelope(t / 12) + 0.05)
      }
    }
  })

  it('leaves and meets each run along it, so a head or a corner keeps the angle Mermaid drew', () => {
    for (let i = 0; i < 20; i++) {
      const across = pairs(handDrawn('M0,0L300,0', `seed${i}`))
      expect(across[1][1]).toBe(0)
      expect(across.at(-2)![1]).toBe(0)
      const down = pairs(handDrawn('M50,0L50,300', `seed${i}`))
      expect(down[1][0]).toBe(50)
      expect(down.at(-2)![0]).toBe(50)
    }
  })

  it('draws a line the same way for the same seed, and another way for another seed', () => {
    expect(handDrawn('M0,0L300,0', 'a->b:dependency')).toBe(handDrawn('M0,0L300,0', 'a->b:dependency'))
    expect(handDrawn('M0,0L300,0', 'a->b:dependency')).not.toBe(handDrawn('M0,0L300,0', 'b->a:dependency'))
  })

  it('keeps corners as drawn and ends each straight run on its original point', () => {
    // Mermaid's rounded edges: L runs joined by Q turns, a space between a Q's two points.
    const d = 'M120.5,40L120.5,180.25Q120.5,185.25 125.5,185.25L300,185.25A5,5,0,0,1,305,190.25L305,400C305,410 315,410 315,420L315,500'
    const out = handDrawn(d, 'seed')
    expect(out).not.toBe(d)
    const corners = ['Q120.5,185.25 125.5,185.25', 'A5,5,0,0,1,305,190.25', 'C305,410 315,410 315,420']
    const ends = ['120.5,180.25', '300,185.25', '305,400']
    corners.forEach((corner, i) => {
      expect(out).toContain(corner)
      expect(out.slice(0, out.indexOf(corner)).endsWith(ends[i])).toBe(true)
    })
    expect(out.endsWith('315,500')).toBe(true)
  })

  it('leaves a line of runs shorter than 24 as it is', () => {
    for (const d of ['M0,0L20,0L20,23', 'M 0 0 L 20.50 0', 'M0,0L10,0Q15,0 15,5L15,25']) expect(handDrawn(d, 'seed')).toBe(d)
  })

  it('leaves a path it cannot read as it is', () => {
    for (const d of ['m0,0l300,0', 'M0,0H300', 'M0,0V300', 'M0,0L300,0Z', 'M0,0,300,0L600,0', 'M0,0L300', 'L0,0L300,0', 'M0,0 e L300,0', 'M0,0L100,0S200,0 300,0', 'M0,0L100,0T300,0', ''])
      expect(handDrawn(d, 'seed')).toBe(d)
  })

  it('reads numbers written with an exponent', () => {
    const out = handDrawn('M1e1,0L3.1e2,1.2e-14', 'seed')
    expect(out).not.toBe('M1e1,0L3.1e2,1.2e-14')
    expect(out.startsWith('M1e1,0')).toBe(true)
    expect(out.endsWith('310,1.2e-14')).toBe(true)
    expect(handDrawn('M1.2e-14,0L20,0', 'seed')).toBe('M1.2e-14,0L20,0')
  })
})
