import { Fragment, useEffect, useRef, useState } from 'react'
import { HARMONIES } from '../color/harmony'
import { FORMATS, type Format, type Gamut, type Oklch } from '../color/oklch'
import {
  AUTO_RULE,
  MAX_SLOTS,
  MIN_SLOTS,
  PROFILES,
  RANDOM,
  type ProfileSetting,
  type RuleId,
} from '../color/scheme'
import { VISIONS, type Vision } from '../color/vision'
import type { Mode } from '../state/mode'
import { schemeUrl } from '../state/url'
import type { SchemeApi } from '../state/useScheme'
import { Masthead } from './Masthead'
import { SchemeBar } from './SchemeBar'
import { SchemeExportDialog } from './SchemeExportDialog'

/** How long the pointer has to rest on a boundary before its seam opens. */
export const SEAM_DWELL = 130

/** Namespaced away from the slot keys, so neither flashes for the other. */
const LINK_KEY = 'scheme-link'

/**
 * What counts as open over the board, and so as owning the keyboard.
 *
 * Exported because it has two halves that have to agree: this selector, and
 * the class the shade strip renders. The strip is a panel rather than a
 * dialog — see `ShadePicker` — so `dialog[open]` alone stopped seeing it.
 */
export const OVERLAY_SELECTOR = 'dialog[open], .shades'

/** Where a keypress landed, as the only two things the answer turns on. */
export type KeyContext = {
  /** Focus is somewhere a space is a character rather than a command. */
  inTextEntry: boolean
  /** Something is open over the board and owns the keyboard: a dialog, or a
   *  bar's shades. */
  inOverlay: boolean
}

/**
 * Whether a Space press belongs to the board rather than to whatever has focus.
 *
 * Space rolls, full stop. Every focusable control keeps focus after it is
 * used — a button after a click, a select after you pick from it — and every
 * one of them answers to Space, so any rule that let focus keep the key made
 * Space mean "do that last thing again" for the rest of the session. Tracking
 * *how* focus arrived was an attempt to have it both ways and was still wrong
 * often enough to be worse than a plain rule.
 *
 * The cost is that Space no longer presses a tabbed-to button. Enter does,
 * which is the keyboard path that matters, and the footer says what Space is
 * for. Only text entry and something open over the board get to keep it.
 */
export function spaceRolls(where: KeyContext): boolean {
  return !where.inTextEntry && !where.inOverlay
}

type Props = {
  scheme: SchemeApi
  mode: Mode
  onMode: (mode: Mode) => void
  format: Format
  onFormat: (format: Format) => void
  gamut: Gamut
  onGamut: (gamut: Gamut) => void
  vision: Vision
  onVision: (vision: Vision) => void
  /** Turn the scheme into palettes in the ramp document, and go there. */
  onSendToRamps: () => void
  /** The same, for one color: the bar's own way over, leaving the rest here. */
  onSendColorToRamps: (color: Oklch) => void
  /** Take the document's base colours as the scheme, locked. */
  onSeedFromRamps: () => void
  copiedKey: string | null
  onCopy: (key: string, text: string) => void
}

/**
 * The scheme, as a wall of colour.
 *
 * Deliberately the loudest thing in the app: full-bleed bars, no rules, no
 * grid, and a bar of chrome that can be put away entirely. The editor is a
 * workshop and looks like one; this is the thing you stand back from.
 *
 * The keyboard is the real interface. Space rolls a new scheme, the digits
 * lock a bar, and both are reachable without moving the pointer off the
 * colours — which is the gesture the whole mode is built around.
 */
