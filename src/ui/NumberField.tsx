import { useEffect, useRef, useState } from 'react'

type Props = {
  label: string
  value: number
  min: number
  max: number
  step: number
  decimals: number
  disabled?: boolean
  title?: string
  onCommit: (value: number) => void
}

/**
 * Accept the comma as a decimal separator.
 *
 * Only reachable because the field is `type="text"`: a number input runs the
 * value through HTML's own sanitiser first, which throws away anything that
 * is not a valid floating-point literal, so on a French keyboard "0,85"
 * reached React as "" and the digits vanished on blur. `inputMode="decimal"`
 * is what still brings up the numeric keypad on a phone.
 */
export function parseNumberInput(raw: string): number | null {
  const normalized = raw.trim().replace(',', '.')
  if (
    normalized === '' ||
    normalized === '-' ||
    normalized === '.' ||
    normalized === '-.' ||
    normalized.endsWith('.')
  ) {
    return null
  }
  const parsed = Number.parseFloat(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

export function parseNumberCommit(raw: string): number | null {
  const normalized = raw.trim().replace(',', '.')
  const parsed = Number.parseFloat(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * What the field should show for `raw`, and whether that is worth reporting.
 *
 * Every commit marks the channel hand-edited and pushes an undo entry, so a
 * field that announced its own unchanged value — which is what blur does if
 * it is not asked — turned tabbing past it into an edit, and an edited
 * palette stops rebuilding itself when the base colour changes.
 *
 * Compared at the field's own precision: that is all it can express, so a
 * difference it cannot show is not a difference the designer asked for.
 */
export function commitValue(
  raw: number,
  value: number,
  min: number,
  max: number,
  decimals: number,
): { value: number; changed: boolean } {
  const clamped = Math.min(max, Math.max(min, raw))
  return { value: clamped, changed: clamped.toFixed(decimals) !== value.toFixed(decimals) }
}

/**
 * A number input that lets you finish typing.
 *
 * The draft text is local so intermediate states ("0.", "-") survive, and
 * the field only re-adopts the incoming value when it is not focused —
 * otherwise dragging a curve handle would fight the caret.
 */
export function NumberField({
  label,
  value,
  min,
  max,
  step,
  decimals,
  disabled,
  title,
  onCommit,
}: Props) {
  const [draft, setDraft] = useState(() => value.toFixed(decimals))
  const focused = useRef(false)

  useEffect(() => {
    if (!focused.current) setDraft(value.toFixed(decimals))
  }, [value, decimals])

  const commit = (raw: number): number => {
    const next = commitValue(raw, value, min, max, decimals)
    if (next.changed) onCommit(next.value)
    return next.value
  }

  const step10 = (direction: 1 | -1, shift: boolean) => {
    const delta = (shift ? step * 10 : step) * direction
    setDraft(commit((parseNumberCommit(draft) ?? value) + delta).toFixed(decimals))
  }

  return (
    <label className="field" title={title}>
      <span>{label}</span>
      <input
        type="text"
        className="number"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        value={draft}
        onFocus={() => {
          focused.current = true
        }}
        onBlur={() => {
          focused.current = false
          const parsed = parseNumberCommit(draft)
          // Unparseable text is not an edit, it is an abandoned one: the
          // field goes back to the value it is reporting.
          setDraft((parsed === null ? value : commit(parsed)).toFixed(decimals))
        }}
        onKeyDown={(event) => {
          // A text input has no spinner of its own, so the arrows are ours to
          // implement — and hold shift for a coarser nudge.
          if (event.key === 'Enter') {
            event.currentTarget.blur()
          } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            step10(1, event.shiftKey)
          } else if (event.key === 'ArrowDown') {
            event.preventDefault()
            step10(-1, event.shiftKey)
          }
        }}
        onChange={(event) => {
          setDraft(event.target.value)
          // Out of range mid-typing is a half-typed number, not a request for
          // the limit: the first keystroke of "15" is a 1, and clamping that
          // to the minimum collapsed the ramp and rebuilt it before the 5
          // arrived. Those wait for blur, which clamps.
          const parsed = parseNumberInput(event.target.value)
          if (parsed !== null && parsed >= min && parsed <= max) commit(parsed)
        }}
      />
    </label>
  )
}
