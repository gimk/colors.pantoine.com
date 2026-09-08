import { clamp } from './curve'
import { maxChromaFor } from './gamut'
import { hasUsableHue, HARMONIES, type HarmonyId } from './harmony'
import { normalizeHue, type Gamut, type Oklch } from './oklch'

/**
 * A scheme is a handful of colours chosen to sit beside one another, which is
 * a different object from a ramp and wants a different generator.
 *
 * `harmonyCandidates` rotates hue and holds the seed's lightness, which is the
 * right answer when what you want is a hue to build a *ramp* from — the ramp
 * supplies the tonal range afterwards. Asked for five colours it hands back
 * five of exactly the same weight, and a scheme of five equally-weighted
 * colours reads as a colour wheel rather than as a palette.
 *
 * So two inputs rather than one. A rule decides the hues, exactly as it does
 * today. A profile decides how lightness and chroma are spread across the
 * slots, which is the part that was missing.
 */

export type Slot = {
  /** Stable across a regenerate, so the bars never remount. */
  id: string
  color: Oklch
  /** Held through a regenerate, byte for byte. */
  locked: boolean
}

/** Fewer than two is not a scheme; more than eight stops reading as full-bleed
 *  bars, and a document of colours is what the other mode is for. */
export const MIN_SLOTS = 2
export const MAX_SLOTS = 8

export const DEFAULT_SLOTS = 5

/**
 * The setting both controls offer beside their named choices: no structure.
 *
 * The opposite of `auto`, which rolls a *rule* and then follows it. `random`
 * rolls the colours themselves — free hues, or a lightness and a chroma per
 * slot that answer to nothing — so a scheme made this way cannot say why its
 * colours go together, because they were not chosen to. That is what it is
 * for: the escape hatch from a tool whose whole argument is structure, and a
 * way to find a starting point the eight rules would never have handed you.
 */
export const RANDOM = 'random'

/**
 * What the rule control offers: any of the harmonies, `auto`, or `random`.
 *
 * `auto` is not "no rule" — it rolls one. Every scheme it produces can then
 * answer *why these colours go together*, which is the whole difference
 * between this and a random colour generator, and the roll is reported back so
 * the board can say which rule it landed on. `random` is the one that really
 * does mean no rule, and says so in the control rather than in the result.
 */
export type RuleId = HarmonyId | typeof AUTO_RULE | typeof RANDOM
export const AUTO_RULE = 'auto'

export type ProfileId = 'even' | 'anchored' | 'vivid' | 'muted' | 'pastel'

/** What the weight control holds: one of the profiles, or the roll. */
export type ProfileSetting = ProfileId | typeof RANDOM

export type Profile = {
  id: ProfileId
  label: string
  hint: string
  /**
   * Lightness at the first slot and at the last. Everything between is spread
   * linearly, which is a straight line in OKLCH and therefore actually looks
   * like one — the reason the whole tool is in this space.
   */
  light: [number, number]
  /**
   * Chroma at the first slot and at the last, as a *share of the gamut ceiling
   * at that slot's own lightness and hue* rather than as an absolute.
   *
   * Capping at the ceiling is what keeps every generated colour inside the
   * gamut by construction, so no slot ever needs a clipped marker. It also
   * means the ends of a wide-range profile go quiet on their own: the ceiling
   * at L 0.97 is a tenth of what it is at L 0.6, so a near-white slot comes
   * out near-white whatever share it was asked for.
   */
  chroma: [number, number]
  /** How far the roll may move each slot off the profile, so that pressing
   *  generate twice with the same rule does not hand back the same scheme. */
  jitter: { l: number; c: number; h: number }
  /**
   * Whether the anchor keeps its own lightness rather than taking the one its
   * position in the spread would give it. Only `anchored` does, and it is what
   * the name means: the colour you locked stays the colour you locked, and the
   * others arrange themselves around it.
   */
  holdsAnchor?: boolean
}

/**
 * The lightness bounds the spreads work between.
 *
 * Deliberately not `L_LIGHT`/`L_DARK` from `presets.ts`. Those are the ends of
 * a *ramp*, where an almost-white and an almost-black step are wanted as
 * tokens; here they are two of only five colours, and a scheme that spends two
 * of its five on near-white and near-black has three left to do the work.
 */
