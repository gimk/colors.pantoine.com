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

          {/* Grouped under headings rather than run as seven paragraphs of one
              weight. Somebody opens this with a question already in mind — what
              the notch means, where their palettes went — and headings are what
              let them find the answer without reading the rest. */}
          <div className="help__body">
            {/* First, because this dialog opens from the masthead and the
                masthead is up in both halves of the tool — everything below is
                about Ramps, and a reader who pressed ? on the scheme board
                needs to be told which half they are reading about. */}
            <section className="help__section">
              <h3 className="help__heading">Two modes</h3>
              <p>
                Scheme is where a palette starts: you choose the colours that go
                together. Ramps opens each of them out into a full set of tints and
                shades. The switch is in the middle of the bar at the top.
              </p>
            </section>

            <section className="help__section">
              <h3 className="help__heading">The ramp</h3>
              <p>
                Every step is computed in OKLCH, so the ramp is perceptually even and
                lightness, chroma and hue are yours to shape.
              </p>
              <p>Click any swatch to copy it.</p>
            </section>

            <section className="help__section">
              <h3 className="help__heading">Editing a ramp</h3>
              <p>
                In Ramps, click a palette to point the tools at it. The panel down the
                right edits that one palette — its base colour and steps at the top,
                then a section for each channel. Drag the panel's left edge to widen
                it.
              </p>
              <p>
                On a curve, drag the round handles, or focus one and use the arrow
                keys — hold shift for bigger steps. Start and End set the two ends
                outright, the four shapes rewrite the whole curve, and Reset rebuilds
                the channel from your base colour.
              </p>
            </section>

            <section className="help__section">
              <h3 className="help__heading">More than {gamutLabel(gamut)} can show</h3>
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
            </section>

            <section className="help__section">
              <h3 className="help__heading">Keeping and sharing</h3>
              <p>
                Your palettes are saved in this browser, so they are here when you come
                back. Export hands the document out — as text, as an image, or as a
                link that reopens the palettes you pick with every curve intact.
              </p>
            </section>

            <p className="help__credit">
              Default color names powered by{' '}
              <a
                href="https://github.com/meodai/color-names"
                target="_blank"
                rel="noopener noreferrer"
              >
                meodai/color-names
              </a>
              .
            </p>
          </div>
        </div>
      </dialog>
    </>
  )
}
