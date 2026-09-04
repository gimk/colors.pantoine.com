import type { PaletteView } from '../state/useDocument'

type Props = {
  /** Every palette that can be picked, in document order. */
  targets: PaletteView[]
  /** Ids currently picked. */
  picked: string[]
  onToggle: (id: string) => void
}

/**
 * A list of palettes with a tick each, shared by everything that acts on
 * some of the document rather than all of it.
 *
 * Rows carry the palette's ramp as well as its name: a name you half
 * remember is not enough to pick on, and the ramp is the thing you actually
 * recognise. The row is the control — a real checkbox inside a button is
 * neither valid HTML nor clickable as one — so the tick is a box that fills,
 * and `aria-pressed` carries the state a checkbox would have carried.
 */
export function PalettePicker({ targets, picked, onToggle }: Props) {
  return (
    <div className="plist">
      {targets.map((palette) => {
        const on = picked.includes(palette.id)
        return (
          <button
            key={palette.id}
            type="button"
            className={`plist__row${on ? ' is-picked' : ''}`}
            aria-pressed={on}
            onClick={() => onToggle(palette.id)}
          >
            <span className="plist__mark" aria-hidden="true">
              {on && (
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  style={{ display: 'block' }}
                >
                  <path d="M3 8.5L6.5 12L13 4" />
                </svg>
              )}
            </span>
            <span className="plist__name">{palette.name}</span>
            <span className="plist__ramp">
              {palette.ramp.map((swatch) => (
                <span
                  key={swatch.index}
                  className="plist__chip"
                  style={{ background: swatch.displayColor }}
                />
              ))}
            </span>
          </button>
        )
      })}
    </div>
  )
}
