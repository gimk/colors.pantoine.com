import { describe, expect, it } from 'vitest'
import { flat, linear } from '../color/curve'
import { createPalette } from '../color/presets'
import {
  coalesceKey,
  createDocument,
  documentReducer,
  isTransient,
  selectedEntry,
  type DocumentAction,
} from './document'
import { canRedo, canUndo, COALESCE_MS, initHistory, withHistory } from './history'

const reducer = withHistory(documentReducer, {
  coalesce: coalesceKey,
  transient: isTransient,
})

/** Drives the history reducer with an explicit clock, as the app does. */
function session(...seeds: { name: string; config: ReturnType<typeof createPalette> }[]) {
  let state = initHistory(
    seeds.length ? createDocument(seeds) : createDocument(),
  )
  let clock = 1000

  return {
    /** Dispatch an edit, optionally after waiting `after` milliseconds. */
    edit(action: DocumentAction, after = 16) {
      clock += after
      state = reducer(state, { type: 'do', action, at: clock })
      return this
    },
    undo() {
      state = reducer(state, { type: 'undo' })
      return this
    },
    redo() {
      state = reducer(state, { type: 'redo' })
      return this
    },
    get present() {
      return state.present
    },
    get depth() {
      return state.past.length
    },
    get redoDepth() {
      return state.future.length
    },
    get state() {
      return state
    },
  }
}

const drag = (y: number): DocumentAction => ({
  type: 'palette',
  action: { type: 'setCurve', key: 'chroma', curve: flat(y), moved: 'h1' },
})

const chromaOf = (state: ReturnType<typeof createDocument>) =>
  selectedEntry(state).state.config.chroma

