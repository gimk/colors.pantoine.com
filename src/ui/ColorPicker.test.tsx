import css from '../styles.css?raw'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { parseToOklch, type Gamut, type Oklch } from '../color/oklch'
import { axisMaxChroma, cuspFor } from '../color/slice'
import { ColorPicker } from './ColorPicker'
import { ColorPickerDialog } from './ColorPickerDialog'

const violet: Oklch = parseToOklch('#7c3aed')!

const render = (color: Oklch, gamut: Gamut = 'srgb') =>
  renderToStaticMarkup(<ColorPicker color={color} gamut={gamut} onChange={() => {}} />)

/** The first rule whose selector list ends with `selector`, as written. */
function declarations(selector: string): string {
  const rules = css.match(/[^{}]+\{[^}]*\}/g) ?? []
  const hit = rules.find((rule) => {
    const head = rule.slice(0, rule.indexOf('{')).trim()
    return head.split(',').some((part) => part.trim().endsWith(selector))
  })
  return hit ? hit.slice(hit.indexOf('{') + 1, -1) : ''
}

/** Every `<rect>` in the markup, as attribute maps. */
function rects(html: string): Record<string, string>[] {
  return (html.match(/<rect [^>]*\/?>/g) ?? []).map((tag) => {
    const attrs: Record<string, string> = {}
    for (const [, key, value] of tag.matchAll(/([\w-]+)="([^"]*)"/g)) attrs[key] = value
    return attrs
  })
}

const numbers = (path: string) => path.match(/-?\d+(\.\d+)?/g)!.map(Number)

/** Just the slice, without the hue strip — whose patches are rects too. */
const plotOf = (html: string) =>
  html.slice(html.indexOf('class="cpick__plot"'), html.indexOf('</svg>'))

