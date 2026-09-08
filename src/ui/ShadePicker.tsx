import { useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
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

/** The bar's own colour, showing round the strip, says which bar this is. */
const INSET = 8

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

type Box = { top: number; left: number; width: number; height: number }

type Props = {
  color: Oklch
  gamut: Gamut
  vision: Vision
  format: Format
  /** Names the colour these are shades of, for the label a screen reader gets. */
  name: string
  onPick: (color: Oklch) => void
  /** The element the strip covers: the bar this colour is in. */
  anchor: RefObject<HTMLElement | null>
  trigger: (open: () => void, ref: RefObject<HTMLButtonElement | null>) => ReactNode
  /** For testing, renders the strip without a click. */
  defaultOpen?: boolean
}

/**
 * The shades of one colour, over the bar it belongs to.
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
 */
export function ShadePicker({
  color,
  gamut,
  vision,
  format,
  name,
  onPick,
  anchor,
  trigger,
  defaultOpen = false,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(defaultOpen)
  const [box, setBox] = useState<Box | null>(null)

  /**
   * The ramp this colour makes, derived from the colour rather than from its
   * hex: a hex is sRGB, and rounding a P3 slot through one would derive the
   * whole strip from chroma the document never asked it to give up.
   */
  const ramp = useMemo(
    () => generateRamp(createPalette(formatColor(color, 'oklch'), SHADE_STEPS, gamut), gamut),
    [color, gamut],
  )

  const measure = () => {
    const rect = anchor.current?.getBoundingClientRect()
    if (!rect) return
    // Never more than a sixth of the bar, so eight bars on a narrow window
    // still leave a strip wide enough to read a value on.
    const inset = Math.min(INSET, rect.width / 6)
    setBox({
      top: rect.top + inset,
      left: rect.left + inset,
      width: Math.max(rect.width - inset * 2, 1),
      height: Math.max(rect.height - inset * 2, 1),
    })
  }

  useLayoutEffect(() => {
    if (!open) return
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [open])

  const openStrip = () => {
    measure()
    setOpen(true)
    ref.current?.showModal()
  }

  return (
    <>
      {trigger(openStrip, buttonRef)}

      {/* Modal, which buys three things at once: Escape closes it, a click
          anywhere else closes it, and the board's own keyboard stands down —
          `spaceRolls` skips a press while a dialog is open, so the strip
          cannot be re-rolled out from under the pointer. */}
      <dialog
        ref={ref}
        className="shades"
        style={
          box
            ? {
                position: 'fixed',
                margin: 0,
                top: `${box.top}px`,
                left: `${box.left}px`,
                width: `${box.width}px`,
                height: `${box.height}px`,
              }
            : undefined
        }
        aria-label={`Shades of ${name}`}
        onClose={() => setOpen(false)}
        /* The strip fills the dialog, so anything landing on the dialog
           itself came through the backdrop. */
        onClick={(event) => {
          if (event.target === ref.current) ref.current?.close()
        }}
      >
        {open && (
          <div className="shades__strip">
            {ramp.map((swatch) => {
              const shown = emitted(swatch)
              const seen = vision === 'normal' ? shown : simulate(shown, vision)
              const background =
                vision === 'normal' ? swatch.displayColor : mapToGamut(seen, gamut).displayColor
              const value = formatColor(shown, format, gamut)

              return (
                <button
                  key={swatch.index}
                  type="button"
                  className={`shades__step${swatch.isBase ? ' is-here' : ''}`}
                  style={{ backgroundColor: background, color: inkOn(seen) }}
                  onClick={() => {
                    onPick(shown)
                    ref.current?.close()
                  }}
                  title={swatch.isBase ? `${value} — where this colour already is` : `Use ${value}`}
                >
                  <span className="shades__value">{value}</span>
                </button>
              )
            })}
          </div>
        )}
      </dialog>
    </>
  )
}
