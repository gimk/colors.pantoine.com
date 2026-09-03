import { useState } from 'react'

type Props = {
  name: string
  onRename: (name: string) => void
}

/**
 * Whether text in the name field is a name, or a field on the way to one.
 *
 * Blank is the second. Clearing the field is how someone starts retyping a
 * name, and it is also how they hand the name back to the colour — the two
 * look identical until they leave the field, so nothing is reported until
 * they do.
 */
export function claimsName(raw: string): boolean {
  return raw.trim().length > 0
}

/**
 * The palette's name, editable, and left alone while it is being edited.
 *
 * Like `NumberField`, the draft is local so a half-finished value survives;
 * unlike it, the draft is what the field *shows* rather than a copy kept in
 * step with the incoming name. Clearing a name the palette derived renames it
 * to the very name it already had, which is no change at all — so there would
 * be no incoming value to copy back, and a synced draft would sit there empty.
 */
export function NameField({ name, onRename }: Props) {
  /** `null` while the field is not being edited: the document's name shows. */
  const [draft, setDraft] = useState<string | null>(null)

  return (
    <label className="field field--stacked">
      <span className="field__tag">Name</span>
      <input
        type="text"
        className="toolbox__input-name"
        value={draft ?? name}
        spellCheck={false}
        autoComplete="off"
        placeholder="Palette name"
        onBlur={() => {
          // Left blank: the rename was abandoned. This is where the derived
          // colour name comes back and the palette starts following its base
          // again — on the way out of the field, not under the caret.
          if (draft !== null && !claimsName(draft)) onRename('')
          setDraft(null)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
        }}
        onChange={(event) => {
          const value = event.target.value
          setDraft(value)
          if (claimsName(value)) onRename(value)
        }}
      />
    </label>
  )
}