describe('the OKLCH picker', () => {
  const html = render(violet)

  it('replaces the system picker rather than sitting beside it', () => {
    const dialog = renderToStaticMarkup(
      <ColorPickerDialog
        color={violet}
        gamut="srgb"
        onChange={() => {}}
        onGamut={() => {}}
      />,
    )
    expect(dialog).not.toContain('type="color"')
    expect(dialog).toContain('aria-label="Pick base colour"')
  })

  it('includes a gamut dropdown when open that reflects the active gamut', () => {
    const openDialog = renderToStaticMarkup(
      <ColorPickerDialog
        color={violet}
        gamut="p3"
        onChange={() => {}}
        onGamut={() => {}}
        defaultOpen
      />,
    )
    expect(openDialog).toContain('<span>Gamut</span>')
    expect(openDialog).toContain('<select')
    expect(openDialog).toContain('Display P3')
    expect(openDialog).toContain('Rec. 2020')
  })

  it('draws the slice and the hue strip, and nothing else', () => {
    expect(html.match(/<svg/g)).toHaveLength(2)
    expect(html).toContain('class="cpick__plot"')
    expect(html).toContain('class="cpick__hue"')
  })

  it('offers lightness, chroma and hue as numbers too', () => {
    for (const label of ['>L</span>', '>C</span>', '>H</span>']) {
      expect(html).toContain(label)
    }
    // Through the same text fields as the rest of the tool, so a comma
    // decimal still parses.
    expect(html).not.toContain('type="number"')
    expect(html.match(/class="number"/g)).toHaveLength(3)
  })

  it('reports the colour in OKLCH, with the sRGB hex under it', () => {
    expect(html).toContain('oklch(')
    expect(html).toMatch(/class="cpick__hex">#[0-9a-f]{6}</)
  })
})

describe('the slice geometry', () => {
  const html = render(violet)

  it('keeps every painted cell inside the frame', () => {
    const all = rects(plotOf(html))
    const frame = all.find((r) => r.class === 'cpick__frame')!
    const left = Number(frame.x)
    const top = Number(frame.y)
    const right = left + Number(frame.width)
    const bottom = top + Number(frame.height)

    const cells = all.filter((r) => r.fill)
    expect(cells.length).toBeGreaterThan(100)
    for (const cell of cells) {
      expect(Number(cell.x)).toBeGreaterThanOrEqual(left - 0.01)
      expect(Number(cell.y)).toBeGreaterThanOrEqual(top - 0.01)
      // A cell overhangs by the seam overlap and no more.
      expect(Number(cell.x) + Number(cell.width)).toBeLessThanOrEqual(right + 1)
      expect(Number(cell.y) + Number(cell.height)).toBeLessThanOrEqual(bottom + 1)
    }
  })

  it('paints the cells in colours, not in frame ink', () => {
    const fills = new Set(rects(plotOf(html)).map((r) => r.fill).filter(Boolean))
    expect(fills.size).toBeGreaterThan(100)
    for (const fill of fills) expect(fill).toMatch(/^#[0-9a-f]{6}$/)
  })

  /**
   * The wedge is the whole point: chroma runs out at both ends of the
   * lightness range and bulges at the cusp between them. A boundary that
   * came out as a straight line would mean the gamut was being drawn as the
   * rectangle HSV pretends it is.
   */
  it('draws a gamut edge that bulges rather than running straight', () => {
    const edge = html.match(/class="cpick__edge" d="([^"]+)"/)![1]
    const xs = numbers(edge).filter((_, i) => i % 2 === 0)
    const widest = Math.max(...xs)
    const ends = (xs[0] + xs[xs.length - 1]) / 2
    expect(widest).toBeGreaterThan(ends + 40)
  })

  it('closes the edge at both ends of the lightness range', () => {
    const edge = html.match(/class="cpick__edge" d="([^"]+)"/)![1]
    const xs = numbers(edge).filter((_, i) => i % 2 === 0)
    expect(xs[0]).toBeCloseTo(xs[xs.length - 1], 1)
  })

  it('marks the cusp where the slice is widest', () => {
    const cusp = html.match(/class="cpick__cusp" cx="([\d.]+)" cy="([\d.]+)"/)!
    const edge = html.match(/class="cpick__edge" d="([^"]+)"/)![1]
    const xs = numbers(edge).filter((_, i) => i % 2 === 0)
    expect(Number(cusp[1])).toBeGreaterThan(Math.max(...xs) - 6)
  })

  it('puts the marker on the colour it was given', () => {
    const marker = html.match(/class="cpick__marker" cx="([\d.]+)" cy="([\d.]+)"/)!
    const frame = rects(plotOf(html)).find((r) => r.class === 'cpick__frame')!
    const x = (Number(marker[1]) - Number(frame.x)) / Number(frame.width)
    const y = (Number(marker[2]) - Number(frame.y)) / Number(frame.height)
    expect(x).toBeCloseTo(violet.c / axisMaxChroma('srgb'), 2)
    expect(y).toBeCloseTo(1 - violet.l, 2)
  })

  it('travels up as the colour lightens and right as it saturates', () => {
    const at = (color: Oklch) => {
      const m = render(color).match(/class="cpick__marker" cx="([\d.]+)" cy="([\d.]+)"/)!
      return { x: Number(m[1]), y: Number(m[2]) }
    }
    const dark = at({ l: 0.25, c: 0.1, h: 250 })
    const light = at({ l: 0.85, c: 0.1, h: 250 })
    const grey = at({ l: 0.5, c: 0.01, h: 250 })
    const vivid = at({ l: 0.5, c: 0.2, h: 250 })

    expect(light.y).toBeLessThan(dark.y)
    expect(vivid.x).toBeGreaterThan(grey.x)
  })
})

