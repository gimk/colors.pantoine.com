import css from '../styles.css?raw'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { HARMONIES } from '../color/harmony'
import { createPalette } from '../color/presets'
import { generateRamp } from '../color/ramp'
import type { PaletteView } from '../state/useDocument'
import { NewPaletteDialog } from './NewPaletteDialog'

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

const brand = view('p1', 'brand', '#7c3aed')
const accent = view('p2', 'accent', '#facc15')

const open = renderToStaticMarkup(
  <NewPaletteDialog
    palettes={[brand, accent]}
    selected={brand}
    gamut="srgb"
    onAdd={() => {}}
    defaultOpen
  />,
)

const shut = renderToStaticMarkup(
  <NewPaletteDialog palettes={[brand]} selected={brand} gamut="srgb" onAdd={() => {}} />,
)

describe('the new-palette dialog', () => {
  it('offers the trigger and nothing else until it is opened', () => {
    expect(shut).toContain('+ New palette')
    // The body unmounts with the dialog, so a shut dialog cannot be tabbed into.
    expect(shut).not.toContain('newpal__panel')
  })

  it('opens on the paste pane', () => {
    expect(open).toContain('newpal__panel')
    expect(open).toContain('newpal__paste')
    expect(open).toContain('>Paste<')
    expect(open).toContain('>Harmony<')
    // Paste pressed, harmony not — the panes are `is-on` toggles, since there
    // is no tab pattern anywhere in this app.
    const panes = open.slice(open.indexOf('newpal__panes'))
    expect(panes.slice(0, panes.indexOf('</span>'))).toContain('aria-pressed="true"')
  })

  it('says nothing is addable before anything is typed', () => {
    expect(open).toContain('Nothing to add yet')
    expect(open).toContain('disabled')
  })

  it('offers a way out that adds nothing', () => {
    expect(open).toContain('>Cancel<')
  })

  it('names the dialog for a screen reader', () => {
    expect(open).toContain('aria-labelledby="newpal-title"')
    expect(open).toContain('id="newpal-title"')
  })
})

describe('the harmony pane', () => {
  // Rendered directly rather than clicked: there is no DOM in this suite, so
  // the pane is exercised by asking for it, not by pressing the toggle.
  const harmony = renderToStaticMarkup(
    <NewPaletteDialog
      palettes={[brand, accent]}
      selected={brand}
      gamut="srgb"
      onAdd={() => {}}
      defaultOpen
      defaultPane="harmony"
    />,
  )

  it('lists every rule, with All rules first', () => {
    expect(harmony).toContain('>All rules<')
    expect(harmony.indexOf('>All rules<')).toBeLessThan(harmony.indexOf(HARMONIES[0].label))
    for (const rule of HARMONIES) expect(harmony).toContain(`>${rule.label}<`)
  })

  it('shows every rule at once by default, so they can be compared', () => {
    expect(harmony.match(/newpal__rule-name/g)).toHaveLength(HARMONIES.length)
  })

  it('gives each rule exactly the candidates its offsets define, plus the seed', () => {
    const rows = harmony.split('class="newpal__rule"').slice(1)
    expect(rows).toHaveLength(HARMONIES.length)
    rows.forEach((row, index) => {
      expect(row.match(/newpal__cand--seed/g)).toHaveLength(1)
      const all = row.match(/newpal__cand/g) ?? []
      // One seed span plus one button per offset.
      expect(all).toHaveLength(HARMONIES[index].offsets.length + 2)
    })
  })

  it('offers every swatch of every palette as a source', () => {
    expect(harmony).toContain('>brand<')
    expect(harmony).toContain('>accent<')
    expect(harmony.match(/newpal__pick/g)).toHaveLength(brand.ramp.length + accent.ramp.length)
  })

  it('starts on the selected palette’s base step', () => {
    const base = brand.ramp[brand.config.baseIndex]
    const picked = harmony.slice(harmony.indexOf('newpal__pick is-picked'))
    expect(picked).toContain(`brand ${base.label}`)
  })

  it('styles the candidates as separate choices, not a continuous ramp', () => {
    // A gap is what distinguishes "pick one of these" from "this is a scale".
    expect(declarations('.newpal__preview,\n.newpal__rule-ramp,\n.newpal__source-ramp')).toContain(
      'gap',
    )
    // And bigger in the rule rows than in the paste preview: these are the
    // colours being judged, not a confirmation that a paste parsed.
    const preview = /width:\s*(\d+)px/.exec(declarations('.newpal__cand'))
    const candidate = /width:\s*(\d+)px/.exec(declarations('.newpal__rule-ramp .newpal__cand'))
    expect(Number(candidate?.[1])).toBeGreaterThan(Number(preview?.[1]))
  })

  it('marks the seed swatch as not a button', () => {
    expect(declarations('.newpal__cand--seed')).toContain('cursor: default')
    expect(declarations('.newpal__cand--seed')).toContain('border-style: dashed')
  })

  it('rings the picked source instead of filling it', () => {
    // `is-on` fills with ink, which would paint over the colour the button
    // exists to show.
    expect(declarations('.newpal__pick.is-picked')).toContain('outline')
    expect(declarations('.newpal__pick.is-picked')).not.toContain('background')
  })
})

describe('the dialog’s styles', () => {
  it('covers its own box, so a click on the dialog is a backdrop click', () => {
    expect(declarations('.newpal')).toContain('padding: 0')
  })

  it('dims the backdrop, unlike the colour picker', () => {
    // The picker keeps its backdrop clear so the ramps stay judgeable behind
    // it. This one is a decision, not a preview.
    expect(declarations('.newpal::backdrop')).toContain('rgb(0 0 0 / 0.55)')
    expect(declarations('.cdialog::backdrop')).toContain('transparent')
  })

  it('fixes the height of both variable regions', () => {
    // The dialog is centred, so a region that grows re-centres the whole modal.
    const scroll = declarations('.newpal__scroll')
    expect(scroll).toMatch(/height:\s*\d+px/)
    expect(scroll).toContain('overflow-y: auto')
  })
})
