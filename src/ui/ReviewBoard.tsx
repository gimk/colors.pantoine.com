import { useEffect, useRef, useState, type DragEvent, type PointerEvent } from 'react'
import { FORMATS, formatColor, type Format, type Gamut } from '../color/oklch'
import {
  boardSvg,
  copyBoardPng,
  type BoardOptions,
  type BoardPalette,
} from '../export/image'
import type { DocumentApi } from '../state/useDocument'
import { MAX_GAP, type ReviewApi } from '../state/useReview'
import { RampStrip } from './RampStrip'

type Props = {
  doc: DocumentApi
  review: ReviewApi
  format: Format
  /**
   * The board's format select drives the document's one format rather than a
   * second of its own. What a chip reads as and what clicking it copies have
   * to be the same string — showing a hex while copying an `oklch()` is a
   * trap, and two settings for one idea is how you get there.
   */
  onFormat: (format: Format) => void
  gamut: Gamut
  dark: boolean
  onDark: () => void
  onExit: () => void
  copiedKey: string | null
  onCopy: (key: string, text: string) => void
}

/** Namespaced away from the swatch keys, so neither flashes for the other. */
const SVG_KEY = 'board-svg'

/**
 * The board is copied at a fixed long edge rather than at screen scale, so a
 * board pasted into Figma is usable whatever window it was arranged in.
 * Proportions come from the board itself, so what lands on the clipboard is
 * the arrangement that was on screen and not a re-guess of it.
 */
const COPY_WIDTH = 2000

/**
 * Where each internal boundary of a weighted track list falls, as CSS.
 *
 * A track's size is exactly its share of the axis: `flex-basis` is 0 for
 * every band and every swatch, so `flex-grow` divides the room in proportion
 * and nothing needs measuring. Gaps are the one thing not shared out, so they
 * come off the percentage and back on as a constant.
 */
function boundaries(weights: number[], gap: number): string[] {
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  if (!(total > 0)) return []
  const gaps = gap * Math.max(weights.length - 1, 0)
  const offsets: string[] = []
  let run = 0
  for (let index = 0; index < weights.length - 1; index += 1) {
    run += weights[index]
    const share = `${((run / total) * 100).toFixed(4)}%`
    if (!gaps) {
      offsets.push(share)
      continue
    }
    // The share of the *gapless* room, plus the gaps that come before this
    // boundary and half of the one it sits in. Signed explicitly, because
    // `calc(33% - -2px)` is not a thing calc will parse.
    const shift = index * gap + gap / 2 - (gaps * run) / total
    offsets.push(`calc(${share} ${shift < 0 ? '-' : '+'} ${Math.abs(shift).toFixed(4)}px)`)
  }
  return offsets
}

