import { useCallback, useState } from 'react'
import { nameForColor } from '../color/names'
import {
  formatColor,
  mapToGamut,
  parseToOklch,
  type Format,
  type Gamut,
  type Oklch,
} from '../color/oklch'
import { inkOn, simulate, type Vision } from '../color/vision'
import type { SlotView } from '../state/useScheme'
import { ColorPickerDialog } from './ColorPickerDialog'
import { ShadePicker } from './ShadePicker'

type Props = {
  slot: SlotView
  format: Format
  gamut: Gamut
  onGamut: (gamut: Gamut) => void
  vision: Vision
  /** Hides everything but the colour. */
  bare: boolean
  removable: boolean
  copied: boolean
  onCopy: (key: string, text: string) => void
  onToggleLock: () => void
  onRemove: () => void
  onColor: (color: Oklch) => void
  dragging: boolean
  dropTarget: boolean
  onDragStart: () => void
  onDragEnd: () => void
  onDragOver: () => void
  onDrop: () => void
}

/**
 * One colour, full height.
 *
 * The bar itself is the copy target, so the gesture that costs nothing is the
 * one you want most often. Everything else — the lock, the picker, removing
 * it — sits in a cluster that only appears under the pointer, because the
 * whole point of the mode is that the colour is not competing with chrome.
 */
export function SchemeBar({
  slot,
  format,
  gamut,
  onGamut,
  vision,
  bare,
  removable,
  copied,
  onCopy,
  onToggleLock,
  onRemove,
  onColor,
  dragging,
  dropTarget,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: Props) {
  /**
   * The colour as the eye in force receives it.
   *
   * The value printed on the bar and what a click copies both stay what the
   * scheme holds: a simulation is a way of looking at colours, never a way of
   * changing them. Only the ground and the ink it is read against move.
   */
  const seen = vision === 'normal' ? slot.shown : simulate(slot.shown, vision)
  const background = vision === 'normal' ? slot.displayColor : mapToGamut(seen, gamut).displayColor
  const ink = inkOn(seen)

  /** Whether this bar's shades are open over it. */
  const [shades, setShades] = useState(false)
  const closeShades = useCallback(() => setShades(false), [])

  const value = formatColor(slot.color, format, gamut)
  const name = nameForColor(slot.hex)
  const key = `slot-${slot.id}`

  return (
    <section
      className={`sbar${dragging ? ' sbar--dragging' : ''}${dropTarget ? ' sbar--drop' : ''}${
        slot.locked ? ' sbar--locked' : ''
      }`}
      style={{ background, color: ink }}
      /* The bar drags, not a separate grip, so reordering survives the chrome
         being switched off. A native drag and a click stay distinct, so the
         copy still works. */
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={(event) => {
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        onDragOver()
      }}
      onDrop={(event) => {
        event.preventDefault()
        onDrop()
      }}
    >
      {/* Covers the bar and carries the copy, so the click target is the
          colour rather than a strip of it. Transparent and unbordered: the
          brief for this mode is colour, and a button's chrome here would be
          the one thing on screen that is not paint. */}
      <button
        type="button"
        className="sbar__face"
        style={{ color: ink }}
        onClick={() => onCopy(key, value)}
        title={`Copy ${value}`}
      >
        {!bare && (
          <span className="sbar__read">
            <span className="sbar__value">{copied ? 'copied' : value}</span>
            <span className="sbar__name">{name}</span>
          </span>
        )}
      </button>

      {!bare && (
        <span className="sbar__tools">
          <button
            type="button"
            /* Deliberately not `is-on`. That class carries a document-wide
               fill in the app's own black, which on a light bar landed a
               black glyph on a black square — the tools here are painted in
               the bar's contrast colour, not the frame's. */
            className={`sbar__tool${slot.locked ? ' sbar__tool--locked' : ''}`}
            /* Filled while locked, in the same two colours the bar already
               uses: the ink it chose for legibility, and the bar's own ground
               showing back through the glyph. */
            style={
              slot.locked
                ? { color: background, backgroundColor: ink, borderColor: ink }
                : { color: ink, borderColor: ink }
            }
            aria-pressed={slot.locked}
            onClick={onToggleLock}
            title={
              slot.locked
                ? 'Locked — held through a regenerate. Click to release it.'
                : 'Lock this colour so a regenerate leaves it alone'
            }
          >
            {slot.locked ? (
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="3" y="11" width="18" height="11" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            ) : (
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="3" y="11" width="18" height="11" />
                <path d="M7 11V7a5 5 0 0 1 9.9-1" />
              </svg>
            )}
          </button>

          {/* The tool's own picker rather than the operating system's, for the
              reason it always is here: the system one is sRGB hex and cannot
              express a colour on a P3 document. Editing by hand locks the
              slot, which the reducer does — pick the exact blue you wanted and
              the next regenerate has to leave it alone. */}
          <ColorPickerDialog
            color={slot.color}
            gamut={gamut}
            onGamut={onGamut}
            panelTitle={name}
            onChange={(value) => {
              const next = parseToOklch(value)
              if (next) onColor(next)
            }}
            trigger={(open, ref) => (
              <button
                ref={ref}
                type="button"
                className="sbar__tool"
                style={{ color: ink, borderColor: ink }}
                onClick={open}
                title="Pick this colour by hand"
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M3 21l4-1 11-11-3-3L4 17z" />
                  <path d="M14 6l4 4" />
                </svg>
              </button>
            )}
          />

          {/* Between the picker and the bin, because it is the third way to
              set this colour and the quickest: the wedge is for a colour you
              have in mind, this is for the one you are on being nearly
              right. */}
          <button
            type="button"
            className="sbar__tool"
            style={{ color: ink, borderColor: ink }}
            aria-expanded={shades}
            onClick={() => setShades((on) => !on)}
            title="Take a lighter or darker shade of this colour"
          >
            {/* The half-filled disc every tool uses for tint and shade, which
                reads at 12px where a stack of bars would not. */}
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none" />
            </svg>
          </button>

          <button
            type="button"
            className="sbar__tool"
            style={{ color: ink, borderColor: ink }}
            disabled={!removable}
            onClick={onRemove}
            title={removable ? 'Remove this colour' : 'A scheme needs at least two colours'}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M5 12h14" />
            </svg>
          </button>
        </span>
      )}

      {/* Inside the bar rather than over the window, so it is inset by the
          bar's own colour and cannot be mistaken for a panel belonging to the
          board. Picking locks the slot, since it goes through the same
          `setColor` the picker does. */}
      {!bare && shades && (
        <ShadePicker
          color={slot.color}
          gamut={gamut}
          vision={vision}
          format={format}
          onPick={onColor}
          onClose={closeShades}
        />
      )}
    </section>
  )
}
