import { afterEach, describe, expect, it } from 'vitest'
import { flat } from '../color/curve'
import { normalizeHue, parseToOklch } from '../color/oklch'
import { createPalette } from '../color/presets'
import {
  createDocument,
  documentReducer,
  selectedEntry,
  type DocumentAction,
  type DocumentState,
} from './document'
import { restoreDocument, saveDocument } from './storage'
import { decodeDocument, decodePalette, encodeDocument, encodePalette, restoreBaseColor } from './url'

const run = (state: DocumentState, ...actions: DocumentAction[]) =>
  actions.reduce(documentReducer, state)

const hueOf = (hex: string) => parseToOklch(hex)!.h

describe('document', () => {
  it('opens with one palette, selected', () => {
    const doc = createDocument()
    expect(doc.palettes).toHaveLength(1)
    expect(doc.palettes[0].name).toBe('brand')
    expect(selectedEntry(doc).id).toBe(doc.palettes[0].id)
  })

  it('selects the last palette, which is the one the toolbox opens under', () => {
    const doc = createDocument([
      { name: 'one', config: createPalette('#7c3aed') },
      { name: 'two', config: createPalette('#facc15') },
    ])
    expect(selectedEntry(doc).name).toBe('two')
  })

  it('appends a new palette below and moves the selection to it', () => {
    const doc = run(createDocument(), { type: 'new' })
    expect(doc.palettes).toHaveLength(2)
    expect(selectedEntry(doc).id).toBe(doc.palettes[1].id)
    expect(doc.palettes[1].name).toBe('palette 2')
  })

  it('starts a new palette elsewhere on the hue circle', () => {
    // Two identical purple ramps would be no use to anyone building a scheme.
    const doc = run(createDocument(), { type: 'new' })
    const [first, second] = doc.palettes.map((entry) => hueOf(entry.state.config.base))
    expect(Math.abs(normalizeHue(second - first) - 72)).toBeLessThan(3)
  })

  it('edits only the selected palette', () => {
    // The whole point of the stack: a drag on one ramp must not reach another.
    const doc = run(createDocument(), { type: 'new' })
    const untouched = doc.palettes[0]
    const next = run(doc, {
      type: 'palette',
      action: { type: 'setCurve', key: 'chroma', curve: flat(0.1) },
    })
    expect(next.palettes[0].state).toBe(untouched.state)
    expect(next.palettes[1].state.config.chroma).not.toEqual(
      doc.palettes[1].state.config.chroma,
    )
    expect(next.palettes[1].state.edited.chroma).toBe(true)
    expect(next.palettes[0].state.edited.chroma).toBe(false)
  })

  it('moves the selection on click, and ignores an id it does not have', () => {
    const doc = run(createDocument(), { type: 'new' })
    const first = doc.palettes[0].id
    expect(selectedEntry(run(doc, { type: 'select', id: first })).id).toBe(first)
    expect(run(doc, { type: 'select', id: 'nope' })).toBe(doc)
  })

  it('reorders, and stops at both ends of the stack', () => {
    const doc = run(createDocument(), { type: 'new' }, { type: 'new' })
    const [a, b, c] = doc.palettes.map((entry) => entry.id)

    const moved = run(doc, { type: 'move', id: c, by: -1 })
    expect(moved.palettes.map((entry) => entry.id)).toEqual([a, c, b])
    // Reordering is not selecting: the palette you were editing stays selected.
    expect(selectedEntry(moved).id).toBe(c)

    expect(run(doc, { type: 'move', id: a, by: -1 })).toBe(doc)
    expect(run(doc, { type: 'move', id: c, by: 1 })).toBe(doc)
  })

  it('deletes a palette and never empties the document', () => {
    const one = createDocument()
    expect(run(one, { type: 'remove', id: one.palettes[0].id })).toBe(one)

    const doc = run(one, { type: 'new' }, { type: 'new' })
    const [a, b, c] = doc.palettes.map((entry) => entry.id)
    const gone = run(doc, { type: 'remove', id: b })
    expect(gone.palettes.map((entry) => entry.id)).toEqual([a, c])
    expect(selectedEntry(gone).id).toBe(c)
  })

  it('hands the selection to a neighbour when the selected palette goes', () => {
    const doc = run(createDocument(), { type: 'new' }, { type: 'new' })
    const [, b, c] = doc.palettes.map((entry) => entry.id)
    expect(selectedEntry(doc).id).toBe(c)
    const gone = run(doc, { type: 'remove', id: c })
    expect(selectedEntry(gone).id).toBe(b)
  })

  it('renames without disturbing the palette itself', () => {
    const doc = createDocument()
    const id = doc.palettes[0].id
    const renamed = run(doc, { type: 'rename', id, name: 'accent' })
    expect(renamed.palettes[0].name).toBe('accent')
    expect(renamed.palettes[0].state).toBe(doc.palettes[0].state)
  })

  it('updates steps globally across all palettes in the document', () => {
    const doc = run(createDocument(), { type: 'new' }, { type: 'new' })
    expect(doc.palettes).toHaveLength(3)
    for (const p of doc.palettes) {
      expect(p.state.config.steps).toBe(11)
    }

    const changed = run(doc, { type: 'setSteps', value: 7 })
    for (const p of changed.palettes) {
      expect(p.state.config.steps).toBe(7)
    }
  })

  it('inherits the global step count when creating a new palette', () => {
    const doc = run(createDocument(), { type: 'setSteps', value: 15 }, { type: 'new' })
    expect(doc.palettes).toHaveLength(2)
    expect(doc.palettes[0].state.config.steps).toBe(15)
    expect(doc.palettes[1].state.config.steps).toBe(15)
  })

  it('unifies loaded palettes to the document global step count', () => {
    const mixedSeeds = [
      { name: 'brand', config: createPalette('#7c3aed', 9) },
      { name: 'accent', config: createPalette('#facc15', 13) },
    ]
    const doc = createDocument(mixedSeeds)
    expect(doc.palettes[0].state.config.steps).toBe(9)
    expect(doc.palettes[1].state.config.steps).toBe(9)
  })

  it('syncs lightness across all palettes and aligns their base steps', () => {
    const doc = run(createDocument(), { type: 'new' })

    const customCurve = { start: 0.99, end: 0.12, h1: { x: 0.3, y: 0.8 }, h2: { x: 0.7, y: 0.3 } }
    const withCustom = run(doc, {
      type: 'palette',
      action: { type: 'setCurve', key: 'lightness', curve: customCurve },
    })

    const synced = run(withCustom, { type: 'syncChannel', key: 'lightness' })
    expect(synced.palettes[0].state.config.lightness).toEqual(customCurve)
    expect(synced.palettes[1].state.config.lightness).toEqual(customCurve)
    expect(synced.palettes[0].state.edited.lightness).toBe(true)
  })

  it('syncs chroma curve across all palettes', () => {
    const doc = run(createDocument(), { type: 'new' })
    const customChroma = flat(0.12)
    const withCustom = run(doc, {
      type: 'palette',
      action: { type: 'setCurve', key: 'chroma', curve: customChroma },
    })

    const synced = run(withCustom, { type: 'syncChannel', key: 'chroma' })
    expect(synced.palettes[0].state.config.chroma.start).toBeCloseTo(0.12, 4)
    expect(synced.palettes[0].state.config.chroma.end).toBeCloseTo(0.12, 4)
    expect(synced.palettes[0].state.edited.chroma).toBe(true)
  })

  it('syncs hue shift delta curve across palettes', () => {
    const doc = run(createDocument(), { type: 'new' })
    const customHue = flat(10)
    const withCustom = run(doc, {
      type: 'palette',
      action: { type: 'setCurve', key: 'hue', curve: customHue },
    })

    const synced = run(withCustom, { type: 'syncChannel', key: 'hue' })
    expect(synced.palettes[0].state.config.hue.start).toBeCloseTo(10, 4)
    expect(synced.palettes[0].state.config.hue.end).toBeCloseTo(10, 4)
    expect(synced.palettes[0].state.edited.hue).toBe(true)
  })

  it('syncs all three curves simultaneously with syncAll', () => {
    const doc = run(createDocument(), { type: 'new' })
    const synced = run(doc, { type: 'syncAll' })
    const source = synced.palettes[1].state.config
    const target = synced.palettes[0].state.config
    expect(target.lightness).toEqual(source.lightness)
    expect(target.chroma).toEqual(source.chroma)
    expect(target.hue).toEqual(source.hue)
    expect(synced.palettes[0].state.edited).toEqual({
      lightness: true,
      chroma: true,
      hue: true,
    })
  })
})

