import { describe, expect, it } from 'vitest'
import { parseToOklch, toHex } from '../color/oklch'
import { createPalette } from '../color/presets'
import { AUTO_RULE, MAX_SLOTS, MIN_SLOTS, type Slot } from '../color/scheme'
import { canRedo, canUndo, initHistory, withHistory } from './history'
import {
  coalesceKey,
  createScheme,
  newSlot,
  schemeReducer,
  type SchemeAction,
  type SchemeState,
} from './scheme'
import {
  decodeDocument,
  decodeGamut,
  decodeMode,
  decodeScheme,
  encodeDocument,
  encodeScheme,
} from './url'

const run = (state: SchemeState, ...actions: SchemeAction[]) =>
  actions.reduce((current, action) => schemeReducer(current, action), state)

const start = (): SchemeState => createScheme([], 'triad', 'even', 'srgb', 1)

const seeded = (colors: number[][], locked: number[] = []): SchemeState =>
  createScheme(
    colors.map(([l, c, h], index) => newSlot({ l, c, h }, locked.includes(index))),
    'triad',
    'even',
    'srgb',
  )

describe('createScheme', () => {
  it('opens on a rolled scheme rather than a fixed one', () => {
    const a = createScheme([], AUTO_RULE, 'even', 'srgb', 1)
    const b = createScheme([], AUTO_RULE, 'even', 'srgb', 2)
    expect(a.slots).toHaveLength(5)
    expect(a.slots.map((s) => s.color)).not.toEqual(b.slots.map((s) => s.color))
  })

  it('gives every slot an id of its own', () => {
    const { slots } = start()
    expect(new Set(slots.map((slot) => slot.id)).size).toBe(slots.length)
  })

  it('keeps the slots it was handed, and claims no rule for them', () => {
    const state = seeded([[0.5, 0.1, 0], [0.7, 0.1, 90]])
    expect(state.slots).toHaveLength(2)
    expect(state.rolled).toBeNull()
  })
})

describe('generate', () => {
  it('replaces the colours and reports the rule it used', () => {
    const before = start()
    const after = run(before, { type: 'generate', seed: 99 })
    expect(after.slots.map((s) => s.color)).not.toEqual(before.slots.map((s) => s.color))
    expect(after.rolled).toBe('triad')
  })

  it('is reproducible from its seed, so an undo replays to the same colours', () => {
    const before = start()
    const a = run(before, { type: 'generate', seed: 7 })
    const b = run(before, { type: 'generate', seed: 7 })
    expect(a).toEqual(b)
  })

  it('holds locked slots and leaves the rest to the roll', () => {
    const before = run(start(), { type: 'toggleLock', id: 'nope' })
    const locked = before.slots[1].id
    const held = run(before, { type: 'toggleLock', id: locked })
    const after = run(held, { type: 'generate', seed: 3 })
    expect(after.slots[1]).toBe(held.slots[1])
    expect(after.slots[0].color).not.toEqual(held.slots[0].color)
  })

  it('changes nothing, and records nothing, when everything is locked', () => {
    let state = start()
    for (const slot of state.slots) {
      state = run(state, { type: 'toggleLock', id: slot.id })
    }
    expect(run(state, { type: 'generate', seed: 5 })).toBe(state)
  })

  it('resolves auto to a real rule and reports it', () => {
    const state = run(
      { ...start(), rule: AUTO_RULE },
      { type: 'generate', seed: 21 },
    )
    expect(state.rolled).not.toBeNull()
    expect(state.rule).toBe(AUTO_RULE)
  })
})

