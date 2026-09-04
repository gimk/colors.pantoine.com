import { CHANNELS, type ChannelKey, type Curve, type CurveControl } from '../color/curve'
import { SHAPES } from '../color/shapes'
import type { Swatch } from '../color/ramp'
import type { PaletteView } from '../state/useDocument'
import { ApplyToDialog } from './ApplyToDialog'
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
  /** The palettes Apply to can copy this curve onto: everything but this one. */
  syncTargets?: PaletteView[]
  onSyncTo?: (ids: string[]) => void
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
  syncTargets,
  onSyncTo,
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
        <span className="spacer" />
        {/* Up here rather than beside Start and End, where it was competing
            for a row that now has two ways to send this curve elsewhere.
            Undoing your own edits belongs with the channel's name anyway. */}
        <button
          type="button"
          className="panel__reset"
          onClick={onReset}
          title="Rebuild this channel's default from the base colour"
        >
          Reset
        </button>
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
          {onSyncTo && (
            <ApplyToDialog
              /* Keyed on the stack, so a palette added or removed while the
                 panel is mounted cannot leave a pick pointing at nothing. */
              key={syncTargets?.map((palette) => palette.id).join(',')}
              channel={channel.label.toLowerCase()}
              targets={syncTargets ?? []}
              onApply={onSyncTo}
            />
          )}
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
