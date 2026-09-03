import { CHANNELS, type ChannelKey, type Curve, type CurveControl } from '../color/curve'
import { SHAPES } from '../color/shapes'
import type { Swatch } from '../color/ramp'
import { CurveEditor } from './CurveEditor'
import { NumberField } from './NumberField'

type Props = {
  channelKey: ChannelKey
  curve: Curve
  swatches: Swatch[]
  /** Index of the base step, when the base colour is locked. */
  lockedIndex?: number
  onChange: (curve: Curve, moved?: CurveControl) => void
  onEndpoint: (end: 'start' | 'end', value: number) => void
  onReset: () => void
  canSync?: boolean
  onSync?: () => void
  /** Chroma only: the gamut ceiling sampled across the ramp, for the graph. */
  ceiling?: number[]
  graphH?: number
}

export function CurvePanel({
  channelKey,
  curve,
  swatches,
  lockedIndex,
  onChange,
  onEndpoint,
  onReset,
  canSync,
  onSync,
  ceiling,
  graphH,
}: Props) {
  const channel = CHANNELS[channelKey]
  const last = Math.max(swatches.length - 1, 1)

  // A locked base sitting on an endpoint pins that endpoint outright: no
  // other control on the curve could absorb the correction.
  const frozenStart = lockedIndex === 0
  const frozenEnd = lockedIndex === last

  return (
    <section className="panel">
      <header className="panel__head">
        <span className="panel__title">{channel.label}</span>
        <span className="panel__axis">{channel.axis}</span>
      </header>

      <div className="panel__row">
        <NumberField
          label="Start"
          value={curve.start}
          min={channel.min}
          max={channel.max}
          step={channel.nudge}
          decimals={channel.decimals}
          disabled={frozenStart}
          title={frozenStart ? 'Locked to the base colour' : undefined}
          onCommit={(value) => onEndpoint('start', value)}
        />
        <NumberField
          label="End"
          value={curve.end}
          min={channel.min}
          max={channel.max}
          step={channel.nudge}
          decimals={channel.decimals}
          disabled={frozenEnd}
          title={frozenEnd ? 'Locked to the base colour' : undefined}
          onCommit={(value) => onEndpoint('end', value)}
        />
        <div className="panel__actions">
          {onSync && (
            <button
              type="button"
              onClick={onSync}
              disabled={!canSync}
              title={
                !canSync
                  ? 'Requires at least two palettes in the document'
                  : `Apply this ${channel.label.toLowerCase()} curve to all palettes in the document`
              }
            >
              Apply all
            </button>
          )}
          <button
            type="button"
            onClick={onReset}
            title="Rebuild this channel's default from the base colour"
          >
            Reset
          </button>
        </div>
      </div>

      <div className="panel__row panel__row--shapes">
        <span className="legend">Shape</span>
        {SHAPES.map((shape) => (
          <button
            key={shape.id}
            type="button"
            title={shape.hint}
            onClick={() => onChange(shape.apply(curve, channel))}
          >
            {shape.label}
          </button>
        ))}
      </div>

      <CurveEditor
        curve={curve}
        channel={channel}
        swatches={swatches}
        lockedIndex={lockedIndex}
        ceiling={ceiling}
        graphH={graphH}
        onChange={onChange}
      />
    </section>
  )
}
