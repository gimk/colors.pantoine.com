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
  copiedKey,
  idPrefix = 'swatch',
  swatchTitle,
  onCopy,
}: Props) {
  return (
    <div className="ramp">
      {ramp.map((swatch) => {
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
              {/* The label cell normally reports the copy. With the labels
                  away there is nowhere for it to land, so it lands here —
                  a click with no acknowledgement reads as a broken one. */}
              {!labels && isCopied && <span className="swatch__flash">copied</span>}
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
