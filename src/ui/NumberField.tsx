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

  const commitIfValid = (raw: string) => {
    const parsed = parseNumberInput(raw)
    if (parsed !== null) {
      onCommit(parsed)
    }
  }

  return (
    <label className="field" title={title}>
      <span>{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        lang="en"
        inputMode="decimal"
        disabled={disabled}
        value={draft}
        onFocus={() => {
          focused.current = true
        }}
        onBlur={() => {
          focused.current = false
          const parsed = parseNumberCommit(draft)
          if (parsed !== null) {
            const clamped = Math.min(max, Math.max(min, parsed))
            onCommit(clamped)
            setDraft(clamped.toFixed(decimals))
          } else {
            setDraft(value.toFixed(decimals))
          }
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.currentTarget.blur()
          } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            const delta = event.shiftKey ? step * 10 : step
            const current = parseNumberCommit(draft) ?? value
            const next = Math.min(max, Math.max(min, current + delta))
            onCommit(next)
            setDraft(next.toFixed(decimals))
          } else if (event.key === 'ArrowDown') {
            event.preventDefault()
            const delta = event.shiftKey ? step * 10 : step
            const current = parseNumberCommit(draft) ?? value
            const next = Math.min(max, Math.max(min, current - delta))
            onCommit(next)
            setDraft(next.toFixed(decimals))
          }
        }}
        onChange={(event) => {
          setDraft(event.target.value)
          commitIfValid(event.target.value)
        }}
      />
    </label>
  )
}
