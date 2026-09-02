import { useState } from 'react'
import type { PaletteConfig } from '../color/presets'
import type { Swatch } from '../color/ramp'
import { TEXT_FORMATS } from '../export/formats'
import {
  copyPng,
  downloadPng,
  downloadSvg,
  SIZE_PRESETS,
  toSvg,
  type ImageOptions,
} from '../export/image'
import { shareUrl } from '../state/url'
import { useCopy } from './useCopy'

type Props = {
  ramp: Swatch[]
  config: PaletteConfig
  name: string
  onName: (name: string) => void
}

export function ExportPanel({ ramp, config, name, onName }: Props) {
  const { copy, copied } = useCopy()
  const [sizeId, setSizeId] = useState(SIZE_PRESETS[1].id)
  const [labels, setLabels] = useState(false)
  const [imageNote, setImageNote] = useState<string | null>(null)

  const size = SIZE_PRESETS.find((preset) => preset.id === sizeId) ?? SIZE_PRESETS[1]
  const options: ImageOptions = { size: size.size, labels }

  const announce = (message: string) => {
    setImageNote(message)
    window.setTimeout(() => setImageNote(null), 2000)
  }

  return (
    <section className="panel export">
      <header className="panel__head">
        <span className="panel__title">Export</span>
        <span className="panel__axis">{ramp.length} steps</span>
      </header>

      <div className="panel__row">
        <label className="field">
          <span>Name</span>
          <input
            type="text"
            value={name}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => onName(event.target.value)}
          />
        </label>
        <span className="spacer" />
        <button
          type="button"
          onClick={() => copy('share', shareUrl(config, name))}
          title="A link that reopens this palette with every curve intact"
        >
          {copied === 'share' ? 'Link copied' : 'Copy link'}
        </button>
      </div>

      <div className="export__group">
        <span className="legend">As text</span>
        <div className="export__buttons">
          {TEXT_FORMATS.map((format) => (
            <button
              key={format.id}
              type="button"
              onClick={() => copy(format.id, format.build(ramp, name))}
            >
              {copied === format.id ? 'Copied' : format.label}
            </button>
          ))}
        </div>
      </div>

      <div className="export__group">
        <span className="legend">As image</span>
        <div className="panel__row panel__row--flush">
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
          <label className="field">
            <input
              type="checkbox"
              checked={labels}
              onChange={(event) => setLabels(event.target.checked)}
            />
            <span>Labels</span>
          </label>
        </div>
        <div className="export__buttons">
          <button
            type="button"
            onClick={async () => {
              const ok = await copyPng(ramp, options)
              announce(ok ? 'PNG copied' : 'Clipboard blocked — use download')
            }}
            title="Paste onto a Figma canvas and eyedrop the steps"
          >
            Copy PNG
          </button>
          <button type="button" onClick={() => downloadPng(ramp, options, name)}>
            Download PNG
          </button>
          <button
            type="button"
            onClick={() => copy('svg', toSvg(ramp, options, name))}
            title="Paste into Figma as one named, editable rectangle per step"
          >
            {copied === 'svg' ? 'Copied' : 'Copy SVG'}
          </button>
          <button type="button" onClick={() => downloadSvg(ramp, options, name)}>
            Download SVG
          </button>
        </div>
        <p className="export__hint">
          {imageNote ??
            (labels
              ? 'Labels are baked in — turn them off if you plan to eyedrop this.'
              : 'Flat blocks, no gaps or rules, so a pipette always lands on a real step.')}
        </p>
      </div>
    </section>
  )
}
