import { useEffect, useRef, useState } from 'react'
import { isInSrgb, type Gamut } from '../color/oklch'
import { buildText, TEXT_FORMATS } from '../export/formats'
import {
  copyRampsPng,
  downloadRampsPng,
  downloadRampsSvg,
  rampsSvg,
  SIZE_PRESETS,
  type ImageOptions,
} from '../export/image'
import { documentUrl } from '../state/url'
import type { PaletteView } from '../state/useDocument'
import { PalettePicker } from './PalettePicker'

type Props = {
  /** The whole document, in order: anything here can be exported. */
  palettes: PaletteView[]
  gamut: Gamut
  /** Travels in the link, so a reopened document keeps its steps behaviour. */
  stepsLocked: boolean
  /** Only so `renderToStaticMarkup` can see the body. */
  defaultOpen?: boolean
  /** Likewise: the picker is a click deep, so tests reach it by prop. */
  defaultActionId?: string
}

/** What one export does, once it knows which palettes it is acting on. */
type Action = {
  id: string
  label: string
  /** The confirm button in the picker step, and the verb in the note. */
  verb: 'Copy' | 'Download'
  group: 'image' | 'link' | 'text' | 'file'
  title?: string
  /** Trails the label in the list: the extension a text format would carry. */
  hint?: string
  /** Muted in the list: sRGB-only formats under a wider gamut. */
  lossy?: boolean
  /**
   * The palettes picked, in document order. Whole views rather than name and
   * ramp: the share link needs the configs, and two palettes are allowed to
   * end up carrying the same name, so nothing here may look one up by it.
   */
  run: (picked: PaletteView[]) => Promise<string> | string
}

const FEEDBACK_MS = 2600

/** Every format that can only say sRGB, whatever the document is designed for. */
const SRGB_ONLY = ['hex', 'css-hex', 'tailwind', 'scss']

async function writeText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // Blocked by an insecure origin or a denied permission. Nothing to
    // recover, but it must never be reported as a copy that happened.
    return false
  }
}

const countOf = (picked: { name: string }[]) =>
  picked.length === 1 ? picked[0].name : `${picked.length} palettes`

/**
 * Export, for as much of the document as you mean.
 *
 * It used to be a fourth panel in the toolbox, wedged between the curve
 * editors it has nothing to do with and fixed to their height, and it could
 * only ever export the one palette the toolbox was on. Both were wrong: a
 * hand-off is the document leaving the tool, not an edit to one ramp, so it
 * belongs in the top bar beside the other things that act on everything.
 *
 * Every action asks which palettes before it runs, on the same picker Apply
 * to uses. Everything is ticked when it opens, since export usually means
 * "all of this" — untick to narrow — and the picks survive from one action to
 * the next while the dialog is up, so copying a Tailwind scale and then a PNG
 * of the same three palettes does not mean choosing them twice.
 */
