/**
 * Looking at the board through somebody else's eyes.
 *
 * A viewing condition, never an edit: nothing here touches a palette, a curve
 * or what a chip copies. The colours the document holds stay exactly what
 * they were, and only the pixels change — which is the whole point, since the
 * question being asked is whether the palette you actually built survives the
 * trip to an eye that is not yours.
 *
 * Everything is defined in sRGB. The confusion matrices below are derived for
 * sRGB primaries, so feeding them Display P3 channel values would be
 * simulating a different display's colourblindness; a wide-gamut board under
 * a simulation is therefore shown through its sRGB rendition, which is the
 * only rendition the maths has anything true to say about.
 */

export type Vision =
  | 'normal'
  | 'grayscale'
  | 'protanopia'
  | 'deuteranopia'
  | 'tritanopia'

export type VisionOption = {
  id: Vision
  label: string
  /** What the mode is for, in the words of the question it answers. */
  hint: string
}

export const VISIONS: VisionOption[] = [
  {
    id: 'normal',
    label: 'Normal',
    hint: 'The palettes as they are',
  },
  {
    id: 'grayscale',
    label: 'Grayscale',
    hint: 'Colour taken away, tone kept: two steps that merge here have the same luminance, and nothing but hue was telling them apart',
  },
  {
    id: 'protanopia',
    label: 'Protanopia',
    hint: 'No red cone: red darkens and falls in with green. Around 1% of men',
  },
  {
    id: 'deuteranopia',
    label: 'Deuteranopia',
    hint: 'No green cone: the commonest red/green confusion. Around 1% of men',
  },
  {
    id: 'tritanopia',
    label: 'Tritanopia',
    hint: 'No blue cone: blue falls in with green, yellow with pink. Rare, and it hits both sexes alike',
  },
]

export function isVision(value: string | null | undefined): value is Vision {
  return value != null && VISIONS.some((option) => option.id === value)
}

export function visionLabel(vision: Vision): string {
  return VISIONS.find((option) => option.id === vision)?.label ?? 'Normal'
}

/**
 * Machado, Oliveira & Fernandes (2009), at full severity.
 *
 * A single 3×3 applied to *linear* sRGB, which is why these are matrices and
 * not a curve: the physical stimulus is what a missing cone fails to
 * distinguish, so the gamma has to come off first and go back on after. The
 * rows of each sum to 1, so the grey axis comes through untouched — a
 * simulation that tinted the neutrals would be visibly wrong at a glance.
 *
 * Dichromacy only. The anomalous forms (protanomaly and friends) are far more
 * common but they are a severity dial, and a palette that survives the
 * dichromat survives them all — so the board asks the hard question and
 * leaves the dial out of the bar.
 */
const MATRICES: Record<
  Exclude<Vision, 'normal' | 'grayscale'>,
  readonly [number, number, number, number, number, number, number, number, number]
> = {
  protanopia: [
    0.152286, 1.052583, -0.204868,
    0.114503, 0.786281, 0.099216,
    -0.003882, -0.048116, 1.051998,
  ],
  deuteranopia: [
    0.367322, 0.860646, -0.227968,
    0.280085, 0.672501, 0.047413,
    -0.011820, 0.042940, 0.968881,
  ],
  tritanopia: [
    1.255528, -0.076749, -0.178779,
    -0.078411, 0.930809, 0.147602,
    0.004733, 0.691367, 0.303900,
  ],
}

/**
 * The sRGB transfer function, both ways.
 *
 * `oklch.ts` linearises with WCAG 2.1's published 0.03928 rather than the
 * sRGB spec's 0.04045. The two curves part company by less than a 16-bit
 * step, so the luminance this file computes and the contrast figures stamped
 * beside a chip cannot disagree about anything anyone can see.
 */
function toLinear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4)
}

function toGamma(channel: number): number {
  return channel <= 0.0031308 ? channel * 12.92 : 1.055 * Math.pow(channel, 1 / 2.4) - 0.055
}

/** WCAG relative luminance weights, so grey means the same here as it does there. */
const LUMA = [0.2126, 0.7152, 0.0722] as const

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n)

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i

/** `#rgb` or `#rrggbb` as three 0 → 1 channels, or null for anything else. */
function parseHex(hex: string): [number, number, number] | null {
  const match = HEX.exec(hex.trim())
  if (!match) return null
  const digits = match[1]
  const wide = digits.length === 6
  const at = (index: number) => {
    const slice = wide ? digits.slice(index * 2, index * 2 + 2) : digits[index].repeat(2)
    return parseInt(slice, 16) / 255
  }
  return [at(0), at(1), at(2)]
}

function toHex(r: number, g: number, b: number): string {
  const channel = (n: number) =>
    Math.round(clamp01(n) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${channel(r)}${channel(g)}${channel(b)}`
}

/**
 * The colour as the given eye receives it, as a hex string.
 *
 * Anything unparseable comes back untouched. A simulation that failed loudly
 * — a black chip, an empty background — would be read as a colour, and a
 * board that lies about one step is worse than one that misses a mode.
 */
export function simulate(hex: string, vision: Vision): string {
  if (vision === 'normal') return hex
  const rgb = parseHex(hex)
  if (!rgb) return hex

  const [r, g, b] = rgb.map(toLinear)

  if (vision === 'grayscale') {
    // Tone at the same luminance, not the average of the channels: the point
    // of the mode is that two chips merging here are two chips a contrast
    // check cannot tell apart either.
    const y = LUMA[0] * r + LUMA[1] * g + LUMA[2] * b
    const grey = toGamma(clamp01(y))
    return toHex(grey, grey, grey)
  }

  const m = MATRICES[vision]
  return toHex(
    toGamma(clamp01(m[0] * r + m[1] * g + m[2] * b)),
    toGamma(clamp01(m[3] * r + m[4] * g + m[5] * b)),
    toGamma(clamp01(m[6] * r + m[7] * g + m[8] * b)),
  )
}

/**
 * Black or white, whichever is legible on this colour.
 *
 * Taken from the colour actually on screen rather than from the swatch's
 * stored contrast figures, because under a simulation those are the figures
 * of a colour nobody is looking at: a saturated red is a mid tone to you and
 * a dark brown to a protanope, and black type would vanish into it.
 */
export function inkOn(hex: string): '#000000' | '#ffffff' {
  const rgb = parseHex(hex)
  if (!rgb) return '#000000'
  const [r, g, b] = rgb.map(toLinear)
  const y = LUMA[0] * r + LUMA[1] * g + LUMA[2] * b
  const onWhite = 1.05 / (y + 0.05)
  const onBlack = (y + 0.05) / 0.05
  return onBlack >= onWhite ? '#000000' : '#ffffff'
}
