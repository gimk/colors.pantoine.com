import { CHANNELS, type ChannelKey, type Curve } from '../color/curve'
import { SHAPES } from '../color/shapes'
import type { Swatch } from '../color/ramp'
import { CurveEditor } from './CurveEditor'
import { NumberField } from './NumberField'

type Props = {
  channelKey: ChannelKey
  curve: Curve
  swatches: Swatch[]
  onChange: (curve: Curve) => void
  onEndpoint: (end: 'start' | 'end', value: number) => void
  onReset: () => void
}

export function CurvePanel({
  channelKey,
  curve,
  swatches,
  onChange,
  onEndpoint,
  onReset,
}: Props) {
  const channel = CHANNELS[channelKey]

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
          onCommit={(value) => onEndpoint('start', value)}
        />
        <NumberField
          label="End"
          value={curve.end}
          min={channel.min}
          max={channel.max}
          step={channel.nudge}
          decimals={channel.decimals}
          onCommit={(value) => onEndpoint('end', value)}
        />
        <span className="spacer" />
        <button
          type="button"
          onClick={onReset}
          title="Rebuild this channel's default from the base colour"
        >
          Reset
        </button>
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
        onChange={onChange}
      />
    </section>
  )
}
