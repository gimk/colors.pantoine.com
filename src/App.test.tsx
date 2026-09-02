import css from './styles.css?raw'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { App } from './App'
import { createPalette, DEFAULT_STEPS } from './color/presets'
import { generateRamp } from './color/ramp'
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