describe('document links', () => {
  const seeds = [
    { name: 'brand', config: createPalette('#7c3aed') },
    { name: 'accent', config: { ...createPalette('#facc15'), baseLocked: true } },
    { name: 'grey', config: createPalette('#64748b', 21) },
  ]

  it('round-trips every palette, in order, with its name', () => {
    const back = decodeDocument(`#${encodeDocument(seeds)}`)
    expect(back.map((entry) => entry.name)).toEqual(['brand', 'accent', 'grey'])
    expect(back[1].config.baseLocked).toBe(true)
    expect(back[2].config.steps).toBe(21)
    // Curves survive to the 4 decimals the link is rounded to, which is finer
    // than any control a designer can drag.
    const there = seeds[0].config.lightness
    const back0 = back[0].config.lightness
    expect(back0.start).toBeCloseTo(there.start, 4)
    expect(back0.end).toBeCloseTo(there.end, 4)
    expect(back0.h1.y).toBeCloseTo(there.h1.y, 4)
    expect(back0.h2.y).toBeCloseTo(there.h2.y, 4)
  })

  it('still opens a link made before there was more than one palette', () => {
    const old = encodePalette(seeds[0].config, 'brand')
    const back = decodeDocument(`#${old}`)
    expect(back).toHaveLength(1)
    expect(back[0].name).toBe('brand')
  })

  it('drops a mangled segment rather than losing the whole link', () => {
    const good = encodePalette(seeds[0].config, 'brand')
    const back = decodeDocument(`#${good}~n=nonsense~${encodePalette(seeds[1].config, 'accent')}`)
    expect(back.map((entry) => entry.name)).toEqual(['brand', 'accent'])
  })

  it('returns nothing for an empty hash', () => {
    expect(decodeDocument('')).toEqual([])
    expect(decodeDocument('#')).toEqual([])
  })

  it('adds # only when necessary when reloading base color from save', () => {
    // Bare hex codes should have # restored
    expect(restoreBaseColor('7c3aed')).toBe('#7c3aed')
    expect(restoreBaseColor('f0a')).toBe('#f0a')
    expect(restoreBaseColor('7c3aedff')).toBe('#7c3aedff')
    expect(restoreBaseColor('#7c3aed')).toBe('#7c3aed')

    // CSS color formats must NOT have # added
    expect(restoreBaseColor('oklch(0.6 0.15 240)')).toBe('oklch(0.6 0.15 240)')
    expect(restoreBaseColor('rgb(255 0 0)')).toBe('rgb(255 0 0)')
    expect(restoreBaseColor('hsl(120 50% 50%)')).toBe('hsl(120 50% 50%)')
    expect(restoreBaseColor('color(display-p3 1 0 0)')).toBe('color(display-p3 1 0 0)')
    expect(restoreBaseColor('rebeccapurple')).toBe('rebeccapurple')
  })

  it('preserves oklch base color when encoding and decoding palette', () => {
    const oklchPalette = createPalette('oklch(0.6 0.15 240)')
    const encoded = encodePalette(oklchPalette, 'vibrant')
    const decoded = decodePalette(encoded)
    expect(decoded).not.toBeNull()
    expect(decoded!.config.base).toBe('oklch(0.6 0.15 240)')
    expect(decoded!.config.base.startsWith('#')).toBe(false)
  })
})