describe('slots', () => {
  it('toggles a lock, and declines an id it does not have', () => {
    const before = start()
    const id = before.slots[2].id
    const after = run(before, { type: 'toggleLock', id })
    expect(after.slots[2].locked).toBe(true)
    expect(run(after, { type: 'toggleLock', id }).slots[2].locked).toBe(false)
    expect(run(before, { type: 'toggleLock', id: 'ghost' })).toBe(before)
  })

  it('locks a slot whose colour was set by hand', () => {
    const before = start()
    const id = before.slots[0].id
    const after = run(before, { type: 'setColor', id, color: { l: 0.4, c: 0.2, h: 200 } })
    expect(after.slots[0].color).toEqual({ l: 0.4, c: 0.2, h: 200 })
    expect(after.slots[0].locked).toBe(true)
  })

  it('declines a colour that is already the one it has', () => {
    const before = start()
    const { id, color } = before.slots[0]
    expect(run(before, { type: 'setColor', id, color })).toBe(before)
  })

  it('adds up to the cap and no further', () => {
    let state = start()
    while (state.slots.length < MAX_SLOTS) state = run(state, { type: 'add' })
    expect(state.slots).toHaveLength(MAX_SLOTS)
    expect(run(state, { type: 'add' })).toBe(state)
  })

  it('removes down to the floor and no further', () => {
    let state = start()
    while (state.slots.length > MIN_SLOTS) {
      state = run(state, { type: 'remove', id: state.slots[0].id })
    }
    expect(state.slots).toHaveLength(MIN_SLOTS)
    expect(run(state, { type: 'remove', id: state.slots[0].id })).toBe(state)
    expect(run(state, { type: 'remove', id: 'ghost' })).toBe(state)
  })

  it('gives an added slot an id nothing else has', () => {
    const state = run(start(), { type: 'add' }, { type: 'add' })
    expect(new Set(state.slots.map((s) => s.id)).size).toBe(state.slots.length)
  })

  it('reorders, and declines a move that goes nowhere', () => {
    const before = start()
    const [first, second] = before.slots
    const after = run(before, { type: 'reorder', sourceId: first.id, targetId: second.id })
    expect(after.slots[0].id).toBe(second.id)
    expect(after.slots[1].id).toBe(first.id)
    expect(run(before, { type: 'reorder', sourceId: first.id, targetId: first.id })).toBe(before)
    expect(run(before, { type: 'reorder', sourceId: 'ghost', targetId: first.id })).toBe(before)
  })

  it('sets a count in both directions, clamped', () => {
    const before = start()
    expect(run(before, { type: 'setCount', value: 3 }).slots).toHaveLength(3)
    expect(run(before, { type: 'setCount', value: 8 }).slots).toHaveLength(8)
    expect(run(before, { type: 'setCount', value: 99 }).slots).toHaveLength(MAX_SLOTS)
    expect(run(before, { type: 'setCount', value: 0 }).slots).toHaveLength(MIN_SLOTS)
    expect(run(before, { type: 'setCount', value: before.slots.length })).toBe(before)
  })

  it('keeps the slots it did not trim', () => {
    const before = start()
    const after = run(before, { type: 'setCount', value: 3 })
    expect(after.slots.map((s) => s.id)).toEqual(before.slots.slice(0, 3).map((s) => s.id))
  })
})

describe('settings', () => {
  it('sets the rule and the profile, and declines a repeat', () => {
    const before = start()
    expect(run(before, { type: 'setRule', value: 'square' }).rule).toBe('square')
    expect(run(before, { type: 'setRule', value: 'triad' })).toBe(before)
    expect(run(before, { type: 'setProfile', value: 'pastel' }).profile).toBe('pastel')
    expect(run(before, { type: 'setProfile', value: 'even' })).toBe(before)
  })

  it('loads a scheme wholesale, and drops the rule that described the old one', () => {
    const before = run(start(), { type: 'generate', seed: 4 })
    expect(before.rolled).not.toBeNull()
    const incoming: Slot[] = [
      newSlot({ l: 0.5, c: 0.1, h: 10 }, true),
      newSlot({ l: 0.7, c: 0.1, h: 200 }),
    ]
    const after = run(before, { type: 'load', slots: incoming })
    expect(after.slots).toBe(incoming)
    expect(after.slots[0].locked).toBe(true)
    expect(after.rolled).toBeNull()
    expect(run(before, { type: 'load', slots: [] })).toBe(before)
  })
})

describe('undo', () => {
  const reducer = withHistory<SchemeState, SchemeAction>(
    (state, action) => schemeReducer(state, action),
    { coalesce: coalesceKey },
  )

  it('steps back through generates one roll at a time', () => {
    // The reason the mode is worth building on this history: mash the key,
    // then walk back to the roll you liked.
    let history = initHistory(start())
    const seen = [history.present.slots.map((s) => s.color)]
    for (const seed of [1, 2, 3, 4]) {
      history = reducer(history, { type: 'do', action: { type: 'generate', seed }, at: seed })
      seen.push(history.present.slots.map((s) => s.color))
    }
    expect(canUndo(history)).toBe(true)
    for (let back = seen.length - 2; back >= 0; back -= 1) {
      history = reducer(history, { type: 'undo' })
      expect(history.present.slots.map((s) => s.color)).toEqual(seen[back])
    }
    expect(canUndo(history)).toBe(false)
    expect(canRedo(history)).toBe(true)
  })

  it('collapses a drag in the picker into one entry', () => {
    let history = initHistory(start())
    const id = history.present.slots[0].id
    for (let step = 0; step < 8; step += 1) {
      history = reducer(history, {
        type: 'do',
        action: { type: 'setColor', id, color: { l: 0.3 + step / 40, c: 0.1, h: 90 } },
        at: 1000 + step * 20,
      })
    }
    expect(history.past).toHaveLength(1)
    history = reducer(history, { type: 'undo' })
    expect(history.present.slots[0].locked).toBe(false)
  })

  it('does not merge two generates, however fast they arrive', () => {
    let history = initHistory(start())
    history = reducer(history, { type: 'do', action: { type: 'generate', seed: 1 }, at: 0 })
    history = reducer(history, { type: 'do', action: { type: 'generate', seed: 2 }, at: 1 })
    expect(history.past).toHaveLength(2)
  })

  it('records nothing for an action the reducer declined', () => {
    let history = initHistory(start())
    history = reducer(history, {
      type: 'do',
      action: { type: 'setRule', value: 'triad' },
      at: 0,
    })
    expect(canUndo(history)).toBe(false)
  })
})

