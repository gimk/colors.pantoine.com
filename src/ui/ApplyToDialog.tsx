import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PaletteView } from '../state/useDocument'

type Props = {
  /** The channel being copied, lower-cased for prose: "lightness", "chroma", "hue". */
  channel: string
  /** Every palette that could receive the curve — the selected one excluded. */
  targets: PaletteView[]
  onApply: (ids: string[]) => void
  /** For testing, renders the body immediately without a click. */
  defaultOpen?: boolean
}

/**
 * Apply all, narrowed to the palettes you actually mean.
 *
 * Apply all answers one question — make the whole document agree — and a
 * document is rarely one thing: a set of brand hues wants a shared lightness
 * ramp while the grey beside it keeps its own. Sending the curve everywhere
 * and repairing the strays afterwards costs more than choosing, so this picks
 * the receivers first.
 *
 * Built on `ColorPickerDialog`'s floating shape rather than `NewPaletteDialog`'s
 * centred one: the curve panels sit at the foot of the window, and a modal
 * dropped in the middle of the screen would cover the very ramps you are
 * choosing between. The list stays live behind it for the same reason.
 *
 * Multi-select rather than a plain menu of palettes. One click per palette
 * would be the shorter path to a single target and the longer one to three,
 * and three is where this earns its place — with two palettes in a document
 * there is nothing here that Apply all does not already do.
 */
export function ApplyToDialog({ channel, targets, onApply, defaultOpen = false }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(defaultOpen)
  const [picked, setPicked] = useState<string[]>([])
  const [coords, setCoords] = useState<{ top?: number; bottom?: number; left: number }>({
    left: 16,
    bottom: 80,
  })

  const updatePosition = () => {
    if (!buttonRef.current || typeof window === 'undefined') return
    const rect = buttonRef.current.getBoundingClientRect()
    const width = Math.min(380, window.innerWidth - 32)
    const left = Math.max(16, Math.min(rect.left, window.innerWidth - width - 16))

    // Above by preference: the panels this opens from are at the foot of the
    // window, so below is usually a sliver and above is the whole page.
    if (rect.top >= window.innerHeight - rect.bottom) {
      setCoords({ bottom: Math.max(8, window.innerHeight - rect.top + 8), left, top: undefined })
    } else {
      setCoords({ top: Math.max(8, rect.bottom + 8), left, bottom: undefined })
    }
  }

  useLayoutEffect(() => {
    if (!open) return
    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [open])

  useEffect(() => {
    if (defaultOpen && ref.current && !ref.current.open) {
      updatePosition()
      ref.current.showModal?.()
    }
  }, [defaultOpen])

  const toggle = (id: string) =>
    setPicked((current) =>
      current.includes(id) ? current.filter((other) => other !== id) : [...current, id],
    )

  const apply = () => {
    if (!picked.length) return
    onApply(picked)
    ref.current?.close()
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        disabled={targets.length === 0}
        title={
          targets.length === 0
            ? 'Requires at least two palettes in the document'
            : `Copy this ${channel} curve onto palettes you choose`
        }
        onClick={() => {
          // A fresh sheet every time. The picks are the sentence being
          // spoken, not a setting, and one left over from the last channel
          // would be applied without being read.
          setPicked([])
          updatePosition()
          setOpen(true)
          ref.current?.showModal()
        }}
      >
        Apply to
      </button>

      <dialog
        ref={ref}
        className="applyto"
        style={{
          position: 'fixed',
          margin: 0,
          left: `${coords.left}px`,
          top: coords.top != null ? `${coords.top}px` : 'auto',
          bottom: coords.bottom != null ? `${coords.bottom}px` : 'auto',
        }}
        aria-labelledby="applyto-title"
        onClose={() => setOpen(false)}
        /* The dialog carries no padding, so the panel covers its whole box and
           a click landing on the dialog itself is a click on the backdrop. */
        onClick={(event) => {
          if (event.target === ref.current) ref.current?.close()
        }}
      >
        {open && (
          <div className="applyto__panel">
            <header className="panel__head">
              <span className="panel__title" id="applyto-title">
                Apply {channel} to
              </span>
              <span className="spacer" />
              <button type="button" onClick={() => ref.current?.close()}>
                Cancel
              </button>
            </header>

            <div className="applyto__body">
              <div className="applyto__list">
                {targets.map((palette) => {
                  const on = picked.includes(palette.id)
                  return (
                    <button
                      key={palette.id}
                      type="button"
                      className={`applyto__target${on ? ' is-picked' : ''}`}
                      aria-pressed={on}
                      onClick={() => toggle(palette.id)}
                    >
                      <span className="applyto__mark" aria-hidden="true">
                        {on ? '×' : ''}
                      </span>
                      <span className="applyto__name">{palette.name}</span>
                      <span className="applyto__ramp">
                        {palette.ramp.map((swatch) => (
                          <span
                            key={swatch.index}
                            className="applyto__chip"
                            style={{ background: swatch.displayColor }}
                          />
                        ))}
                      </span>
                    </button>
                  )
                })}
              </div>

              <div className="applyto__foot">
                <span className="applyto__count">
                  {picked.length === 0
                    ? 'Pick the palettes to copy it to'
                    : `${picked.length} of ${targets.length} palette${targets.length > 1 ? 's' : ''}`}
                </span>
                <button
                  type="button"
                  className="is-primary"
                  disabled={picked.length === 0}
                  onClick={apply}
                >
                  Apply
                </button>
              </div>
            </div>
          </div>
        )}
      </dialog>
    </>
  )
}
