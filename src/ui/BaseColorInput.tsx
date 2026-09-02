type Props = {
  value: string
  /** The parsed colour as a hex, for the native picker. */
  resolvedHex: string
  valid: boolean
  onChange: (value: string) => void
}

export function BaseColorInput({ value, resolvedHex, valid, onChange }: Props) {
  return (
    <div className="field">
      <label htmlFor="base-color">
        <span>Base</span>
      </label>
      <input
        id="base-color"
        type="text"
        className={valid ? undefined : 'invalid'}
        value={value}
        spellCheck={false}
        autoComplete="off"
        placeholder="#7c3aed"
        aria-invalid={!valid}
        onChange={(event) => onChange(event.target.value)}
      />
      <input
        type="color"
        className="picker"
        aria-label="Pick base colour"
        value={resolvedHex}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}
