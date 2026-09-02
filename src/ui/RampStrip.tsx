import { formatColor, type Format } from '../color/oklch'
import type { Swatch } from '../color/ramp'

type Props = {
  ramp: Swatch[]
  format: Format
  copiedKey: string | null
  /** Drop the rules between and around the colour chips. */
  seamless?: boolean
  /** Namespaces the copy keys, so two strips cannot flash "copied" together. */
  idPrefix?: string
  /** Overrides the tooltip when a click does something other than copy. */
  swatchTitle?: (value: string) => string
  onCopy: (key: string, text: string) => void
}

export function RampStrip({
  ramp,
  format,
  copiedKey,
  seamless,
  idPrefix = 'swatch',
  swatchTitle,
  onCopy,
}: Props) {
  return (
    <div className={`ramp${seamless ? ' ramp--seamless' : ''}`}>
      {ramp.map((swatch) => {
        const value = formatColor(swatch.oklch, format)
        const key = `${idPrefix}-${swatch.index}`
        const isCopied = copiedKey === key

        return (
          <button
            key={key}
            type="button"
            className="swatch"
            onClick={() => onCopy(key, value)}
            title={swatchTitle ? swatchTitle(value) : `Copy ${value}`}
          >
            <span className="swatch__chip" style={{ background: swatch.hex }}>
              {swatch.clipped && (
                <span
                  className="swatch__clipped"
                  title="Requested chroma is outside sRGB — mapped to the nearest displayable colour"
                />
              )}
              {swatch.isBase && <span className="swatch__base">base</span>}
            </span>
            <span className="swatch__meta">
              <span className="swatch__label">{swatch.label}</span>
              {isCopied ? (
                <span className="swatch__copied">copied</span>
              ) : (
                <span className="swatch__value">{value}</span>
              )}
              <span className="swatch__sub">
                {`W ${swatch.contrastOnWhite.toFixed(1)} · B ${swatch.contrastOnBlack.toFixed(1)}`}
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