export function SchemeBoard({
  scheme,
  mode,
  onMode,
  format,
  onFormat,
  gamut,
  onGamut,
  vision,
  onVision,
  onSendToRamps,
  onSendColorToRamps,
  onSeedFromRamps,
  copiedKey,
  onCopy,
}: Props) {
  const [bare, setBare] = useState(false)
  const [dragging, setDragging] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  /** Which boundary is standing open, if any. */
  const [openSeam, setOpenSeam] = useState<number | null>(null)
  const dwell = useRef<number | undefined>(undefined)

  const { slots, generate, toggleLock } = scheme

  useEffect(() => () => window.clearTimeout(dwell.current), [])

  /**
   * Start the wait on one seam.
   *
   * Long enough that crossing the row on the way somewhere else never opens
   * anything — a hand moving between two bars clears a 28px strip in well
   * under this — and short enough not to read as a wait when you meant it.
   */
  const armSeam = (at: number) => {
    window.clearTimeout(dwell.current)
    dwell.current = window.setTimeout(() => setOpenSeam(at), SEAM_DWELL)
  }

  /** Closing is immediate: a seam you have left should not trail the pointer. */
  const closeSeam = () => {
    window.clearTimeout(dwell.current)
    setOpenSeam(null)
  }

  /**
   * Space rolls, and the digits lock.
   *
   * `preventDefault` on the keydown is what stops a focused control acting on
   * the key as well: a button activates on the Space *keyup*, and suppressing
   * the keydown suppresses that. It also stops the page scrolling, which is
   * the browser's own default for the key.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null

      const where = {
        // A space inside a name is a space. Selects are deliberately not here:
        // one keeps focus after you pick from it, and Space reopening the menu
        // you just used is exactly the behaviour this is meant to be rid of.
        inTextEntry: Boolean(target?.closest?.('input, textarea, [contenteditable]')),
        // Anything open over the board owns the keyboard entirely — rolling a
        // new scheme behind an open export panel is nobody's intention, and
        // rolling one out from under a strip of shades even less so. The
        // shades are a panel rather than a dialog, for the reason
        // `ShadePicker` documents, so they have to be named here too.
        inOverlay: Boolean(document.querySelector(OVERLAY_SELECTOR)),
      }

      if (event.code === 'Space') {
        if (!spaceRolls(where)) return
        event.preventDefault()
        generate()
        return
      }

      if (where.inTextEntry || where.inOverlay) return
      const digit = Number(event.key)
      if (Number.isInteger(digit) && digit >= 1 && digit <= slots.length) {
        event.preventDefault()
        toggleLock(slots[digit - 1].id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [generate, toggleLock, slots])

  const rolledLabel =
    scheme.rule === AUTO_RULE && scheme.rolled
      ? HARMONIES.find((harmony) => harmony.id === scheme.rolled)?.label
      : null

  /**
   * The seam that lives on the boundary before slot `at`.
   *
   * A real flex item of zero width rather than something laid over the bars,
   * which is what lets the two colours actually move aside: opening it widens
   * its basis, the bars give up the room between them, and the gap appears
   * where the pointer already is. Overlaying and shifting the bars instead
   * would have them slide across their outer neighbours, or pull the ends of
   * the row away from the window edges.
   *
   * The dwell is held here rather than as a CSS `transition-delay`, because a
   * delay defers only the *appearance*. The hit area is live from the first
   * moment either way, so a seam styled that way spends the dwell as an
   * invisible 28px strip over every boundary that swallows clicks meant for
   * the colour underneath — click near a bar's edge to copy it and a colour
   * is silently inserted instead. Opening on a timer instead lets the button
   * stay `pointer-events: none` until it is actually on screen, so nothing
   * can be clicked before it can be seen.
   */
  const insertAt = (at: number) =>
    bare || slots.length >= MAX_SLOTS ? null : (
      <span
        key={`seam-${at}`}
        className={`scheme__seam${openSeam === at ? ' is-open' : ''}`}
        onPointerEnter={() => armSeam(at)}
        onPointerLeave={closeSeam}
      >
        <button
          type="button"
          className="scheme__insert"
          /* The boundary this seam stands on, which is also what a click
             inserts at. Rendered so the mapping from a seam's place in the row
             to the index it acts on is checkable without a DOM. */
          data-at={at}
          onClick={() => {
            scheme.add(at)
            // The new colour is what should fill the gap it was added into.
            closeSeam()
          }}
          onFocus={() => setOpenSeam(at)}
          onBlur={closeSeam}
          title={
            at === 0
              ? 'Add a colour at the start'
              : at === slots.length
                ? 'Add a colour at the end'
                : 'Add a colour here'
          }
        >
          +
        </button>
      </span>
    )

  return (
    <div className={`scheme${bare ? ' scheme--bare' : ''}`}>
      {/* The same masthead the editor carries, above this mode's own toolbar.
          The name of the tool and the switch between its halves do not change
          with what you are making, so neither does the bar that holds them. */}
      <Masthead mode={mode} onMode={onMode} gamut={gamut} />

      <header className="scheme__bar">
        <button
          type="button"
          className="is-primary"
          onClick={generate}
          title="Roll a new scheme, holding every locked colour (Space)"
        >
          Generate
        </button>

        <label className="field">
          <span>Rule</span>
          <select
            value={scheme.rule}
            onChange={(event) => scheme.setRule(event.target.value as RuleId)}
            title="Which hues the unlocked colours are allowed to take, measured from the locked one"
          >
            {/* The two that roll, above the eight that decide. Auto picks a
                rule and follows it; Random is the one that means none. */}
            <option value={AUTO_RULE} title="Roll one of the eight rules, and say which">
              Auto
            </option>
            <option value={RANDOM} title="No rule at all — every hue rolled on its own">
              Random
            </option>
            {HARMONIES.map((harmony) => (
              <option key={harmony.id} value={harmony.id} title={harmony.hint}>
                {harmony.label}
              </option>
            ))}
          </select>
        </label>

        {/* What Auto actually rolled. The mode's claim is that these colours
            go together for a reason, and this is where it says the reason. */}
        {rolledLabel && (
          <span className="scheme__rolled" title="The rule this scheme was rolled with">
            {rolledLabel}
          </span>
        )}

        <label className="field">
          <span>Weight</span>
          <select
            value={scheme.profile}
            onChange={(event) => scheme.setProfile(event.target.value as ProfileSetting)}
            title="How lightness and chroma are spread across the scheme"
          >
            <option
              value={RANDOM}
              title="No profile — every colour's lightness and chroma rolled on its own"
            >
              Random
            </option>
            {PROFILES.map((profile) => (
              <option key={profile.id} value={profile.id} title={profile.hint}>
                {profile.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Colours</span>
          <select
            value={slots.length}
            onChange={(event) => scheme.setCount(Number(event.target.value))}
            title="How many colours the scheme has"
          >
            {Array.from({ length: MAX_SLOTS - MIN_SLOTS + 1 }, (_unused, index) => {
              const count = MIN_SLOTS + index
              return (
                <option key={count} value={count}>
                  {count}
                </option>
              )
            })}
          </select>
        </label>

        <button
          type="button"
          disabled={!scheme.canUndo}
          onClick={scheme.undo}
          title="Step back one roll (Ctrl+Z)"
        >
          Undo
        </button>

        <button
          type="button"
          disabled={!scheme.canRedo}
          onClick={scheme.redo}
          title="Redo (Ctrl+Shift+Z)"
        >
          Redo
        </button>

        <span className="spacer" />

        <label className="field">
          <span>Click copies</span>
          <select value={format} onChange={(event) => onFormat(event.target.value as Format)}>
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

        {/* Same pair as the review board, and the same reasoning: not what the
            colours are, but the conditions they are being judged under. */}
        <label className={`field${vision === 'normal' ? '' : ' field--simulating'}`}>
          <span>Vision</span>
          <select
            value={vision}
            onChange={(event) => onVision(event.target.value as Vision)}
            title={VISIONS.find((option) => option.id === vision)?.hint}
          >
            {VISIONS.map((option) => (
              <option key={option.id} value={option.id} title={option.hint}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          className={bare ? 'is-on' : undefined}
          aria-pressed={bare}
          onClick={() => setBare((on) => !on)}
          title="Put every label and control away and leave nothing but the colours"
        >
          Bare
        </button>

        {/* The scheme's own link, not the document's: sharing five colours and
            sharing a stack of ramps are two different things to send someone,
            and one link that carried both would open on the wrong one. */}
        <button
          type="button"
          className={copiedKey === LINK_KEY ? 'is-on' : undefined}
          onClick={() =>
            onCopy(
              LINK_KEY,
              schemeUrl(
                scheme.state.slots,
                scheme.state.rule,
                scheme.state.profile,
                gamut,
              ),
            )
          }
          title="Copy a link that opens this scheme, locks and all"
        >
          {copiedKey === LINK_KEY ? 'Link copied' : 'Copy link'}
        </button>

        <SchemeExportDialog slots={scheme.state.slots} gamut={gamut} />

        <span className="divider" aria-hidden="true" />

        <button
          type="button"
          onClick={onSeedFromRamps}
          title="Replace the scheme with the base colour of every palette in the document, locked"
        >
          &larr; From ramps
        </button>

        <button
          type="button"
          onClick={onSendToRamps}
          title="Make a tint and shade palette from each of these colours, and go there"
        >
          To ramps &rarr;
        </button>
      </header>

      <div className="scheme__bars">
        {slots.map((slot, index) => (
          <Fragment key={slot.id}>
            {insertAt(index)}
            <SchemeBar
            slot={slot}
            format={format}
            gamut={gamut}
            onGamut={onGamut}
            vision={vision}
            bare={bare}
            removable={slots.length > MIN_SLOTS}
            copied={copiedKey === `slot-${slot.id}`}
            onCopy={onCopy}
            onToggleLock={() => scheme.toggleLock(slot.id)}
            onRemove={() => scheme.remove(slot.id)}
            onColor={(color) => scheme.setColor(slot.id, color)}
            onToRamps={() => onSendColorToRamps(slot.color)}
            dragging={dragging === slot.id}
            dropTarget={dropTarget === slot.id && dragging !== slot.id}
            onDragStart={() => setDragging(slot.id)}
            onDragEnd={() => {
              setDragging(null)
              setDropTarget(null)
            }}
            onDragOver={() => {
              if (dropTarget !== slot.id) setDropTarget(slot.id)
            }}
            onDrop={() => {
              if (dragging && dragging !== slot.id) scheme.reorder(dragging, slot.id)
              setDragging(null)
              setDropTarget(null)
            }}
          />
          </Fragment>
        ))}
        {insertAt(slots.length)}
      </div>

      {!bare && (
        <footer className="scheme__foot">
          <span>Space rolls a new scheme · a digit locks that colour · click a bar to copy it</span>
        </footer>
      )}
    </div>
  )
}
