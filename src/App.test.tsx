import css from './styles.css?raw'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { App } from './App'
import { createPalette, DEFAULT_STEPS } from './color/presets'
import { generateRamp } from './color/ramp'
import { PaletteRow } from './ui/PaletteRow'
import { RampStrip } from './ui/RampStrip'

/**
 * A render smoke test. It will not catch layout problems, but it does catch
 * the things that break a first paint — a bad hook order, a null deref while
 * parsing the base colour, a missing prop — without pulling in a DOM.
 */
describe('App', () => {
  const html = renderToStaticMarkup(<App />)

  it('renders one swatch per step', () => {
    expect(html.match(/class="swatch"/g)).toHaveLength(DEFAULT_STEPS)
  })

  it('renders a graph for each of the three channels', () => {
    expect(html.match(/class="graph"/g)).toHaveLength(3)
    for (const label of ['Lightness', 'Chroma', 'Hue shift']) {
      expect(html).toContain(label)
    }
  })

  it('says which colour space it is working in', () => {
    expect(html).toContain('OKLCH')
    expect(html).toContain('OKLCH L')
    expect(html).toContain('OKLCH C')
  })

  it('marks the base step', () => {
    expect(html.match(/class="swatch__base"/g)).toHaveLength(1)
  })

  it('offers a base position for every step, and a lock', () => {
    const select = html.match(/Base at<\/span>.*?<\/select>/s)?.[0] ?? ''
    expect(select.match(/<option /g)).toHaveLength(DEFAULT_STEPS)
    expect(html).toContain('Lock base')
    expect(html).toContain('aria-pressed="false"')
  })

  it('offers a gamut dropdown with sRGB, Display P3, Adobe RGB, and Rec. 2020', () => {
    const select = html.match(/Gamut<\/span>.*?<\/select>/s)?.[0] ?? ''
    expect(select).toContain('sRGB')
    expect(select).toContain('Display P3')
    expect(select).toContain('Adobe RGB')
    expect(select).toContain('Rec. 2020')
  })

  it('offers a global steps input in the header', () => {
    const controls = html.slice(html.indexOf('class="controls"'), html.indexOf('class="stack"'))
    expect(controls).toContain('<span>Steps</span>')
    expect(controls).toContain(`value="${DEFAULT_STEPS}"`)
  })

  it('does not warn about squeezed steps on the default ramp', () => {
    expect(html).not.toContain('class="notice"')
  })

  it('shows the dividers by default and offers to hide them', () => {
    expect(html).toContain('class="ramp"')
    expect(html).not.toContain('ramp--seamless')
    expect(html).toContain('Hide dividers')
  })

  it('paints the default ramp with real colours, not placeholders', () => {
    const fills = html.match(/background:#[0-9a-f]{6}/g) ?? []
    expect(fills.length).toBe(DEFAULT_STEPS)
    expect(new Set(fills).size).toBe(DEFAULT_STEPS)
  })
})

describe('RampStrip', () => {
  const ramp = generateRamp(createPalette('#7c3aed'))
  const render = (seamless: boolean) =>
    renderToStaticMarkup(
      <RampStrip
        ramp={ramp}
        format="hex"
        copiedKey={null}
        seamless={seamless}
        onCopy={() => {}}
      />,
    )

  it('drops the rules around the chips only when asked', () => {
    expect(render(false)).toContain('class="ramp"')
    expect(render(true)).toContain('class="ramp ramp--seamless"')
  })

  it('keeps every swatch and its label either way', () => {
    for (const seamless of [false, true]) {
      const html = render(seamless)
      expect(html.match(/class="swatch"/g)).toHaveLength(ramp.length)
      for (const swatch of ramp) {
        expect(html).toContain(swatch.hex)
        expect(html).toContain(`>${swatch.label}<`)
      }
    }
  })
})

/** The declarations of the first rule whose selector list ends in `selector`. */
function declarations(selector: string) {
  for (const block of css.split('}')) {
    const open = block.indexOf('{')
    if (open < 0) continue
    if (block.slice(0, open).trim().endsWith(selector)) return block.slice(open + 1)
  }
  return ''
}

/**
 * The swatch borders are a cascade problem, not a render one: the base
 * `button` rule paints a 1px box, so a swatch that does not reset it keeps a
 * contour around the colour whatever the seamless class removes. No markup
 * test can see that, so assert it against the stylesheet.
 */
describe('swatch borders', () => {
  it('resets the border the base button rule would paint', () => {
    expect(declarations('select')).toContain('border: 1px solid var(--rule)')
    expect(declarations('.swatch')).toContain('border: none')
  })

  it('keeps the chip rules on the chip, where seamless can reach them', () => {
    expect(declarations('.swatch__chip')).toContain('border: 1px solid var(--rule)')
    expect(declarations('.ramp--seamless .swatch:last-child .swatch__chip')).toContain(
      'border-color: transparent',
    )
  })
})

/**
 * The squeeze warning is shown and hidden by curve drags. In flow it reflowed
 * everything under it on every frame of a gesture, which moved the graph being
 * dragged. That is a layout property, so it is asserted here.
 */
describe('squeeze warning', () => {
  const rule = declarations('.notice')

  it('floats, so appearing mid-drag cannot reflow the page', () => {
    expect(rule).toContain('position: fixed')
    expect(rule).toContain('pointer-events: none')
  })

  it('is opaque, since it sits over the ramp', () => {
    expect(rule).toContain('background: var(--paper)')
  })
})

describe('the palette stack', () => {
  const html = renderToStaticMarkup(<App />)

  it('opens with one palette and one toolbox under it', () => {
    expect(html.match(/class="prow[ "]/g)).toHaveLength(1)
    expect(html.match(/class="toolbox"/g)).toHaveLength(1)
  })

  it('offers document-level actions in the top bar', () => {
    expect(html).toContain('New palette')
    expect(html).toContain('Hide tools')
    expect(html).toContain('Hide dividers')
  })

  it('keeps the base settings in the toolbox, not the top bar', () => {
    // They belong to a palette, not the document: with a stack of ramps, a
    // base field far from the one it drives would be ambiguous.
    const bar = html.slice(html.indexOf('class="controls"'), html.indexOf('class="stack"'))
    for (const control of ['Base at', 'Lock base', 'Re-derive']) {
      expect(bar).not.toContain(control)
      expect(html).toContain(control)
    }
    expect(html).toContain('Match all curves')
    expect(html).toContain('Apply all')
  })

  it('says that palettes are saved and that a link carries all of them', () => {
    expect(html).toContain('saved in this browser')
  })
})

