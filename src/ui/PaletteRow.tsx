import type { MouseEvent } from 'react'
import type { Format } from '../color/oklch'
import type { PaletteView } from '../state/useDocument'
import { RampStrip } from './RampStrip'

type Props = {
  palette: PaletteView
  index: number
  count: number
  selected: boolean
  format: Format
  seamless: boolean
  /** Tools are hidden: the stack is being looked at, not edited. */
  bare: boolean
  copiedKey: string | null
  onSelect: () => void
  onRemove: () => void
  onMove: (by: -1 | 1) => void
  onCopy: (key: string, text: string) => void
}

export function PaletteRow({
  palette,
  index,
  count,
  selected,
  format,
  seamless,
  bare,
  copiedKey,
  onSelect,
  onRemove,
  onMove,
  onCopy,
}: Props) {
  // With the tools hidden there is nothing to select into, so every strip goes
  // back to copying. Otherwise the first click on a palette picks it up and
  // brings the toolbox to it; clicks after that copy, as they always did.
  const copies = selected || bare

  /**
   * Clicking the palette selects it — anywhere but on a control, so the
   * buttons inside keep doing their own jobs without nesting anything
   * interactive inside anything else interactive.
   */
  const pick = (event: MouseEvent<HTMLElement>) => {
    if (copies) return
    if ((event.target as HTMLElement).closest('button, input, select, a')) return
    onSelect()
  }

  return (
    <section
      className={`prow${selected && !bare ? ' prow--selected' : ''}`}
      onClick={pick}
      aria-current={selected && !bare ? 'true' : undefined}
    >
      {!bare && (
        <header className="prow__head">
          <span className="prow__name">{palette.name}</span>
          <span className="prow__note">
            {palette.ramp.length} steps · {palette.config.base}
          </span>
          <span className="spacer" />
          {!selected && (
            <button type="button" onClick={onSelect} title="Bring the toolbox to this palette">
              Edit
            </button>
          )}
          <button
            type="button"
            disabled={index === 0}
            onClick={() => onMove(-1)}
            title="Move this palette up the stack"
          >
            Up
          </button>
          <button
            type="button"
            disabled={index === count - 1}
            onClick={() => onMove(1)}
            title="Move this palette down the stack"
          >
            Down
          </button>
          <button
            type="button"
            disabled={count < 2}
            onClick={onRemove}
            title={count < 2 ? 'The last palette cannot be deleted' : 'Delete this palette'}
          >
            Delete
          </button>
        </header>
      )}

      <RampStrip
        ramp={palette.ramp}
        format={format}
        copiedKey={copiedKey}
        seamless={seamless}
        idPrefix={palette.id}
        swatchTitle={copies ? undefined : () => `Edit ${palette.name}`}
        onCopy={copies ? onCopy : onSelect}
      />
    </section>
  )
}