describe('the gamut a slice is drawn for', () => {
  it('widens the wedge when the document gamut widens', () => {
    const reach = (gamut: Gamut) => {
      const edge = render({ l: 0.7, c: 0.1, h: 145 }, gamut).match(
        /class="cpick__edge" d="([^"]+)"/,
      )![1]
      return Math.max(...numbers(edge).filter((_, i) => i % 2 === 0))
    }
    // Chroma the gamut cannot reach is the same dead space in every slice,
    // so a wider gamut has to push the edge further out at a given hue.
    expect(reach('rec2020')).toBeGreaterThan(reach('srgb'))
  })

  it('paints a wide-gamut slice in color(), which hex cannot carry', () => {
    const fills = new Set(
      rects(plotOf(render(violet, 'p3')))
        .map((r) => r.fill)
        .filter(Boolean),
    )
    for (const fill of fills) expect(fill).toContain('color(display-p3')
  })

  it('scales the chroma axis to the gamut, and says so', () => {
    expect(render(violet, 'srgb')).toContain(axisMaxChroma('srgb').toFixed(2))
    expect(render(violet, 'rec2020')).toContain(axisMaxChroma('rec2020').toFixed(2))
  })
})

/**
 * A base colour is a request, exactly as a curve value is: the rest of the
 * tool maps it and annotates the cost rather than refusing it. So the picker
 * lets the marker sit outside the wedge, and shows where it will land.
 */
describe('picking outside the gamut', () => {
  const outside: Oklch = { l: 0.75, c: 0.3, h: 145 }

  /**
   * Reported inside the plot and via the corner badge on the preview. The dialog
   * is centred, so a notice that comes and goes in the document flow would
   * re-centre the modal mid-drag. The corner badge sits absolutely inside the
   * fixed-height preview box, leaving overall panel structure untouched.
   */
  it('reports it without adding anything to the panel flow', () => {
    const heights = (color: Oklch) =>
      render(color).match(/class="cpick__(plot|hue|fields|out)"/g)
    expect(heights(outside)).toEqual(heights(violet))
    expect(render(outside)).toContain('class="cpick__clipped"')
    expect(render(outside)).toContain('sRGB clipped')
    expect(render(violet)).not.toContain('class="cpick__clipped"')
  })

  it('shows how far the request overshoots, and where it lands', () => {
    const html = render(outside)
    const spill = html.match(/class="cpick__spill" x1="([\d.]+)" y1="[\d.]+" x2="([\d.]+)"/)!
    expect(Number(spill[2])).toBeGreaterThan(Number(spill[1]))
    expect(html).toContain('class="cpick__lands"')
  })

  it('keeps quiet when the same colour fits the wider gamut', () => {
    const html = render(outside, 'rec2020')
    expect(html).not.toContain('cpick__spill')
    expect(html).not.toContain('cpick__lands')
  })

  it('holds the marker inside the plot even past the axis', () => {
    const html = render({ l: 0.6, c: 0.9, h: 145 })
    const marker = html.match(/class="cpick__marker" cx="([\d.]+)"/)!
    const frame = rects(plotOf(html)).find((r) => r.class === 'cpick__frame')!
    expect(Number(marker[1])).toBeLessThanOrEqual(Number(frame.x) + Number(frame.width))
  })
})

describe('reaching the picker without a mouse', () => {
  const html = render(violet)

  it('offers the marker and the hue strip as focusable sliders', () => {
    expect(html.match(/role="slider"/g)).toHaveLength(2)
    expect(html.match(/tabindex="0"/g)).toHaveLength(2)
  })

  it('says what the marker is reporting, since a point has no one number', () => {
    expect(html).toMatch(/aria-valuetext="Lightness [\d.]+ percent, chroma [\d.]+"/)
  })

  it('reports the hue as an angle out of 360', () => {
    expect(html).toContain('aria-valuemax="360"')
  })
})

