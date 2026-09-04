import type { Swatch } from '../color/ramp'
import { slugify, type NamedRamp } from './formats'

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
/** Room above a band for the palette's name, when several are stacked. */
const NAME_STRIP = 20
const NAME_FONT = '12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'

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
  drawRamps(canvas, [{ name: '', ramp }], options)
}

/**
 * Several palettes as one image: a band each, stacked in the order picked.
 *
 * A single palette is drawn exactly as it always was — same width, same
 * height, no name — so the quick copy off a palette header and a one-palette
 * export still produce the same picture. The name strip only appears once
 * there is more than one band to tell apart, and only with labels on, since
 * labels off means "just the colours, nothing to read".
 *
 * Bands are as wide as their own ramp rather than padded to the longest. With
 * the steps unlocked a palette can be shorter than its neighbour, and
 * stretching it would misreport the step size everything here is drawn at.
 */
export function drawRamps(
  canvas: HTMLCanvasElement,
  palettes: NamedRamp[],
  options: ImageOptions,
): void {
  const size = Math.round(options.size)
  const labelStrip = options.labels ? LABEL_STRIP : 0
  const nameStrip = options.labels && palettes.length > 1 ? NAME_STRIP : 0
  const band = nameStrip + size + labelStrip
  const steps = Math.max(1, ...palettes.map((palette) => palette.ramp.length))

  canvas.width = size * steps
  canvas.height = band * palettes.length

  const ctx = canvas.getContext('2d')
  if (!ctx) return

  if (labelStrip > 0) {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }

  palettes.forEach((palette, index) => {
    const top = band * index + nameStrip

    palette.ramp.forEach((swatch, position) => {
      ctx.fillStyle = swatch.hex
      ctx.fillRect(position * size, top, size, size)
    })

    if (!options.labels) return

    ctx.textBaseline = 'alphabetic'

    if (nameStrip > 0) {
      ctx.font = `bold ${NAME_FONT}`
      ctx.textAlign = 'left'
      ctx.fillStyle = '#000000'
      ctx.fillText(palette.name, 2, top - 6)
    }

    ctx.font = LABEL_FONT
    ctx.textAlign = 'center'
    palette.ramp.forEach((swatch, position) => {
      const centre = position * size + size / 2
      ctx.fillStyle = '#000000'
      ctx.fillText(swatch.label, centre, top + size + 14)
      ctx.fillStyle = '#767676'
      ctx.fillText(swatch.hex, centre, top + size + 28)
    })
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

/* --- a chosen set of palettes as one image ---------------------------- */

/*
 * What the export dialog hands to the clipboard and to disk.
 *
 * The single-palette functions above stay as they are, and one palette
 * through here produces the same bytes they do: `drawRamps` and `rampsSvg`
 * both reduce to the one-band case. They keep their own names rather than
 * being folded into `copyPng` because the palette-header copy has exactly one
 * ramp by definition and should not have to say so in a list.
 */

/** One name for a file that holds several palettes. */
function imageName(palettes: NamedRamp[]): string {
  return palettes.length === 1 ? `${slugify(palettes[0].name)}-ramp` : 'palettes'
}

function rampsCanvas(palettes: NamedRamp[], options: ImageOptions): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  drawRamps(canvas, palettes, options)
  return canvas
}

export function rampsPngBlob(
  palettes: NamedRamp[],
  options: ImageOptions,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    rampsCanvas(palettes, options).toBlob((blob) => resolve(blob), 'image/png')
  })
}

export async function copyRampsPng(
  palettes: NamedRamp[],
  options: ImageOptions,
): Promise<boolean> {
  const blob = await rampsPngBlob(palettes, options)
  if (!blob || typeof ClipboardItem === 'undefined') return false
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    return true
  } catch {
    return false
  }
}

export async function downloadRampsPng(
  palettes: NamedRamp[],
  options: ImageOptions,
): Promise<boolean> {
  const blob = await rampsPngBlob(palettes, options)
  if (!blob) return false
  download(blob, `${imageName(palettes)}.png`)
  return true
}

/**
 * The same stack as vector rectangles, one group per palette.
 *
 * Grouped and named so Figma receives a frame per palette rather than eighty
 * loose rectangles it is up to you to sort out. Labels are left off here as
 * they are in `toSvg`: the point of the vector export is editable layers, and
 * baked text is the opposite of that.
 */
