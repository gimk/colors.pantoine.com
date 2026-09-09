import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react'
import { formatColor, GAMUTS, gamutLabel, mapToGamut, type Gamut, type Oklch } from '../color/oklch'
import { ColorPicker, type ColorPickerModel } from './ColorPicker'

/** How near the panel is ever allowed to come to an edge of the window. */
const EDGE = 16

/**
 * Where the panel goes: beside whatever opened it, and centered in the window.
 *
 * One axis each. Horizontally it follows the opener, because that is what
 * says which swatch is being edited — clamped off both edges, so a bar on the
 * right of the board does not push it out of the window. Vertically it takes
 * the middle and stays there, which is the one height that needs no room
 * either side of the opener to be reachable.
 *
 * It used to pick a side by which had the more room and then anchor to it.
 * That is fine on a tall window and wrong on a short one: a panel taller than
 * the space above it was pinned by its foot and hung off the top of the
 * screen — and a `fixed` panel off the top cannot be scrolled back, so the
 * wedge, the fields and the hex were all simply gone.
 *
 * Centering leans on the panel capping its own height in CSS: a box no taller
 * than the window is one that has a middle to sit in. Taller than that and
 * the clamp puts its head at the top margin, where the scroll can reach the
 * rest.
 *
 * Pure, and exported, because the case worth checking is the short window —
 * which is a size, and a render without a DOM has none.
 */
export function placePanel(
  anchor: { left: number },
  panel: { width: number; height: number },
  viewport: { width: number; height: number },
): { top: number; left: number } {
  return {
    left: Math.max(EDGE, Math.min(anchor.left, viewport.width - panel.width - EDGE)),
    top: Math.max(EDGE, Math.round((viewport.height - panel.height) / 2)),
  }
}

type Props = {
  /** The colour to open on — already resolved, so an unparseable field still picks. */
  color: Oklch
  gamut: Gamut
  onChange: (value: string) => void
  /**
   * Sets the document gamut, the same one the top bar sets. Not a preview
   * mode of the picker's own: the gamut decides how much chroma every
   * derived curve may ask for, so a second, local copy of it would let the
   * wedge disagree with the ramp it is being picked for.
   */
  onGamut: (gamut: Gamut) => void
  /**
   * What opens the panel, given the opener and the ref it has to carry.
   *
   * The default is the filled swatch the toolbox puts beside its base field.
   * The scheme board has a colour the size of the window already and wants a
   * quiet pencil in the corner of it instead, so the trigger is the caller's
   * to draw — the ref is not optional, since the panel positions itself
   * against whatever opened it.
   */
  trigger?: (open: () => void, ref: RefObject<HTMLButtonElement | null>) => ReactNode
  /**
   * Names the panel. The toolbox is picking a base, so it says so.
   *
   * Deliberately not the color's name, which is what the board passed at
   * first: the color is the thing being changed in here, so its name changed
   * on every pixel of a drag across the wedge — a header that rewrites itself
   * while you work reads as the panel glitching, not as the color being
   * described. The bar behind the panel names the color, and goes on naming
   * it as it changes, which is where that belongs.
   */
  panelTitle?: string
  /** For testing, renders the modal body immediately without a click. */
  defaultOpen?: boolean
}

/**
 * The picker, behind the swatch that used to open the operating system's.
 *
 * Positioned floating adjacent to the swatch button with a clean, clear backdrop.
 *
 * Edits apply as they are made, like every other control here. There is no
 * cancel because there is already an undo: `setBase` coalesces, so a whole
 * session at the picker steps back in one.
 */