export function ExportDialog({
  palettes,
  gamut,
  stepsLocked,
  defaultOpen,
  defaultActionId,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const timer = useRef<number | undefined>(undefined)
  const [open, setOpen] = useState(defaultOpen ?? false)
  const [actionId, setActionId] = useState<string | null>(defaultActionId ?? null)
  const [picked, setPicked] = useState<string[]>(() => palettes.map((p) => p.id))
  const [note, setNote] = useState<string | null>(null)
  const [sizeId, setSizeId] = useState(SIZE_PRESETS[1].id)
  const [labels, setLabels] = useState(false)

  useEffect(() => () => window.clearTimeout(timer.current), [])

  useEffect(() => {
    if (defaultOpen) ref.current?.showModal?.()
  }, [defaultOpen])

  const size = SIZE_PRESETS.find((preset) => preset.id === sizeId) ?? SIZE_PRESETS[1]
  const options: ImageOptions = { size: size.size, labels }

  const say = (message: string) => {
    setNote(message)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setNote(null), FEEDBACK_MS)
  }

  /** A palette that cannot be reached in sRGB, in any of the ones offered. */
  const wide = gamut !== 'srgb' && palettes.some((p) => p.ramp.some((s) => !isInSrgb(s.oklch)))

  const actions: Action[] = [
    {
      id: 'copy-png',
      label: 'Copy PNG',
      verb: 'Copy',
      group: 'image',
      title: 'Paste onto a Figma canvas and eyedrop the steps',
      run: async (chosen) =>
        (await copyRampsPng(chosen, options))
          ? `PNG copied · ${countOf(chosen)}`
          : 'Clipboard blocked — use Download PNG',
    },
    {
      id: 'copy-svg',
      label: 'Copy SVG',
      verb: 'Copy',
      group: 'image',
      title: 'Paste into Figma as one named, editable rectangle per step',
      run: async (chosen) =>
        (await writeText(rampsSvg(chosen, options)))
          ? `SVG copied · ${countOf(chosen)}`
          : 'Clipboard blocked — use Download SVG',
    },
    {
      id: 'share',
      label: 'Share link',
      verb: 'Copy',
      group: 'link',
      title: 'A link that reopens the palettes you pick, with every curve intact',
      run: async (chosen) => {
        const seeds = chosen.map((palette) => ({
          config: palette.config,
          name: palette.name,
          nameCustom: palette.nameCustom,
        }))
        return (await writeText(documentUrl(seeds, gamut, stepsLocked)))
          ? `Link copied · ${countOf(chosen)}`
          : 'Clipboard blocked'
      },
    },
    ...TEXT_FORMATS.map((format): Action => ({
      id: format.id,
      label: format.label,
      verb: 'Copy',
      group: 'text',
      hint: `.${format.extension}`,
      lossy: wide && SRGB_ONLY.includes(format.id),
      title:
        wide && SRGB_ONLY.includes(format.id)
          ? `${format.label} is sRGB-only — wide-gamut colours will be mapped to sRGB`
          : undefined,
      run: async (chosen) =>
        (await writeText(buildText(format, chosen, gamut)))
          ? `${format.label} copied · ${countOf(chosen)}`
          : 'Clipboard blocked',
    })),
    {
      id: 'download-png',
      label: 'Download PNG',
      verb: 'Download',
      group: 'file',
      run: async (chosen) =>
        (await downloadRampsPng(chosen, options))
          ? `PNG saved · ${countOf(chosen)}`
          : 'The image could not be rendered',
    },
    {
      id: 'download-svg',
      label: 'Download SVG',
      verb: 'Download',
      group: 'file',
      run: (chosen) => {
        downloadRampsSvg(chosen, options)
        return `SVG saved · ${countOf(chosen)}`
      },
    },
  ]

  const action = actions.find((entry) => entry.id === actionId) ?? null

  /** In document order, whatever order they were ticked in. */
  const chosen = palettes.filter((palette) => picked.includes(palette.id))

  const start = () => {
    setNote(null)
    setPicked(palettes.map((palette) => palette.id))
    setActionId(null)
    setOpen(true)
    ref.current?.showModal()
  }

  const toggle = (id: string) =>
    setPicked((current) =>
      current.includes(id) ? current.filter((other) => other !== id) : [...current, id],
    )

  const run = async () => {
    if (!action || !chosen.length) return
    // Back to the list, with the answer under the header: exports come in
    // bunches — the same palettes into a stylesheet and then into Figma — and
    // closing on the first one would make the second start from scratch.
    const message = await action.run(chosen)
    setActionId(null)
    say(message)
  }

  const group = (id: Action['group']) => actions.filter((entry) => entry.group === id)

  const button = (entry: Action, className?: string) => (
    <button
      key={entry.id}
      type="button"
      className={[className, entry.lossy ? 'is-lossy' : ''].filter(Boolean).join(' ') || undefined}
      title={entry.title}
      onClick={() => {
        setNote(null)
        setActionId(entry.id)
      }}
    >
      {entry.label}
    </button>
  )

  return (
    <>
      <button
        type="button"
        onClick={start}
        title="Copy or download the palettes you pick — as text, as an image, or as a link"
      >
        Export
      </button>

      <dialog
        ref={ref}
        className="exportd"
        aria-labelledby="exportd-title"
        onClose={() => setOpen(false)}
        /* The dialog carries no padding, so the panel covers its whole box and
           a click landing on the dialog itself is a click on the backdrop. */
        onClick={(event) => {
          if (event.target === ref.current) ref.current?.close()
        }}
      >
        {open && (
          <div className="exportd__panel">
            <header className="panel__head">
              <span className="panel__title" id="exportd-title">
                {action ? action.label : 'Export'}
              </span>
              <span className="spacer" />
              {action && (
                <button type="button" onClick={() => setActionId(null)}>
                  Back
                </button>
              )}
              <button type="button" onClick={() => ref.current?.close()}>
                {action ? 'Cancel' : 'Close'}
              </button>
            </header>

            {note && <p className="exportd__note">{note}</p>}

            {action ? (
              /* The second step says what it is asking for, on the same strip
                 the sections use, with the select-all beside the question
                 rather than down in the footer among the commit buttons. */
              <section className="exportd__sect">
                <header className="exportd__head">
                  <span className="legend">Which palettes</span>
                  <span className="spacer" />
                  <button
                    type="button"
                    className="exportd__minor"
                    onClick={() =>
                      setPicked(
                        picked.length === palettes.length
                          ? []
                          : palettes.map((palette) => palette.id),
                      )
                    }
                  >
                    {picked.length === palettes.length ? 'Select none' : 'Select all'}
                  </button>
                </header>

                <div className="exportd__pick">
                  <PalettePicker targets={palettes} picked={picked} onToggle={toggle} />

                  <div className="plist__foot">
                    <span className="plist__count">
                      {picked.length === 0
                        ? 'Pick at least one palette'
                        : `${picked.length} of ${palettes.length} palette${palettes.length > 1 ? 's' : ''}`}
                    </span>
                    <button
                      type="button"
                      className="is-primary"
                      disabled={picked.length === 0}
                      onClick={run}
                    >
                      {action.verb}
                    </button>
                  </div>
                </div>
              </section>
            ) : (
              <div className="exportd__body">
                {/* Three sections, each under a strip of its own: grouped by
                    what comes out rather than by how often it is used, so
                    there is one place to look for a format you have not used
                    before. Within a section the two clipboard copies lead and
                    the file downloads follow, quieter — pasting is the common
                    hand-off, saving the occasional one. */}
                <section className="exportd__sect">
                  {/* Labels rides the strip rather than the button row: it is
                      a property of every image below it, and among the buttons
                      it read as a fifth thing you could click to export. */}
                  <header className="exportd__head">
                    <span className="legend">As an image</span>
                    <span className="spacer" />
                    <label className="field field--checkbox">
                      <input
                        type="checkbox"
                        checked={labels}
                        onChange={(event) => setLabels(event.target.checked)}
                      />
                      <span>Labels</span>
                    </label>
                  </header>

                  <div className="exportd__rows">
                    <div className="exportd__row">
                      {group('image').map((entry) => button(entry))}
                      <span className="spacer" />
                      <label className="field">
                        <span>Size</span>
                        <select value={sizeId} onChange={(event) => setSizeId(event.target.value)}>
                          {SIZE_PRESETS.map((preset) => (
                            <option key={preset.id} value={preset.id}>
                              {preset.label} · {preset.size}px
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <div className="exportd__row">
                      {group('file').map((entry) => button(entry, 'exportd__minor'))}
                      <span className="exportd__hint">
                        Saved at the size above, one band per palette
                      </span>
                    </div>
                  </div>
                </section>

                <section className="exportd__sect">
                  <header className="exportd__head">
                    <span className="legend">As text</span>
                  </header>

                  {/* A bordered list rather than a bag of chips: eight
                      same-shaped buttons wrapped across a row is a wall to
                      read, where one format per line with its extension at
                      the end can be scanned down. */}
                  <div className="exportd__formats">
                    {group('text').map((entry) => (
                      <button
                        key={entry.id}
                        type="button"
                        className={`exportd__format${entry.lossy ? ' is-lossy' : ''}`}
                        title={entry.title}
                        onClick={() => {
                          setNote(null)
                          setActionId(entry.id)
                        }}
                      >
                        <span>{entry.label}</span>
                        <span className="exportd__ext">{entry.hint}</span>
                      </button>
                    ))}
                  </div>
                </section>

                <section className="exportd__sect">
                  <header className="exportd__head">
                    <span className="legend">As a link</span>
                  </header>

                  <div className="exportd__rows">
                    <div className="exportd__row">
                      {group('link').map((entry) => button(entry))}
                      <span className="exportd__hint">
                        Reopens the palettes you pick, every curve intact
                      </span>
                    </div>
                  </div>
                </section>
              </div>
            )}
          </div>
        )}
      </dialog>
    </>
  )
}
