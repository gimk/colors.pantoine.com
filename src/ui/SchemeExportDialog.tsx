import { useEffect, useRef, useState } from 'react'
import { isInSrgb, type Gamut } from '../color/oklch'
import type { Slot } from '../color/scheme'
import { buildText, TEXT_FORMATS } from '../export/formats'
import {
  copyRampsPng,
  downloadRampsPng,
  downloadRampsSvg,
  rampsSvg,
  SIZE_PRESETS,
} from '../export/image'
import { schemeRamp } from '../export/scheme'
import { useCopy } from './useCopy'

type Props = {
  slots: Slot[]
  gamut: Gamut
  /** Only so `renderToStaticMarkup` can see the body. */
  defaultOpen?: boolean
}

/**
 * Everything a scheme can leave the tool as.
 *
 * The editor's export panel asks which palettes to include and then how,
 * because a document can hold two dozen ramps. A scheme is one row, so that
 * whole first step disappears and this is the second half of that dialog on
 * its own — same shell, same section furniture, same formats, no picker.
 */
export function SchemeExportDialog({ slots, gamut, defaultOpen }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const [open, setOpen] = useState(defaultOpen ?? false)
  const [size, setSize] = useState(SIZE_PRESETS[1].size)
  const [labels, setLabels] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const { copy, copied, mark } = useCopy()

  useEffect(() => {
    if (defaultOpen) ref.current?.showModal?.()
  }, [defaultOpen])

  const palettes = [schemeRamp(slots, gamut)]
  const options = { size, labels }

  /** Written on every export, so a copy that silently failed still says so. */
  const say = (message: string) => setNote(message)

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true)
          setNote(null)
          ref.current?.showModal()
        }}
        title="Copy or download the scheme as text, an image, or vectors"
      >
        Export
      </button>

      <dialog
        ref={ref}
        className="exportd"
        aria-labelledby="schemex-title"
        onClose={() => setOpen(false)}
        onClick={(event) => {
          if (event.target === ref.current) ref.current?.close()
        }}
      >
        {open && (
          <div className="exportd__panel">
            <header className="panel__head">
              <span className="panel__title" id="schemex-title">
                Export scheme
              </span>
              <span className="spacer" />
              <button type="button" onClick={() => ref.current?.close()}>
                Close
              </button>
            </header>

            {note && <p className="exportd__note">{note}</p>}

            <div className="exportd__body">
              <section className="exportd__sect">
                <header className="exportd__head">
                  <span className="legend">As an image</span>
                  <span className="spacer" />
                  <label className="field field--checkbox">
                    <input
                      type="checkbox"
                      checked={labels}
                      onChange={(event) => setLabels(event.target.checked)}
                    />
                    <span>Bake labels</span>
                  </label>
                </header>

                <div className="exportd__rows">
                  <div className="exportd__row">
                    <span>PNG</span>
                    <span className="spacer" />
                    <label className="field">
                      <span>Size</span>
                      <select value={size} onChange={(event) => setSize(Number(event.target.value))}>
                        {SIZE_PRESETS.map((preset) => (
                          <option key={preset.id} value={preset.size}>
                            {preset.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      className={copied === 'png' ? 'is-on' : undefined}
                      onClick={async () => {
                        const ok = await copyRampsPng(palettes, options)
                        if (ok) mark('png')
                        say(ok ? 'PNG copied' : 'The clipboard refused the image — download it instead')
                      }}
                    >
                      Copy
                    </button>
                    <button
                      type="button"
                      className="exportd__minor"
                      onClick={async () => {
                        const ok = await downloadRampsPng(palettes, options)
                        say(ok ? 'PNG downloaded' : 'Could not render the PNG')
                      }}
                    >
                      Download
                    </button>
                  </div>

                  <div className="exportd__row">
                    <span>SVG</span>
                    <span className="exportd__hint">
                      One named rectangle per colour, grouped
                    </span>
                    <span className="spacer" />
                    <button
                      type="button"
                      className={copied === 'svg' ? 'is-on' : undefined}
                      onClick={() => {
                        copy('svg', rampsSvg(palettes, options))
                        say('SVG copied')
                      }}
                    >
                      Copy
                    </button>
                    <button
                      type="button"
                      className="exportd__minor"
                      onClick={() => {
                        downloadRampsSvg(palettes, options)
                        say('SVG downloaded')
                      }}
                    >
                      Download
                    </button>
                  </div>
                </div>
              </section>

              <section className="exportd__sect">
                <header className="exportd__head">
                  <span className="legend">As text</span>
                  <span className="spacer" />
                  <span className="exportd__hint">Colours numbered in scheme order</span>
                </header>

                <div className="exportd__formats">
                  {TEXT_FORMATS.map((format) => {
                    // sRGB-only under a wider gamut: still offered, because a
                    // hex list of a P3 scheme is a useful approximation, but
                    // never without saying that is what it is.
                    const lossy =
                      gamut !== 'srgb' &&
                      (format.id === 'hex' || format.id.endsWith('-hex')) &&
                      slots.some((slot) => !isInSrgb(slot.color))
                    return (
                      <button
                        key={format.id}
                        type="button"
                        className={`exportd__format${lossy ? ' is-lossy' : ''}${
                          copied === format.id ? ' is-on' : ''
                        }`}
                        title={
                          lossy
                            ? 'Some colours are outside sRGB — this format writes the nearest sRGB rendition'
                            : undefined
                        }
                        onClick={() => {
                          copy(format.id, buildText(format, palettes, gamut))
                          say(`${format.label} copied`)
                        }}
                      >
                        {format.label}
                        <span className="exportd__ext">.{format.extension}</span>
                      </button>
                    )
                  })}
                </div>
              </section>
            </div>
          </div>
        )}
      </dialog>
    </>
  )
}
