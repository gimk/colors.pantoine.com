import { useEffect, useMemo, useRef, useState } from 'react'
import { harmonyCandidates, hasUsableHue, HARMONIES, type Harmony } from '../color/harmony'
import {
  formatColor,
  gamutLabel,
  mapToGamut,
  parseColorList,
  type Gamut,
  type Oklch,
} from '../color/oklch'
import type { BaseSeed } from '../state/document'
import type { PaletteView } from '../state/useDocument'

type Props = {
  palettes: PaletteView[]
  /** Where the harmony pane starts: the palette the toolbox is on. */
  selected: PaletteView
  gamut: Gamut
  onAdd: (bases: BaseSeed[]) => void
  /** Only so `renderToStaticMarkup` can see the body. */
  defaultOpen?: boolean
  /** Likewise: there is no DOM in the tests, so the pane behind the toggle has
   *  to be reachable by prop rather than by a click. */
  defaultPane?: Pane
}

export type Pane = 'paste' | 'harmony'

/** The comparison view: every rule's candidates at once. */
const ALL_RULES = 'all'

/**
 * The guided way into a new palette.
 *
 * Adding a palette used to step the base hue by 72 degrees and say nothing
 * about it — a fair guess for a second ramp and a poor one for a fifth, where
 * the document ends up being the hue wheel walked in equal steps whatever the
 * brand actually is. Two things were missing: pasting colours somebody had
 * already decided on, and help choosing the next hue when they had not.
 *
 * Built on `HelpDialog`'s shape rather than the colour picker's. The picker
 * floats beside its trigger with a transparent backdrop because it previews
 * live edits behind itself; this is one decision that commits and closes, so it
 * is centred, the backdrop dims, and `showModal` supplies Escape, focus
 * trapping and an inert background. Escape and a backdrop click add nothing —
 * unlike the picker, there is no live commit to preserve.
 */
