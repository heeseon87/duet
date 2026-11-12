/**
 * Keeps the paper grain on whole device pixels at any zoom, as cmux's shader does. The grain tiles are 1280 px, baked
 * for one tile pixel per device pixel, so their CSS size is 1280 / devicePixelRatio: 640px on a Retina screen at 100%.
 * A fixed 640px grew with the page zoom (at 125% the grain came out 1.25 times coarser than the terminal's).
 */
export function lockGrainToDevicePixels() {
  const dpr = window.devicePixelRatio || 1
  document.documentElement.style.setProperty('--grain-size', `${1280 / dpr}px`)
  // devicePixelRatio changes with the zoom and when the window moves to another screen.
  matchMedia(`(resolution: ${dpr}dppx)`).addEventListener('change', lockGrainToDevicePixels, { once: true })
}
