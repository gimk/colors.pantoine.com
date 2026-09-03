import { formatColor, gamutLabel, isInSrgb, type Format, type Gamut } from '../color/oklch'
import type { Swatch } from '../color/ramp'

type Props = {
  ramp: Swatch[]
  format: Format
  gamut?: Gamut
  copiedKey: string | null
  /** Show the step name, value and contrast cells under each chip. */
  labels?: boolean
  /**
   * Annotate the chips: which step carries the base, and which steps the
   * gamut could not give in full. Both answer questions you only ask of the
   * palette you are shaping, so they ride the selection — on every ramp at
   * once they were 30-odd marks competing with the colours.
   */
  markers?: boolean
  /** Which way the ramp runs. Vertical is the review board's column layout. */
  orientation?: 'horizontal' | 'vertical'
  /**
   * Chips take whatever room the strip is given instead of standing at their
   * own fixed height. What makes a strip fill a review band, where the size
   * across is the band's share of the window rather than a constant.
   */
  fill?: boolean
  /**
   * Share of the strip per step, in `flex-grow` terms. Absent means an even
   * split, which is every strip in the editor. Given, it is indexed by step
   * and a missing entry counts as one share.
   */
  weights?: number[]
  /**
   * Print the value on the chip itself, in whatever format is in force.
   *
   * The review board's answer to labels: the editor's label cell sits under
   * the chip in a bordered grid, which on a board of filling chips would eat
   * the colour and put back the very rows the board exists to be rid of.
   * Boxed and centred instead, so it lands on a step of any lightness — and
   * it doubles as the copy acknowledgement, since two marks in one place
   * would collide.
   */
  stamp?: boolean
  /** Namespaces the copy keys, so two strips cannot flash "copied" together. */
  idPrefix?: string
  /** Overrides the tooltip when a click does something other than copy. */
  swatchTitle?: (value: string) => string
  onCopy: (key: string, text: string) => void
}

export function RampStrip({
  ramp,
  format,
  gamut = 'srgb',
  labels = true,
  markers = true,
  orientation = 'horizontal',
  fill = false,
  weights,
  stamp = false,
  copiedKey,
  idPrefix = 'swatch',
  swatchTitle,
  onCopy,
}: Props) {
  const className =
    `ramp${orientation === 'vertical' ? ' ramp--vertical' : ''}${fill ? ' ramp--fill' : ''}`

  return (
    <div className={className}>
      {ramp.map((swatch, position) => {
        const value = formatColor(swatch.oklch, format, gamut)
        const key = `${idPrefix}-${swatch.index}`
        const isCopied = copiedKey === key
        const isUnavailable =
          gamut !== 'srgb' &&
          (format === 'hex' || format === 'rgb' || format === 'hsl') &&
          !isInSrgb(swatch.oklch)

        return (
          <button
            key={key}
            type="button"
            className="swatch"
            /* A share of the strip rather than an equal split. `flex-basis`
               stays 0 from the stylesheet, so a step's size is exactly its
               share of the total — which is what lets the review board place
               its ruler ticks by percentage without measuring a chip. */
            style={weights ? { flexGrow: weights[position] ?? 1 } : undefined}
            onClick={() => onCopy(key, value)}
            title={swatchTitle ? swatchTitle(value) : `Copy ${value}`}
          >
            <span className="swatch__chip" style={{ background: swatch.displayColor }}>
              {markers && swatch.clipped && (
                <span
                  className="swatch__clipped"
                  title={`Requested chroma is outside ${gamutLabel(gamut)} — mapped to the nearest displayable colour`}
                />
              )}
              {markers && swatch.isBase && <span className="swatch__base">base</span>}
              {/* The stamp is already the one mark in the middle of the chip,
                  so it reports the copy itself rather than having a second
                  mark land on top of it. Subtle text in white or black depending
                  on the swatch contrast. */}
              {stamp && (
                <span
                  className={`swatch__stamp${isCopied ? ' is-copied' : ''}`}
                  style={{
                    color:
                      swatch.contrastOnBlack >= swatch.contrastOnWhite
                        ? '#000000'
                        : '#ffffff',
                  }}
                >
                  {isCopied ? (
                    'copied'
                  ) : (
                    <>
                      <span className="swatch__stamp-label">{swatch.label}</span>
                      <span className="swatch__stamp-value">{value}</span>
                      <span className="swatch__stamp-contrast">
                        {`W ${swatch.contrastOnWhite.toFixed(1)} · B ${swatch.contrastOnBlack.toFixed(1)}`}
                      </span>
                    </>
                  )}
                </span>
              )}
              {/* The label cell normally reports the copy. With the labels
                  away there is nowhere for it to land, so it lands here —
                  a click with no acknowledgement reads as a broken one. */}
              {!labels && !stamp && isCopied && <span className="swatch__flash">copied</span>}
            </span>
            {labels && (
              <span className="swatch__meta">
                <span className="swatch__label">{swatch.label}</span>
                {isCopied ? (
                  <span className="swatch__copied">copied</span>
                ) : (
                  <span
                    className={`swatch__value${isUnavailable ? ' swatch__value--unavailable' : ''}`}
                    title={
                      isUnavailable
                        ? `${format.toUpperCase()} does not cover ${gamutLabel(gamut)} — showing mapped sRGB fallback`
                        : undefined
                    }
                  >
                    {value}
                  </span>
                )}
                <span
                  className="swatch__sub"
                  title={`WCAG 2.1 contrast ratios: ${swatch.contrastOnWhite.toFixed(2)}:1 on White, ${swatch.contrastOnBlack.toFixed(2)}:1 on Black`}
                >
                  {`W ${swatch.contrastOnWhite.toFixed(1)} · B ${swatch.contrastOnBlack.toFixed(1)}`}
                </span>
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