const SPREAD_LIGHT = 0.92
const SPREAD_DARK = 0.22

export const PROFILES: Profile[] = [
  {
    id: 'even',
    label: 'Even',
    hint: 'The full tonal range, spread evenly. A light, some mids, a dark.',
    light: [SPREAD_LIGHT, SPREAD_DARK],
    chroma: [0.7, 0.7],
    jitter: { l: 0.04, c: 0.12, h: 6 },
  },
  {
    id: 'anchored',
    label: 'Anchored',
    hint: 'One colour holds its weight and the rest arrange around it.',
    light: [0.9, 0.26],
    chroma: [0.6, 0.85],
    jitter: { l: 0.05, c: 0.14, h: 8 },
    holdsAnchor: true,
  },
  {
    id: 'vivid',
    label: 'Vivid',
    hint: 'Poster colours. Everything saturated, at similar weight.',
    light: [0.74, 0.56],
    chroma: [0.95, 1],
    jitter: { l: 0.05, c: 0.04, h: 7 },
  },
  {
    id: 'muted',
    label: 'Muted',
    hint: 'Editorial. Held well back from the gamut edge.',
    light: [0.8, 0.4],
    chroma: [0.32, 0.38],
    jitter: { l: 0.06, c: 0.06, h: 10 },
  },
  {
    id: 'pastel',
    label: 'Pastel',
    hint: 'Light and soft, with very little chroma to any of it.',
    light: [0.94, 0.84],
    chroma: [0.26, 0.34],
    jitter: { l: 0.03, c: 0.06, h: 12 },
  },
]

export function profileFor(id: ProfileId): Profile {
  return PROFILES.find((profile) => profile.id === id) ?? PROFILES[0]
}

export function isProfileId(value: string | null | undefined): value is ProfileId {
  return PROFILES.some((profile) => profile.id === value)
}

export function isProfileSetting(value: string | null | undefined): value is ProfileSetting {
  return value === RANDOM || isProfileId(value)
}

export function isRuleId(value: string | null | undefined): value is RuleId {
  return (
    value === AUTO_RULE || value === RANDOM || HARMONIES.some((harmony) => harmony.id === value)
  )
}

/**
 * The bounds a rolled weight works between.
 *
 * The widest the named profiles reach, so `random` can land anywhere any of
 * them can and anywhere between. Each slot rolls its own, independently: this
 * is the setting that means *no profile*, and a spread would be a profile.
 * The consequence is real and intended — five colours can come back at much
 * the same weight, the way `vivid` deliberately does, or scattered across the
 * whole range. Chroma is still a share of the ceiling at the slot's own
 * lightness and hue, so a rolled scheme is in gamut by construction like
 * every other one.
 */
const ROLLED_LIGHT: [number, number] = [SPREAD_DARK, SPREAD_LIGHT]
const ROLLED_SHARE: [number, number] = [0.25, 1]

/** Hue wobble for a rolled weight: the middle of what the profiles ask for. */
const ROLLED_HUE_JITTER = 8

/** A roll in `[-amount, +amount]`. */
const wobble = (rng: () => number, amount: number) => (rng() * 2 - 1) * amount

/** Position of slot `index` along a spread of `count`, 0 → 1. One slot sits in
 *  the middle rather than at either end, where the bounds are extremes. */
function position(index: number, count: number): number {
  return count < 2 ? 0.5 : index / (count - 1)
}

const lerp = (from: number, to: number, t: number) => from + (to - from) * t

/**
 * Absolute hues for `count` slots, given the anchor's hue and a rule's offsets.
 *
 * The rule supplies a fixed number of offsets — one for complementary, four for
 * double split — and a scheme may ask for more slots than that. Past the end of
 * the list it cycles, shifting each repeat off its original by a widening step
 * and alternating the direction, so a sixth slot lands as a neighbour of the
 * first rather than as a duplicate of it. The step is a real interval rather
 * than a roll: two colours 18 degrees apart are a deliberate pair, two colours
 * 3 degrees apart are a mistake, and only the former should be reachable.
 */