export function NewPaletteDialog({
  palettes,
  selected,
  gamut,
  onAdd,
  defaultOpen,
  defaultPane,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const [open, setOpen] = useState(defaultOpen ?? false)
  const [pane, setPane] = useState<Pane>(defaultPane ?? 'paste')
  const [pasted, setPasted] = useState('')
  const [rule, setRule] = useState<string>(ALL_RULES)
  const [seedKey, setSeedKey] = useState<string | null>(null)

  useEffect(() => {
    if (defaultOpen) ref.current?.showModal?.()
  }, [defaultOpen])

  const parsed = useMemo(() => parseColorList(pasted), [pasted])

  /** Every swatch in the document, as a pickable seed. */
  const sources = palettes.map((palette) => ({
    palette,
    swatches: palette.ramp.map((swatch) => ({ key: `${palette.id}-${swatch.index}`, swatch })),
  }))

  // Held as a key rather than a colour so the ring follows the swatch, and so
  // an edit behind the dialog is reflected rather than frozen at pick time.
  const activeKey = seedKey ?? `${selected.id}-${selected.config.baseIndex}`
  const seed: Oklch =
    sources.flatMap((source) => source.swatches).find((entry) => entry.key === activeKey)?.swatch
      .oklch ?? selected.ramp[selected.config.baseIndex].oklch

  const close = () => ref.current?.close()

  const add = (bases: BaseSeed[]) => {
    if (!bases.length) return
    onAdd(bases)
    setPasted('')
    close()
  }

  const rules: Harmony[] =
    rule === ALL_RULES ? HARMONIES : HARMONIES.filter((harmony) => harmony.id === rule)
  const ground = (color: Oklch) => ({ background: mapToGamut(color, gamut).displayColor })
  const count = parsed.colors.length

  return (
    <>
      <button
        type="button"
        className="is-primary"
        onClick={() => {
          setOpen(true)
          ref.current?.showModal()
        }}
        title="Paste colours, or build a palette from a colour harmony"
      >
        + New palette
      </button>

      <dialog
        ref={ref}
        className="newpal"
        aria-labelledby="newpal-title"
        onClose={() => setOpen(false)}
        /* The dialog carries no padding, so the panel covers its whole box and
           a click landing on the dialog itself is a click on the backdrop. */
        onClick={(event) => {
          if (event.target === ref.current) close()
        }}
      >
        {open && (
          <div className="newpal__panel">
            <header className="panel__head">
              <span className="panel__title" id="newpal-title">
                New palette
              </span>
              <span className="newpal__panes">
                <button
                  type="button"
                  className={pane === 'paste' ? 'is-on' : undefined}
                  aria-pressed={pane === 'paste'}
                  onClick={() => setPane('paste')}
                >
                  Paste
                </button>
                <button
                  type="button"
                  className={pane === 'harmony' ? 'is-on' : undefined}
                  aria-pressed={pane === 'harmony'}
                  onClick={() => setPane('harmony')}
                >
                  Harmony
                </button>
              </span>
              <span className="spacer" />
              <button type="button" onClick={close}>
                Cancel
              </button>
            </header>

            {pane === 'paste' ? (
              <div className="newpal__body">
                <label className="field field--stacked">
                  <span className="field__tag">Colours</span>
                  <textarea
                    className="newpal__paste"
                    value={pasted}
                    spellCheck={false}
                    autoComplete="off"
                    rows={4}
                    placeholder={'#ff5722\nrgb(30 136 229)\noklch(0.7 0.15 150)'}
                    onChange={(event) => setPasted(event.target.value)}
                  />
                </label>

                <p className="newpal__hint">
                  Any format CSS accepts — hex with or without the hash, rgb(), hsl(),
                  oklch(), a colour name. Separate them with newlines, commas,
                  semicolons or spaces. One palette is made per colour.
                </p>

                {/* Fixed height, and it has to be: the dialog is centred, so a
                    preview growing with every colour pasted would re-centre the
                    whole modal between keystrokes. */}
                <div className="newpal__scroll">
                  <div className="newpal__preview">
                    {parsed.colors.map((entry, index) => (
                      <span
                        key={`${entry.input}-${index}`}
                        className="newpal__cand"
                        style={ground(entry.oklch)}
                        title={entry.input}
                      />
                    ))}
                  </div>
                  {parsed.unrecognised.length > 0 && (
                    <p className="newpal__bad">Not a colour: {parsed.unrecognised.join(', ')}</p>
                  )}
                </div>

                <div className="newpal__foot">
                  <span className="newpal__count">
                    {count === 0
                      ? 'Nothing to add yet'
                      : `${count} colour${count > 1 ? 's' : ''} recognised`}
                  </span>
                  <button
                    type="button"
                    className="is-primary"
                    disabled={count === 0}
                    /* The pasted text goes through as the base, verbatim.
                       Re-emitting it as `oklch()` would round it: #00ff66 sits
                       on the sRGB boundary, and one decimal of lightness comes
                       back as #05ff66. A candidate has no original text and
                       must be formatted; this does, so it is left alone. */
                    onClick={() => add(parsed.colors.map((entry) => ({ base: entry.input })))}
                  >
                    {count > 1 ? `Add ${count} palettes` : 'Add palette'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="newpal__body">
                <div className="newpal__row">
                  <span className="legend">Source</span>
                  <span className="newpal__hint">Any colour already in the document</span>
                </div>

                <div className="newpal__sources">
                  {sources.map(({ palette, swatches }) => (
                    <div key={palette.id} className="newpal__source">
                      <span className="newpal__source-name">{palette.name}</span>
                      <span className="newpal__source-ramp">
                        {swatches.map(({ key, swatch }) => (
                          <button
                            key={key}
                            type="button"
                            className={`newpal__pick${key === activeKey ? ' is-picked' : ''}`}
                            style={ground(swatch.oklch)}
                            aria-pressed={key === activeKey}
                            title={`${palette.name} ${swatch.label} — ${swatch.hex}`}
                            onClick={() => setSeedKey(key)}
                          />
                        ))}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="newpal__row newpal__rules">
                  <span className="legend">Rule</span>
                  <button
                    type="button"
                    className={rule === ALL_RULES ? 'is-on' : undefined}
                    aria-pressed={rule === ALL_RULES}
                    title="Every rule at once, to compare"
                    onClick={() => setRule(ALL_RULES)}
                  >
                    All rules
                  </button>
                  {HARMONIES.map((harmony) => (
                    <button
                      key={harmony.id}
                      type="button"
                      className={rule === harmony.id ? 'is-on' : undefined}
                      aria-pressed={rule === harmony.id}
                      title={harmony.hint}
                      onClick={() => setRule(harmony.id)}
                    >
                      {harmony.label}
                    </button>
                  ))}
                </div>

                {/* Same fixed-height reason as the paste preview, and more
                    acute: "All rules" is eight times the height of one. */}
                <div className="newpal__scroll">
                  {!hasUsableHue(seed) && (
                    <p className="newpal__bad">
                      That swatch has no chroma to rotate, so every rule returns the same
                      grey. Pick a colour with some saturation in it.
                    </p>
                  )}
                  {rules.map((harmony) => {
                    const candidates = harmonyCandidates(seed, harmony, gamut)
                    return (
                      <div key={harmony.id} className="newpal__rule">
                        <span className="newpal__rule-name" title={harmony.hint}>
                          {harmony.label}
                        </span>
                        <span className="newpal__rule-ramp">
                          {/* The seed leads the row, marked and not clickable.
                              Without it Complementary reads as one lonely
                              swatch rather than the pair it actually is. */}
                          <span
                            className="newpal__cand newpal__cand--seed"
                            style={ground(seed)}
                            title="The colour you picked"
                          />
                          {candidates.map((candidate, index) => {
                            const offset = harmony.offsets[index]
                            return (
                              <button
                                key={`${harmony.id}-${index}`}
                                type="button"
                                className="newpal__cand"
                                style={ground(candidate)}
                                title={`${formatColor(candidate, 'hex')} — ${offset > 0 ? '+' : ''}${offset}° in ${gamutLabel(gamut)}`}
                                onClick={() =>
                                  add([
                                    {
                                      base: formatColor(candidate, 'oklch'),
                                      name:
                                        candidates.length > 1
                                          ? `${harmony.slug} ${index + 1}`
                                          : harmony.slug,
                                    },
                                  ])
                                }
                              />
                            )
                          })}
                        </span>
                      </div>
                    )
                  })}
                </div>

                <div className="newpal__foot">
                  <span className="newpal__count">
                    Click a swatch to make it the base of a new palette
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </dialog>
    </>
  )
}
