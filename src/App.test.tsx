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

  /**
   * Steps belongs to the document, not to a palette: every ramp shares the
   * count. So it sits in the top bar with the other document controls, and
   * exactly once — two fields driving one value invite the reading that the
   * palette under the toolbox has a count of its own.
   */
  it('offers a global steps input in the header, and only there', () => {
    const controls = html.slice(html.indexOf('class="controls"'), html.indexOf('class="stack"'))
    expect(controls).toContain('<span>Steps</span>')
    expect(controls).toContain(`value="${DEFAULT_STEPS}"`)
    expect(html.match(/<span>Steps<\/span>/g)).toHaveLength(1)
  })

  /**
   * A number input's own sanitiser drops a comma decimal, and clearing it
   * reads back as 0 — which clamped the whole document to the minimum step
   * count in the middle of retyping it.
   */
  it('takes every numeric value through a text field, not a number input', () => {
    expect(html).not.toContain('type="number"')
  })

  it('does not warn about squeezed steps on the default ramp', () => {
    expect(html).not.toContain('class="notice"')
  })

  /**
   * A 1px line changes how the eye reads the two colours it separates, which
   * is the judgement this tool exists to support. The steps meet edge to
   * edge, permanently — there is no toggle because there is no other option
   * worth offering.
   */
  it('lets the steps meet edge to edge, with nothing between them', () => {
    expect(html).toContain('class="ramp"')
    expect(html).not.toContain('Hide dividers')
    expect(declarations('.swatch__chip')).not.toContain('border')
  })

  it('shows the colour labels by default and offers to hide them', () => {
    expect(html.match(/class="swatch__meta"/g)).toHaveLength(DEFAULT_STEPS)
    expect(html).toContain('Hide labels')
  })

  /**
   * The one control in the bar that adds to the document rather than
   * adjusting it, so it leads and it is filled.
   */
  it('leads the bar with New palette, filled', () => {
    const bar = html.slice(html.indexOf('class="controls"'), html.indexOf('class="stack"'))
    expect(bar).toContain('class="is-primary"')
    expect(bar.indexOf('New palette')).toBeLessThan(bar.indexOf('Undo'))
    expect(declarations('button.is-primary')).toContain('background: var(--ink)')
  })

  it('paints the default ramp with real colours, not placeholders', () => {
    const fills = html.match(/background:#[0-9a-f]{6}/g) ?? []
    expect(fills.length).toBe(DEFAULT_STEPS)
    expect(new Set(fills).size).toBe(DEFAULT_STEPS)
  })
})