describe('coalesce', () => {
  it('merges only colour edits, and only per slot', () => {
    expect(coalesceKey({ type: 'setColor', id: 'a', color: { l: 0, c: 0, h: 0 } })).toBe('color:a')
    expect(coalesceKey({ type: 'setColor', id: 'b', color: { l: 0, c: 0, h: 0 } })).toBe('color:b')
    expect(coalesceKey({ type: 'generate', seed: 1 })).toBeNull()
    expect(coalesceKey({ type: 'add' })).toBeNull()
    expect(coalesceKey({ type: 'toggleLock', id: 'a' })).toBeNull()
  })
})

describe('the scheme in a link', () => {
  const slots = [
    newSlot({ l: 0.92, c: 0.04, h: 60 }, true),
    newSlot({ l: 0.62, c: 0.16, h: 190 }),
    newSlot({ l: 0.3, c: 0.1, h: 300 }),
  ]

  it('round-trips the colours, the locks and the settings', () => {
    const hash = encodeScheme(slots, 'split', 'muted')
    const back = decodeScheme(hash)!
    expect(back.colors).toHaveLength(3)
    expect(back.locks).toEqual([true, false, false])
    expect(back.rule).toBe('split')
    expect(back.profile).toBe('muted')
    back.colors.forEach((entry, index) => {
      const color = parseToOklch(entry)!
      // Through hex and back, so the round trip is exact to eight bits and no
      // further — which is the promise the whole hash format makes.
      expect(toHex(color)).toBe(toHex(slots[index].color))
    })
  })

  it('writes no lock key at all when nothing is locked', () => {
    const bare = slots.map((slot) => ({ ...slot, locked: false }))
    expect(encodeScheme(bare, AUTO_RULE, 'even')).not.toContain('sl=')
    expect(decodeScheme(encodeScheme(bare, AUTO_RULE, 'even'))!.locks).toEqual([
      false,
      false,
      false,
    ])
  })

  it('is dropped by the palette decoder rather than opened as a palette', () => {
    // The compatibility promise: an older reader, and the ramp decoder in this
    // one, must both skip a segment they do not recognise.
    const hash = `${encodeScheme(slots, 'triad', 'even')}`
    expect(decodeDocument(hash)).toEqual([])
  })

  it('travels beside a document without either reading the other', () => {
    const doc = encodeDocument(
      [{ config: createPalette('#7c3aed', 11), name: 'brand' }],
      'p3',
      true,
    )
    const hash = `${doc}~${encodeScheme(slots, 'square', 'vivid')}`
    expect(decodeDocument(hash)).toHaveLength(1)
    expect(decodeDocument(hash)[0].name).toBe('brand')
    expect(decodeScheme(hash)!.rule).toBe('square')
    expect(decodeGamut(hash)).toBe('p3')
  })

  it('has no scheme in a link that carries none', () => {
    expect(decodeScheme('')).toBeNull()
    expect(decodeScheme('#')).toBeNull()
    expect(decodeScheme(encodeDocument([{ config: createPalette('#000'), name: 'x' }]))).toBeNull()
  })

  it('drops a colour that will not parse rather than failing the link', () => {
    const back = decodeScheme('sc=ff0000-notacolour-0000ff&sr=triad&sp=even')!
    expect(back.colors).toHaveLength(2)
    expect(back.rule).toBe('triad')
  })

  it('ignores a lock mask that does not match the colours', () => {
    // Worse than no locks: locks pinned to the wrong colours.
    const back = decodeScheme('sc=ff0000-00ff00-0000ff&sl=11&sr=triad&sp=even')!
    expect(back.locks).toEqual([false, false, false])
  })

  it('falls back on a rule or a profile it does not know', () => {
    const back = decodeScheme('sc=ff0000-00ff00&sr=nonsense&sp=nonsense')!
    expect(back.rule).toBe(AUTO_RULE)
    expect(back.profile).toBe('even')
  })

  it('refuses a scheme shorter than a scheme, and caps a long one', () => {
    expect(decodeScheme('sc=ff0000&sr=triad&sp=even')).toBeNull()
    const many = Array.from({ length: 20 }, (_unused, index) =>
      toHex({ l: 0.5, c: 0.1, h: index * 17 }).slice(1),
    ).join('-')
    expect(decodeScheme(`sc=${many}`)!.colors).toHaveLength(MAX_SLOTS)
  })

  it('says which mode a link was made in, or nothing at all', () => {
    expect(decodeMode(`m=scheme~${encodeScheme(slots, 'triad', 'even')}`)).toBe('scheme')

    // Nothing said is its own answer, not the editor. Only the scheme board
    // writes the key, and the mode is remembered between sessions now, so a
    // link that says nothing must leave the choice to what was remembered.
    expect(decodeMode('')).toBeNull()
    expect(decodeMode(encodeDocument([{ config: createPalette('#000'), name: 'x' }]))).toBeNull()
  })
})

