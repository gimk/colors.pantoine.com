import { arc, clamp, flat, linear, type Channel, type Curve } from './curve'

/**
 * One-click curve shapes.
 *
 * Every shape but Flat keeps the curve's own endpoints, so reaching for one
 * changes how the ramp travels between the values the designer already chose
 * rather than throwing them away. They are starting points to drag from, not
 * finished answers — the Reset button is what restores the gamut-aware
 * default for the channel.
 */
export type Shape = {
  id: string
  label: string
  hint: string
  apply: (curve: Curve, channel: Channel) => Curve
}

/** How far above the endpoints an arc peaks, as a share of the channel. */
const ARC_RISE = 0.25

function arcPeak(curve: Curve, channel: Channel): number {
  const mean = (curve.start + curve.end) / 2
  const rise = (channel.max - channel.min) * ARC_RISE
  return clamp(mean + rise, channel.min, channel.max)
}

export const SHAPES: Shape[] = [
  {
    id: 'flat',
    label: 'Flat',
    hint: 'Hold the first value across every step',
    apply: (curve) => flat(curve.start),
  },
  {
    id: 'linear',
    label: 'Linear',
    hint: 'Straight line between the two ends',
    apply: (curve) => linear(curve.start, curve.end),
  },
  {
    id: 'arc',
    label: 'Arc',
    hint: 'Rise to a peak mid-ramp and fall away again',
    apply: (curve, channel) => arc(curve.start, curve.end, arcPeak(curve, channel)),
  },
  {
    id: 'ease',
    label: 'Ease',
    hint: 'Linger near both ends, move quickly through the middle',
    apply: (curve) => ({
      start: curve.start,
      end: curve.end,
      h1: { x: 0.42, y: curve.start },
      h2: { x: 0.58, y: curve.end },
    }),
  },
]
