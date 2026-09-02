import { useRef, useState } from 'react'
import { formatColor, GAMUTS, gamutLabel, mapToGamut, type Gamut, type Oklch } from '../color/oklch'
import { ColorPicker, type ColorPickerModel } from './ColorPicker'

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
  /** For testing, renders the modal body immediately without a click. */
  defaultOpen?: boolean
}

/**
 * The picker, behind the swatch that used to open the operating system's.
 *
 * A modal rather than a popover for a structural reason: the toolbox dock is
 * a `max-height` scroll container, so anything absolutely positioned inside
 * it is clipped at the dock's edge. `showModal` escapes that entirely and
 * brings Escape and focus trapping with it — and the native picker this
 * replaces was an OS modal too, so nothing is lost in feel.
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
  defaultOpen = false,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const swatch = mapToGamut(color, gamut).displayColor
  const [open, setOpen] = useState(defaultOpen)
  const [model, setModel] = useState<ColorPickerModel>('oklch')

  return (
    <>
      <button
        type="button"
        className="picker"
        style={{ background: swatch }}
        aria-label="Pick base colour"
        title={`Pick the base colour in OKLCH — ${gamutLabel(gamut)}`}
        onClick={() => {
          setOpen(true)
          ref.current?.showModal()
        }}
      />

      <dialog
        ref={ref}
        className="cdialog"
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
            <header className="panel__head">
              <span className="panel__title" id="cpick-title">
                Base colour
              </span>
              <label className="field">
                <span>Model</span>
                <select
                  value={model}
                  onChange={(event) => setModel(event.target.value as ColorPickerModel)}
                  title="Color model for the picker: OKLCH (perceptual), HSV, or HSL"
                >
                  <option value="oklch">OKLCH</option>
                  <option value="hsv">HSV</option>
                  <option value="hsl">HSL</option>
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
                    <option key={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <span className="spacer" />
              <button type="button" onClick={() => ref.current?.close()}>
                Done
              </button>
            </header>

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
