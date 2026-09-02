import { converter, formatCss, formatHex, inGamut, parse, toGamut } from 'culori'

export type Oklch = { l: number; c: number; h: number }

export type Gamut = 'srgb' | 'p3' | 'a98' | 'rec2020'

export type GamutOption = {
  id: Gamut
  label: string
}

export const GAMUTS: GamutOption[] = [
  { id: 'srgb', label: 'sRGB' },
  { id: 'p3', label: 'Display P3' },
  { id: 'a98', label: 'Adobe RGB' },
  { id: 'rec2020', label: 'Rec. 2020' },
]

export function gamutLabel(gamut: Gamut): string {
  switch (gamut) {
    case 'srgb':
      return 'sRGB'
    case 'p3':
      return 'Display P3'
    case 'a98':
      return 'Adobe RGB'
    case 'rec2020':
      return 'Rec. 2020'
  }
}

const toOklch = converter('oklch')
const toRgb = converter('rgb')
const toP3 = converter('p3')
const toA98 = converter('a98')
const toRec2020 = converter('rec2020')

/**
 * Half an 8-bit step. culori's own `inGamut` is exact to the last float,
 * which would put a false "clipped" notch on colours sitting right on the
 * boundary — precisely the ones a designer pushes a chroma curve toward.
 * Since the tool's output is 8-bit hex, anything that rounds into a valid
 * channel is genuinely displayable.
 */
const CHANNEL_TOLERANCE = 0.5 / 255

const srgbMap = toGamut('rgb', 'oklch', null, 0)
const p3Map = toGamut('p3', 'oklch', null, 0)
const a98Map = toGamut('a98', 'oklch', null, 0)
const rec2020Map = toGamut('rec2020', 'oklch', null, 0)

function convertToGamut(color: Oklch, gamut: Gamut) {
  const c = { mode: 'oklch' as const, ...color }
  switch (gamut) {
    case 'srgb':
      return toRgb(c)
    case 'p3':
      return toP3(c)
    case 'a98':
      return toA98(c)
    case 'rec2020':
      return toRec2020(c)
  }
}

function mapGamutColor(color: Oklch, gamut: Gamut) {
  const c = { mode: 'oklch' as const, ...color }
  switch (gamut) {
    case 'srgb':
      return srgbMap(c)
    case 'p3':
      return p3Map(c)
    case 'a98':
      return a98Map(c)
    case 'rec2020':
      return rec2020Map(c)
  }
}

/** Check gamut inclusion using culori's exact inGamut check. */
export function culoriInGamut(color: Oklch, gamut: Gamut = 'srgb'): boolean {
  const mode = gamut === 'srgb' ? 'rgb' : gamut
  return inGamut(mode)({ mode: 'oklch', ...color })
}

/** Parse anything CSS accepts (hex, rgb(), hsl(), oklch(), named) into OKLCH. */
export function parseToOklch(input: string): Oklch | null {
  const parsed = parse(input.trim())
  if (!parsed) return null
  const c = toOklch(parsed)
  if (!c) return null
  return { l: c.l ?? 0, c: c.c ?? 0, h: c.h ?? 0 }
}

/** Check whether an OKLCH color fits in the specified gamut within channel tolerance. */
export function isInGamut(color: Oklch, gamut: Gamut = 'srgb'): boolean {
  const c = convertToGamut(color, gamut)
  if (!c) return false
  const lo = -CHANNEL_TOLERANCE
  const hi = 1 + CHANNEL_TOLERANCE
  return c.r >= lo && c.r <= hi && c.g >= lo && c.g <= hi && c.b >= lo && c.b <= hi
}

export function isInSrgb(color: Oklch): boolean {
  return isInGamut(color, 'srgb')
}

/** Nearest in-gamut sRGB hex for an OKLCH colour. */
export function toHex(color: Oklch): string {
  return formatHex(srgbMap({ mode: 'oklch', ...color })) ?? '#000000'
}