describe('PaletteRow', () => {
  const config = createPalette('#7c3aed')
  const view = {
    id: 'p1',
    name: 'brand',
    config,
    ramp: generateRamp(config),
    edited: false,
  }

  const render = (over: Partial<Parameters<typeof PaletteRow>[0]> = {}) =>
    renderToStaticMarkup(
      <PaletteRow
        palette={view}
        index={0}
        count={2}
        selected={false}
        format="hex"
        seamless={false}
        bare={false}
        copiedKey={null}
        onSelect={() => {}}
        onRemove={() => {}}
        onMove={() => {}}
        onCopy={() => {}}
        {...over}
      />,
    )

  it('offers Edit only on the palettes that are not being edited', () => {
    expect(render()).toContain('>Edit</button>')
    expect(render({ selected: true })).not.toContain('>Edit</button>')
  })

  it('marks the selected palette without moving anything', () => {
    expect(render({ selected: true })).toContain('prow prow--selected')
    expect(render()).toContain('class="prow"')
  })

  it('will not reorder off the ends of the stack', () => {
    const first = render({ index: 0, count: 3 })
    expect(first).toMatch(/disabled[^>]*>Up</)
    expect(first).not.toMatch(/disabled[^>]*>Down</)
    const last = render({ index: 2, count: 3 })
    expect(last).toMatch(/disabled[^>]*>Down</)
    expect(last).not.toMatch(/disabled[^>]*>Up</)
  })

  it('will not delete the only palette there is', () => {
    expect(render({ count: 1 })).toMatch(/disabled[^>]*>Delete</)
    expect(render({ count: 2 })).not.toMatch(/disabled[^>]*>Delete</)
  })

  it('puts every tool away in bare mode, keeping the colours', () => {
    const bare = render({ bare: true })
    expect(bare).not.toContain('prow__head')
    for (const tool of ['Edit', 'Delete', 'Up', 'Down']) {
      expect(bare).not.toContain(`>${tool}</button>`)
    }
    expect(bare.match(/class="swatch"/g)).toHaveLength(view.ramp.length)
  })
})

/**
 * Selecting a palette must not move it. The marker swaps colours on a name
 * that is padded either way, so the ramp underneath cannot shift as the
 * selection travels down the stack.
 */
describe('selection marker', () => {
  it('changes colour only, never geometry', () => {
    expect(declarations('.prow__name')).toContain('padding:')
    const marked = declarations('.prow--selected .prow__name')
    expect(marked).toContain('background: var(--ink)')
    for (const property of ['padding', 'margin', 'border', 'font-size']) {
      expect(marked).not.toContain(property)
    }
  })
})

describe('undo and redo', () => {
  const html = renderToStaticMarkup(<App />)

  it('offers both, greyed out until there is something to step through', () => {
    const bar = html.slice(html.indexOf('class="controls"'), html.indexOf('class="stack"'))
    for (const label of ['Undo', 'Redo']) {
      expect(bar).toMatch(new RegExp(`disabled[^>]*>\s*${label}`))
    }
  })

  it('names the shortcut, since that is how it will actually be used', () => {
    expect(html).toContain('Ctrl+Z')
    expect(html).toContain('Ctrl+Shift+Z')
  })
})
