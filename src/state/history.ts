/**
 * Undo/redo as snapshots of whole states.
 *
 * Snapshots rather than inverse actions: a document is a few palettes of six
 * numbers per curve, so copying one costs nothing, and every snapshot shares
 * the same immutable config objects as the live state — which means the ramp
 * cache still hits after an undo and stepping back is instant.
 *
 * The hard part is not the stack, it is what counts as one edit. A curve drag
 * dispatches on every pointer move and a text field on every keystroke, so
 * without coalescing a single gesture would bury the thing you actually wanted
 * to undo under fifty entries.
 */

export type History<S> = {
  past: S[]
  present: S
  future: S[]
  /** What produced `present`, so the next edit knows whether to merge into it. */
  lastKey: string | null
  lastAt: number
}

export type HistoryAction<A> =
  | { type: 'undo' }
  | { type: 'redo' }
  /** The timestamp is passed in rather than read inside: a reducer stays pure. */
  | { type: 'do'; action: A; at: number }

export type HistoryOptions<A> = {
  /**
   * Edits sharing a key, close together in time, collapse into one entry.
   * `null` means the action always begins an entry of its own.
   */
  coalesce: (action: A) => string | null
  /** Changes the view without editing anything: navigation, selection. */
  transient?: (action: A) => boolean
  limit?: number
  windowMs?: number
}

/** Deep enough to cover a working session, shallow enough to stay small. */
export const HISTORY_LIMIT = 100

/**
 * Long enough to swallow the gap between keystrokes and pointer moves, short
 * enough that coming back to a field after a pause starts a new entry.
 */
export const COALESCE_MS = 700

export function initHistory<S>(present: S): History<S> {
  return { past: [], present, future: [], lastKey: null, lastAt: 0 }
}

export const canUndo = <S,>(state: History<S>) => state.past.length > 0
export const canRedo = <S,>(state: History<S>) => state.future.length > 0

export function withHistory<S, A>(
  reducer: (state: S, action: A) => S,
  options: HistoryOptions<A>,
) {
  const { coalesce, transient, limit = HISTORY_LIMIT, windowMs = COALESCE_MS } = options

  return function historyReducer(state: History<S>, action: HistoryAction<A>): History<S> {
    switch (action.type) {
      case 'undo': {
        if (!state.past.length) return state
        return {
          past: state.past.slice(0, -1),
          present: state.past[state.past.length - 1],
          future: [state.present, ...state.future],
          // An undo ends the run: the next drag must start a fresh entry
          // rather than merging into one from before the undo.
          lastKey: null,
          lastAt: 0,
        }
      }

      case 'redo': {
        if (!state.future.length) return state
        return {
          past: [...state.past, state.present],
          present: state.future[0],
          future: state.future.slice(1),
          lastKey: null,
          lastAt: 0,
        }
      }

      case 'do': {
        const present = reducer(state.present, action.action)
        // A reducer that declined the action — an unknown id, a move already
        // at the end of the stack — has produced nothing to record.
        if (present === state.present) return state

        if (transient?.(action.action)) {
          return { ...state, present, lastKey: null, lastAt: 0 }
        }

        const key = coalesce(action.action)
        const merge =
          key !== null && key === state.lastKey && action.at - state.lastAt < windowMs

        return {
          // Merging replaces `present` and leaves `past` alone, so the entry
          // to step back to is the state from before the whole gesture.
          past: merge ? state.past : [...state.past, state.present].slice(-limit),
          present,
          // Any fresh edit abandons the branch a redo would have gone down.
          future: [],
          lastKey: key,
          lastAt: action.at,
        }
      }
    }
  }
}