export function rampsSvg(palettes: NamedRamp[], options: ImageOptions): string {
  const size = Math.round(options.size)
  const steps = Math.max(1, ...palettes.map((palette) => palette.ramp.length))
  const width = size * steps
  const height = size * palettes.length

  const groups = palettes
    .map((palette, index) => {
      const slug = slugify(palette.name)
      const rects = palette.ramp
        .map(
          (swatch, position) =>
            `    <rect id="${slug}-${swatch.label}" x="${position * size}" ` +
            `y="${index * size}" width="${size}" height="${size}" fill="${swatch.hex}"/>`,
        )
        .join('\n')
      return `  <g id="${slug}">\n${rects}\n  </g>`
    })
    .join('\n')

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="0 0 ${width} ${height}">\n${groups}\n</svg>`
  )
}

export function downloadRampsSvg(palettes: NamedRamp[], options: ImageOptions): void {
  const blob = new Blob([rampsSvg(palettes, options)], { type: 'image/svg+xml' })
  download(blob, `${imageName(palettes)}.svg`)
}

/* --- the review board as one image ------------------------------------ */

export type BoardPalette = {
  name: string
  ramp: Swatch[]
  /**
   * The value to stamp on each step, pre-formatted by the caller and indexed
   * by step. Formatted outside so this file stays out of the business of
   * knowing formats and gamuts, and so the image cannot disagree with the
   * board about what a step reads as.
   */
  values?: string[]
}

export type BoardOptions = {
  /** `rows`: palettes are horizontal bands stacked down the image. */
  axis: 'rows' | 'columns'
  /** Space between palettes, in image pixels. Never between steps. */
  gap: number
  /** Share of the stacking axis per palette, in document order. */
  paletteWeights: number[]
  /**
   * Share of the ramp axis per step, shared by every palette so they line up.
   *
   * Need not cover the longest ramp: with the steps unlocked a palette can
   * have more steps than the array has entries, and a missing entry counts as
   * one share, as it does on the board itself.
   */
  stepWeights: number[]
  /** Palette names, and each step's value stamped on its block. */
  labels: boolean
  width: number
  height: number
  /** The canvas the board is being judged against, painted into the gaps. */
  background: string
}

/**
 * Integer pixel spans for a set of weights laid across `total` pixels.
 *
 * Boundaries are rounded *once*, cumulatively, and each span is the distance
 * between two of them. Rounding each span on its own instead leaves the
 * errors to accumulate, which shows up as a 1px seam of background between
 * two steps and a 1px overlap somewhere else — and a seam is the one thing
 * this file exists to avoid, since a pipette landing on it picks the seam.
 */
export function tracks(
  weights: number[],
  total: number,
  gap: number,
): { start: number; size: number }[] {
  const sum = weights.reduce((a, b) => a + b, 0)
  if (!(sum > 0)) return []
  const room = total - gap * (weights.length - 1)

  let weight = 0
  let edge = 0
  return weights.map((share, index) => {
    weight += share
    const end = Math.round((weight / sum) * room) + index * gap
    const track = { start: edge, size: Math.max(end - edge, 0) }
    edge = end + gap
    return track
  })
}

/**
 * Step tracks for one ramp, cached per step count.
 *
 * `stepWeights` is a single array shared by every palette, so that palettes of
 * the same length line up step for step. With the steps unlocked they need not
 * be the same length, and a longer ramp runs off the end of the array — so a
 * missing entry counts as one share, exactly as the board's own flex layout
 * treats it. Reading the width straight out of the array instead dropped every
 * step past the end for want of one, which is how a palette with more steps
 * than the others came out of the exporters short.
 */
function stepTracker(
  weights: number[],
  total: number,
): (count: number) => { start: number; size: number }[] {
  const cache = new Map<number, { start: number; size: number }[]>()
  return (count) => {
    const cached = cache.get(count)
    if (cached) return cached
    const own = Array.from({ length: count }, (_, index) => weights[index] ?? 1)
    const laid = tracks(own, total, 0)
    cache.set(count, laid)
    return laid
  }
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export function drawBoard(
  canvas: HTMLCanvasElement,
  palettes: BoardPalette[],
  options: BoardOptions,
): void {
  canvas.width = Math.max(Math.round(options.width), 1)
  canvas.height = Math.max(Math.round(options.height), 1)

  const ctx = canvas.getContext('2d')
  if (!ctx) return

  // The gaps are canvas, not nothing: the spacing between palettes is being
  // judged against the ground, so the image has to carry the same ground.
  ctx.fillStyle = options.background
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  const rows = options.axis === 'rows'
  const bands = tracks(
    options.paletteWeights,
    rows ? canvas.height : canvas.width,
    Math.round(options.gap),
  )
  const stepsFor = stepTracker(options.stepWeights, rows ? canvas.width : canvas.height)

  palettes.forEach((palette, index) => {
    const band = bands[index]
    if (!band) return
    const steps = stepsFor(palette.ramp.length)
    palette.ramp.forEach((swatch, position) => {
      const step = steps[position]
      if (!step) return
      ctx.fillStyle = swatch.hex
      if (rows) ctx.fillRect(step.start, band.start, step.size, band.size)
      else ctx.fillRect(band.start, step.start, band.size, step.size)
    })
  })

  if (!options.labels) return

  // Subtle labels in white or black depending on the contrast of the swatch.
  const fontPx = Math.round(Math.min(Math.max(canvas.width / 160, 9), 16))
  const subFontPx = Math.round(fontPx * 0.85)
  const contrastFontPx = Math.round(fontPx * 0.75)

  palettes.forEach((palette, index) => {
    const band = bands[index]
    if (!band) return
    const steps = stepsFor(palette.ramp.length)

    // Step labels: color number + value centred on each chip
    palette.ramp.forEach((swatch, position) => {
      const step = steps[position]
      if (!step) return
      const cellX = rows ? step.start : band.start
      const cellY = rows ? band.start : step.start
      const cellW = rows ? step.size : band.size
      const cellH = rows ? band.size : step.size

      const textColor =
        swatch.contrastOnBlack >= swatch.contrastOnWhite ? '#000000' : '#ffffff'
      ctx.fillStyle = textColor
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'

      const cx = cellX + cellW / 2
      const cy = cellY + cellH / 2
      const value = palette.values?.[position]
      const contrast = `W ${swatch.contrastOnWhite.toFixed(1)} · B ${swatch.contrastOnBlack.toFixed(1)}`

      if (value && cellH >= fontPx * 3.4) {
        ctx.font = `bold ${fontPx}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`
        if (ctx.measureText(swatch.label).width <= cellW - 4) {
          ctx.fillText(swatch.label, cx, cy - fontPx * 1.1)
        }
        ctx.font = `${subFontPx}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`
        if (ctx.measureText(value).width <= cellW - 4) {
          ctx.fillText(value, cx, cy)
        }
        ctx.font = `${contrastFontPx}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`
        if (ctx.measureText(contrast).width <= cellW - 4) {
          ctx.fillText(contrast, cx, cy + fontPx * 1.05)
        }
      } else if (value && cellH >= fontPx * 2.2) {
        ctx.font = `bold ${fontPx}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`
        if (ctx.measureText(swatch.label).width <= cellW - 4) {
          ctx.fillText(swatch.label, cx, cy - fontPx * 0.55)
        }
        ctx.font = `${subFontPx}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`
        if (ctx.measureText(value).width <= cellW - 4) {
          ctx.fillText(value, cx, cy + fontPx * 0.55)
        }
      } else if (cellH >= fontPx) {
        ctx.font = `bold ${fontPx}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`
        if (ctx.measureText(swatch.label).width <= cellW - 4) {
          ctx.fillText(swatch.label, cx, cy)
        }
      }
    })
  })
}

/**
 * The board as vector rectangles, one group per palette.
 *
 * When labels are toggled on, includes each step's color number, formatted value,
 * and WCAG W/B contrast ratios in white or black text depending on the underlying swatch contrast.
 */
export function boardSvg(palettes: BoardPalette[], options: BoardOptions): string {
  const width = Math.max(Math.round(options.width), 1)
  const height = Math.max(Math.round(options.height), 1)
  const rows = options.axis === 'rows'
  const bands = tracks(
    options.paletteWeights,
    rows ? height : width,
    Math.round(options.gap),
  )
  const stepsFor = stepTracker(options.stepWeights, rows ? width : height)
  const fontPx = Math.round(Math.min(Math.max(width / 160, 9), 16))
  const subFontPx = Math.round(fontPx * 0.85)
  const contrastFontPx = Math.round(fontPx * 0.75)

  const groups = palettes
    .map((palette, index) => {
      const band = bands[index]
      if (!band) return ''
      const slug = slugify(palette.name)
      const steps = stepsFor(palette.ramp.length)
      const rects = palette.ramp
        .map((swatch, position) => {
          const step = steps[position]
          if (!step) return ''
          const x = rows ? step.start : band.start
          const y = rows ? band.start : step.start
          const w = rows ? step.size : band.size
          const h = rows ? band.size : step.size
          return (
            `    <rect id="${slug}-${swatch.label}" x="${x}" y="${y}" ` +
            `width="${w}" height="${h}" fill="${swatch.hex}"/>`
          )
        })
        .filter(Boolean)
        .join('\n')

      let labelsMarkup = ''
      if (options.labels) {
        const stepTexts = palette.ramp
          .map((swatch, position) => {
            const step = steps[position]
            if (!step) return ''
            const cellX = rows ? step.start : band.start
            const cellY = rows ? band.start : step.start
            const cellW = rows ? step.size : band.size
            const cellH = rows ? band.size : step.size

            const textColor =
              swatch.contrastOnBlack >= swatch.contrastOnWhite ? '#000000' : '#ffffff'
            const cx = Math.round(cellX + cellW / 2)
            const cy = Math.round(cellY + cellH / 2)
            const value = palette.values?.[position]
            const contrast = `W ${swatch.contrastOnWhite.toFixed(1)} · B ${swatch.contrastOnBlack.toFixed(1)}`

            if (value && cellH >= fontPx * 3.4) {
              const labelY = Math.round(cy - fontPx * 1.1)
              const valueY = Math.round(cy)
              const contrastY = Math.round(cy + fontPx * 1.05)
              return (
                `    <text x="${cx}" y="${labelY}" fill="${textColor}" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="${fontPx}" font-weight="bold" text-anchor="middle" dominant-baseline="central">${swatch.label}</text>\n` +
                `    <text x="${cx}" y="${valueY}" fill="${textColor}" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="${subFontPx}" text-anchor="middle" dominant-baseline="central">${escapeXml(value)}</text>\n` +
                `    <text x="${cx}" y="${contrastY}" fill="${textColor}" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="${contrastFontPx}" text-anchor="middle" dominant-baseline="central">${escapeXml(contrast)}</text>`
              )
            } else if (value && cellH >= fontPx * 2.2) {
              const labelY = Math.round(cy - fontPx * 0.55)
              const valueY = Math.round(cy + fontPx * 0.55)
              return (
                `    <text x="${cx}" y="${labelY}" fill="${textColor}" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="${fontPx}" font-weight="bold" text-anchor="middle" dominant-baseline="central">${swatch.label}</text>\n` +
                `    <text x="${cx}" y="${valueY}" fill="${textColor}" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="${subFontPx}" text-anchor="middle" dominant-baseline="central">${escapeXml(value)}</text>`
              )
            } else {
              return `    <text x="${cx}" y="${cy}" fill="${textColor}" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="${fontPx}" font-weight="bold" text-anchor="middle" dominant-baseline="central">${swatch.label}</text>`
            }
          })
          .filter(Boolean)
          .join('\n')

        labelsMarkup = `\n${stepTexts}`
      }

      return `  <g id="${slug}">\n${rects}${labelsMarkup}\n  </g>`
    })
    .filter(Boolean)
    .join('\n')

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="0 0 ${width} ${height}">\n${groups}\n</svg>`
  )
}

function boardCanvas(palettes: BoardPalette[], options: BoardOptions): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  drawBoard(canvas, palettes, options)
  return canvas
}

export function boardPngBlob(
  palettes: BoardPalette[],
  options: BoardOptions,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    boardCanvas(palettes, options).toBlob((blob) => resolve(blob), 'image/png')
  })
}

/** The board as arranged, straight to the clipboard. */
export async function copyBoardPng(
  palettes: BoardPalette[],
  options: BoardOptions,
): Promise<boolean> {
  const blob = await boardPngBlob(palettes, options)
  if (!blob || typeof ClipboardItem === 'undefined') return false
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    return true
  } catch {
    return false
  }
}