describe('the picker frame', () => {
  it('claims the drags, so a touch does not scroll the dialog instead', () => {
    expect(declarations('.cpick__hue')).toContain('touch-action: none')
  })

  it('rings the marker in both inks, so it reads on any colour under it', () => {
    expect(declarations('.cpick__halo')).toContain('stroke: var(--paper)')
    expect(declarations('.cpick__marker')).toContain('stroke: var(--ink)')
  })

  it('escapes the dock rather than being clipped inside it', () => {
    // The dock is a max-height scroll container, so the panel is a modal
    // dialog: an absolutely positioned popover would be cut off at its edge.
    expect(declarations('.toolbox')).toContain('overflow-y: auto')
    expect(declarations('.cdialog')).toContain('padding: 0')
    expect(css).toContain('.cdialog::backdrop')
  })
})

describe('the cusp, across hues', () => {
  /** Sanity on the numbers the plot is drawn from, at the UI's own scale. */
  it('is high on magenta and low on cyan, as the axis assumes', () => {
    expect(cuspFor(328, 'srgb').c).toBeGreaterThan(0.25)
    expect(cuspFor(195, 'srgb').c).toBeLessThan(0.2)
  })
})

describe('classic color models (HSV and HSL)', () => {
  it('offers a model switcher in the dialog header', () => {
    const dialog = renderToStaticMarkup(
      <ColorPickerDialog
        color={violet}
        gamut="srgb"
        onChange={() => {}}
        onGamut={() => {}}
        defaultOpen
      />,
    )
    expect(dialog).toContain('<span>Model</span>')
    expect(dialog).toContain('OKLCH')
    expect(dialog).toContain('HSV')
    expect(dialog).toContain('HSL')
  })

  it('renders HSV mode with saturation/value gradients and H, S, V numeric fields', () => {
    const html = renderToStaticMarkup(
      <ColorPicker color={violet} gamut="srgb" model="hsv" onChange={() => {}} />,
    )
    expect(html).toContain('id="hsv-x"')
    expect(html).toContain('id="hsv-y"')
    expect(html).toContain('id="hue-rainbow"')
    expect(html).toContain('>H</span>')
    expect(html).toContain('>S</span>')
    expect(html).toContain('>V</span>')
  })

  it('renders HSL mode with saturation/lightness gradients and H, S, L numeric fields', () => {
    const html = renderToStaticMarkup(
      <ColorPicker color={violet} gamut="srgb" model="hsl" onChange={() => {}} />,
    )
    expect(html).toContain('id="hsl-x"')
    expect(html).toContain('id="hsl-y"')
    expect(html).toContain('id="hue-rainbow"')
    expect(html).toContain('>H</span>')
    expect(html).toContain('>S</span>')
    expect(html).toContain('>L</span>')
  })

  it('positions the marker accurately in HSV and HSL modes', () => {
    // Pure red in sRGB has H=0, S=1, V=1, L=0.5
    // In OKLCH: l ≈ 0.628, c ≈ 0.2577, h ≈ 29.23
    const red = { l: 0.627955, c: 0.257683, h: 29.2339 }
    const hsvHtml = renderToStaticMarkup(
      <ColorPicker color={red} gamut="srgb" model="hsv" onChange={() => {}} />,
    )
    // S=1 (far right), V=1 (top)
    const hsvMarker = hsvHtml.match(/class="cpick__marker" cx="([\d.]+)" cy="([\d.]+)"/)!
    expect(Number(hsvMarker[1])).toBeGreaterThan(250) // near right edge
    expect(Number(hsvMarker[2])).toBeLessThan(2) // near top edge

    const hslHtml = renderToStaticMarkup(
      <ColorPicker color={red} gamut="srgb" model="hsl" onChange={() => {}} />,
    )
    // S=1 (far right), L=0.5 (middle: 240 * 0.5 = 120)
    const hslMarker = hslHtml.match(/class="cpick__marker" cx="([\d.]+)" cy="([\d.]+)"/)!
    expect(Number(hslMarker[1])).toBeGreaterThan(250) // near right edge
    expect(Number(hslMarker[2])).toBeCloseTo(120, 0) // exact vertical middle
  })
})