describe('inserting at a boundary', () => {
  const three = (): SchemeState =>
    createScheme(
      [
        newSlot({ l: 0.9, c: 0.05, h: 20 }),
        newSlot({ l: 0.5, c: 0.15, h: 200 }),
        newSlot({ l: 0.2, c: 0.08, h: 300 }),
      ],
      'triad',
      'even',
      'srgb',
    )

  it('lands the new colour exactly where the boundary was', () => {
    const before = three()
    for (const at of [0, 1, 2, 3]) {
      const after = run(before, { type: 'add', at })
      expect(after.slots).toHaveLength(4)
      // Every original slot is still there, in order, with the new one wedged
      // in at `at` — so the ids either side say where it went.
      const ids = after.slots.map((slot) => slot.id)
      const originals = before.slots.map((slot) => slot.id)
      expect(ids.filter((id) => originals.includes(id))).toEqual(originals)
      expect(originals).not.toContain(ids[at])
    }
  })

  it('appends when no boundary is named, as the toolbar count does', () => {
    const before = three()
    const after = run(before, { type: 'add' })
    expect(after.slots.slice(0, 3).map((s) => s.id)).toEqual(before.slots.map((s) => s.id))
  })

  it('clamps a boundary outside the row rather than tearing a hole in it', () => {
    const before = three()
    expect(run(before, { type: 'add', at: -5 }).slots).toHaveLength(4)
    expect(run(before, { type: 'add', at: 99 }).slots).toHaveLength(4)
    expect(run(before, { type: 'add', at: 99 }).slots[3].id).not.toBe(before.slots[2].id)
  })

  it('gives a colour between two neighbours the weight of both', () => {
    // It belongs where it was put rather than interrupting the run.
    const before = three()
    const inserted = run(before, { type: 'add', at: 1 }).slots[1].color
    expect(inserted.l).toBeCloseTo((0.9 + 0.5) / 2, 6)
    expect(inserted.c).toBeCloseTo((0.05 + 0.15) / 2, 6)
  })

  it('takes the shorter way round the wheel between two hues', () => {
    // 350 and 10 meet at 0, not at 180.
    const wrap = createScheme(
      [newSlot({ l: 0.5, c: 0.1, h: 350 }), newSlot({ l: 0.5, c: 0.1, h: 10 })],
      'triad',
      'even',
      'srgb',
    )
    expect(run(wrap, { type: 'add', at: 1 }).slots[1].color.h).toBeCloseTo(0, 6)
  })

  it('steps away from the only neighbour at either end', () => {
    const before = three()
    const atStart = run(before, { type: 'add', at: 0 }).slots[0].color
    const atEnd = run(before, { type: 'add', at: 3 }).slots[3].color
    expect(atStart.h).toBeCloseTo(350, 6)
    expect(atEnd.h).toBeCloseTo(330, 6)
  })

  it('still refuses to go past the cap', () => {
    let state = three()
    while (state.slots.length < MAX_SLOTS) state = run(state, { type: 'add', at: 1 })
    expect(run(state, { type: 'add', at: 1 })).toBe(state)
  })
})