export function ColorPickerDialog({
  color,
  gamut,
  onChange,
  onGamut,
  trigger,
  panelTitle = 'Base colour',
  defaultOpen = false,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const swatch = mapToGamut(color, gamut).displayColor
  const [open, setOpen] = useState(defaultOpen)
  const [model, setModel] = useState<ColorPickerModel>('oklch')
  const [coords, setCoords] = useState<{ top: number; left: number }>({ top: EDGE, left: EDGE })

  /**
   * Measure what `placePanel` decides from, and hand it the answer.
   *
   * The panel's height is measured rather than assumed: it depends on the
   * model in force, and on how much of the window the cap has left it.
   */
  const updatePosition = () => {
    if (!buttonRef.current || typeof window === 'undefined') return
    const anchor = buttonRef.current.getBoundingClientRect()
    // Zero until the panel has rendered once — `openPanel` positions the
    // dialog before its contents exist, and the layout effect below measures
    // it again as soon as they do.
    const box = ref.current?.getBoundingClientRect()
    setCoords(
      placePanel(
        anchor,
        {
          width: box?.width || Math.min(420, window.innerWidth - EDGE * 2),
          height: box?.height ?? 0,
        },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    )
  }

  // Re-measured on a change of model as well as on opening: the three models
  // do not draw to the same height, and the middle of the window is a height
  // that depends on the panel's own — so a panel that changed shape where it
  // stood would be left sitting off center, and in a short window would hang
  // its hex off the bottom of the screen.
  useLayoutEffect(() => {
    if (open) {
      updatePosition()
      window.addEventListener('resize', updatePosition)
      window.addEventListener('scroll', updatePosition, true)
      return () => {
        window.removeEventListener('resize', updatePosition)
        window.removeEventListener('scroll', updatePosition, true)
      }
    }
  }, [open, model])

  useEffect(() => {
    if (defaultOpen && ref.current && !ref.current.open) {
      updatePosition()
      ref.current.showModal?.()
    }
  }, [defaultOpen])

  const openPanel = () => {
    updatePosition()
    setOpen(true)
    ref.current?.showModal()
  }

  return (
    <>
      {trigger ? (
        trigger(openPanel, buttonRef)
      ) : (
        <button
          ref={buttonRef}
          type="button"
          className="picker"
          style={{ background: swatch }}
          aria-label="Pick base colour"
          title={`Pick the base colour in OKLCH — ${gamutLabel(gamut)}`}
          onClick={openPanel}
        />
      )}

      <dialog
        ref={ref}
        className="cdialog"
        style={{
          position: 'fixed',
          margin: 0,
          left: `${coords.left}px`,
          top: `${coords.top}px`,
        }}
        aria-labelledby="cpick-title"
        /* Fires for Escape and for the close button alike, so neither route
           leaves the panel mounted behind a shut dialog. */
        onClose={() => setOpen(false)}
        /* No padding of its own, so the panel covers the dialog's whole box
           and a click that lands on the dialog is a click on the backdrop. */
        onClick={(event) => {
          if (event.target === ref.current) ref.current?.close()
        }}
      >
        {open && (
          <div className="cdialog__panel">
            {/* Two rows rather than one. The head carried the name, both
                settings and the way out on a single line — which fits a dock
                panel the width of the window and not a dialog of 420px, where
                Done was pushed off the right edge. What the panel is and how
                to leave it stay on top; the two settings take a row of their
                own, and wrap in it if they have to. */}
            <header className="panel__head cdialog__head">
              <span className="panel__title" id="cpick-title">
                {panelTitle}
              </span>
              <button type="button" onClick={() => ref.current?.close()}>
                Done
              </button>
            </header>

            <div className="panel__row">
              <label className="field">
                <span>Model</span>
                <select
                  value={model}
                  onChange={(event) => setModel(event.target.value as ColorPickerModel)}
                  title="Color model for the picker: OKLCH (perceptual), OKHSV, or OKHSL"
                >
                  <option value="oklch">OKLCH</option>
                  <option value="okhsv">OKHSV</option>
                  <option value="okhsl">OKHSL</option>
                </select>
              </label>
              <label className="field">
                <span>Gamut</span>
                <select
                  value={gamut}
                  onChange={(event) => onGamut(event.target.value as Gamut)}
                  title="Which display this palette is designed for. Widening it widens the wedge, and lets every derived chroma curve ask for more."
                >
                  {GAMUTS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <ColorPicker
              color={color}
              gamut={gamut}
              model={model}
              onChange={(next) => onChange(formatColor(next, 'oklch'))}
            />
          </div>
        )}
      </dialog>
    </>
  )
}
