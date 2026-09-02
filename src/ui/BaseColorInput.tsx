import type { Gamut, Oklch } from '../color/oklch'
import { ColorPickerDialog } from './ColorPickerDialog'

type Props = {
  value: string
  /**
   * The parsed colour, for the picker. Resolved by the caller so a field
   * mid-edit — or holding nonsense — still opens on something pickable.
   */
  color: Oklch
  gamut: Gamut
  valid: boolean
  onChange: (value: string) => void
  onGamut: (gamut: Gamut) => void
}

export function BaseColorInput({ value, color, gamut, valid, onChange, onGamut }: Props) {
  return (
    <div className="field field--stacked">
      <span className="field__tag">Base color</span>
      <div className="field__swatch-wrap">
        <input
          id="base-color"
          type="text"
          className={`toolbox__input-color${valid ? '' : ' invalid'}`}
          value={value}
          spellCheck={false}
          autoComplete="off"
          placeholder="#7c3aed"
          aria-invalid={!valid}
          onChange={(event) => onChange(event.target.value)}
        />
        <ColorPickerDialog color={color} gamut={gamut} onChange={onChange} onGamut={onGamut} />
      </div>
    </div>
  )
}
