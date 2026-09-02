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

  return (
    <label className="field" title={title}>
      <span>{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        value={draft}
        onFocus={() => {
          focused.current = true
        }}
        onBlur={() => {
          focused.current = false
          setDraft(value.toFixed(decimals))
        }}
        onChange={(event) => {
          setDraft(event.target.value)
          const parsed = Number.parseFloat(event.target.value)
          if (Number.isFinite(parsed)) onCommit(parsed)
        }}
      />
    </label>
  )
}