describe('RampStrip', () => {
  const ramp = generateRamp(createPalette('#7c3aed'))
  const render = () =>
    renderToStaticMarkup(
      <RampStrip ramp={ramp} format="hex" copiedKey={null} onCopy={() => {}} />,
    )

  it('keeps every swatch and its label', () => {
    const html = render()
    expect(html.match(/class="swatch"/g)).toHaveLength(ramp.length)
    for (const swatch of ramp) {
      expect(html).toContain(swatch.hex)
      expect(html).toContain(`>${swatch.label}<`)
    }
  })

  /**
   * With the labels away the chips are all that is left, which is the point —
   * but the label cell is also where a copy is acknowledged, so the
   * acknowledgement has to move onto the chip rather than disappear.
   */
  describe('with the labels hidden', () => {
    const stripped = renderToStaticMarkup(
      <RampStrip
        ramp={ramp}
        format="hex"
        labels={false}
        copiedKey="swatch-3"
        onCopy={() => {}}
      />,
    )

    it('drops the label cells and keeps every chip', () => {
      expect(stripped).not.toContain('swatch__meta')
      expect(stripped.match(/class="swatch__chip"/g)).toHaveLength(ramp.length)
    })

    it('still says when a swatch has been copied', () => {
      expect(stripped.match(/class="swatch__flash"/g)).toHaveLength(1)
      const flash = declarations('.swatch__flash')
      expect(flash).toContain('position: absolute')
      // Boxed, so the word lands legibly on a step of any lightness.
      expect(flash).toContain('background: var(--ink)')
    })
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
 * Almost every hand-off is one of two gestures: paste the ramp into Figma as
 * pixels, or as layers. Those stay in the open with the one option that
 * changes what they produce; the eight text formats and the file downloads
 * are each right for one situation and wrong for the rest, so they fold away.
 */
describe('the export panel', () => {
  const html = renderToStaticMarkup(<App />)
  const panel = html.slice(html.indexOf('class="panel export"'))
  const front = panel.slice(0, panel.indexOf('<details'))

  it('keeps the two copies and the labels toggle in front', () => {
    for (const control of ['Copy PNG', 'Copy SVG', '<span>Labels</span>']) {
      expect(front).toContain(control)
    }
  })

  it('folds every other export into one drawer, shut', () => {
    expect(panel.match(/<details/g)).toHaveLength(1)
    const drawer = panel.slice(panel.indexOf('<details'))
    // Shut: a <details> with no `open` attribute.
    expect(drawer.slice(0, drawer.indexOf('>'))).not.toContain('open')
    for (const label of ['Copy link', 'Hex list', 'Tailwind scale', 'Download PNG', 'Download SVG']) {
      expect(drawer).toContain(label)
      expect(front).not.toContain(label)
    }
  })

  /**
   * Size is in the drawer but still governs the copies in front, so the
   * drawer says so rather than leaving a hidden setting to be discovered.
   */
  it('says that the hidden size still applies to the copies', () => {
    expect(panel).toContain('Size applies to the copies above')
  })

  /**
   * Opening the drawer used to grow the grid row, which pushed the dock
   * taller and stretched the three curve panels beside it over empty space.
   */
  it('scrolls the drawer rather than growing the dock', () => {
    expect(panel).toContain('class="drawer__body"')
    const body = declarations('.drawer__body')
    expect(body).toContain('overflow-y: auto')
    expect(body).toContain('min-height: 0')
    expect(declarations('.export')).toContain('max-height')
  })
})

/**
 * The explanatory copy used to sit under the palettes as a grey paragraph,
 * where it was read once and then became furniture at the foot of every
 * session. It lives behind a question mark now, and the page is left to the
 * colours.
 */
describe('the help dialog', () => {
  const html = renderToStaticMarkup(<App />)
  const dialog = html.slice(html.indexOf('<dialog'), html.indexOf('</dialog>'))
  const page =
    html.slice(0, html.indexOf('<dialog')) +
    html.slice(html.indexOf('</dialog>') + '</dialog>'.length)

  it('offers a question mark at the top right', () => {
    const masthead = page.slice(0, page.indexOf('class="controls"'))
    expect(masthead).toContain('class="help__open"')
    expect(masthead).toContain('>?<')
  })

  it('leaves no explanatory grey anywhere on the page', () => {
    expect(page).not.toContain('class="footnote"')
    expect(declarations('.footnote')).toBe('')
    for (const line of [
      'perceptually even',
      'Click a swatch to copy it',
      'notched corner',
      'saved in this browser',
    ]) {
      expect(page).not.toContain(line)
    }
  })

  it('keeps every word of it in the dialog, shut until asked for', () => {
    // A <dialog> with no `open` attribute: present in the markup, inert.
    expect(dialog.slice(0, dialog.indexOf('>'))).not.toContain('open')
    for (const line of [
      'perceptually even',
      'Click a swatch to copy it',
      'notched corner',
      'saved in this browser',
    ]) {
      expect(dialog).toContain(line)
    }
  })

  it('names the gamut the clipping notch is relative to', () => {
    expect(dialog).toContain('sRGB')
  })
})

/**
 * The two bars that frame the work. Both stay put: undo and the step count
 * are wanted at any scroll position, and so are the curves — the stack can be
 * many palettes long, and reaching a control should never cost a scroll.
 */
describe('the sticky frame', () => {
  const html = renderToStaticMarkup(<App />)

  it('pins the controls to the top of the window, opaquely', () => {
    const rule = declarations('.controls')
    expect(rule).toContain('position: sticky')
    expect(rule).toContain('top: 0')
    // Or the ramps would read straight through it.
    expect(rule).toContain('background: var(--paper)')
  })

  it('docks the toolbox to the foot of the window, opaquely', () => {
    const rule = declarations('.toolbox')
    expect(rule).toContain('position: sticky')
    expect(rule).toContain('bottom: 0')
    expect(rule).toContain('background: var(--paper)')
  })

  /**
   * `position: sticky` pins against the containing block, so the dock has to
   * come after the palettes it floats over — and the horizontal toolbox no
   * longer trails the selection down the stack.
   */
  it('puts the dock after the stack, not inside it', () => {
    expect(html.indexOf('class="stack"')).toBeLessThan(html.indexOf('class="toolbox"'))
    expect(html).not.toContain('stack__item')
  })

  /** A fixed-height dock on a short window would leave nothing for the ramps. */
  it('caps the height of the dock rather than fixing it', () => {
    const rule = declarations('.toolbox')
    expect(rule).toContain('max-height')
    expect(rule).toContain('overflow-y: auto')
  })

  it('takes the full width of the window', () => {
    expect(declarations('.app')).toContain('max-width: none')
  })

  /**
   * `position: sticky` only has somewhere to stick while its container runs
   * past the foot of the window. With a short stack the shell ended above the
   * fold and the dock came to rest mid-screen over a band of bare body.
   */
  it('fills the window, so the dock is flush with its foot at any length', () => {
    const shell = declarations('.app')
    expect(shell).toContain('min-height: 100vh')
    expect(shell).toContain('flex-direction: column')
    // The stack takes the slack, not the dock.
    expect(declarations('.stack')).toContain('flex: 1')
  })
})

/**
 * The graph measures itself in real pixels — one user unit per pixel — so it
 * spreads into whatever width the dock gives it at a fixed height. A portrait
 * viewBox scaled to a full-width column came out taller than the dock.
 */
describe('the curve graphs', () => {
  const html = renderToStaticMarkup(<App />)

  it('is wider than it is tall, and sized in real pixels', () => {
    const boxes = html.match(/viewBox="0 0 (\d+) (\d+)"/g) ?? []
    expect(boxes).toHaveLength(3)
    for (const box of boxes) {
      const [, w, h] = box.match(/viewBox="0 0 (\d+) (\d+)"/)!
      expect(Number(w)).toBeGreaterThan(Number(h))
    }
  })

  it('fills the width it is given', () => {
    expect(declarations('.graph')).toContain('width: 100%')
  })
})

/**
 * The second ground, pulled back from pure white on pure black: every rule in
 * this UI borders a colour the eye is trying to judge, and at full contrast
 * the frame competed with the palette.
 */
describe('the dark canvas', () => {
  const rule = declarations(":root[data-canvas='dark']")

  it('is an off-white on a soft near-black, not #fff on #000', () => {
    expect(rule).toMatch(/--ink:\s*#e6e6e8/)
    expect(rule).toMatch(/--paper:\s*#17171a/)
    expect(rule).not.toMatch(/#fff\b/)
  })

  it('keeps the rules a clear step below the text', () => {
    expect(rule).toMatch(/--rule:\s*#7a7a82/)
  })
})

/**
 * The swatch borders are a cascade problem, not a render one: the base
 * `button` rule paints a 1px box, so a swatch that does not reset it keeps a
 * contour around every colour. No markup test can see that, so assert it
 * against the stylesheet.
 */
describe('swatch borders', () => {
  it('resets the border the base button rule would paint', () => {
    expect(declarations('select')).toContain('border: 1px solid var(--rule)')
    expect(declarations('.swatch')).toContain('border: none')
  })

  it('leaves no rule of its own around a chip', () => {
    expect(declarations('.swatch__chip')).not.toContain('border')
    expect(css).not.toContain('ramp--seamless')
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
    expect(html).toContain('Hide labels')
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

  /**
   * Three signals, because one small inversion was read as a styling choice
   * rather than a status: the gutter bar, the inverted name, and the state in
   * words. Only the palette the dock is editing carries them.
   */
  it('says which palette the tools are editing, in words', () => {
    expect(render({ selected: true })).toContain('>Editing<')
    expect(render()).not.toContain('>Editing<')
    expect(render({ selected: true })).toContain('aria-current="true"')
  })

  it('drops the marker with the tools, since nothing is being edited', () => {
    const bare = render({ selected: true, bare: true })
    expect(bare).not.toContain('>Editing<')
    expect(bare).not.toContain('prow--selected')
  })

  /**
   * The base badge and the clipping notch answer questions you only ask of
   * the palette you are shaping. On every ramp at once they were thirty-odd
   * marks competing with the colours.
   */
  describe('swatch annotations', () => {
    const clipped = createPalette('#00ff66')
    const vivid = {
      ...view,
      config: clipped,
      ramp: generateRamp({
        ...clipped,
        chroma: { start: 0.3, end: 0.3, h1: { x: 1 / 3, y: 0.3 }, h2: { x: 2 / 3, y: 0.3 } },
      }),
    }

    it('marks the base step and the clipped steps on the selected palette', () => {
      const active = render({ palette: vivid, selected: true })
      expect(active).toContain('class="swatch__base"')
      expect(active).toContain('class="swatch__clipped"')
    })

    it('leaves the other palettes as colour alone', () => {
      for (const row of [render({ palette: vivid }), render({ palette: vivid, bare: true })]) {
        expect(row).not.toContain('class="swatch__base"')
        expect(row).not.toContain('class="swatch__clipped"')
      }
    })
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
  /**
   * A contour around the whole row, as an outline rather than a border.
   *
   * That settles both problems the earlier markers had at once. An outline is
   * painted outside the box model, so it cannot move the ramp as the
   * selection travels down the stack and needs no reserved space on the rows
   * without it; and the offset holds it clear of the end chips, so no colour
   * gains a black neighbour.
   */
  it('costs no layout, so nothing moves as the selection travels', () => {
    const marked = declarations('.prow--selected')
    expect(marked).toContain('outline: 2px solid var(--ink)')
    for (const property of ['padding', 'margin', 'border', 'width', 'height', 'background']) {
      expect(marked).not.toContain(property)
    }
  })

  it('holds the contour off the colours', () => {
    expect(declarations('.prow--selected')).toMatch(/outline-offset:\s*[1-9]/)
  })

  /** Small enough that the name beside it still sets the header's height. */
  it('keeps the badge under the name it sits beside', () => {
    expect(declarations('.prow__badge')).toContain('font-size: 9px')
  })

  /** The band and the gutter bar are gone: the contour is the whole marker. */
  it('leaves no trace of the heavier markers it replaced', () => {
    expect(css).not.toContain('.prow--selected::before')
    expect(css).not.toContain('.prow--selected .prow__head')
  })

  /**
   * Nor a rule under the header: the contour already bounds the row, so a
   * line there was a second edge inside that boundary.
   */
  it('draws no line between the header and the ramp', () => {
    expect(declarations('.prow__head')).not.toContain('border')
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
