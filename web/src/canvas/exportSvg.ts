/** A standalone SVG of the drawing: the colors the page paints with CSS are written into the file. */
export function standaloneSvg(svg: SVGSVGElement, title: string): string {
  const clone = svg.cloneNode(true) as SVGSVGElement
  const src = [svg, ...svg.querySelectorAll<SVGElement | HTMLElement>('*')]
  const dst = [clone, ...clone.querySelectorAll<SVGElement | HTMLElement>('*')]
  const PROPS = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'opacity', 'color', 'font-weight', 'font-family', 'font-size', 'background-color', 'text-decoration']
  src.forEach((el, i) => {
    const out = dst[i]
    if (!out || el.classList?.contains('cv-edge-hit') || el.classList?.contains('cv-badge') || el.classList?.contains('cv-pins')) return
    const cs = getComputedStyle(el)
    const style = PROPS.map(p => `${p}:${cs.getPropertyValue(p)}`).join(';')
    out.setAttribute('style', `${out.getAttribute('style') ?? ''};${style}`)
  })
  clone.querySelectorAll('.cv-edge-hit, .cv-badge, .cv-pins').forEach(n => n.remove())
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