export function ReviewBoard({
  doc,
  review,
  format,
  onFormat,
  gamut,
  dark,
  onDark,
  onExit,
  copiedKey,
  onCopy,
}: Props) {
  const bandsRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [copiedBoard, setCopiedBoard] = useState(false)

  const { layout, steps } = review
  const rows = layout.axis === 'rows'
  const { palettes } = doc
  const paletteWeights = palettes.map((palette) => review.weightOf(palette.id))

  // Leaving has to be reachable without hunting for a button, since the board
  // is deliberately almost all colour and hardly any chrome.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onExit()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onExit])

  /**
   * Drag a ruler tick to move share between the two tracks it divides.
   *
   * Sizes are measured once, when the drag begins, and every move recomputes
   * from that snapshot against the total distance travelled. Applying each
   * event's own increment instead compounds the rounding, and the boundary
   * drifts away from the pointer over a long drag.
   */
  const beginResize = (
    event: PointerEvent<HTMLElement>,
    kind: 'palette' | 'step',
    index: number,
  ) => {
    const bands = bandsRef.current
    if (!bands || event.button !== 0) return
    event.preventDefault()

    const alongY = kind === 'palette' ? rows : !rows
    const span = alongY ? bands.clientHeight : bands.clientWidth
    const weights = kind === 'palette' ? paletteWeights : steps
    const total = weights.reduce((sum, weight) => sum + weight, 0)
    const gaps = kind === 'palette' ? layout.gap * Math.max(weights.length - 1, 0) : 0
    const room = Math.max(span - gaps, 1)
    const sizeA = (weights[index] / total) * room
    const sizeB = (weights[index + 1] / total) * room
    const origin = alongY ? event.clientY : event.clientX

    const tick = event.currentTarget
    tick.setPointerCapture(event.pointerId)

    const move = (moved: globalThis.PointerEvent) => {
      const delta = (alongY ? moved.clientY : moved.clientX) - origin
      if (kind === 'palette') {
        review.resizePalettes(palettes[index].id, palettes[index + 1].id, sizeA, sizeB, delta)
      } else {
        review.resizeSteps(index, index + 1, sizeA, sizeB, delta)
      }
    }

    const done = () => {
      tick.removeEventListener('pointermove', move)
      tick.removeEventListener('pointerup', done)
      tick.removeEventListener('pointercancel', done)
    }

    tick.addEventListener('pointermove', move)
    tick.addEventListener('pointerup', done)
    tick.addEventListener('pointercancel', done)
  }

  /**
   * The board's geometry in image pixels, measured rather than re-guessed, so
   * both copies carry the arrangement that is actually on screen.
   */
  const boardOptions = (): BoardOptions | null => {
    const bands = bandsRef.current
    if (!bands) return null
    const box = bands.getBoundingClientRect()
    if (!box.width || !box.height) return null
    const scale = COPY_WIDTH / box.width
    return {
      axis: layout.axis,
      gap: layout.gap * scale,
      paletteWeights,
      stepWeights: steps,
      labels: layout.labels,
      width: COPY_WIDTH,
      height: box.height * scale,
      background: dark ? '#000000' : '#ffffff',
    }
  }

  const boardPalettes = (): BoardPalette[] =>
    palettes.map((palette) => ({
      name: palette.name,
      ramp: palette.ramp,
      values: layout.labels
        ? palette.ramp.map((swatch) => formatColor(swatch.oklch, format, gamut))
        : undefined,
    }))

  const handleCopyPng = async () => {
    const options = boardOptions()
    if (!options) return
    if (await copyBoardPng(boardPalettes(), options)) {
      setCopiedBoard(true)
      window.setTimeout(() => setCopiedBoard(false), 1500)
    }
  }

  const handleCopySvg = () => {
    const options = boardOptions()
    if (!options) return
    onCopy(SVG_KEY, boardSvg(boardPalettes(), options))
  }

  const handleDrop = (event: DragEvent, targetId: string) => {
    event.preventDefault()
    setDropTarget(null)
    const sourceId = event.dataTransfer.getData('text/plain')
    if (sourceId && sourceId !== targetId) doc.reorder(sourceId, targetId)
  }

  const paletteTicks = boundaries(paletteWeights, layout.gap)
  const stepTicks = boundaries(steps, 0)

  return (
    <div className={`review review--${layout.axis}`}>
      <header className="review__bar">
        <button
          type="button"
          className="is-primary"
          onClick={onExit}
          title="Back to the editor (Escape)"
        >
          &larr; Back
        </button>
        <h1>colors.pantoine.com &mdash; review</h1>
        <span className="spacer" />

        <div className="review__group" role="group" aria-label="Layout">
          <button
            type="button"
            className={rows ? 'is-on' : undefined}
            aria-pressed={rows}
            onClick={() => review.setAxis('rows')}
            title="Palettes as horizontal bands, stacked down the window"
          >
            Rows
          </button>
          <button
            type="button"
            className={!rows ? 'is-on' : undefined}
            aria-pressed={!rows}
            onClick={() => review.setAxis('columns')}
            title="Palettes as vertical bands, stacked across the window"
          >
            Columns
          </button>
        </div>

        <label className="field review__gap">
          <span>Spacing</span>
          <input
            type="range"
            min={0}
            max={MAX_GAP}
            step={1}
            value={layout.gap}
            onChange={(event) => review.setGap(Number(event.target.value))}
            title="Space between palettes. Steps within one palette always meet edge to edge."
          />
        </label>

        {/* One switch for the palette names and the value on every chip: they
            answer the same question, and a board that named its palettes but
            not its steps would be halfway to the editor's label grid without
            being any use. */}
        <button
          type="button"
          className={layout.labels ? 'is-on' : undefined}
          aria-pressed={layout.labels}
          onClick={() => review.setLabels(!layout.labels)}
          title="Print the palette names, and each step's value on its chip"
        >
          Labels
        </button>

        <label className="field">
          <span>Format</span>
          <select
            value={format}
            onChange={(event) => onFormat(event.target.value as Format)}
            title="What the labels read as, and what clicking a chip copies"
          >
            {FORMATS.map((option) => {
              const unavailable =
                gamut !== 'srgb' && (option === 'hex' || option === 'rgb' || option === 'hsl')
              return (
                <option
                  key={option}
                  value={option}
                  style={unavailable ? { color: 'var(--muted)' } : undefined}
                >
                  {option}{unavailable ? ' (sRGB only)' : ''}
                </option>
              )
            })}
          </select>
        </label>

        <button type="button" onClick={onDark} title="Judge the palettes against the other ground">
          {dark ? 'Light canvas' : 'Dark canvas'}
        </button>

        <button
          type="button"
          onClick={review.reset}
          title="Every palette and every step back to an even share"
        >
          Reset sizes
        </button>

        {/* The same two gestures the export panel leads with, on the whole
            board rather than one ramp: paste it as pixels, or as layers. */}
        <button
          type="button"
          className={copiedBoard ? 'is-on' : undefined}
          onClick={handleCopyPng}
          title="Copy the board as one PNG, arranged exactly as it is here"
        >
          {copiedBoard ? 'PNG copied' : 'Copy PNG'}
        </button>

        <button
          type="button"
          className={copiedKey === SVG_KEY ? 'is-on' : undefined}
          onClick={handleCopySvg}
          title="Copy the board as SVG: one named, editable rectangle per step, grouped per palette"
        >
          {copiedKey === SVG_KEY ? 'SVG copied' : 'Copy SVG'}
        </button>
      </header>

      {/* Two rulers meeting at a corner, one per axis: the palette ruler
          divides the stack, the step ruler divides the ramp. Resizing lives
          here so the colour field stays untouched — grips laid over the chips
          would put a strip that cannot be copied either side of every
          boundary, in the one mode that is nothing but chips. */}
      <div
        className={`review__ruler review__ruler--palette review__ruler--${rows ? 'down' : 'across'}`}
      >
        {paletteTicks.map((offset, index) => (
          <span
            key={palettes[index].id}
            className="review__tick"
            style={rows ? { top: offset } : { left: offset }}
            onPointerDown={(event) => beginResize(event, 'palette', index)}
            title={`Drag to resize ${palettes[index].name} against ${palettes[index + 1].name}`}
            role="separator"
            aria-orientation={rows ? 'horizontal' : 'vertical'}
          />
        ))}
      </div>

      <div
        className={`review__ruler review__ruler--step review__ruler--${rows ? 'across' : 'down'}`}
      >
        {stepTicks.map((offset, index) => (
          <span
            key={index}
            className="review__tick"
            style={rows ? { left: offset } : { top: offset }}
            onPointerDown={(event) => beginResize(event, 'step', index)}
            title="Drag to resize this step, across every palette"
            role="separator"
            aria-orientation={rows ? 'vertical' : 'horizontal'}
          />
        ))}
      </div>

      <div className="review__bands" ref={bandsRef} style={{ gap: `${layout.gap}px` }}>
        {palettes.map((palette) => (
          <section
            key={palette.id}
            className={`rband${dropTarget === palette.id ? ' rband--drop' : ''}${
              dragging === palette.id ? ' rband--dragging' : ''
            }`}
            style={{ flexGrow: review.weightOf(palette.id) }}
            /* The band itself drags, not only the name badge, so switching
               the labels off does not take reordering away with them. A
               native drag and a click stay distinct, so a chip still copies
               — and resizing is on the rulers, so nothing else competes. */
            draggable
            onDragStart={(event) => {
              setDragging(palette.id)
              event.dataTransfer.setData('text/plain', palette.id)
              event.dataTransfer.effectAllowed = 'move'
            }}
            onDragEnd={() => {
              setDragging(null)
              setDropTarget(null)
            }}
            onDragOver={(event) => {
              event.preventDefault()
              event.dataTransfer.dropEffect = 'move'
              if (dropTarget !== palette.id) setDropTarget(palette.id)
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropTarget(null)
            }}
            onDrop={(event) => handleDrop(event, palette.id)}
          >
            {layout.labels && (
              /* Subtle unboxed name, in white or black depending on the
                 contrast of the first swatch it sits over. Absolute, so
                 naming a palette costs the colours no room — and it is the
                 visible advertisement that a band can be dragged. */
              <span
                className="rband__name"
                style={{
                  color:
                    palette.ramp[0]?.contrastOnBlack >= palette.ramp[0]?.contrastOnWhite
                      ? '#000000'
                      : '#ffffff',
                }}
                title="Drag to reorder"
              >
                {palette.name}
              </span>
            )}
            <RampStrip
              ramp={palette.ramp}
              format={format}
              gamut={gamut}
              labels={false}
              markers={false}
              orientation={rows ? 'horizontal' : 'vertical'}
              fill
              weights={steps}
              stamp={layout.labels}
              copiedKey={copiedKey}
              idPrefix={palette.id}
              onCopy={onCopy}
            />
          </section>
        ))}
      </div>
    </div>
  )
}
