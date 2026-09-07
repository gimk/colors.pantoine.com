import { converter } from 'culori'
import { contrastRatio, relativeLuminance, type Oklch } from './oklch'

/**
 * Looking at a palette through somebody else's eyes.
 *
 * A viewing condition, never an edit: nothing here touches a colour, a curve
 * or what a chip copies. The question is whether the palette you actually
 * built survives the trip to an eye that is not yours, and a question is not
 * allowed to change its subject.
 *
 * Colour in, colour out — OKLCH both ways, like everything else in this
 * folder. Nothing here knows what display the answer is bound for; the
 * caller maps the result with `mapToGamut`, exactly as it maps every other
 * colour the tool produces. That is what makes the check honest on a
 * wide-gamut document: a P3 red is simulated as a P3 red, not as the sRGB
 * rendition of one, and it is the strict gamut map — not this file — that
 * decides what the screen can show of the answer.
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
 * A single 3×3 in *linear* light, which is why these are matrices and not a
 * curve: what a missing cone fails to distinguish is the physical stimulus,
 * so the gamma has to come off first and go back on after — which converting
 * through OKLCH does for us at both ends.
 *
 * They are quoted for linear sRGB, and that is not the gamut limitation it
 * sounds like. Linear sRGB is a complete set of coordinates for colour, not
 * a box: the unit cube is the sRGB *gamut*, while the space itself runs past
 * it in every direction, and a P3 red is simply a triple with a coordinate
 * above one and two below zero. The matrix is a linear map, so it means
 * exactly the same thing out there as it does inside. Nothing is clamped on
 * the way in or out, and that single restraint is the whole of what makes
 * this accurate on a wide-gamut document.
 *
 * The rows of each sum to one, so the grey axis comes through untouched — a
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
 * WCAG relative luminance weights.
 *
 * The Y row of the linear sRGB to XYZ matrix, so this is true CIE luminance
 * for any colour written in linear sRGB coordinates — the ones past the
 * gamut included. It is also the luminance the contrast figures stamped
 * beside a chip are computed from, so a grey chip and its own label cannot
 * come to different conclusions.
 */
const LUMA = [0.2126, 0.7152, 0.0722] as const

const toLinear = converter('lrgb')
const toOklch = converter('oklch')

/** Linear sRGB coordinates back to OKLCH, out-of-gamut values and all. */
function fromLinear(r: number, g: number, b: number): Oklch {
  const c = toOklch({ mode: 'lrgb', r, g, b })
  return {
    // A projection can land a hair below black on a colour that started at
    // the very edge of one. Nothing but float dust, but a negative lightness
    // is not a colour anything downstream should have to reason about.
    l: Math.min(1, Math.max(0, c?.l ?? 0)),
    c: Math.max(0, c?.c ?? 0),
    // Neutrals have no hue, and culori says so with `undefined`.
    h: c?.h ?? 0,
  }
}

/** The colour as the given eye receives it. */
export function simulate(color: Oklch, vision: Vision): Oklch {
  if (vision === 'normal') return color

  const linear = toLinear({ mode: 'oklch', ...color })
  const r = linear?.r ?? 0
  const g = linear?.g ?? 0
  const b = linear?.b ?? 0

  if (vision === 'grayscale') {
    // Tone at the same luminance, not the average of the channels: the point
    // of the mode is that two chips merging here are two chips a contrast
    // check cannot tell apart either. A grey brighter than white is not a
    // thing, so the one bound worth keeping is that one.
    const y = Math.min(1, Math.max(0, LUMA[0] * r + LUMA[1] * g + LUMA[2] * b))
    return fromLinear(y, y, y)
  }

  const m = MATRICES[vision]
  return fromLinear(
    m[0] * r + m[1] * g + m[2] * b,
    m[3] * r + m[4] * g + m[5] * b,
    m[6] * r + m[7] * g + m[8] * b,
  )
}

/**
 * Black or white, whichever is legible on this colour.
 *
 * The same comparison every swatch already carries in its own contrast
 * figures, on a colour that has none — the simulated one. Worth reading off
 * the colour on screen rather than the colour it came from: a saturated red
 * is a mid tone to you and a dark brown to a protanope, and black type would
 * vanish into it.
 */
export function inkOn(color: Oklch): '#000000' | '#ffffff' {
  const luminance = relativeLuminance(color)
  return contrastRatio(luminance, 0) >= contrastRatio(luminance, 1) ? '#000000' : '#ffffff'
}
