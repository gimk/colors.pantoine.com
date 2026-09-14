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

  const channelName = channel.label.toLowerCase()

  return (
    <section className="panel panel--curve">
      {/* The axis under the name rather than beside it: at this width the two
          on one line left the name no room, and the axis is a note about the
          plot below, not a second title. */}
      <header className="panel__head">
        <span className="panel__title">{channel.label}</span>
        <span className="panel__axis">{channel.axis}</span>
        {/* Undoing your own edits belongs with the channel's name — and up
            here it is out of the way of the two buttons that send this curve
            somewhere else, which are a different kind of act entirely. */}
        <button
          type="button"
          className="panel__reset"
          onClick={onReset}
          title="Rebuild this channel's default from the base colour"
        >
          Reset
        </button>
      </header>

      {/* The plot leads. It is what the panel is for, and reading down a
          column of three the eye should meet each curve directly under the
          name of the channel it belongs to, not after two rows of controls. */}
      <CurveEditor
        curve={curve}
        channel={channel}
        swatches={swatches}
        lockedIndex={lockedIndex}
        ceiling={ceiling}
        graphH={graphH}
        onChange={onChange}
      />

      <div className="panel__controls">
        <div className="panel__pair">
          <NumberField
            label="Start"
            stacked
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
            stacked
            value={curve.end}
            min={channel.min}
            max={channel.max}
            step={channel.nudge}
            decimals={channel.decimals}
            disabled={frozenEnd}
            title={frozenEnd ? 'Locked to the base colour' : undefined}
            onCommit={(value) => onEndpoint('end', value)}
          />
        </div>

        {/* Four equal shares of the row, sharing their borders — so the set
            reads as one control with four settings, and fits any width the
            panel is dragged to. It was a legend and four buttons on a line
            sized to their own words, which wrapped raggedly the moment the
            column got narrow. The legend goes: four shape names in a joined
            strip do not need to be told they are shapes. */}
        <div className="seg" role="group" aria-label="Shape">
          {SHAPES.map((shape) => (
            <button
              key={shape.id}
              type="button"
              className="seg__btn"
              title={shape.hint}
              onClick={() => onChange(shape.apply(curve, channel))}
            >
              {shape.label}
            </button>
          ))}
        </div>

        {(onSyncTo || onSync) && (
          <div className="panel__pair">
            {onSyncTo && (
              <ApplyToDialog
                /* Keyed on the stack, so a palette added or removed while the
                   panel is mounted cannot leave a pick pointing at nothing. */
                key={syncTargets?.map((palette) => palette.id).join(',')}
                channel={channelName}
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
                    : `Apply this ${channelName} curve to all palettes in the document`
                }
              >
                Apply all
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
