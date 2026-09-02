import type { Swatch } from '../color/ramp'
import { slugify } from './formats'

export type ImageOptions = {
  /** Edge of one swatch block, in pixels. */
  size: number
  /** Bake the step label and hex into the image. */
  labels: boolean
}

export const SIZE_PRESETS = [
  { id: 'strip', label: 'Strip', size: 48 },
  { id: 'medium', label: 'Medium', size: 96 },
  { id: 'large', label: 'Large', size: 192 },
]

const LABEL_STRIP = 34
const LABEL_FONT = '11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'

/**
 * Flat blocks with no gaps, gridlines or borders.
 *
 * This image exists to be eyedropped in another tool, so anything drawn
 * between two swatches is a trap: a pipette landing on a 1px rule picks the
 * rule. Coordinates stay on integers for the same reason — a half-pixel
 * boundary gets antialiased into a colour that is in neither swatch.
 */
export function drawRamp(
  canvas: HTMLCanvasElement,
  ramp: Swatch[],
  options: ImageOptions,
): void {
  const size = Math.round(options.size)
  const labelStrip = options.labels ? LABEL_STRIP : 0

  canvas.width = size * ramp.length
  canvas.height = size + labelStrip

  const ctx = canvas.getContext('2d')
  if (!ctx) return

  if (labelStrip > 0) {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }

  ramp.forEach((swatch, index) => {
    ctx.fillStyle = swatch.hex
    ctx.fillRect(index * size, 0, size, size)
  })

  if (labelStrip === 0) return

  ctx.font = LABEL_FONT
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ramp.forEach((swatch, index) => {
    const centre = index * size + size / 2
    ctx.fillStyle = '#000000'
    ctx.fillText(swatch.label, centre, size + 14)
    ctx.fillStyle = '#767676'
    ctx.fillText(swatch.hex, centre, size + 28)
  })
}

function createCanvas(ramp: Swatch[], options: ImageOptions): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  drawRamp(canvas, ramp, options)
  return canvas
}

export function toPngBlob(ramp: Swatch[], options: ImageOptions): Promise<Blob | null> {
  return new Promise((resolve) => {
    createCanvas(ramp, options).toBlob((blob) => resolve(blob), 'image/png')
  })
}

/** Straight to the clipboard, ready to paste onto a Figma canvas. */
export async function copyPng(ramp: Swatch[], options: ImageOptions): Promise<boolean> {
  const blob = await toPngBlob(ramp, options)
  if (!blob || typeof ClipboardItem === 'undefined') return false
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    return true
  } catch {
    return false
  }
}

export function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Revoked on the next tick; revoking immediately can cancel the download.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function downloadPng(
  ramp: Swatch[],
  options: ImageOptions,
  name: string,
): Promise<boolean> {
  const blob = await toPngBlob(ramp, options)
  if (!blob) return false
  download(blob, `${slugify(name)}-ramp.png`)
  return true
}

/**
 * The same ramp as vector rectangles.
 *
 * Worth having alongside the PNG because Figma pastes this as real editable
 * layers, one per step, each already named and carrying its own fill — rather
 * than as a flat picture you can only sample.
 */
export function toSvg(ramp: Swatch[], options: ImageOptions, name: string): string {
  const size = Math.round(options.size)
  const slug = slugify(name)
  const width = size * ramp.length
  const rects = ramp
    .map(
      (swatch, index) =>
        `  <rect id="${slug}-${swatch.label}" x="${index * size}" y="0" ` +
        `width="${size}" height="${size}" fill="${swatch.hex}"/>`,
    )
    .join('\n')

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${size}" ` +
    `viewBox="0 0 ${width} ${size}">\n${rects}\n</svg>`
  )
}

export function downloadSvg(ramp: Swatch[], options: ImageOptions, name: string): void {
  const blob = new Blob([toSvg(ramp, options, name)], { type: 'image/svg+xml' })
  download(blob, `${slugify(name)}-ramp.svg`)
}