export function hueSequence(
  anchorHue: number,
  offsets: number[],
  count: number,
  rng: () => number,
  jitter = 0,
): number[] {
  // The anchor's own hue leads, then the rule's rotations from it.
  const base = [0, ...offsets]
  const hues: number[] = []
  for (let index = 0; index < count; index += 1) {
    const lap = Math.floor(index / base.length)
    const sign = lap % 2 === 1 ? -1 : 1
    const shift = lap === 0 ? 0 : sign * (18 + 10 * (lap - 1))
    hues.push(normalizeHue(anchorHue + base[index % base.length] + shift + wobble(rng, jitter)))
  }
  return hues
}

/**
 * A colour to build a scheme around, when nothing in it is locked.
 *
 * Mid-weight and near the gamut edge: an anchor is the colour every other slot
 * is measured from, and one rolled at L 0.95 or at a tenth of its available
 * chroma gives every rule almost nothing to rotate.
 */
function rollAnchor(gamut: Gamut, rng: () => number): Oklch {
  const h = rng() * 360
  const l = clamp(0.6 + wobble(rng, 0.12), 0.4, 0.78)
  const c = maxChromaFor(l, h, gamut) * (0.72 + rng() * 0.26)
  return { l, c, h }
}

export type Generated = {
  slots: Slot[]
  /**
   * The rule actually applied — the roll, when `auto` was asked for — or
   * `null` when there was none, which is what `random` means.
   */
  rule: HarmonyId | null
}

/**
 * A fresh scheme, holding whatever was locked.
 *
 * Ids and lock flags survive untouched: a regenerate replaces colours and
 * nothing else, so React keys stay put and the bar you locked is still under
 * your cursor afterwards.
 *
 * A locked slot also keeps its place in the hue sequence rather than being
 * squeezed out of it. Handing its offset to the next unlocked slot instead
 * would make locking one bar silently re-hue every bar after it, which is the
 * opposite of what a lock is for.
 */
export function generateScheme(
  slots: Slot[],
  rule: RuleId,
  profileId: ProfileSetting,
  gamut: Gamut = 'srgb',
  rng: () => number = Math.random,
): Generated {
  const count = slots.length
  // `null` for `random`, which is the absence of a rule rather than one more
  // of them: there is nothing to rotate from and nothing to report afterwards.
  const harmony =
    rule === RANDOM
      ? null
      : rule === AUTO_RULE
        ? HARMONIES[Math.min(Math.floor(rng() * HARMONIES.length), HARMONIES.length - 1)]
        : (HARMONIES.find((entry) => entry.id === rule) ?? HARMONIES[0])

  if (!count) return { slots, rule: harmony?.id ?? null }

  // And `null` for a rolled weight, for the same reason: every slot answers
  // to its own roll rather than to a shared spread.
  const profile = profileId === RANDOM ? null : profileFor(profileId)

  // The first locked slot with a hue worth rotating. A locked grey is still
  // held, but it cannot anchor anything: every rule would rotate nothing and
  // hand back the same grey as many times as there are slots.
  const anchorIndex = slots.findIndex((slot) => slot.locked && hasUsableHue(slot.color))
  const anchor = anchorIndex >= 0 ? slots[anchorIndex].color : rollAnchor(gamut, rng)

  // A rule rotates its offsets off the anchor; no rule rolls each hue on its
  // own, which is the whole of what `random` does to the hue axis.
  const hues = harmony
    ? hueSequence(anchor.h, harmony.offsets, count, rng, profile?.jitter.h ?? ROLLED_HUE_JITTER)
    : Array.from({ length: count }, () => rng() * 360)

  const next = slots.map((slot, index) => {
    if (slot.locked) return slot

    const t = position(index, count)
    const h = hues[index]

    const holdAnchor = profile?.holdsAnchor && index === anchorIndex
    const l = holdAnchor
      ? anchor.l
      : profile
        ? clamp(
            lerp(profile.light[0], profile.light[1], t) + wobble(rng, profile.jitter.l),
            0.08,
            0.98,
          )
        : lerp(ROLLED_LIGHT[0], ROLLED_LIGHT[1], rng())

    const share = profile
      ? clamp(lerp(profile.chroma[0], profile.chroma[1], t) + wobble(rng, profile.jitter.c), 0, 1)
      : lerp(ROLLED_SHARE[0], ROLLED_SHARE[1], rng())

    const c = maxChromaFor(l, h, gamut) * share

    return { ...slot, color: { l, c, h } }
  })

  return { slots: next, rule: harmony?.id ?? null }
}
