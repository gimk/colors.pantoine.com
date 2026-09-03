import { useState, type DragEvent, type MouseEvent } from 'react'
import type { Format, Gamut } from '../color/oklch'
import { countDuplicateSteps } from '../color/ramp'
import { copyPng } from '../export/image'
import type { PaletteView } from '../state/useDocument'
import { RampStrip } from './RampStrip'

type Props = {
  palette: PaletteView
  count: number
  selected: boolean
  format: Format
  index?: number
  gamut?: Gamut
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
  copiedKey,
  onSelect,
  onRemove,
  onReorder,
  onCopy,
}: Props) {
  const [isOver, setIsOver] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [copiedPng, setCopiedPng] = useState(false)
  const duplicates = countDuplicateSteps(palette.ramp)

  const handleCopyPng = async (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    // Labelled, always: this is the editor, where a ramp is being read as
    // much as looked at. The review board's Copy PNG is the other end of
    // that — the whole document rather than one row, and labelled only if
    // the board itself is.
    const ok = await copyPng(palette.ramp, { size: 96, labels: true })
    if (ok) {
      setCopiedPng(true)
      window.setTimeout(() => setCopiedPng(false), 1500)
    }
  }

  /**
   * The first click on a palette picks it up and brings the toolbox to it;
   * clicks after that copy, as they always did.
   */
  const copies = selected

  const pick = (event: MouseEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest('button, input, select, a, .prow__handle')) return
    if (!selected) {
      onSelect()
    } else if ((event.target as HTMLElement).closest('.prow__head')) {
      onSelect()
    }
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
      className={`prow${selected ? ' prow--selected' : ''}${isOver ? ' prow--drop-target' : ''}${isDragging ? ' prow--dragging' : ''}`}
      onClick={pick}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      aria-current={selected ? 'true' : undefined}
    >
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
        {selected && <span className="badge prow__badge">Editing</span>}
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
          className={`prow__btn-icon${copiedPng ? ' is-copied' : ''}`}
          onClick={handleCopyPng}
          title={copiedPng ? 'Palette copied as PNG!' : 'Copy palette as PNG'}
          aria-label="Copy palette as PNG"
        >
          {copiedPng ? (
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" style={{ display: 'block' }}>
              <path d="M3 8.5L6.5 12L13 4" />
            </svg>
          ) : (
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ display: 'block' }}>
              <rect x="5.5" y="5.5" width="9" height="9" />
              <path d="M3.5 10.5H1.5V1.5H10.5V3.5" />
            </svg>
          )}
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

      <RampStrip
        ramp={palette.ramp}
        format={format}
        gamut={gamut}
        markers={selected}
        copiedKey={copiedKey}
        idPrefix={palette.id}
        swatchTitle={copies ? undefined : () => `Edit ${palette.name}`}
        onCopy={copies ? onCopy : onSelect}
      />
    </section>
  )
}
