import { useRef } from 'react'
import { gamutLabel, type Gamut } from '../color/oklch'

type Props = {
  gamut: Gamut
}

/**
 * The explanatory copy, behind a question mark.
 *
 * It used to sit under the palettes as a grey paragraph, where it was read
 * once and then became furniture at the foot of every session. A native
 * `<dialog>` carries it instead: `showModal` brings focus trapping, Escape,
 * and an inert background with no code of our own, and the page is left to
 * the colours.
 */
export function HelpDialog({ gamut }: Props) {
  const ref = useRef<HTMLDialogElement>(null)

  return (
    <>
      <button
        type="button"
        className="help__open"
        aria-label="How this works"
        title="How this works"
        onClick={() => ref.current?.showModal()}
      >
        ?
      </button>

      <dialog
        ref={ref}
        className="help"
        aria-labelledby="help-title"
        /* The dialog has no padding of its own, so its own box is entirely
           covered by the panel below — which makes a click that lands on the
           dialog itself a click on the backdrop, and nothing else. */
        onClick={(event) => {
          if (event.target === ref.current) ref.current?.close()
        }}
      >
        <div className="help__panel">
          <header className="panel__head">
            <span className="panel__title" id="help-title">
              How this works
            </span>
            <button type="button" onClick={() => ref.current?.close()}>
              Close
            </button>
          </header>

          <div className="help__body">
            <p>
              Every step is computed in OKLCH, so the ramp is perceptually even and
              lightness, chroma and hue are yours to shape.
            </p>
            <p>
              Click a swatch to copy it, or click another palette to bring the toolbox
              to it.
            </p>
            <p>
              Drag the round handles, or focus one and use the arrow keys — hold shift
              for bigger steps.
            </p>
            <p>
              A notched corner means the curve asked for more chroma than{' '}
              {gamutLabel(gamut)} can show, and the colour was mapped to the nearest
              one it can — hue held, chroma reduced.
            </p>
            <p>
              The dashed line across the chroma graph is the most chroma{' '}
              {gamutLabel(gamut)} has at each step, and the hatching above it is
              chroma you cannot have. A curve up in the hatching still produces
              colours — they are just the ones under the line.
            </p>
            <p>
              Your palettes are saved in this browser, and the address bar holds all of
              them, so a link carries the whole set.
            </p>
          </div>
        </div>
      </dialog>
    </>
  )
}
