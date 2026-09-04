import css from '../styles.css?raw'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createPalette } from '../color/presets'
import { generateRamp } from '../color/ramp'
import type { PaletteView } from '../state/useDocument'
import { ApplyToDialog } from './ApplyToDialog'
import { CurvePanel } from './CurvePanel'

/** The first rule whose selector list ends with `selector`, as written. */
function declarations(selector: string) {
  for (const block of css.split('}')) {
    const open = block.indexOf('{')
    if (open < 0) continue
    if (block.slice(0, open).trim().endsWith(selector)) return block.slice(open + 1)
  }
  return ''
}

function view(id: string, name: string, base: string): PaletteView {
  const config = createPalette(base)
  return { id, name, config, ramp: generateRamp(config, 'srgb'), edited: false }
}

const accent = view('p2', 'accent', '#facc15')
const grey = view('p3', 'grey', '#64748b')

const open = renderToStaticMarkup(
  <ApplyToDialog channel="lightness" targets={[accent, grey]} onApply={() => {}} defaultOpen />,
)

const shut = renderToStaticMarkup(
  <ApplyToDialog channel="lightness" targets={[accent, grey]} onApply={() => {}} />,
)

describe('the apply-to dialog', () => {
  it('offers the trigger and nothing else until it is opened', () => {
    expect(shut).toContain('>Apply to<')
    // The body unmounts with the dialog, so a shut dialog cannot be tabbed into.
    expect(shut).not.toContain('applyto__panel')
  })

  it('names the channel being copied, so three identical panels stay distinct', () => {
    expect(open).toContain('Apply lightness to')
  })

  it('lists every other palette, with the ramp that says which one it is', () => {
    expect(open).toContain('>accent<')
    expect(open).toContain('>grey<')
    expect(open.match(/plist__row/g)?.length).toBeGreaterThanOrEqual(2)
    expect(open.match(/plist__chip/g)).toHaveLength(accent.ramp.length + grey.ramp.length)
  })

  it('opens with nothing picked, and cannot be applied until something is', () => {
    expect(open).not.toContain('is-picked')
    expect(open).toContain('aria-pressed="false"')
    expect(open).toContain('Pick the palettes to copy it to')
    const foot = open.slice(open.indexOf('plist__foot'))
    expect(foot).toContain('disabled')
  })

  it('goes dead when there is nothing to copy to', () => {
    const alone = renderToStaticMarkup(
      <ApplyToDialog channel="hue" targets={[]} onApply={() => {}} />,
    )
    expect(alone).toContain('disabled')
    expect(alone).toContain('Requires at least two palettes')
  })

  it('keeps the list on a class of its own, not the colour swatch button', () => {
    // `.picker` is the 26px square that opens the colour picker. A list
    // wearing that name renders as a 26px box with every row hidden inside
    // it — which is exactly how this list first shipped.
    expect(open).toContain('class="plist"')
    expect(open).not.toContain('class="picker"')
    const box = declarations('.plist')
    expect(box).toContain('max-height: 260px')
    expect(box).toContain('overflow-y: auto')
    expect(box).not.toContain('width: 26px')
  })

  it('keeps its rows clear of the chrome sizing they sit inside', () => {
    // The dialog opens from `.panel__actions`, whose 24px buttons would
    // otherwise apply to every row in the list.
    expect(declarations('.plist .plist__row')).toContain('height: auto')
  })

  it('washes the picked row rather than filling it, so the ramp survives', () => {
    const rule = declarations('button.plist__row.is-picked')
    expect(rule).toContain('background: var(--grid)')
    expect(rule).not.toContain('background: var(--ink)')
    expect(rule).toContain('color: var(--ink)')
  })
})

describe('a curve panel with more than one palette in the document', () => {
  const config = createPalette('#7c3aed')
  const panel = renderToStaticMarkup(
    <CurvePanel
      channelKey="lightness"
      curve={config.lightness}
      swatches={generateRamp(config, 'srgb')}
      canSync
      onSync={() => {}}
      syncTargets={[accent, grey]}
      onSyncTo={() => {}}
      onChange={() => {}}
      onEndpoint={() => {}}
      onReset={() => {}}
    />,
  )

  it('offers both ways to send the curve elsewhere', () => {
    expect(panel).toContain('>Apply to<')
    expect(panel).toContain('>Apply all<')
  })

  it('keeps Reset in the header, out of the row those two share', () => {
    const head = panel.slice(0, panel.indexOf('</header>'))
    expect(head).toContain('panel__reset')
    expect(head).not.toContain('Apply')
  })
})
