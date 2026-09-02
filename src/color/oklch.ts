import { converter, formatCss, formatHex, parse, toGamut } from 'culori'

export type Oklch = { l: number; c: number; h: number }

export type Gamut = 'srgb' | 'p3' | 'a98' | 'rec2020' | 'oklab'

export type GamutOption = {
  id: Gamut
  label: string
}

export const GAMUTS: GamutOption[] = [
  { id: 'srgb', label: 'sRGB' },
  { id: 'p3', label: 'Display P3' },
  { id: 'a98', label: 'Adobe RGB' },
  { id: 'rec2020', label: 'Rec. 2020' },
  { id: 'oklab', label: 'OKLab' },
]

export function isGamut(value: string | null | undefined): value is Gamut {
  return value != null && GAMUTS.some((option) => option.id === value)
}

export function parseGamut(value: string | null | undefined): Gamut | null {
  if (!value) return null
  if (isGamut(value)) return value
  const match = GAMUTS.find(
    (option) => option.label.toLowerCase() === value.toLowerCase(),
  )
  return match?.id ?? null
}

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
    case 'oklab':
      return 'OKLab'
  }
}

const toOklch = converter('oklch')
const toOklab = converter('oklab')
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

/**
 * Hold L and H, reduce chroma until the colour fits the target gamut.
 *
 * Deliberately *not* the CSS Color 4 default. That algorithm accepts a
 * candidate that is only "roughly" in gamut and lets the final channel clip
 * finish the job, which measured up to 9° of hue drift on saturated colours
 * in exchange for about 0.001 of chroma. In a tool whose whole point is
 * steering hue, an unrequested 9° shift is unacceptable and a hair less
 * chroma is something the chroma curve can answer for. Passing jnd = 0
 * makes the search strict, holding hue to within half a degree.
 */
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
    case 'oklab':
      return toOklab(c)
  }
}

function mapGamutColor(color: Oklch, gamut: Exclude<Gamut, 'oklab'>) {
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

/** Four decimals is finer than a 16-bit step, and keeps a copied `color()` readable. */
const CHANNEL_PLACES = 4

/**
 * Round the channels of an already-mapped colour and settle them into range.
 *
 * The strict search lands exactly on the gamut boundary, which leaves float
 * dust behind (-1.2e-14 for a channel that means 0, 1.0000000000000002 for
 * one that means 1) and `formatCss` would print every digit of it. This is
 * not the naive clip the strict map exists to avoid: the colour is already
 * inside the gamut, and all that is being removed is the dust.
 */
function settle<T extends { mode: string; r: number; g: number; b: number }>(color: T): T {
  const fix = (n: number) => Math.min(1, Math.max(0, Number(n.toFixed(CHANNEL_PLACES))))
  return { ...color, r: fix(color.r), g: fix(color.g), b: fix(color.b) }
}

function settleLab<T extends { l: number; a: number; b: number }>(color: T): T {
  const fix = (n: number) => Number(n.toFixed(CHANNEL_PLACES))
  return {
    ...color,
    l: Math.min(1, Math.max(0, fix(color.l))),
    a: fix(color.a),
    b: fix(color.b),
  }
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
  if (gamut === 'oklab') {
    return color.l >= -CHANNEL_TOLERANCE && color.l <= 1 + CHANNEL_TOLERANCE && color.c >= 0
  }
  const c = convertToGamut(color, gamut)
  if (!c || !('r' in c)) return false
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

/**
 * CSS Color 4 `color()` notation for the colour as the target gamut shows it.
 *
 * The one output that can carry a wide-gamut colour intact: hex, rgb() and
 * hsl() are all sRGB by definition, so on a P3 palette they are the sRGB
 * rendition of what is on screen, not what is on screen.
 */
export function toColorCss(color: Oklch, gamut: Gamut = 'srgb'): string {
  if (gamut === 'oklab') {
    const oklabColor = toOklab({ mode: 'oklch', ...color })
    if (oklabColor) {
      return formatCss(settleLab(oklabColor)) ?? formatColor(color, 'oklch')
    }
    return formatColor(color, 'oklch')
  }
  return formatCss(settle(mapGamutColor(color, gamut))) ?? toHex(color)
}

export type Mapped = {
  /**
   * Nearest sRGB hex, whatever the target gamut. Wide-gamut colours have no
   * hex, so this is the sRGB rendition — reached by the same strict map, not
   * by clipping the wide-gamut channels, which would drift the hue.
   */
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
  if (gamut === 'oklab') {
    return {
      hex: toHex(color),
      displayColor: toColorCss(color, 'oklab'),
      chroma: color.c,
      chromaLost: 0,
      clipped: false,
    }
  }
  const mapped = mapGamutColor(color, gamut)
  const chroma = toOklch(mapped)?.c ?? 0
  const chromaLost = Math.max(0, color.c - chroma)
  // Not `formatHex(mapped)`: on a wide-gamut value that clamps the channels,
  // which is the hue-drifting clip the strict map exists to avoid, and `hex`
  // is what every export writes. Map the request to sRGB properly instead.
  const hex = toHex(color)
  const displayColor = gamut === 'srgb' ? hex : toColorCss(color, gamut)

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

export type Format = 'hex' | 'oklch' | 'rgb' | 'hsl' | 'color()'

export const FORMATS: Format[] = ['hex', 'oklch', 'rgb', 'hsl', 'color()']

/**
 * `gamut` only reaches `color()`. Every other format is sRGB by definition,
 * and `oklch` prints the request, so none of them can say anything about the
 * gamut the palette is being viewed in.
 */
export function formatColor(color: Oklch, format: Format, gamut: Gamut = 'srgb'): string {
  switch (format) {
    case 'hex':
      return toHex(color)
    case 'color()':
      return toColorCss(color, gamut)
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