/** An in-memory stand-in, since these tests run without a DOM. */
function stubStorage(throws = false) {
  const store = new Map<string, string>()
  const fail = () => {
    throw new Error('storage disabled')
  }
  ;(globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (key: string) => (throws ? fail() : (store.get(key) ?? null)),
      setItem: (key: string, value: string) => (throws ? fail() : store.set(key, value)),
    },
  }
  return store
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window
})

describe('saving', () => {
  const brand = { name: 'brand', config: createPalette('#7c3aed') }
  const accent = { name: 'accent', config: createPalette('#facc15') }

  it('reopens what was saved, including which palette was being edited', () => {
    stubStorage()
    saveDocument([brand, accent], 1)
    const back = restoreDocument('')
    expect(back.seeds.map((entry) => entry.name)).toEqual(['brand', 'accent'])
    expect(back.selected).toBe(1)
  })

  it('opens a shared link on its own when there is nothing saved', () => {
    stubStorage()
    const back = restoreDocument(`#${encodeDocument([brand, accent])}`)
    expect(back.seeds.map((entry) => entry.name)).toEqual(['brand', 'accent'])
    expect(back.selected).toBe(1)
  })

  it('merges a link into the saved document instead of replacing it', () => {
    // Following someone's link must not cost you the palettes you had.
    stubStorage()
    saveDocument([brand], 0)
    const back = restoreDocument(`#${encodeDocument([accent])}`)
    expect(back.seeds.map((entry) => entry.name)).toEqual(['brand', 'accent'])
    // And it lands on the palette the link was sent for.
    expect(back.selected).toBe(1)
  })

  it('adds nothing on a reload, and keeps the palette being edited', () => {
    // A reload sees its own document in the address bar. Merging that back in
    // would duplicate every palette and throw away the selection.
    stubStorage()
    saveDocument([brand, accent], 0)
    const back = restoreDocument(`#${encodeDocument([brand, accent])}`)
    expect(back.seeds).toHaveLength(2)
    expect(back.selected).toBe(0)
  })

  it('falls back to nothing when storage holds rubbish', () => {
    const store = stubStorage()
    store.set('colors.pantoine.com/v1', '{not json')
    expect(restoreDocument('').seeds).toEqual([])
    store.set('colors.pantoine.com/v1', JSON.stringify({ v: 99, hash: 'c=7c3aed' }))
    expect(restoreDocument('').seeds).toEqual([])
  })

  it('survives a browser that refuses storage outright', () => {
    stubStorage(true)
    expect(() => saveDocument([brand], 0)).not.toThrow()
    expect(restoreDocument('').seeds).toEqual([])
    // A link still opens: the address bar does not need permission.
    expect(restoreDocument(`#${encodeDocument([accent])}`).seeds).toHaveLength(1)
  })
})
