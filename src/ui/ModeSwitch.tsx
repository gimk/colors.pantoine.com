import type { Mode } from '../state/mode'

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
 * in the masthead, where the title used to carry the name of the only mode
 * there was after it.
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
        title="Build a palette of colours that go together — new, and still settling"
      >
        Scheme
        {/* Dimmed and small rather than parenthesised: the labels are already
            uppercase and tracked, and `(BETA)` at that size reads as part of
            the name instead of as a note about it. */}
        <span className="modes__beta">beta</span>
      </button>
      <button
        type="button"
        className={mode === 'ramps' ? 'is-on' : undefined}
        aria-pressed={mode === 'ramps'}
        onClick={() => onMode('ramps')}
        title="Open a colour out into a tint and shade ramp"
      >
        Ramps
      </button>
    </span>
  )
}
