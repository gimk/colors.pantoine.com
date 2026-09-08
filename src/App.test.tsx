import css from './styles.css?raw'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { App } from './App'
import {
  formatColor,
  isInGamut,
  mapToGamut,
  parseToOklch,
  toHex,
  type Gamut,
  type Oklch,
} from './color/oklch'
import { MAX_SLOTS, type Slot } from './color/scheme'
import { schemeReducer, type SchemeState } from './state/scheme'
import { buildText, TEXT_FORMATS } from './export/formats'
import { schemeRamp } from './export/scheme'
import type { SchemeApi } from './state/useScheme'
import { SchemeBoard, spaceRolls, type KeyContext } from './ui/SchemeBoard'
import { SchemeExportDialog } from './ui/SchemeExportDialog'
import { ModeSwitch } from './ui/ModeSwitch'
import { emitted, ShadePicker, SHADE_STEPS } from './ui/ShadePicker'
import { createPalette, DEFAULT_STEPS } from './color/presets'
import { chromaCeilingProfile, generateRamp } from './color/ramp'
import { MAX_PALETTES } from './state/document'
import { encodeDocument } from './state/url'
import { useDocument } from './state/useDocument'
import { simulate, type Vision } from './color/vision'
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
    expect(declarations('button.is-primary')).toContain('background-color: var(--ink)')
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
 * spreads into whatever box the panel gives it. A portrait viewBox scaled to
 * a full-width column came out taller than the dock; a viewBox that named a
 * height the panel did not give letterboxed the plot inside its own frame.
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

  /**
   * Both directions, and the height by flexing rather than by aspect ratio:
   * the rows above the graph are one line tall at some panel widths and two
   * at others, so a graph sized from a constant left a band of dead paper
   * under the plot at the widths where they fitted on one.
   */
  it('fills the box it is given, in both directions', () => {
    const graph = declarations('.graph')
    expect(graph).toContain('width: 100%')
    expect(graph).toContain('flex: 1')
    // Shrinkable, but never to nothing.
    expect(graph).toMatch(/min-height: 1\d\dpx/)
    expect(declarations('.panel')).toContain('flex-direction: column')
  })

  it('asks for 228 before it has been measured', () => {
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

  it('will delete the only palette there is, leaving the document empty', () => {
    // It used to refuse, which left people holding a palette they could not be
    // rid of. The empty document is a real state with its own way back in.
    expect(render({ count: 1 })).not.toMatch(/disabled[^>]*>Delete</)
    expect(render({ count: 2 })).not.toMatch(/disabled[^>]*>Delete</)
    expect(render({ count: 1 })).toContain('leaving the document empty')
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
    const markup = renderToStaticMarkup(<Toolbox doc={mockDoc} selected={mockDoc.selected} />)
    expect(markup).toContain('class="number toolbox__input-steps"')
    expect(markup).toContain('value="9"')
  })

  /**
   * Hover paints a bar and leaves the fill alone, everywhere.
   *
   * It used to invert, which ran in opposite directions depending on where a
   * button started — a paper one filled, a solid one emptied — so two side by
   * side read as two different gestures, and a hovered primary was
   * indistinguishable from a resting ordinary button.
   */
  it('gives every button the same hover, whatever it is resting on', () => {
    const base = declarations('button')
    expect(base).toContain('background-image: linear-gradient(currentColor, currentColor)')
    expect(base).toContain('background-size: 0% 2px')
    expect(declarations('button:focus-visible:not(:disabled)')).toContain(
      'background-size: 100% 2px',
    )
  })

  it('leaves the resting fill alone on hover, so state and hover stay distinct', () => {
    const hover = declarations('button:focus-visible:not(:disabled)')
    expect(hover).not.toContain('color:')
    expect(hover).not.toContain('background-color:')
    // Nothing inverts any more: the solid states have no hover rule of their own.
    expect(css).not.toContain('button.is-on:hover')
    expect(css).not.toContain('button.is-primary:hover')
  })

  it('sets fills with background-color, or the bar would be wiped out', () => {
    // `background` shorthand resets background-image, which is the bar.
    for (const rule of ['button.is-primary', 'button.is-on', '.controls__btn-lock']) {
      expect(declarations(rule)).not.toContain('background: var(')
    }
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
  function Board({
    axis,
    labels = true,
    vision = 'normal',
  }: {
    axis: ReviewAxis
    labels?: boolean
    vision?: Vision
  }) {
    const doc = useDocument({ seeds, selected: 0 })
    return (
      <ReviewBoard
        doc={doc}
        review={layoutOf(axis, doc.selected!.config.steps, labels)}
        format="hex"
        onFormat={() => {}}
        gamut="srgb"
        vision={vision}
        onVision={() => {}}
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
  const grey = renderToStaticMarkup(<Board axis="rows" vision="grayscale" />)

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

  /**
   * The board can be looked through somebody else's eyes: grey, to catch two
   * steps that only hue was separating, or one of the dichromacies. It paints
   * the chips and nothing else — a simulation answers "does this survive",
   * never "what should this be", so the value on a chip and what clicking it
   * copies stay the colour the document holds.
   */
  it('repaints the chips for the eye being checked, and nothing else', () => {
    expect(rows).toContain('<span>Vision</span>')
    expect(rows).toContain('>Deuteranopia</option>')

    // Mapped for the document's gamut like any other colour, which on an
    // sRGB document is a hex.
    const base = toHex(simulate(parseToOklch('#7c3aed')!, 'grayscale'))
    expect(base).not.toBe('#7c3aed')
    expect(grey).toContain(`background:${base}`)
    expect(rows).toContain('background:#7c3aed')
    expect(grey).not.toContain('background:#7c3aed')

    // The colours are still the document's: the stamp reads the real hex,
    // and so does the copy behind it.
    expect(grey).toContain('>#7c3aed<')
    expect(grey).toContain('title="Copy #7c3aed"')
  })

  /** A board that has stopped showing the true colours says so in the bar. */
  it('marks the control while a simulation is on', () => {
    expect(rows).not.toContain('field--simulating')
    expect(grey).toContain('field--simulating')
    expect(declarations('.field--simulating select')).toContain('background: var(--ink)')
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

/**
 * The scheme board, on a fabricated api.
 *
 * The state comes from a hook and the hook needs no DOM, but the board's
 * behaviour is keyboard and pointer, none of which `renderToStaticMarkup`
 * can reach. What is left worth checking is what it paints: a bar per colour,
 * the ink it chose to write on them, and that a locked slot says so.
 */
describe('scheme board', () => {
  const colors: Oklch[] = [
    { l: 0.94, c: 0.03, h: 80 },
    { l: 0.72, c: 0.13, h: 200 },
    { l: 0.5, c: 0.18, h: 320 },
    { l: 0.24, c: 0.07, h: 20 },
  ]

  const slotsOf = (locked: number[] = []): Slot[] =>
    colors.map((color, index) => ({
      id: `s${index}`,
      color,
      locked: locked.includes(index),
    }))

  const apiOf = (slots: Slot[]): SchemeApi => ({
    slots: slots.map((slot) => {
      const mapped = mapToGamut(slot.color, 'srgb')
      return {
        id: slot.id,
        color: slot.color,
        locked: slot.locked,
        displayColor: mapped.displayColor,
        hex: mapped.hex,
        clipped: mapped.clipped,
        shown: slot.color,
      }
    }),
    rule: 'auto',
    rolled: 'triad',
    profile: 'even',
    state: { slots, rule: 'auto', rolled: 'triad', profile: 'even' },
    canUndo: true,
    canRedo: false,
    undo: () => {},
    redo: () => {},
    generate: () => {},
    toggleLock: () => {},
    setColor: () => {},
    add: () => {},
    remove: () => {},
    reorder: () => {},
    setRule: () => {},
    setProfile: () => {},
    setCount: () => {},
    load: () => {},
  })

  /** The hex printed on each bar, in the order they appear across the row. */
  const barOrder = (htmlOrSlots: string | Slot[]) => {
    const html = typeof htmlOrSlots === 'string' ? htmlOrSlots : render(htmlOrSlots)
    return [...html.matchAll(/class="sbar__value">(#[0-9a-f]{6})</g)].map((match) => match[1])
  }

  const render = (slots: Slot[], vision: Vision = 'normal') =>
    renderToStaticMarkup(
      <SchemeBoard
        scheme={apiOf(slots)}
        mode="scheme"
        onMode={() => {}}
        format="hex"
        onFormat={() => {}}
        gamut="srgb"
        onGamut={() => {}}
        vision={vision}
        onVision={() => {}}
        onSendToRamps={() => {}}
        onSeedFromRamps={() => {}}
        copiedKey={null}
        onCopy={() => {}}
      />,
    )

  it('paints one bar per colour', () => {
    const html = render(slotsOf())
    expect(html.match(/class="sbar[ "]/g)).toHaveLength(colors.length)
  })

  it('offers both modes, and marks the one it is in', () => {
    const html = render(slotsOf())
    expect(html).toContain('>Ramps<')
    // Sliced between the switch and what follows it in the masthead. Not
    // matched to its own closing tag: the beta mark is a nested span, so the
    // first `</span>` is no longer the switch's.
    const start = html.indexOf('class="modes"')
    const modes = html.slice(start, html.indexOf('class="masthead__end"'))
    expect(start).toBeGreaterThan(-1)
    expect(modes.match(/<button/g)).toHaveLength(2)
    expect(modes.match(/aria-pressed="true"/g)).toHaveLength(1)
  })

  it('carries the same masthead the editor does, above its own toolbar', () => {
    const html = render(slotsOf())
    expect(html).toContain('class="masthead"')
    expect(html).toContain('COLORS // PANTOINE')
    expect(html).toContain('Antoine Pouligny')
    expect(html).toContain('badge badge--solid')
    // And above, not inside: the mode's own bar follows it.
    expect(html.indexOf('class="masthead"')).toBeLessThan(html.indexOf('class="scheme__bar"'))
  })

  it('centres the switch on the window rather than on the room left over', () => {
    // Three grid columns, the outer two sharing the slack equally. With
    // spacers instead, the switch would slide as the title or the credit
    // changed width.
    const bar = declarations('.masthead')
    expect(bar).toContain('display: grid')
    expect(bar).toContain('grid-template-columns: 1fr auto 1fr')
  })

  it('says which rule Auto rolled', () => {
    expect(render(slotsOf())).toContain('Triad')
  })

  it('marks a locked bar as pressed, and an unlocked one as not', () => {
    const html = render(slotsOf([1]))
    expect(html).toContain('sbar sbar--locked')
    // One lock control per bar, exactly one of them on.
    const locks = html.match(/aria-pressed="(true|false)"[^>]*title="Locked/g) ?? []
    expect(locks).toHaveLength(1)
  })

  it('writes on each bar in whichever of black and white can be read on it', () => {
    // The near-white slot has to take black ink and the near-black one white,
    // or the values are invisible on the two bars that need them most.
    const html = render(slotsOf())
    const ink = [...html.matchAll(/class="sbar[^"]*"[^>]*color:\s*(#[0-9a-f]{6})/g)].map(
      (match) => match[1],
    )
    expect(ink[0]).toBe('#000000')
    expect(ink[ink.length - 1]).toBe('#ffffff')
  })

  it('prints the value in the format the document is set to', () => {
    const html = render(slotsOf())
    for (const color of colors) expect(html).toContain(formatColor(color, 'hex'))
  })

  it('paints the colours as seen under a simulation, and still copies the truth', () => {
    const html = render(slotsOf(), 'deuteranopia')
    // The value on the bar is the colour the scheme holds, whatever eye is on.
    for (const color of colors) expect(html).toContain(formatColor(color, 'hex'))
    // The ground is not, or the simulation would be showing nothing.
    expect(html).not.toBe(render(slotsOf()))
  })

  it('offers an insert at every boundary, including both ends', () => {
    const html = render(slotsOf())
    const inserts = html.match(/class="scheme__insert"/g) ?? []
    // One more than there are colours: between each pair, and outside each end.
    expect(inserts).toHaveLength(colors.length + 1)
  })

  /**
   * The whole chain, in the terms you actually look at: which colour sits
   * where across the row, before and after a seam is clicked. The reducer
   * test and the seam-index test each check one link; this checks that
   * clicking the third seam really does put the colour third on screen.
   */
  it('lands a clicked seam’s colour in that seam, not at the end of the row', () => {
    const before = render(slotsOf())
    const originals = colors.map(toHex)
    expect(barOrder(before)).toEqual(originals)

    for (const at of [0, 2, colors.length]) {
      const state: SchemeState = {
        slots: slotsOf(),
        rule: 'triad',
        rolled: null,
        profile: 'even',
      }
      const order = barOrder(render(schemeReducer(state, { type: 'add', at }).slots))
      expect(order).toHaveLength(colors.length + 1)
      // Every original still in order, with exactly one new colour at `at`.
      expect(order.filter((hex) => originals.includes(hex))).toEqual(originals)
      expect(originals).not.toContain(order[at])
    }
  })

  it('acts on the boundary it stands on, seam by seam', () => {
    // The gap the other two tests leave: they check the reducer inserts at the
    // index it is given, and that seams and bars alternate — neither checks
    // that the Nth seam is the one that asks for index N.
    const html = render(slotsOf())
    const seams = [...html.matchAll(/class="scheme__insert" data-at="(\d+)"/g)].map((m) =>
      Number(m[1]),
    )
    expect(seams).toEqual([0, 1, 2, 3, 4])
  })

  it('interleaves the inserts with the bars, so the row can part at a seam', () => {
    // Laid over the bars they could not move them aside; as flex items between
    // them, widening one takes room from the two colours either side.
    const html = render(slotsOf())
    const order = [...html.matchAll(/class="(scheme__insert|sbar)"/g)].map((m) => m[1])
    expect(order).toEqual([
      'scheme__insert',
      'sbar',
      'scheme__insert',
      'sbar',
      'scheme__insert',
      'sbar',
      'scheme__insert',
      'sbar',
      'scheme__insert',
    ])
  })


  it('sets the reading along the foot of the bar and centred across it', () => {
    const face = declarations('.sbar__face')
    expect(face).toContain('justify-content: flex-end')
    expect(face).toContain('align-items: center')
    expect(declarations('.sbar__read')).toContain('text-align: center')
  })

  it('opens the seam rather than holding a gap open', () => {
    // Zero width until opened, so a control that is not there costs the row
    // nothing — and the hit area has to reach past zero to be reachable.
    const seam = declarations('.scheme__seam')
    expect(seam).toContain('flex: 0 0 0px')
    expect(seam).toContain('transition')
    expect(declarations('.scheme__seam::before')).toContain('inset: 0 -14px')
    expect(declarations('.scheme__seam.is-open')).toContain('flex-basis: 36px')
  })

  /**
   * The dwell is a timer in the component, not a CSS `transition-delay`, and
   * that is a safety property rather than a style choice: a delay defers only
   * how the seam *looks*. Its hit area would be live from the first moment,
   * so every boundary would carry an invisible 28px strip taking clicks meant
   * for the colour under it — click near a bar's edge to copy, and a colour is
   * silently inserted instead.
   */
  it('cannot be clicked before it can be seen', () => {
    expect(declarations('.scheme__insert')).toContain('pointer-events: none')
    expect(declarations('.scheme__insert:focus-visible')).toContain('pointer-events: auto')
    // And no seam rule reintroduces the delay-based version by the back door.
    for (const rule of ['.scheme__seam', '.scheme__seam.is-open', '.scheme__insert']) {
      expect(declarations(rule)).not.toContain('transition-delay')
    }
  })

  it('drops the inserts once the scheme is full, and in bare mode', () => {
    const full = Array.from({ length: MAX_SLOTS }, (_unused, index) => ({
      id: `f${index}`,
      color: { l: 0.5, c: 0.1, h: index * 40 },
      locked: false,
    }))
    expect(render(full)).not.toContain('scheme__insert')
  })

  it('says how to drive it, since almost none of it is a visible control', () => {
    const html = render(slotsOf())
    expect(html).toContain('Space rolls a new scheme')
  })

  /**
   * The board promises Space always rolls. A button keeps focus after a click
   * and a focused button answers to Space, so without taking the key back one
   * click on Generate quietly redefines Space as "press Generate again" — and
   * one click on a lock redefines it as "toggle that lock".
   */
  describe('what Space belongs to', () => {
    const at = (over: Partial<KeyContext> = {}): KeyContext => ({
      inTextEntry: false,
      inDialog: false,
      ...over,
    })

    it('rolls, whatever has focus', () => {
      // The whole point. A button keeps focus after a click and a select keeps
      // it after you pick from one, and both answer to Space — so any rule
      // that let focus keep the key turned Space into "do that last thing
      // again" for the rest of the session.
      expect(spaceRolls(at())).toBe(true)
    })

    it('leaves the key to text entry, where a space is a character', () => {
      expect(spaceRolls(at({ inTextEntry: true }))).toBe(false)
    })

    it('never rolls behind an open dialog', () => {
      expect(spaceRolls(at({ inDialog: true }))).toBe(false)
      expect(spaceRolls(at({ inDialog: true, inTextEntry: true }))).toBe(false)
    })
  })
})

describe('scheme export', () => {
  const slots: Slot[] = [
    { id: 'a', color: { l: 0.9, c: 0.05, h: 60 }, locked: false },
    { id: 'b', color: { l: 0.6, c: 0.15, h: 200 }, locked: false },
    { id: 'c', color: { l: 0.3, c: 0.1, h: 300 }, locked: false },
  ]

  it('offers every text format the editor does', () => {
    const html = renderToStaticMarkup(
      <SchemeExportDialog slots={slots} gamut="srgb" defaultOpen />,
    )
    for (const format of TEXT_FORMATS) expect(html).toContain(format.label)
  })

  it('numbers the colours in scheme order rather than by lightness', () => {
    // A scheme is not five tints of anything, so a weight token would be a
    // claim about these colours that is not true.
    const ramp = schemeRamp(slots, 'srgb', 'brand')
    expect(ramp.ramp.map((swatch) => swatch.label)).toEqual(['1', '2', '3'])
    const css = buildText(TEXT_FORMATS.find((f) => f.id === 'css-hex')!, [ramp], 'srgb')
    expect(css).toContain('--brand-1')
    expect(css).toContain('--brand-3')
    expect(css).not.toContain('--brand-500')
  })

  it('writes a hex list of exactly the colours in the scheme', () => {
    const ramp = schemeRamp(slots, 'srgb')
    const list = buildText(TEXT_FORMATS.find((f) => f.id === 'hex')!, [ramp], 'srgb')
    expect(list.split('\n')).toEqual(slots.map((slot) => toHex(slot.color)))
  })

  it('marks no colour as the base, because a scheme has none', () => {
    for (const swatch of schemeRamp(slots, 'srgb').ramp) expect(swatch.isBase).toBe(false)
  })
})

/**
 * The editor with nothing in it.
 *
 * Reached by deleting the last palette, which the reducer now allows. The App
 * reads its opening document from storage, so an emptied one is staged there —
 * a stored empty list means "emptied on purpose", which is the whole reason
 * storage tells that apart from having saved nothing at all.
 */
describe('the empty editor', () => {
  const html = (() => {
    const store = new Map<string, string>()
    store.set(
      'colors.pantoine.com/v1',
      JSON.stringify({ v: 1, hash: encodeDocument([]), selected: -1 }),
    )
    // Which half, as well as what is in it: the tool opens on the scheme
    // board unless something says otherwise, and this is a test about the
    // editor with nothing in it.
    store.set('colors.pantoine.com/mode/v1', JSON.stringify({ v: 1, mode: 'ramps' }))
    ;(globalThis as { window?: unknown }).window = {
      location: { hash: '', pathname: '/', search: '' },
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, value),
      },
    }
    try {
      return renderToStaticMarkup(<App />)
    } finally {
      delete (globalThis as { window?: unknown }).window
    }
  })()

  it('offers both ways back into a palette, in the middle of the page', () => {
    expect(html).toContain('class="blank"')
    expect(html).toContain('+ Quick add')
    expect(html).toContain('+ New palette')
  })

  it('puts the toolbox away, since there is no palette to edit', () => {
    expect(html).not.toContain('class="toolbox"')
    expect(html).not.toContain('class="graph"')
    expect(html).not.toContain('class="stack"')
  })

  it('drops the controls that answer to a palette', () => {
    // Steps, Review and Export all act on a stack that is not there. Undo and
    // the canvas still apply, so they stay.
    expect(html).not.toContain('class="controls__steps"')
    expect(html).not.toContain('>Review</button>')
    expect(html).toContain('>Undo</button>')
  })

  it('offers each way in exactly once', () => {
    // The bar stands its own pair down while the centred pair is up, or the
    // page would carry two New palette buttons and two quick adds.
    expect(html.match(/\+ Quick add/g)).toHaveLength(1)
    expect(html.match(/\+ New palette/g)).toHaveLength(1)
  })

  it('centres the pair by taking the room the stack would have had', () => {
    const blank = declarations('.blank')
    expect(blank).toContain('flex: 1')
    expect(blank).toContain('justify-content: center')
    expect(blank).toContain('align-items: center')
  })
})

describe('which half the tool opens on', () => {
  /** `App` against a stubbed browser holding exactly what is passed in. */
  const openWith = (stored: Record<string, string> = {}) => {
    const store = new Map(Object.entries(stored))
    ;(globalThis as { window?: unknown }).window = {
      location: { hash: '', pathname: '/', search: '' },
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, value),
      },
    }
    try {
      return renderToStaticMarkup(<App />)
    } finally {
      delete (globalThis as { window?: unknown }).window
    }
  }

  it('opens on the scheme board when nothing has been saved', () => {
    const html = openWith()
    expect(html).toContain('class="scheme"')
    expect(html).not.toContain('class="toolbox"')
  })

  it('opens on the editor for somebody who left it there', () => {
    const html = openWith({
      'colors.pantoine.com/mode/v1': JSON.stringify({ v: 1, mode: 'ramps' }),
    })
    expect(html).toContain('class="toolbox"')
    expect(html).not.toContain('class="scheme"')
  })
})

describe('the two ways back into a palette', () => {
  it('gives them room without giving them colours of their own', () => {
    // They sit alone on the page, so they are larger — but the hover is the
    // one the whole app uses, which is what stopped the solid one and the
    // outlined one reading as opposite gestures.
    const blank = declarations('.blank__actions button')
    expect(blank).toContain('padding: var(--space-4) var(--space-7)')
    expect(blank).not.toContain('background')
    expect(blank).not.toContain('color:')
  })
})

describe('a scheme bar’s tools', () => {
  const colors: Oklch[] = [
    { l: 0.94, c: 0.03, h: 80 },
    { l: 0.24, c: 0.07, h: 20 },
  ]

  const slotsOf = (locked: number[] = []): Slot[] =>
    colors.map((color, index) => ({
      id: `s${index}`,
      color,
      locked: locked.includes(index),
    }))

  const render = (slots: Slot[]) =>
    renderToStaticMarkup(
      <SchemeBoard
        scheme={
          {
            slots: slots.map((slot) => {
              const mapped = mapToGamut(slot.color, 'srgb')
              return {
                id: slot.id,
                color: slot.color,
                locked: slot.locked,
                displayColor: mapped.displayColor,
                hex: mapped.hex,
                clipped: mapped.clipped,
                shown: slot.color,
              }
            }),
            rule: 'auto',
            rolled: null,
            profile: 'even',
            state: { slots, rule: 'auto', rolled: null, profile: 'even' },
            canUndo: false,
            canRedo: false,
            undo: () => {},
            redo: () => {},
            generate: () => {},
            toggleLock: () => {},
            setColor: () => {},
            add: () => {},
            remove: () => {},
            reorder: () => {},
            setRule: () => {},
            setProfile: () => {},
            setCount: () => {},
            load: () => {},
          } as SchemeApi
        }
        mode="scheme"
        onMode={() => {}}
        format="hex"
        onFormat={() => {}}
        gamut="srgb"
        onGamut={() => {}}
        vision="normal"
        onVision={() => {}}
        onSendToRamps={() => {}}
        onSeedFromRamps={() => {}}
        copiedKey={null}
        onCopy={() => {}}
      />,
    )

  /**
   * `is-on` carries a document-wide fill in the frame's own black. The tools
   * on a bar are painted in the bar's contrast colour instead, so on a light
   * colour — where that contrast colour is also black — a locked lock came out
   * as a black glyph on a black square.
   */
  it('keeps the locked lock off the app-wide toggle fill', () => {
    const html = render(slotsOf([0]))
    expect(html).toContain('sbar__tool--locked')
    expect(html).not.toContain('sbar__tool is-on')
  })

  it('fills a locked lock in the bar’s own two colours', () => {
    // The light bar takes black ink, so the fill is black and the glyph is the
    // bar showing back through it. Never black on black.
    const light = render(slotsOf([0]))
    const ground = mapToGamut(colors[0], 'srgb').displayColor
    expect(light).toContain(`color:${ground};background-color:#000000`)

    // And the dark bar the other way round, from the same rule.
    const dark = render(slotsOf([1]))
    expect(dark).toContain(`color:${mapToGamut(colors[1], 'srgb').displayColor};background-color:#ffffff`)
  })

  it('leaves an unlocked tool unfilled', () => {
    expect(render(slotsOf())).toContain('style="color:#000000;border-color:#000000"')
  })

  /**
   * The bar's face is a button covering the whole bar, so clicking a colour to
   * copy it focuses that button — and focus outlives the pointer. Scoped to
   * the bar, that left the tools showing on a bar the cursor had left.
   */
  it('holds the tools open for focus only when focus is on one of them', () => {
    // Comments stripped first: the rule explains itself by naming the selector
    // it replaced, which a plain search through the stylesheet would find.
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(rules).toContain('.sbar__tools:focus-within')
    expect(rules).not.toContain('.sbar:focus-within')
  })
})

describe('the shades of one bar', () => {
  const color: Oklch = { l: 0.62, c: 0.14, h: 18 }

  const strip = (gamut: Gamut = 'srgb', vision: Vision = 'normal') =>
    renderToStaticMarkup(
      <ShadePicker
        color={color}
        gamut={gamut}
        vision={vision}
        format="hex"
        name="test"
        onPick={() => {}}
        anchor={{ current: null }}
        trigger={(open) => (
          <button type="button" onClick={open}>
            shades
          </button>
        )}
        defaultOpen
      />,
    )

  it('offers the ramp the other half of the tool would build', () => {
    // Not a lightness ladder of its own: the strip is the editor's own
    // default ramp for this colour, so what you pick here is a step you could
    // have got by sending the scheme across and reading it off there.
    const html = strip()
    const expected = generateRamp(
      createPalette(formatColor(color, 'oklch'), SHADE_STEPS, 'srgb'),
      'srgb',
    )
    expect(html.match(/class="shades__step/g)).toHaveLength(SHADE_STEPS)
    for (const swatch of expected) {
      expect(html).toContain(`background-color:${swatch.displayColor}`)
    }
  })

  it('marks the step the colour is already on, exactly once', () => {
    // The strip is a move from where you are, so where you are has to be in
    // it — and picking it again is changing your mind, not a mistake.
    const html = strip()
    expect(html.match(/shades__step is-here/g)).toHaveLength(1)
    expect(html).toContain('where this colour already is')
  })

  it('picks the colour the screen showed, not the one the curves asked for', () => {
    // A step whose chroma did not fit was drawn with the chroma given back.
    // Picking the request instead would put a colour in the scheme that was
    // never on the strip, and break the promise that every slot is in gamut.
    const wide = generateRamp(
      createPalette('oklch(0.62 0.29 18)', SHADE_STEPS, 'srgb'),
      'srgb',
    )
    const clipped = wide.filter((swatch) => swatch.clipped)
    expect(clipped.length).toBeGreaterThan(0)
    for (const swatch of clipped) {
      expect(isInGamut(swatch.oklch, 'srgb')).toBe(false)
      expect(isInGamut(emitted(swatch), 'srgb')).toBe(true)
    }
  })

  it('paints the strip under the eye in force, and reads the value against it', () => {
    // The same rule the bars follow: a simulation changes the ground and the
    // ink, never the colour that is being chosen.
    const html = strip('srgb', 'deuteranopia')
    const seen = simulate(emitted(generateRamp(
      createPalette(formatColor(color, 'oklch'), SHADE_STEPS, 'srgb'),
      'srgb',
    )[0]), 'deuteranopia')
    expect(html).toContain(`background-color:${mapToGamut(seen, 'srgb').displayColor}`)
  })

  it('leaves the hover bar every other button draws', () => {
    // The fill is set per step as `background-color`; the `background`
    // shorthand would reset `background-image`, which is the bar, and on a
    // strip of twenty-one colours it is the only mark on the one under the
    // pointer.
    expect(strip()).not.toMatch(/class="shades__step[^"]*" style="background:/)
    expect(declarations('.shades__step')).not.toContain('background:')
  })

  it('dims nothing behind it', () => {
    // The rest of the window is the other colours in the scheme, which are
    // what this choice is being made against.
    expect(declarations('.shades::backdrop')).toContain('background: transparent')
  })
})

describe('the mode switch', () => {
  const html = renderToStaticMarkup(<ModeSwitch mode="ramps" onMode={() => {}} />)

  it('marks the scheme half as beta, inside the label', () => {
    expect(html).toContain('class="modes__beta"')
    expect(html).toContain('>beta<')
    // Inside the Scheme button, not floating beside the pair.
    const scheme = html.slice(0, html.indexOf('Ramps'))
    expect(scheme).toContain('modes__beta')
  })

  it('leaves the switch two buttons wide', () => {
    expect(html.match(/<button/g)).toHaveLength(2)
  })

  it('lets the mark take the colour of whichever half it is on', () => {
    // The scheme half is filled when it is the mode in force, so a fixed
    // colour here would be unreadable on one of the two states.
    expect(declarations('.modes__beta')).not.toContain('color:')
  })
})
