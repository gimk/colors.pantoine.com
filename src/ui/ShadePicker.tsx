import { useEffect, useMemo, useRef } from 'react'
import { nameForColor } from '../color/names'
import { formatColor, mapToGamut, type Format, type Gamut, type Oklch } from '../color/oklch'
import { createPalette, MAX_STEPS } from '../color/presets'
import { generateRamp, type Swatch } from '../color/ramp'
import { inkOn, simulate, type Vision } from '../color/vision'

/**
 * How many shades the strip offers.
 *
 * As many as the editor will ever build, because the strip is as tall as the
 * bar and has the room. Fewer would space them further apart than the choice
 * they represent: two adjacent steps here are already close enough that
 * picking between them is a judgement, which is the point of showing them.
 */
export const SHADE_STEPS = MAX_STEPS

/**
 * What the display actually emits for one step of the ramp.
 *
 * `oklch` on a swatch is what the curves asked for, which at the vivid end of
 * a narrow gamut is more chroma than there is. The strict map answers by
 * holding lightness and hue and giving chroma back, so the request minus
 * `chromaLost` is the colour that was on screen — and picking that rather
 * than the request is what keeps the scheme's promise that every slot is
 * inside the gamut. Nobody can choose a colour they were never shown.
 */
export function emitted(swatch: Swatch): Oklch {
  return {
    l: swatch.oklch.l,
    c: Math.max(0, swatch.oklch.c - swatch.chromaLost),
    h: swatch.oklch.h,
  }
}

type Props = {
  color: Oklch
  gamut: Gamut
  vision: Vision
  format: Format
  onPick: (color: Oklch) => void
  onClose: () => void
}

/**
 * The shades of one colour, laid over the bar it belongs to.
 *
 * The ramp is the one the other half of the tool would build from this
 * colour — `createPalette` and `generateRamp`, default curves, the document's
 * gamut — rather than a lightness ladder invented here. That is what makes it
 * an answer rather than a list: the shade you pick is a colour this tool
 * stands behind, chroma held to what the hue can carry at that lightness, and
 * it is the step you would have got by sending the scheme to ramps and
 * reading it off there.
 *
 * The colour you are already on is in the strip, marked, at wherever its own
 * lightness puts it. So the gesture is *move from here*, up into the tints or
 * down into the shades, and picking the step you are on is a way of changing
 * your mind rather than a mistake.
 *
 * A panel inside the bar, deliberately not a `<dialog>`. A modal one was the
 * first attempt, for the Escape and the click-away it gives you free, and it
 * was wrong: `showModal` makes the whole document inert, and this board is a
 * wall of colour with nothing else on it, so an inert board under a backdrop
 * that had to stay transparent — the other colours being exactly what the
 * choice is made against — is indistinguishable from an application that has
 * hung. Every bar stayed lit and stopped answering. The three dismissals are
 * cheap to do by hand, and the board behind stays alive while you choose.
 */
export function ShadePicker({ color, gamut, vision, format, onPick, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  /**
   * The ramp this colour makes, derived from the colour rather than from its
   * hex: a hex is sRGB, and rounding a P3 slot through one would derive the
   * whole strip from chroma the document never asked it to give up.
   */
  const ramp = useMemo(
    () => generateRamp(createPalette(formatColor(color, 'oklch'), SHADE_STEPS, gamut), gamut),
    [color, gamut],
  )

  /**
   * Escape, and a press that lands anywhere else.
   *
   * `pointerdown` rather than `click`, in capture, so a press meant to
   * dismiss the strip does not also reach the bar underneath and copy a
   * colour on its way past. The press that opened the strip cannot close it:
   * this listener is registered as the strip mounts, which is after that
   * press has already been dispatched.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    const onDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onDown, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onDown, true)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      className="shades"
      role="group"
      aria-label="Shades"
      /* Moving off the bar puts it away: this is a glance and a click, and
         leaving is the way you say you did not want one. */
      onPointerLeave={onClose}
      /* The bar is the drag handle for reordering, and these steps are inside
         it. Without this, a press that slides a pixel down the strip starts
         dragging the whole colour instead of choosing a shade. */
      onDragStart={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
    >
      {ramp.map((swatch) => {
        const shown = emitted(swatch)
        const seen = vision === 'normal' ? shown : simulate(shown, vision)
        const background =
          vision === 'normal' ? swatch.displayColor : mapToGamut(seen, gamut).displayColor
        const value = formatColor(shown, format, gamut)
        // The 30k list is already loaded and cached — every bar is named off
        // it — so naming the whole strip when it opens costs a fraction of a
        // millisecond, and a name is most of what tells two neighbouring
        // shades apart at a glance.
        const name = nameForColor(swatch.hex)

        return (
          <button
            key={swatch.index}
            type="button"
            className={`shades__step${swatch.isBase ? ' is-here' : ''}`}
            style={{ backgroundColor: background, color: inkOn(seen) }}
            aria-current={swatch.isBase || undefined}
            onClick={() => {
              onPick(shown)
              onClose()
            }}
            title={
              swatch.isBase
                ? `${name} · ${value} — where this colour already is`
                : `Use ${name} · ${value}`
            }
          >
            {/* Both readings on the step under the pointer: the value is what
                a click takes, the name is what makes it memorable. Absolutely
                positioned, so nothing moves when they appear and the mark on
                the current step can sit in the same place. */}
            <span className="shades__read">
              <span className="shades__value">{value}</span>
              <span className="shades__name">{name}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
