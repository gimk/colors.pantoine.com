import { afterEach, describe, expect, it } from 'vitest'
import { flat } from '../color/curve'
import { nameForColor } from '../color/names'
import { formatColor, normalizeHue, parseToOklch, toHex } from '../color/oklch'
import { baseIndexFor, createPalette } from '../color/presets'
import { generateRamp } from '../color/ramp'
import { anyEdited } from './paletteReducer'
import {
  createDocument,
  documentReducer,
  HUE_JITTER,
  MAX_PALETTES,
  NEW_PALETTE_HUE_STEP,
  selectedEntry,
  type DocumentAction,
  type DocumentState,
} from './document'
import { restoreDocument, saveDocument } from './storage'
import {
  decodeDocument,
  decodeGamut,
  decodePalette,
  decodeStepsLocked,
  encodeDocument,
  encodePalette,
  restoreBaseColor,
} from './url'

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
    // Named after whatever colour it landed on, which the quick-add varies.
    expect(doc.palettes[1].name).toBe(nameForColor(doc.palettes[1].state.config.base))
  })

  it('starts a new palette elsewhere on the hue circle', () => {
    // Two identical purple ramps would be no use to anyone building a scheme.
    // The step is the golden angle, give or take the jitter either side of it
    // — plus a few degrees, since the base is stored as hex and a new one is
    // picked at a fresh lightness and chroma, which quantises differently.
    for (let attempt = 0; attempt < 20; attempt++) {
      const doc = run(createDocument(), { type: 'new' })
      const [first, second] = doc.palettes.map((entry) => hueOf(entry.state.config.base))
      const step = normalizeHue(second - first)
      expect(Math.abs(step - NEW_PALETTE_HUE_STEP)).toBeLessThan(HUE_JITTER / 2 + 4)
    }
  })

  it('does not hand out the same colour twice in a run of quick-adds', () => {
    // The reason the step is jittered: a fixed one walks the wheel in a cycle
    // and starts handing back colours the document already has.
    let doc = createDocument()
    for (let i = 0; i < MAX_PALETTES - 1; i++) doc = run(doc, { type: 'new' })
    const bases = doc.palettes.map((entry) => entry.state.config.base)
    expect(new Set(bases).size).toBe(bases.length)
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

  it('reorders palettes by dragging between source and target ids', () => {
    const doc = run(createDocument(), { type: 'new' }, { type: 'new' })
    const [a, b, c] = doc.palettes.map((entry) => entry.id)

    const reordered = run(doc, { type: 'reorder', sourceId: c, targetId: a })
    expect(reordered.palettes.map((entry) => entry.id)).toEqual([c, a, b])

    const reordered2 = run(reordered, { type: 'reorder', sourceId: a, targetId: b })
    expect(reordered2.palettes.map((entry) => entry.id)).toEqual([c, b, a])

    expect(run(doc, { type: 'reorder', sourceId: a, targetId: a })).toBe(doc)
    expect(run(doc, { type: 'reorder', sourceId: a, targetId: 'nope' })).toBe(doc)
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
    expect(doc.stepsLocked).toBe(true)
  })

  it('allows editing steps per palette independently when stepsLocked is false', () => {
    const doc = run(createDocument(), { type: 'new' })
    expect(doc.palettes).toHaveLength(2)
    expect(doc.stepsLocked).toBe(true)

    // Unlock steps
    const unlocked = run(doc, { type: 'setStepsLocked', value: false })
    expect(unlocked.stepsLocked).toBe(false)

    // Change only palette 0's steps
    const p0Id = unlocked.palettes[0].id
    const updated = run(unlocked, { type: 'setPaletteSteps', id: p0Id, value: 7 })
    expect(updated.palettes[0].state.config.steps).toBe(7)
    expect(updated.palettes[1].state.config.steps).toBe(11)

    // When unlocked, palette-scoped setSteps modifies only the active palette
    const active = run(updated, {
      type: 'palette',
      action: { type: 'setSteps', value: 15 },
    })
    // Palette 1 is selected
    expect(active.palettes[1].state.config.steps).toBe(15)
    expect(active.palettes[0].state.config.steps).toBe(7)
  })

  it('synchronizes all palettes to active palette when locking steps back on', () => {
    const doc = run(
      createDocument(),
      { type: 'new' },
      { type: 'setStepsLocked', value: false },
    )
    const p0Id = doc.palettes[0].id
    const mixed = run(doc, { type: 'setPaletteSteps', id: p0Id, value: 5 })
    expect(mixed.palettes[0].state.config.steps).toBe(5)
    expect(mixed.palettes[1].state.config.steps).toBe(11)

    // Selected palette is palette 1 (steps: 11)
    const relocked = run(mixed, { type: 'setStepsLocked', value: true })
    expect(relocked.stepsLocked).toBe(true)
    expect(relocked.palettes[0].state.config.steps).toBe(11)
    expect(relocked.palettes[1].state.config.steps).toBe(11)
  })

  it('preserves individual palette steps when stepsLocked is false', () => {
    const mixedSeeds = [
      { name: 'brand', config: createPalette('#7c3aed', 9) },
      { name: 'accent', config: createPalette('#facc15', 13) },
    ]
    const doc = createDocument(mixedSeeds, -1, 'srgb', false)
    expect(doc.stepsLocked).toBe(false)
    expect(doc.palettes[0].state.config.steps).toBe(9)
    expect(doc.palettes[1].state.config.steps).toBe(13)
  })

  it('carries the steps lock through a link, so per-palette steps survive', () => {
    // Encoding without the lock loses more than a toggle: reopening locked
    // synchronises every palette to the first one's step count, so a 5-step
    // palette comes back as an 11 and the work is gone.
    const unlocked = run(
      createDocument(),
      { type: 'new' },
      { type: 'setStepsLocked', value: false },
    )
    const doc = run(unlocked, {
      type: 'setPaletteSteps',
      id: unlocked.palettes[1].id,
      value: 5,
    })
    expect(doc.palettes.map((entry) => entry.state.config.steps)).toEqual([11, 5])

    const seeds = doc.palettes.map((entry) => ({
      config: entry.state.config,
      name: entry.name,
    }))
    const hash = encodeDocument(seeds, doc.gamut, doc.stepsLocked)
    expect(decodeStepsLocked(hash)).toBe(false)

    const reopened = createDocument(
      decodeDocument(hash),
      -1,
      doc.gamut,
      decodeStepsLocked(hash),
    )
    expect(reopened.stepsLocked).toBe(false)
    expect(reopened.palettes.map((entry) => entry.state.config.steps)).toEqual([11, 5])
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

  it('copies to the palettes named, and to no others', () => {
    const doc = run(createDocument(), { type: 'new' }, { type: 'new' })
    const withCustom = run(doc, {
      type: 'palette',
      action: { type: 'setCurve', key: 'hue', curve: flat(14) },
    })
    // `new` selects what it appends, so the edit above landed on the third.
    const [first, second, third] = withCustom.palettes
    expect(selectedEntry(withCustom).id).toBe(third.id)

    const synced = run(withCustom, { type: 'syncChannel', key: 'hue', to: [second.id] })
    expect(synced.palettes[1].state.config.hue.start).toBeCloseTo(14, 4)
    expect(synced.palettes[1].state.edited.hue).toBe(true)
    // By identity: an untouched palette must come back as the very entry it
    // was, or the pass reads as an edit and history records one.
    expect(synced.palettes[0]).toBe(first)
  })

  it('does nothing when the list of palettes to copy to is empty', () => {
    const doc = run(createDocument(), { type: 'new' })
    const withCustom = run(doc, {
      type: 'palette',
      action: { type: 'setCurve', key: 'hue', curve: flat(14) },
    })
    expect(run(withCustom, { type: 'syncChannel', key: 'hue', to: [] })).toBe(withCustom)
  })

  it('ignores a palette that has since been deleted', () => {
    const doc = run(createDocument(), { type: 'new' })
    const withCustom = run(doc, {
      type: 'palette',
      action: { type: 'setCurve', key: 'hue', curve: flat(14) },
    })
    expect(run(withCustom, { type: 'syncChannel', key: 'hue', to: ['gone'] })).toBe(withCustom)
  })
})

/**
 * Why `commitValue` has to guard the unchanged case: an endpoint commit is
 * always an edit, whatever value it carries. There is nothing to compare
 * against down here — a curve that has been corrected to hold a locked base
 * legitimately comes back with the endpoint the caller asked for — so the
 * field is the only place that knows the designer did not move anything.
 */
describe('committing an endpoint', () => {
  it('counts as hand-editing the channel, even at the value it already had', () => {
    const before = createDocument()
    const { start } = before.palettes[0].state.config.lightness
    expect(before.palettes[0].state.edited.lightness).toBe(false)

    const after = run(before, {
      type: 'palette',
      action: { type: 'setEndpoint', key: 'lightness', end: 'start', value: start },
    })
    expect(after).not.toBe(before)
    expect(after.palettes[0].state.edited.lightness).toBe(true)
  })
})

describe('setting base color', () => {
  it('updates lightness and chroma curves when setting a new base color with baseLocked off', () => {
    const doc = createDocument()
    const initialConfig = doc.palettes[0].state.config
    expect(initialConfig.baseLocked).toBe(false)

    // Set a light yellow base color
    const yellow = '#facc15'
    const updated = run(doc, {
      type: 'palette',
      action: { type: 'setBase', value: yellow },
    })
    const newConfig = updated.palettes[0].state.config
    expect(newConfig.base).toBe(yellow)
    // Lightness and chroma must be derived for the new yellow base, not left untouched
    expect(newConfig.lightness).not.toEqual(initialConfig.lightness)
    expect(newConfig.chroma).not.toEqual(initialConfig.chroma)
  })

  it('locks base position against color changes when baseLocked is true, while still allowing user to change baseIndex', () => {
    const doc = createDocument()
    // Lock the base
    const locked = run(doc, {
      type: 'palette',
      action: { type: 'setBaseLocked', value: true },
    })
    const initialIndex = locked.palettes[0].state.config.baseIndex
    expect(locked.palettes[0].state.config.baseLocked).toBe(true)

    // User can still manually change baseIndex
    const newIndex = (initialIndex + 2) % locked.palettes[0].state.config.steps
    const afterUserChange = run(locked, {
      type: 'palette',
      action: { type: 'setBaseIndex', value: newIndex },
    })
    expect(afterUserChange.palettes[0].state.config.baseIndex).toBe(newIndex)

    // Setting a very dark base color retains the locked baseIndex rather than jumping to nearestStep
    const afterDarkBase = run(afterUserChange, {
      type: 'palette',
      action: { type: 'setBase', value: '#050505' },
    })
    expect(afterDarkBase.palettes[0].state.config.baseIndex).toBe(newIndex)
  })

  it('keeps a locked base where it is when the curves are re-derived', () => {
    const start = run(createDocument(), {
      type: 'palette',
      action: { type: 'setBaseLocked', value: true },
    })
    const moved = run(start, { type: 'palette', action: { type: 'setBaseIndex', value: 2 } })
    expect(moved.palettes[0].state.config.baseIndex).toBe(2)

    const rederived = run(moved, { type: 'palette', action: { type: 'rederive' } })
    const config = rederived.palettes[0].state.config
    expect(config.baseIndex).toBe(2)
    expect(config.baseLocked).toBe(true)

    // Kept in the ramp, not merely in the number: the default curves are
    // solved to pass through the base at whatever index they are given, so
    // step 2 must still be the colour that was typed.
    const base = parseToOklch(config.base)!
    const swatch = generateRamp(config, rederived.gamut)[2]
    expect(swatch.oklch.l).toBeCloseTo(base.l, 2)
    expect(swatch.isBase).toBe(true)

    // And the re-derive really did rebuild: nothing is marked hand-edited.
    expect(anyEdited(rederived.palettes[0].state.edited)).toBe(false)
  })

  it('re-derives an unlocked base back to where its lightness falls', () => {
    const moved = run(createDocument(), {
      type: 'palette',
      action: { type: 'setBaseIndex', value: 1 },
    })
    expect(moved.palettes[0].state.config.baseIndex).toBe(1)
    expect(moved.palettes[0].state.config.baseLocked).toBe(false)

    const rederived = run(moved, { type: 'palette', action: { type: 'rederive' } })
    const config = rederived.palettes[0].state.config
    expect(config.baseIndex).toBe(baseIndexFor(parseToOklch(config.base)!, config.steps))
    expect(config.baseIndex).not.toBe(1)
  })

  it('renames a still-derived palette to the colour that was picked', () => {
    const doc = createDocument()
    expect(doc.palettes[0].name).toBe('brand')

    const orange = run(doc, {
      type: 'palette',
      action: { type: 'setBase', value: '#ff5722' },
    })
    expect(orange.palettes[0].name).toBe('Smashing Pumpkins')

    // And again: the name tracks the colour for as long as it is derived.
    const blue = run(orange, {
      type: 'palette',
      action: { type: 'setBase', value: '#1e88e5' },
    })
    expect(blue.palettes[0].name).toBe('Bleu de France')
  })

  it('leaves a name the designer typed alone', () => {
    const start = createDocument()
    const named = run(start, {
      type: 'rename',
      id: start.palettes[0].id,
      name: 'My Custom Brand',
    })
    expect(named.palettes[0].name).toBe('My Custom Brand')

    const edited = run(named, {
      type: 'palette',
      action: { type: 'setBase', value: '#00ff66' },
    })
    expect(edited.palettes[0].name).toBe('My Custom Brand')
  })

  it('holds the last good name while a hex is half typed', () => {
    // The base field keeps unparseable input so the designer can finish
    // typing; the name must not flicker through `nameForColor`'s fallback.
    const start = run(createDocument(), {
      type: 'palette',
      action: { type: 'setBase', value: '#ff5722' },
    })
    expect(start.palettes[0].name).toBe('Smashing Pumpkins')

    const midTyping = run(
      start,
      { type: 'palette', action: { type: 'setBase', value: '#' } },
      { type: 'palette', action: { type: 'setBase', value: '#1' } },
      { type: 'palette', action: { type: 'setBase', value: '#1e' } },
    )
    expect(midTyping.palettes[0].name).toBe('Smashing Pumpkins')

    const finished = run(midTyping, {
      type: 'palette',
      action: { type: 'setBase', value: '#1e88e5' },
    })
    expect(finished.palettes[0].name).toBe('Bleu de France')
  })

  it('hands the name back to the colour when the field is cleared', () => {
    const start = createDocument()
    const id = start.palettes[0].id
    const named = run(start, { type: 'rename', id, name: 'Mine' })
    const cleared = run(named, { type: 'rename', id, name: '' })
    // The name the default violet base derives to, not the `brand` it opened
    // with: clearing the field asks for the colour's own name.
    expect(cleared.palettes[0].name).toBe('Bluish Purple')

    // Cleared is not just a name change: the palette follows the colour again.
    const edited = run(cleared, {
      type: 'palette',
      action: { type: 'setBase', value: '#ff5722' },
    })
    expect(edited.palettes[0].name).toBe('Smashing Pumpkins')
  })

  it('does not take a name another palette is already using', () => {
    const two = run(createDocument(), { type: 'add', bases: [{ base: '#ff5722' }] })
    expect(two.palettes[1].name).toBe('Smashing Pumpkins')

    // The second palette is selected after an add, so steer the first one
    // onto the colour the second already answers to.
    const collided = run(
      two,
      { type: 'select', id: two.palettes[0].id },
      { type: 'palette', action: { type: 'setBase', value: '#ff5722' } },
    )
    expect(collided.palettes[0].name).toBe('Smashing Pumpkins 2')
    expect(collided.palettes[1].name).toBe('Smashing Pumpkins')
  })

  it('carries whether the name was typed through a link and back', () => {
    const start = createDocument()
    const id = start.palettes[0].id
    const doc = run(
      start,
      { type: 'rename', id, name: 'Mine' },
      { type: 'add', bases: [{ base: '#1e88e5' }] },
    )

    const seeds = doc.palettes.map((entry) => ({
      config: entry.state.config,
      name: entry.name,
      nameCustom: entry.nameCustom,
    }))
    const reopened = createDocument(decodeDocument(encodeDocument(seeds)))

    expect(reopened.palettes.map((entry) => entry.name)).toEqual(['Mine', 'Bleu de France'])

    // The typed name survives an edit; the derived one still follows.
    const edited = run(
      reopened,
      { type: 'select', id: reopened.palettes[0].id },
      { type: 'palette', action: { type: 'setBase', value: '#ff5722' } },
      { type: 'select', id: reopened.palettes[1].id },
      { type: 'palette', action: { type: 'setBase', value: '#facc15' } },
    )
    expect(edited.palettes.map((entry) => entry.name)).toEqual(['Mine', 'Goldenrod'])
  })

  it('infers a typed name from a link written before the flag existed', () => {
    // Legacy segments carry no `nc`, so the name itself has to say. A derived
    // name goes on following the colour; anything else is treated as typed.
    const derived = decodePalette(encodePalette(createPalette('#7c3aed'), 'Bluish Purple'))!
    expect(derived.nameCustom).toBeUndefined()
    const followed = run(createDocument([derived]), {
      type: 'palette',
      action: { type: 'setBase', value: '#ff5722' },
    })
    expect(followed.palettes[0].name).toBe('Smashing Pumpkins')

    const typed = decodePalette(encodePalette(createPalette('#7c3aed'), 'Grape Soda'))!
    const kept = run(createDocument([typed]), {
      type: 'palette',
      action: { type: 'setBase', value: '#ff5722' },
    })
    expect(kept.palettes[0].name).toBe('Grape Soda')
  })
})

describe('the document gamut', () => {
  it('is sRGB unless a link or a save says otherwise', () => {
    expect(createDocument().gamut).toBe('srgb')
    expect(createDocument([], -1, 'p3').gamut).toBe('p3')
  })

  it('survives every action that rebuilds the stack', () => {
    const doc = run(createDocument([], -1, 'rec2020'), { type: 'new' }, { type: 'new' })
    expect(doc.gamut).toBe('rec2020')
    expect(run(doc, { type: 'remove', id: doc.palettes[0].id }).gamut).toBe('rec2020')
    expect(run(doc, { type: 'setSteps', value: 9 }).gamut).toBe('rec2020')
  })

  it('builds a new palette for the gamut the document is in', () => {
    const wide = run(createDocument([], -1, 'rec2020'), { type: 'new' })
    const narrow = run(createDocument(), { type: 'new' })
    expect(wide.palettes[1].state.config.chroma).not.toEqual(
      narrow.palettes[1].state.config.chroma,
    )
  })

  /**
   * The same rule `setBaseIndex` already follows: a derived chroma curve is
   * a fraction of a ceiling, so a new ceiling makes it stale, while an
   * edited curve is the designer's and is left alone.
   */
  it('rebuilds an underived chroma curve, and leaves an edited one', () => {
    const before = createDocument()
    const after = run(before, { type: 'setGamut', value: 'rec2020' })
    expect(after.gamut).toBe('rec2020')
    expect(after.palettes[0].state.config.chroma).not.toEqual(
      before.palettes[0].state.config.chroma,
    )

    const byHand = run(before, {
      type: 'palette',
      action: { type: 'setCurve', key: 'chroma', curve: flat(0.09) },
    })
    const kept = run(byHand, { type: 'setGamut', value: 'rec2020' })
    expect(kept.palettes[0].state.config.chroma).toEqual(
      byHand.palettes[0].state.config.chroma,
    )
  })

  it('declines a gamut it is already in', () => {
    const doc = run(createDocument(), { type: 'setGamut', value: 'p3' })
    expect(run(doc, { type: 'setGamut', value: 'p3' })).toBe(doc)
  })
})

/**
 * Applying a curve a palette already has is not an edit. The reducers report
 * "nothing happened" by identity, and history records an entry for any new
 * state, so a second click of Apply all must hand back the same object.
 */
describe('syncing curves twice', () => {
  const twice = (action: DocumentAction) => {
    const doc = run(createDocument(), { type: 'new' }, action)
    return [doc, run(doc, action)] as const
  }

  it('changes nothing the second time, for one channel or another', () => {
    for (const action of [
      { type: 'syncChannel', key: 'hue' },
      { type: 'syncChannel', key: 'chroma' },
    ] as DocumentAction[]) {
      const [once, again] = twice(action)
      expect(again).toBe(once)
    }
  })

  it('still applies the first time', () => {
    const doc = run(
      createDocument(),
      { type: 'new' },
      { type: 'palette', action: { type: 'setCurve', key: 'hue', curve: flat(12) } },
    )
    const synced = run(doc, { type: 'syncChannel', key: 'hue' })
    expect(synced).not.toBe(doc)
    expect(synced.palettes[0].state.config.hue).toEqual(flat(12))
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

  /**
   * The gamut decides how much chroma every curve asked for, so a link
   * without it would open someone else's palette as different colours.
   */
  it('carries the gamut, without disturbing the palettes', () => {
    const hash = `#${encodeDocument(seeds, 'rec2020')}`
    expect(decodeGamut(hash)).toBe('rec2020')
    expect(decodeDocument(hash).map((entry) => entry.name)).toEqual(['brand', 'accent', 'grey'])
  })

  it('says nothing at the default, so an ordinary link is unchanged', () => {
    expect(encodeDocument(seeds, 'srgb')).toBe(encodeDocument(seeds))
    expect(decodeGamut(`#${encodeDocument(seeds)}`)).toBe('srgb')
  })

  it('reads a link made before there was a gamut as sRGB', () => {
    expect(decodeGamut(`#${encodePalette(seeds[0].config, 'brand')}`)).toBe('srgb')
    expect(decodeGamut('')).toBe('srgb')
  })

  it('ignores a gamut that is not one of ours', () => {
    expect(decodeGamut(`#g=cmyk~${encodePalette(seeds[0].config, 'brand')}`)).toBe('srgb')
  })

  it('carries the steps lock state in the link', () => {
    const lockedHash = `#${encodeDocument(seeds, 'srgb', true)}`
    expect(decodeStepsLocked(lockedHash)).toBe(true)

    const unlockedHash = `#${encodeDocument(seeds, 'srgb', false)}`
    expect(unlockedHash).toContain('u=1')
    expect(decodeStepsLocked(unlockedHash)).toBe(false)
  })

  it('decodes unlocked steps from links containing the u=1 flag', () => {
    const mixed = [
      { name: 'nine', config: createPalette('#0044ff', 9) },
      { name: 'eleven', config: createPalette('#ff0044', 11) },
    ]
    const hash = `#${encodeDocument(mixed, 'srgb', false)}`
    expect(decodeStepsLocked(hash)).toBe(false)
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
    expect(back.gamut).toBe('srgb')
  })

  it('reopens in the gamut it was saved in', () => {
    stubStorage()
    saveDocument([brand, accent], 1, 'p3')
    expect(restoreDocument('').gamut).toBe('p3')
  })

  it('opens a link in the gamut it was made in, not the one saved', () => {
    stubStorage()
    saveDocument([brand], 0, 'srgb')
    expect(restoreDocument(`#${encodeDocument([accent], 'rec2020')}`).gamut).toBe('rec2020')
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

describe('adding palettes in a batch', () => {
  const add = (state: DocumentState, bases: { base: string; name?: string }[]) =>
    documentReducer(state, { type: 'add', bases })

  const namesOf = (state: DocumentState) => state.palettes.map((entry) => entry.name)

  it('appends one palette per colour, in the order given', () => {
    const doc = add(createDocument(), [
      { base: '#ff5722' },
      { base: 'rgb(30 136 229)' },
      { base: 'oklch(0.7 0.15 150)' },
    ])
    expect(doc.palettes).toHaveLength(4)
    expect(doc.palettes.slice(1).map((entry) => entry.state.config.base)).toEqual([
      '#ff5722',
      'rgb(30 136 229)',
      'oklch(0.7 0.15 150)',
    ])
  })

  it('lands on the first of the batch, not the last', () => {
    // The same rule a shared link follows: the first one is the one whoever
    // asked for them named first.
    const doc = add(createDocument(), [{ base: '#ff0000' }, { base: '#00ff00' }])
    expect(selectedEntry(doc).id).toBe(doc.palettes[1].id)
  })

  it('hands back the state it was given when there is nothing to add', () => {
    const doc = createDocument()
    expect(add(doc, [])).toBe(doc)
    // An undo entry that undoes nothing is worse than no entry at all.
    expect(add(doc, [{ base: 'not a colour' }, { base: '' }])).toBe(doc)
  })

  it('drops what it cannot parse and keeps the rest', () => {
    // Unlike the base field, a batch has no field left to keep typing in, so a
    // bad string would persist through storage and links with no way to heal.
    const doc = add(createDocument(), [
      { base: '#ff0000' },
      { base: 'not a colour' },
      { base: '#0000ff' },
    ])
    expect(doc.palettes).toHaveLength(3)
    expect(doc.palettes.every((entry) => parseToOklch(entry.state.config.base))).toBe(true)
  })

  it('trims whitespace off a pasted colour', () => {
    const doc = add(createDocument(), [{ base: '  #ff5722\t' }])
    expect(doc.palettes[1].state.config.base).toBe('#ff5722')
  })

  it('names a palette after its colour when it is not given one', () => {
    const doc = add(createDocument(), [{ base: '#ff5722' }, { base: '#1e88e5' }])
    expect(namesOf(doc)).toEqual(['brand', 'Smashing Pumpkins', 'Bleu de France'])
  })

  it('keeps the name it is given', () => {
    const doc = add(createDocument(), [{ base: '#ff5722', name: 'triad 1' }])
    expect(doc.palettes[1].name).toBe('triad 1')
  })

  it('never repeats a name, inside a batch or across them', () => {
    // Names ride in the encoded link segment, and the link merge de-dupes
    // segments through a Set — so two identical names can lose a palette.
    const once = add(createDocument(), [{ base: '#ff5722' }, { base: '#ff5722' }])
    expect(namesOf(once)).toEqual(['brand', 'Smashing Pumpkins', 'Smashing Pumpkins 2'])

    const twice = add(once, [{ base: '#ff5722' }])
    expect(new Set(namesOf(twice)).size).toBe(namesOf(twice).length)
  })

  it('does not reuse a name freed by a removal', () => {
    const doc = add(createDocument(), [{ base: '#ff5722' }])
    const removed = documentReducer(doc, { type: 'remove', id: doc.palettes[0].id })
    const again = add(removed, [{ base: '#ff5722' }])
    expect(new Set(namesOf(again)).size).toBe(namesOf(again).length)
  })

  it('inherits the document step count and gamut', () => {
    const doc = run(createDocument([], -1, 'rec2020'), { type: 'setSteps', value: 15 })
    const added = add(doc, [{ base: '#00ff66' }])
    expect(added.palettes[1].state.config.steps).toBe(15)
    // Derived against the wide ceiling, so the curve differs from the sRGB one.
    const srgb = add(createDocument(), [{ base: '#00ff66' }])
    expect(added.palettes[1].state.config.chroma).not.toEqual(
      srgb.palettes[1].state.config.chroma,
    )
  })

  it('truncates at the cap rather than refusing the whole batch', () => {
    const many = Array.from({ length: MAX_PALETTES + 10 }, (_, i) => ({
      base: `oklch(0.6 0.15 ${i * 7})`,
    }))
    const doc = add(createDocument(), many)
    expect(doc.palettes).toHaveLength(MAX_PALETTES)
    expect(add(doc, [{ base: '#ff0000' }])).toBe(doc)
  })

  it('survives a share link with its bases and names intact', () => {
    const doc = add(createDocument(), [
      { base: formatColor(parseToOklch('#00ff66')!, 'oklch'), name: 'triad 1' },
      { base: '#ff5722' },
    ])
    const seeds = doc.palettes.map((entry) => ({
      config: entry.state.config,
      name: entry.name,
    }))
    const back = decodeDocument(`#${encodeDocument(seeds)}`)
    expect(back.map((entry) => entry.name)).toEqual(['brand', 'triad 1', 'Smashing Pumpkins'])
    expect(back[1].config.base).toBe(seeds[1].config.base)
    // A computed candidate has no original text, so it travels as oklch() and
    // takes a rounding: one decimal of lightness moves a colour sitting on the
    // sRGB boundary by a single 8-bit step. A pasted colour goes through
    // verbatim instead, and takes none.
    expect(toHex(parseToOklch(back[2].config.base)!)).toBe('#ff5722')
    const revived = parseToOklch(back[1].config.base)!
    const original = parseToOklch('#00ff66')!
    expect(revived.h).toBeCloseTo(original.h, 1)
    expect(revived.c).toBeCloseTo(original.c, 3)
  })
})
