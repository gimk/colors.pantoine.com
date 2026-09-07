export type Mode = 'ramps' | 'scheme'

export function isMode(value: string | null | undefined): value is Mode {
  return value === 'ramps' || value === 'scheme'
}

type Props = {
  mode: Mode
  onMode: (mode: Mode) => void
}

/**
 * Which half of the tool you are in.
 *
 * The two modes make different things — a scheme is a handful of colours
 * chosen to sit together, a document is those colours each opened out into a
 * ramp — so the switch names the output rather than the gesture, and it sits
 * in the masthead where the title used to carry `— TINTS & SHADES` after it.
 *
 * The review board is deliberately not here. It is a way of looking at a
 * document of ramps, not a third thing to make, and it lives on the ramps
 * control bar with the rest of the document-wide controls.
 */
export function ModeSwitch({ mode, onMode }: Props) {
  return (
    <span className="modes" role="group" aria-label="Mode">
      <button
        type="button"
        className={mode === 'scheme' ? 'is-on' : undefined}
        aria-pressed={mode === 'scheme'}
        onClick={() => onMode('scheme')}
        title="Build a palette of colours that go together"
      >
        Scheme
      </button>
      <button
        type="button"
        className={mode === 'ramps' ? 'is-on' : undefined}
        aria-pressed={mode === 'ramps'}
        onClick={() => onMode('ramps')}
        title="Open a colour out into a tint and shade ramp"
      >
        Tints &amp; Shades
      </button>
    </span>
  )
}