/**
 * Perceptible chroma difference. Below this the gamut mapping took away
 * something nobody can see, and saying so would only cry wolf on the very
 * colours a designer deliberately pushes to the edge.
 */
export const CHROMA_JND = 0.004

export type Mapped = {
  hex: string
  /** CSS string suitable for element background (hex for sRGB, color(display-p3 ...) for P3, etc.). */
  displayColor: string
  /** Chroma that survived the mapping. */
  chroma: number
  /** How much chroma the display could not give back. */
  chromaLost: number
  /** True only when the loss is perceptible. */
  clipped: boolean
}

/** Map to the target gamut and report displayable CSS color and chroma cost. */
export function mapToGamut(color: Oklch, gamut: Gamut = 'srgb'): Mapped {
  const mapped = mapGamutColor(color, gamut)
  const chroma = toOklch(mapped)?.c ?? 0
  const chromaLost = Math.max(0, color.c - chroma)
  const hex = formatHex(mapped) ?? '#000000'
  const displayColor = gamut === 'srgb' ? hex : formatCss(mapped) ?? hex

  return {
    hex,
    displayColor,
    chroma,
    chromaLost,
    clipped: chromaLost > CHROMA_JND,
  }
}

/** Map to sRGB once and report what it cost. */
export function mapToSrgb(color: Oklch): Mapped {
  return mapToGamut(color, 'srgb')
}

export function toRgb255(color: Oklch): { r: number; g: number; b: number } {
  const c = toRgb(srgbMap({ mode: 'oklch', ...color }))
  return {
    r: Math.round((c?.r ?? 0) * 255),
    g: Math.round((c?.g ?? 0) * 255),
    b: Math.round((c?.b ?? 0) * 255),
  }
}

export function normalizeHue(h: number): number {
  return ((h % 360) + 360) % 360
}

// --- formatting -------------------------------------------------------------

export type Format = 'hex' | 'oklch' | 'rgb' | 'hsl'

export const FORMATS: Format[] = ['hex', 'oklch', 'rgb', 'hsl']

export function formatColor(color: Oklch, format: Format): string {
  switch (format) {
    case 'hex':
      return toHex(color)
    case 'oklch': {
      // Printed from the requested values, not the gamut-mapped ones, so the
      // string says what the curves asked for. Wide-gamut displays honour it.
      const l = (color.l * 100).toFixed(1)
      const c = color.c.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')
      const h = normalizeHue(color.h).toFixed(2)
      return `oklch(${l}% ${c} ${h})`
    }
    case 'rgb': {
      const { r, g, b } = toRgb255(color)
      return `rgb(${r} ${g} ${b})`
    }
    case 'hsl': {
      const { h, s, l } = toHsl(color)
      return `hsl(${h} ${s}% ${l}%)`
    }
  }
}

/** sRGB HSL, for designers whose downstream tools still speak it. */
export function toHsl(color: Oklch): { h: number; s: number; l: number } {
  const { r, g, b } = toRgb255(color)
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const d = max - min
  const l = (max + min) / 2
  let h = 0
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6
    else if (max === gn) h = (bn - rn) / d + 2
    else h = (rn - gn) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) }
}

// --- contrast ---------------------------------------------------------------

function channelLuminance(v: number): number {
  const n = v / 255
  return n <= 0.03928 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4)
}

/** WCAG 2.1 relative luminance of the gamut-mapped sRGB colour. */
export function relativeLuminance(color: Oklch): number {
  const { r, g, b } = toRgb255(color)
  return (
    0.2126 * channelLuminance(r) +
    0.7152 * channelLuminance(g) +
    0.0722 * channelLuminance(b)
  )
}

export function contrastRatio(a: number, b: number): number {
  const lighter = Math.max(a, b)
  const darker = Math.min(a, b)
  return (lighter + 0.05) / (darker + 0.05)
}
