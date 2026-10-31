/** A standalone SVG of the drawing: the colors the page paints with CSS are written into the file. */
export function standaloneSvg(svg: SVGSVGElement, title: string): string {
  const clone = svg.cloneNode(true) as SVGSVGElement
  const src = [svg, ...svg.querySelectorAll<SVGElement | HTMLElement>('*')]
  const dst = [clone, ...clone.querySelectorAll<SVGElement | HTMLElement>('*')]
  // `filter` and the corners too: the page takes Mermaid's shadows off and rounds the package areas, and Mermaid's own
  // style travels with the drawing.
  const PROPS = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'opacity', 'color', 'font-weight', 'font-family', 'font-size', 'background-color', 'text-decoration', 'filter', 'rx', 'ry']
  const headed: [Element, string][] = []
  // The page eases colors and fades (a selection let go of a moment ago is still fading out): read them where they land.
  svg.classList.add('cv-still')
  src.forEach((el, i) => {
    const out = dst[i]
    if (!out || el.classList?.contains('cv-edge-hit') || el.classList?.contains('cv-badge') || el.classList?.contains('cv-pins')) return
    const cs = getComputedStyle(el)
    const style = PROPS.map(p => `${p}:${cs.getPropertyValue(p)}`).join(';')
    out.setAttribute('style', `${out.getAttribute('style') ?? ''};${style}`)
    if (out.hasAttribute('marker-start') || out.hasAttribute('marker-end')) headed.push([out, cs.stroke])
  })
  svg.classList.remove('cv-still')
  clone.querySelectorAll('.cv-edge-hit, .cv-badge, .cv-pins').forEach(n => n.remove())
  // Heads paint with their line's color (context-stroke), which not every viewer reads: each color gets its own copy.
  const copies = new Map<string, string>()
  for (const [line, color] of headed) for (const attr of ['marker-start', 'marker-end']) {
    const id = /url\(#(.+)\)/.exec(line.getAttribute(attr) ?? '')?.[1]
    const marker = id ? clone.querySelector(`#${CSS.escape(id)}`) : null
    if (!marker) continue
    let copy = copies.get(`${id}|${color}`)
    if (!copy) {
      copy = `${id}-c${copies.size}`
      const m = marker.cloneNode(true) as Element
      m.id = copy
      for (const shape of m.querySelectorAll('[style]')) shape.setAttribute('style', shape.getAttribute('style')!.replaceAll('context-stroke', color))
      marker.after(m)
      copies.set(`${id}|${color}`, copy)
    }
    line.setAttribute(attr, `url(#${copy})`)
  }
  // Without the web font a viewer measures text wider than Mermaid did: let labels run over, never clip them.
  clone.querySelectorAll('foreignObject').forEach(fo => {
    fo.setAttribute('overflow', 'visible')
    fo.setAttribute('style', `${fo.getAttribute('style') ?? ''};overflow:visible`)
  })
  clone.querySelectorAll<HTMLElement>('foreignObject div, foreignObject span, foreignObject p').forEach(el => {
    el.style.overflow = 'visible'
    el.style.maxWidth = 'none'
  })
  const vb = svg.viewBox.baseVal
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('width', String(Math.ceil(vb.width)))
  clone.setAttribute('height', String(Math.ceil(vb.height)))
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
  rect.setAttribute('x', String(vb.x)); rect.setAttribute('y', String(vb.y)); rect.setAttribute('width', String(vb.width)); rect.setAttribute('height', String(vb.height)); rect.setAttribute('fill', bg)
  clone.insertBefore(rect, clone.firstChild)
  const t = document.createElementNS('http://www.w3.org/2000/svg', 'title')
  t.textContent = title
  clone.insertBefore(t, clone.firstChild)
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}`
}

export function download(name: string, text: string, type = 'image/svg+xml') {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
