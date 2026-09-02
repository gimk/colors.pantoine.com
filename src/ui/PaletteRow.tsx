import { useState, type DragEvent, type MouseEvent } from 'react'
import type { Format, Gamut } from '../color/oklch'
import { countDuplicateSteps } from '../color/ramp'
import type { PaletteView } from '../state/useDocument'
import { RampStrip } from './RampStrip'

type Props = {
  palette: PaletteView
  count: number
  selected: boolean
  format: Format
  index?: number
  gamut?: Gamut
  /** Show the step name, value and contrast cells under each chip. */
  labels?: boolean
  /** Tools are hidden: the stack is being looked at, not edited. */
  bare: boolean
  copiedKey: string | null
  onSelect: () => void
  onRemove: () => void
  onMove?: (by: -1 | 1) => void
  onReorder?: (sourceId: string, targetId: string) => void
  onCopy: (key: string, text: string) => void
}

export function PaletteRow({
  palette,
  count,
  selected,
  format,
  gamut = 'srgb',
  labels = true,
  bare,
  copiedKey,
  onSelect,
  onRemove,
  onReorder,
  onCopy,
}: Props) {
  const [isOver, setIsOver] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const duplicates = countDuplicateSteps(palette.ramp)

  // With the tools hidden there is nothing to select into, so every strip goes
  // back to copying. Otherwise the first click on a palette picks it up and
  // brings the toolbox to it; clicks after that copy, as they always did.
  const copies = selected || bare

  /**
   * The palette the toolbox is editing — which is nothing, with the tools
   * away. Everything that marks the selection hangs off this, so the band,
   * the badge and the swatch annotations cannot disagree about which row is
   * live.
   */
  const active = selected && !bare

  /**
   * Clicking the palette selects it — anywhere but on a control, so the
   * buttons inside keep doing their own jobs without nesting anything
   * interactive inside anything else interactive.
   */
  const pick = (event: MouseEvent<HTMLElement>) => {
    if (copies) return
    if ((event.target as HTMLElement).closest('button, input, select, a, .prow__handle')) return
    onSelect()
  }

  const handleDragStart = (e: DragEvent) => {
    setIsDragging(true)
    e.dataTransfer.setData('text/plain', palette.id)
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragEnd = () => {
    setIsDragging(false)
  }

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (!isOver) setIsOver(true)
  }

  const handleDragLeave = (e: DragEvent) => {
    // Only clear if leaving the prow container entirely
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsOver(false)
    }
  }

  const handleDrop = (e: DragEvent) => {
    e.preventDefault()
    setIsOver(false)
    const sourceId = e.dataTransfer.getData('text/plain')
    if (sourceId && sourceId !== palette.id && onReorder) {
      onReorder(sourceId, palette.id)
    }
  }

  return (
    <section
      className={`prow${active ? ' prow--selected' : ''}${isOver ? ' prow--drop-target' : ''}${isDragging ? ' prow--dragging' : ''}`}
      onClick={pick}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      aria-current={active ? 'true' : undefined}
    >
      {!bare && (
        <header className="prow__head">
          <span
            className="prow__handle"
            draggable
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            title="Drag to reorder palette"
            aria-label="Drag to reorder"
          >
            ::
          </span>
          <span className="prow__name">{palette.name}</span>
          {active && <span className="badge prow__badge">Editing</span>}
          <span className="prow__note">
            {palette.ramp.length} steps · {palette.config.base}
          </span>
          <span className="spacer" />
          {duplicates > 0 && (
            <span
              className="prow__duplicates"
              title={`${duplicates} step${duplicates > 1 ? 's are' : ' is'} identical to the adjacent step due to ramp compression`}
            >
              {duplicates === 1 ? '1 identical step' : `${duplicates} identical steps`}
            </span>
          )}
          {!selected && (
            <button type="button" onClick={onSelect} title="Bring the toolbox to this palette">
              Edit
            </button>
          )}
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
        gamut={gamut}
        labels={labels}
        markers={active}
        copiedKey={copiedKey}
        idPrefix={palette.id}
        swatchTitle={copies ? undefined : () => `Edit ${palette.name}`}
        onCopy={copies ? onCopy : onSelect}
      />
    </section>
  )
}