describe('history', () => {
  it('starts with nothing to undo or redo', () => {
    const s = session()
    expect(canUndo(s.state)).toBe(false)
    expect(canRedo(s.state)).toBe(false)
    expect(s.undo().depth).toBe(0)
  })

  it('collapses a whole drag into one entry', () => {
    // Fifty pointer moves are one thing the designer did. Without this, undo
    // would walk back through the drag a frame at a time.
    const s = session()
    const before = chromaOf(s.present)
    for (let i = 0; i < 50; i++) s.edit(drag(0.05 + i * 0.001))
    expect(s.depth).toBe(1)
    expect(chromaOf(s.present)).not.toEqual(before)
    s.undo()
    expect(chromaOf(s.present)).toEqual(before)
  })

  it('splits a gesture that resumes after a pause', () => {
    const s = session()
    s.edit(drag(0.05))
    s.edit(drag(0.06), COALESCE_MS + 1)
    expect(s.depth).toBe(2)
  })

  it('keeps separate handles separate', () => {
    const s = session()
    s.edit(drag(0.05))
    s.edit({
      type: 'palette',
      action: { type: 'setCurve', key: 'chroma', curve: flat(0.07), moved: 'h2' },
    })
    expect(s.depth).toBe(2)
  })

  it('gives every shape preset its own entry', () => {
    // A preset comes through setCurve like a drag does, but names no control:
    // it is a click, and two clicks are two edits however fast they land.
    const s = session()
    s.edit({ type: 'palette', action: { type: 'setCurve', key: 'chroma', curve: flat(0.1) } })
    s.edit({
      type: 'palette',
      action: { type: 'setCurve', key: 'chroma', curve: linear(0.2, 0.05) },
    })
    expect(s.depth).toBe(2)
  })

  it('collapses typing in a field, per field', () => {
    const s = session()
    for (const value of ['#7', '#7c', '#7c3', '#7c3a']) {
      s.edit({ type: 'palette', action: { type: 'setBase', value } })
    }
    expect(s.depth).toBe(1)

    // A different field is a different entry, even mid-flow.
    s.edit({ type: 'rename', id: selectedEntry(s.present).id, name: 'br' })
    s.edit({ type: 'rename', id: selectedEntry(s.present).id, name: 'bra' })
    expect(s.depth).toBe(2)
  })

  it('collapses Start and End keystrokes separately', () => {
    // Both commit on every keystroke rather than on blur.
    const s = session()
    s.edit({
      type: 'palette',
      action: { type: 'setEndpoint', key: 'lightness', end: 'start', value: 0.9 },
    })
    s.edit({
      type: 'palette',
      action: { type: 'setEndpoint', key: 'lightness', end: 'start', value: 0.95 },
    })
    expect(s.depth).toBe(1)
    s.edit({
      type: 'palette',
      action: { type: 'setEndpoint', key: 'lightness', end: 'end', value: 0.2 },
    })
    expect(s.depth).toBe(2)
  })

  it('steps back and forward through the stack', () => {
    const s = session()
    s.edit({ type: 'new' })
    s.edit({ type: 'new' })
    expect(s.present.palettes).toHaveLength(3)
    s.undo().undo()
    expect(s.present.palettes).toHaveLength(1)
    s.redo()
    expect(s.present.palettes).toHaveLength(2)
    s.redo()
    expect(s.present.palettes).toHaveLength(3)
    expect(canRedo(s.state)).toBe(false)
  })

  it('brings back a deleted palette, exactly as it was', () => {
    const s = session()
    s.edit({ type: 'new' })
    const doomed = s.present.palettes[1]
    s.edit({ type: 'remove', id: doomed.id })
    expect(s.present.palettes).toHaveLength(1)
    s.undo()
    expect(s.present.palettes[1]).toBe(doomed)
    // The very same config object, so its ramp is still cached.
    expect(s.present.palettes[1].state.config).toBe(doomed.state.config)
  })

  it('abandons the redo branch once you edit again', () => {
    const s = session()
    s.edit({ type: 'new' })
    s.edit({ type: 'new' })
    s.undo()
    expect(s.redoDepth).toBe(1)
    s.edit({ type: 'new' })
    expect(s.redoDepth).toBe(0)
    expect(s.present.palettes).toHaveLength(3)
  })

  it('does not merge a drag with one from before an undo', () => {
    // The run has to end at the undo, or the next drag would rewrite the
    // entry the undo just stepped out of.
    const s = session()
    s.edit(drag(0.05))
    s.undo()
    expect(s.depth).toBe(0)
    s.edit(drag(0.09))
    expect(s.depth).toBe(1)
    s.undo()
    expect(chromaOf(s.present)).toEqual(chromaOf(createDocument()))
  })

  it('records nothing for an action the document declined', () => {
    const s = session()
    s.edit({ type: 'select', id: 'nope' })
    s.edit({ type: 'move', id: selectedEntry(s.present).id, by: -1 })
    s.edit({ type: 'remove', id: selectedEntry(s.present).id })
    expect(s.depth).toBe(0)
  })

  it('does not put selection in the undo stack', () => {
    // Undo steps back through edits, not through where you were looking.
    const s = session()
    s.edit({ type: 'new' })
    const first = s.present.palettes[0].id
    s.edit({ type: 'select', id: first })
    expect(s.depth).toBe(1)
    expect(selectedEntry(s.present).id).toBe(first)

    // Undoing the edit still returns to the palette it was made on.
    s.undo()
    expect(s.present.palettes).toHaveLength(1)
  })

  it('caps how far back it remembers', () => {
    const capped = withHistory(documentReducer, { coalesce: coalesceKey, limit: 3 })
    let state = initHistory(createDocument())
    for (let i = 0; i < 10; i++) {
      state = capped(state, { type: 'do', action: { type: 'new' }, at: i * 10_000 })
    }
    expect(state.past).toHaveLength(3)
    expect(state.present.palettes).toHaveLength(11)
  })
})

describe('a batch of new palettes', () => {
  it('is one undo entry however many palettes it brought', () => {
    const s = session()
    s.edit({
      type: 'add',
      bases: [{ base: '#ff0000' }, { base: '#00ff00' }, { base: '#0000ff' }],
    })
    expect(s.present.palettes).toHaveLength(4)
    expect(s.depth).toBe(1)
    s.undo()
    expect(s.present.palettes).toHaveLength(1)
  })

  it('stays two entries when two batches land back to back', () => {
    // A click is a discrete act, so two of them are two things to step back
    // through — even inside the coalescing window.
    const s = session()
    s.edit({ type: 'add', bases: [{ base: '#ff0000' }] }, 1)
    s.edit({ type: 'add', bases: [{ base: '#00ff00' }] }, 1)
    expect(s.depth).toBe(2)
    s.undo()
    expect(s.present.palettes).toHaveLength(2)
  })

  it('records nothing for a batch the reducer declined', () => {
    const s = session()
    s.edit({ type: 'add', bases: [] })
    s.edit({ type: 'add', bases: [{ base: 'not a colour' }] })
    expect(s.depth).toBe(0)
    expect(canUndo(s.state)).toBe(false)
  })
})
