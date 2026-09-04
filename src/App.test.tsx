import css from './styles.css?raw'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { App } from './App'
import { createPalette, DEFAULT_STEPS } from './color/presets'
import { chromaCeilingProfile, generateRamp } from './color/ramp'
import { MAX_PALETTES } from './state/document'
import { useDocument } from './state/useDocument'
import type { ReviewApi, ReviewAxis } from './state/useReview'
import { CurvePanel } from './ui/CurvePanel'
import { ExportDialog } from './ui/ExportDialog'
import { PaletteRow } from './ui/PaletteRow'
import { RampStrip } from './ui/RampStrip'
import { ReviewBoard } from './ui/ReviewBoard'
import { Toolbox } from './ui/Toolbox'

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
    const select = html.match(/Base position<\/span>.*?<\/select>/s)?.[0] ?? ''
    expect(select.match(/<option /g)).toHaveLength(DEFAULT_STEPS)
    expect(html).toContain('Lock base')
    expect(html).toContain('aria-pressed="false"')
  })

  it('numbers the base positions from one, not by token name', () => {
    // The step labels are derived from lightness and renumber as the ramp is
    // dragged; a position says where on the ramp the base sits.
    const select = html.match(/Base position<\/span>.*?<\/select>/s)?.[0] ?? ''
    const options = [...select.matchAll(/<option[^>]*value="(\d+)"[^>]*>([^<]*)</g)]
    expect(options).toHaveLength(DEFAULT_STEPS)
    options.forEach(([, value, text], index) => {
      // The value stays the config's zero-based index; only the text counts up.
      expect(Number(value)).toBe(index)
      expect(text).toBe(String(index + 1))
    })
  })

  it('offers a gamut dropdown with sRGB, Display P3, Adobe RGB, Rec. 2020, and OKLab', () => {
    const select = html.match(/Gamut<\/span>.*?<\/select>/s)?.[0] ?? ''
    expect(select).toContain('sRGB')
    expect(select).toContain('Display P3')
    expect(select).toContain('Adobe RGB')
    expect(select).toContain('Rec. 2020')
    expect(select).toContain('OKLab')
  })

  /**
   * Steps belongs to the document, not to a palette: every ramp shares the
   * count. So it sits in the top bar with the other document controls, and
   * exactly once — two fields driving one value invite the reading that the
   * palette under the toolbox has a count of its own.
   */
  it('offers a global steps input and lock toggle in the header', () => {
    const controls = html.slice(html.indexOf('class="controls"'), html.indexOf('class="stack"'))
    expect(controls).toContain('<span>Steps</span>')
    expect(controls).toContain(`value="${DEFAULT_STEPS}"`)
    expect(controls).toContain('class="controls__steps"')
    expect(controls).toContain('class="controls__btn-lock is-locked"')
    expect(controls).toContain('Unlock steps per palette')
    expect(controls.match(/<span>Steps<\/span>/g)).toHaveLength(1)
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

  /**
   * The editor is where a ramp is read, so it is always labelled. The two
   * toggles that used to strip it — `Hide labels` and `Hide tools` — between
   * them put the editor into four states, and only one of them was ever
   * wanted: tools away, labels off. That state is the review board.
   */
  it('always shows the colour labels, and sends stripping them to Review', () => {
    expect(html.match(/class="swatch__meta"/g)).toHaveLength(DEFAULT_STEPS)
    expect(html).not.toContain('Hide labels')
    expect(html).not.toContain('Hide tools')
    expect(html).toContain('>Review</button>')
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
    // Scoped to the chips: the picker's own swatch and preview are painted
    // the same way, and counting every fill on the page would tally those.
    const fills =
      html.match(/class="swatch__chip" style="background:#[0-9a-f]{6}/g) ?? []
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

  it('greys out unavailable swatch values in wide gamuts when format is hex', () => {
    const p3Config = createPalette('oklch(70% 0.32 145)', 9, 'p3')
    const p3Ramp = generateRamp(p3Config, 'p3')
    const htmlP3 = renderToStaticMarkup(
      <RampStrip ramp={p3Ramp} format="hex" gamut="p3" copiedKey={null} onCopy={() => {}} />,
    )
    expect(htmlP3).toContain('swatch__value--unavailable')
  })

  it('does not grey out values in wide gamuts when format is oklch or color()', () => {
    const p3Config = createPalette('oklch(70% 0.32 145)', 9, 'p3')
    const p3Ramp = generateRamp(p3Config, 'p3')
    const htmlOklch = renderToStaticMarkup(
      <RampStrip ramp={p3Ramp} format="oklch" gamut="p3" copiedKey={null} onCopy={() => {}} />,
    )
    expect(htmlOklch).not.toContain('swatch__value--unavailable')
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
 * A hand-off is the document leaving the tool, not an edit to one ramp, so
 * export answers to the whole stack from the top bar. It used to be a fourth
 * panel in the toolbox, beside curve editors it has nothing to do with and
 * able to export only the palette the toolbox was on.
 */
describe('the export dialog', () => {
  const html = renderToStaticMarkup(<App />)
  const controls = html.slice(html.indexOf('class="controls"'), html.indexOf('class="stack"'))

  const asView = (id: string, name: string, base: string) => {
    const config = createPalette(base)
    return { id, name, config, ramp: generateRamp(config, 'srgb'), edited: false }
  }
  const brand = asView('p1', 'brand', '#7c3aed')
  const accent = asView('p2', 'accent', '#facc15')

  const list = renderToStaticMarkup(
    <ExportDialog palettes={[brand, accent]} gamut="srgb" stepsLocked defaultOpen />,
  )
  const picking = renderToStaticMarkup(
    <ExportDialog
      palettes={[brand, accent]}
      gamut="srgb"
      stepsLocked
      defaultOpen
      defaultActionId="hex"
    />,
  )

  it('rides the top bar next to the canvas toggle, not the toolbox', () => {
    expect(controls).toContain('>Export<')
    expect(controls.indexOf('Dark canvas')).toBeLessThan(controls.indexOf('>Export<'))
    expect(html).not.toContain('class="panel export"')
  })

  it('offers the trigger and nothing else until it is opened', () => {
    const shut = renderToStaticMarkup(
      <ExportDialog palettes={[brand, accent]} gamut="srgb" stepsLocked />,
    )
    expect(shut).toContain('>Export<')
    expect(shut).not.toContain('exportd__body')
  })

  it('groups every format by what comes out of it', () => {
    for (const label of [
      'Copy PNG',
      'Copy SVG',
      'Download PNG',
      'Download SVG',
      'Share link',
      'Hex list',
      'Tailwind scale',
      '<span>Labels</span>',
    ]) {
      expect(list).toContain(label)
    }
    for (const legend of ['As an image', 'As text', 'As a link']) {
      expect(list).toContain(legend)
    }
  })

  /**
   * Three headings on strips of their own, so the sections can be found
   * before any of the buttons in them are read.
   */
  it('gives each section a strip of its own', () => {
    expect(list.match(/class="exportd__head"/g)).toHaveLength(3)
    const strip = declarations('.exportd__head')
    expect(strip).toContain('background: var(--grid)')
    expect(strip).toContain('border-bottom: 1px solid var(--rule)')
  })

  /**
   * Eight identical chips wrapped across a row is a wall to read. One format
   * per line, with the extension it would carry at the end of it, can be
   * scanned down — and answers which of the three CSS ones is wanted.
   */
  it('lists the text formats one to a line, with their extensions', () => {
    expect(list.match(/class="exportd__format(?: [^"]*)?"/g)).toHaveLength(8)
    for (const ext of ['.txt', '.css', '.js', '.scss', '.json']) {
      expect(list).toContain(`class="exportd__ext">${ext}<`)
    }
  })

  /** Pasting is the common hand-off; saving a file is the occasional one. */
  it('leads with the two copies and keeps the downloads quieter', () => {
    const image = list.slice(list.indexOf('As an image'), list.indexOf('As text'))
    expect(image.indexOf('Copy PNG')).toBeLessThan(image.indexOf('Download PNG'))
    expect(image).toMatch(/class="exportd__minor"[^>]*>Download PNG/)
    expect(declarations('.exportd__minor')).toContain('color: var(--muted)')
  })

  it('asks which palettes once a format is chosen, with every one ticked', () => {
    expect(picking).toContain('Hex list')
    expect(picking).toContain('Which palettes')
    expect(picking).toContain('class="plist"')
    expect(picking.match(/aria-pressed="true"/g)).toHaveLength(2)
    expect(picking).toContain('2 of 2 palettes')
    // The shortcut rides the strip; the footer is left to the commit.
    expect(picking).toContain('Select none')
    // The confirm button says what it will do, and Back returns to the list.
    expect(picking).toContain('>Copy<')
    expect(picking).toContain('>Back<')
  })

  it('shows the format list rather than a picker until then', () => {
    expect(list).not.toContain('class="plist"')
    expect(list).not.toContain('>Back<')
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
    // Matched on the class, not on every viewBox: the picker draws two of
    // its own, and its slice is deliberately near-square.
    const boxes = html.match(/class="graph" viewBox="0 0 (\d+) (\d+)"/g) ?? []
    expect(boxes).toHaveLength(3)
    for (const box of boxes) {
      const [, w, h] = box.match(/viewBox="0 0 (\d+) (\d+)"/)!
      expect(Number(w)).toBeGreaterThan(Number(h))
    }
  })

  it('fills the width it is given', () => {
    expect(declarations('.graph')).toContain('width: 100%')
  })

  it('is sized 20% taller (height 228) for comfortable curve editing', () => {
    const boxes = html.match(/class="graph" viewBox="0 0 (\d+) (\d+)"/g) ?? []
    expect(boxes).toHaveLength(3)
    for (const box of boxes) {
      const [, , h] = box.match(/viewBox="0 0 (\d+) (\d+)"/)!
      expect(Number(h)).toBe(228)
    }
  })
})

/**
 * The second ground, pulled back from pure white on pure black: every rule in
 * this UI borders a colour the eye is trying to judge, and at full contrast
 * the frame competed with the palette.
 */
describe('the dark canvas', () => {
  const rule = declarations(":root[data-canvas='dark']")

  it('is an off-white on a true black ground, not #fff on #000', () => {
    expect(rule).toMatch(/--ink:\s*#e6e6e8/)
    expect(rule).toMatch(/--paper:\s*#000000/)
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
    expect(html).toContain('>Review</button>')
    expect(html).toContain('Dark canvas')
  })

  it('keeps the base settings in the toolbox, not the top bar', () => {
    // They belong to a palette, not the document: with a stack of ramps, a
    // base field far from the one it drives would be ambiguous.
    const bar = html.slice(html.indexOf('class="controls"'), html.indexOf('class="stack"'))
    for (const control of ['Base position', 'Lock base', 'Re-derive']) {
      expect(bar).not.toContain(control)
      expect(html).toContain(control)
    }
    expect(html).toContain('Apply all')
  })

  it('says that palettes are saved and that a link carries all of them', () => {
    expect(html).toContain('saved in this browser')
  })

  /**
   * The system picker is sRGB hex and nothing else, so on a wide-gamut
   * document it cannot express the colour being designed for — and it says
   * nothing about where the chroma runs out.
   */
  it('picks the base in OKLCH rather than handing it to the system picker', () => {
    expect(html).not.toContain('type="color"')
    expect(html).toContain('class="picker"')
    expect(html).toContain('aria-label="Pick base colour"')
  })

  /**
   * A closed `<dialog>` renders its children all the same, and the slice is
   * some six hundred rects — not worth paying for at mount on a panel a
   * session may never open. So the dialog is mounted and empty.
   */
  it('builds no slice until the picker is asked for', () => {
    expect(html).toContain('<dialog class="cdialog"')
    expect(html).not.toMatch(/<dialog class="cdialog"[^>]*\bopen\b/)
    expect(html).not.toContain('cpick__plot')
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

    it('sets the clipped corner indicator color to black or white based on contrast', () => {
      const active = render({ palette: vivid, selected: true })
      expect(active).toMatch(/class="swatch__clipped"[^>]*border-top-color:\s*(?:#000000|#ffffff)/)
    })

    it('leaves the other palettes as colour alone', () => {
      const row = render({ palette: vivid })
      expect(row).not.toContain('class="swatch__base"')
      expect(row).not.toContain('class="swatch__clipped"')
    })

    it('always displays the steps field in the palette header, disabled when locked', () => {
      const locked = render({ stepsLocked: true })
      expect(locked).toContain('class="number prow__input-steps"')
      expect(locked).toMatch(/class="number prow__input-steps"[^>]*disabled/)

      const unlocked = render({ stepsLocked: false, onStepsChange: () => {} })
      expect(unlocked).toContain('class="number prow__input-steps"')
      expect(unlocked).not.toMatch(/class="number prow__input-steps"[^>]*disabled/)
    })

    it('shows only base color in prow__note, avoiding duplicate steps text', () => {
      const row = render()
      expect(row).toContain('class="prow__note"')
      expect(row).not.toContain('steps ·')
    })
  })

  it('provides a drag handle for reordering palettes', () => {
    const row = render()
    expect(row).toContain('class="prow__handle"')
    expect(row).toContain('draggable="true"')
    expect(row).toContain('title="Drag to reorder palette"')
  })

  it('carries a duplicate button and a separate one for the PNG copy', () => {
    const row = render({ onDuplicate: () => {} })
    expect(row).toContain('aria-label="Duplicate palette"')
    expect(row).toContain('aria-label="Copy palette as PNG"')
    // Two icon buttons, each with an icon of its own: the two-sheets glyph
    // duplicates, and the picture copies the PNG.
    expect(row.match(/class="prow__btn-icon"/g)).toHaveLength(2)
    expect(row).not.toMatch(/aria-label="Duplicate palette"[^>]*disabled/)
  })

  it('stops offering to duplicate once the document is full', () => {
    const row = render({ count: MAX_PALETTES, onDuplicate: () => {} })
    expect(row).toMatch(/disabled[^>]*aria-label="Duplicate palette"/)
  })

  it('will not delete the only palette there is', () => {
    expect(render({ count: 1 })).toMatch(/disabled[^>]*>Delete</)
    expect(render({ count: 2 })).not.toMatch(/disabled[^>]*>Delete</)
  })

  /**
   * The editor row always carries its header and its labels now. Putting the
   * tools away is no longer a state this component can be in — it is the
   * review board, a mode of its own, which is what lets it also carry a
   * layout rather than only an absence.
   */
  it('always carries its header, its handle and its labels', () => {
    const row = render()
    expect(row).toContain('prow__head')
    expect(row).toContain('class="prow__handle"')
    expect(row.match(/class="swatch__meta"/g)).toHaveLength(view.ramp.length)
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

  it('keeps the palette stack positioned above the sticky toolbox dock', () => {
    expect(declarations('.toolbox')).toContain('position: sticky')
    expect(declarations('.toolbox')).toContain('bottom: 0')
    expect(declarations('.stack')).toContain('display: flex')
    expect(declarations('.stack')).toContain('flex-direction: column')
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

describe('UI standardization and menu separation', () => {
  const html = renderToStaticMarkup(<App />)

  it('defines design tokens for spacing and typography in :root', () => {
    const root = declarations(':root')
    expect(root).toContain('--space-1')
    expect(root).toContain('--space-9')
    expect(root).toContain('--text-base')
  })

  it('separates controls into distinct groups with brutalist vertical dividers', () => {
    const controls = html.slice(html.indexOf('class="controls"'), html.indexOf('class="stack"'))
    expect(controls).toContain('class="controls__group"')
    expect(controls).toContain('class="divider"')
  })

  it('groups toolbox attributes and actions into a full-width primary cluster', () => {
    const toolbox = html.slice(html.indexOf('class="toolbox"'))
    expect(toolbox).toContain('class="toolbox__primary"')
    expect(toolbox).toContain('toolbox__btn-rederive')
    expect(declarations('.toolbox__primary')).toContain('width: 100%')
  })

  it('provides a vertical resizer handle on the toolbox to scale curves and export', () => {
    const toolbox = html.slice(html.indexOf('class="toolbox"'))
    expect(toolbox).toContain('class="toolbox__resizer"')
    expect(toolbox).toContain('class="toolbox__resizer-grip"')
    expect(declarations('.toolbox__resizer')).toContain('cursor: ns-resize')
  })

  it('renders per-palette steps input in toolbox when steps are unlocked', () => {
    const config = createPalette('#0044ff', 9)
    const mockDoc: any = {
      selected: {
        id: 'p1',
        name: 'brand',
        config,
        ramp: generateRamp(config, 'srgb'),
        edited: false,
      },
      palettes: [],
      gamut: 'srgb',
      stepsLocked: false,
      setBase: () => {},
      setGamut: () => {},
      setBaseIndex: () => {},
      setBaseLocked: () => {},
      setPaletteSteps: () => {},
      rederive: () => {},
      rename: () => {},
    }
    const markup = renderToStaticMarkup(<Toolbox doc={mockDoc} />)
    expect(markup).toContain('class="number toolbox__input-steps"')
    expect(markup).toContain('value="9"')
  })

  it('provides toggle hover states for buttons', () => {
    expect(declarations('button.is-on:hover:not(:disabled)')).toContain('background: var(--paper)')
  })
})


describe('the gamut ceiling in the rendered page', () => {
  const config = createPalette('#00ff66', 11, 'rec2020')
  const markup = renderToStaticMarkup(
    <CurvePanel
      channelKey="chroma"
      curve={config.chroma}
      swatches={generateRamp(config, 'srgb')}
      ceiling={chromaCeilingProfile(config, 'srgb')}
      onChange={() => {}}
      onEndpoint={() => {}}
      onReset={() => {}}
    />,
  )

  it('draws the boundary and hatches the region above it', () => {
    expect(markup).toContain('graph__ceiling')
    expect(markup).toContain('graph__ceiling-fill')
    expect(markup).toContain('graph__hatch')
  })

  const plain = renderToStaticMarkup(
    <CurvePanel
      channelKey="lightness"
      curve={config.lightness}
      swatches={generateRamp(config, 'srgb')}
      onChange={() => {}}
      onEndpoint={() => {}}
      onReset={() => {}}
    />,
  )

  it('leaves the header exactly as the other channels have it', () => {
    // The ceiling belongs to the graph. Compared rather than merely inspected
    // for chrome, so anything the chroma header grows has to be grown by every
    // channel — the two differ by the channel's own name and axis, and nothing
    // else.
    const head = (rendered: string) =>
      rendered
        .slice(0, rendered.indexOf('</header>'))
        .replace(/<span class="panel__title">[^<]*<\/span>/, '')
        .replace(/<span class="panel__axis">[^<]*<\/span>/, '')

    expect(markup).toContain('OKLCH C')
    expect(head(markup)).toBe(head(plain))
  })

  it('draws no ceiling on a channel that has none', () => {
    expect(plain).not.toContain('graph__ceiling')
  })

  it('gives the chroma graph the page’s only ceiling', () => {
    const page = renderToStaticMarkup(<App />)
    expect(page.match(/graph__ceiling"/g)).toHaveLength(1)
  })
})

describe('chroma dots sit where the colour actually landed', () => {
  const config = createPalette('#00ff66', 11, 'rec2020')
  const ramp = generateRamp(config, 'srgb')

  const panel = (channelKey: 'chroma' | 'lightness') =>
    renderToStaticMarkup(
      <CurvePanel
        channelKey={channelKey}
        curve={config[channelKey]}
        swatches={ramp}
        ceiling={channelKey === 'chroma' ? chromaCeilingProfile(config, 'srgb') : undefined}
        onChange={() => {}}
        onEndpoint={() => {}}
        onReset={() => {}}
      />,
    )

  it('draws a leader from the curve to every clipped step', () => {
    const clipped = ramp.filter((swatch) => swatch.clipped).length
    expect(clipped).toBeGreaterThan(0)
    expect(panel('chroma').match(/graph__drop/g)).toHaveLength(clipped)
  })

  it('says what was asked for and what was got', () => {
    expect(panel('chroma')).toMatch(/asked [\d.]+, got [\d.]+/)
  })

  it('leaves dots on the curve for channels the mapping cannot move', () => {
    expect(panel('lightness')).not.toContain('graph__drop')
  })
})

describe('the way into a new palette', () => {
  const page = renderToStaticMarkup(<App />)

  it('leads with the dialog and keeps the hue step as a shortcut', () => {
    const controls = page.slice(page.indexOf('class="controls"'))
    const bar = controls.slice(0, controls.indexOf('class="divider"'))
    expect(bar).toContain('+ New palette')
    expect(bar).toContain('+ Quick add')
    // Filled solid, still the one control here that adds rather than adjusts.
    expect(bar.indexOf('is-primary')).toBeLessThan(bar.indexOf('+ Quick add'))
  })

  it('keeps the dialog body out of the page until it is opened', () => {
    expect(page).toContain('class="newpal"')
    expect(page).not.toContain('newpal__panel')
  })
})

/**
 * The review board: the whole document at once, laid out to be judged as a
 * set rather than edited.
 *
 * It replaced a `Hide labels` and a `Hide tools` toggle. Between them those
 * two could put the editor into four states and only one was ever wanted —
 * tools away, labels off — and as a mode of its own that state can also carry
 * a layout, which a pair of toggles could not.
 */
describe('the review board', () => {
  const bases = ['#7c3aed', '#0ea5e9', '#f59e0b']
  const seeds = bases.map((base, index) => ({
    name: `p${index}`,
    config: createPalette(base),
  }))

  /**
   * The layout is handed in rather than driven through the hook, so an axis
   * can just be stated. `useReview` has its own tests for the arithmetic;
   * what is being rendered here is the board it produces.
   */
  const layoutOf = (axis: ReviewAxis, steps: number, labels = true): ReviewApi => ({
    layout: { axis, gap: 12, paletteWeights: {}, stepWeights: [], labels },
    steps: Array.from({ length: steps }, () => 1),
    setAxis: () => {},
    setGap: () => {},
    setLabels: () => {},
    weightOf: () => 1,
    resizePalettes: () => {},
    resizeSteps: () => {},
    reset: () => {},
  })

  /** A host only for the document, which does have to come from its hook. */
  function Board({ axis, labels = true }: { axis: ReviewAxis; labels?: boolean }) {
    const doc = useDocument({ seeds, selected: 0 })
    return (
      <ReviewBoard
        doc={doc}
        review={layoutOf(axis, doc.selected.config.steps, labels)}
        format="hex"
        onFormat={() => {}}
        gamut="srgb"
        dark={false}
        onDark={() => {}}
        onExit={() => {}}
        copiedKey={null}
        onCopy={() => {}}
      />
    )
  }

  const rows = renderToStaticMarkup(<Board axis="rows" />)
  const columns = renderToStaticMarkup(<Board axis="columns" />)
  const unlabelled = renderToStaticMarkup(<Board axis="rows" labels={false} />)

  it('shows every palette at once', () => {
    expect(rows.match(/class="rband"/g)).toHaveLength(bases.length)
    expect(rows.match(/class="swatch"/g)).toHaveLength(bases.length * DEFAULT_STEPS)
    expect(rows).not.toContain('class="toolbox"')
    expect(rows).not.toContain('class="prow')
  })

  /**
   * The editor's label cell is a bordered grid row under the chip. On a board
   * of filling chips that would eat the colour and put back the very rows the
   * board exists to be rid of, so the value and color number are stamped on the chip
   * instead — subtle and unboxed, with white or black text depending on contrast.
   */
  it('stamps the value on each chip, in the format in force', () => {
    expect(rows).not.toContain('swatch__meta')
    expect(rows.match(/class="swatch__stamp"/g)).toHaveLength(bases.length * DEFAULT_STEPS)
    expect(rows).toContain('>#7c3aed<')
    expect(rows).toContain('>50<')
    expect(rows).toContain('class="swatch__stamp-contrast"')
    expect(rows).toMatch(/W \d+(\.\d+)? · B \d+(\.\d+)?/)
    const stamp = declarations('.swatch__stamp')
    expect(stamp).toContain('position: absolute')
    expect(stamp).toContain('background: none')
    // A value is read and compared, not captioned: tracking out a hex makes
    // two of them harder to tell apart, so the stamp is neither spaced nor
    // uppercased — unlike every other boxed mark in this UI.
    expect(stamp).not.toContain('text-transform')
  })

  it('leaves nothing but colour with the labels off', () => {
    expect(unlabelled).not.toContain('swatch__stamp')
    expect(unlabelled).not.toContain('rband__name')
    expect(unlabelled).not.toContain('swatch__meta')
    expect(unlabelled.match(/class="swatch"/g)).toHaveLength(bases.length * DEFAULT_STEPS)
  })

  /**
   * What a chip reads as and what clicking it copies are one setting, driven
   * from the board's own select. Showing a hex while copying an `oklch()` is
   * a trap, and two settings for one idea is how you arrive at it.
   */
  it('drives the labels and the copies off one format', () => {
    expect(rows).toContain('<span>Format</span>')
    expect(rows.match(/<span>Format<\/span>/g)).toHaveLength(1)
    expect(rows).toContain('title="Copy #7c3aed"')
  })

  /**
   * The base badge and the clipping notch ride the selection in the editor,
   * and on a board of every ramp at once there is no selection to ride —
   * they would be thirty-odd marks competing with the colours.
   */
  it('carries no annotations on the chips', () => {
    expect(rows).not.toContain('swatch__base')
    expect(rows).not.toContain('swatch__clipped')
  })

  it('keeps the page title and a way back, and little else', () => {
    expect(rows).toContain('<h1>colors.pantoine.com — review</h1>')
    expect(rows).toContain('← Back')
    for (const tool of ['Re-derive', 'Lock base', 'Apply all', 'Undo']) {
      expect(rows).not.toContain(tool)
    }
  })

  /**
   * Sizes are shares, never lengths. A band's size is exactly its fraction of
   * the axis, which is what makes the board fit the window by construction
   * rather than by clamping something against the viewport — and it is the
   * assumption the ruler ticks and the board PNG are both drawn from.
   */
  it('sizes the board in shares, so it cannot be arranged out of the window', () => {
    expect(declarations('.review')).toContain('overflow: hidden')
    expect(declarations('.review')).toContain('100dvh')
    const band = declarations('.rband')
    expect(band).toContain('flex-basis: 0')
    expect(rows).toContain('flex-grow:1')
  })

  /**
   * One tick per internal boundary and no more: a ruler tick either divides
   * two tracks or has nothing to divide.
   */
  it('puts a resize tick on every boundary, on both axes', () => {
    const ticks = rows.match(/class="review__tick"/g) ?? []
    expect(ticks).toHaveLength(bases.length - 1 + (DEFAULT_STEPS - 1))
  })

  /**
   * Resizing lives on the rulers rather than on the boundaries themselves.
   * A grip laid over the chips would put a strip that cannot be copied either
   * side of every boundary, in the one mode that is nothing but chips.
   */
  it('keeps the resize grips off the colour', () => {
    const rail = rows.slice(rows.indexOf('review__ruler'), rows.indexOf('review__bands'))
    expect(rail).toContain('review__tick')
    expect(rail).not.toContain('class="swatch"')
  })

  it('swaps which ruler divides which axis with the layout', () => {
    expect(rows).toContain('review__ruler--palette review__ruler--down')
    expect(rows).toContain('review__ruler--step review__ruler--across')
    expect(columns).toContain('review__ruler--palette review__ruler--across')
    expect(columns).toContain('review__ruler--step review__ruler--down')
  })

  it('turns the ramps on their side for the column layout', () => {
    expect(rows).toContain('class="ramp ramp--fill"')
    expect(columns).toContain('class="ramp ramp--vertical ramp--fill"')
    expect(declarations('.ramp--vertical')).toContain('flex-direction: column')
  })

  /**
   * The band itself drags, not only its name badge, so switching the labels
   * off does not take reordering away with them. Resizing is on the rulers,
   * so nothing competes for the gesture, and a native drag stays distinct
   * from a click — a chip still copies.
   */
  it('lets a palette be dragged whether or not it is named', () => {
    expect(rows.match(/class="rband" style="flex-grow:1" draggable="true"/g)).toHaveLength(
      bases.length,
    )
    expect(unlabelled.match(/draggable="true"/g)).toHaveLength(bases.length)
  })

  it('names each palette with subtle unboxed text', () => {
    expect(rows.match(/class="rband__name"/g)).toHaveLength(bases.length)
    // Subtle unboxed text in white or black depending on the underlying swatch contrast.
    expect(declarations('.rband__name')).toContain('background: none')
  })

  /**
   * The same two gestures the export panel leads with — paste as pixels, or
   * as layers — on the whole board rather than one ramp.
   */
  it('offers the board as pixels and as layers', () => {
    expect(rows).toContain('>Copy PNG</button>')
    expect(rows).toContain('>Copy SVG</button>')
  })
})
