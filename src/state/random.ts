/**
 * Seeded randomness, and the single place the unseeded kind is allowed.
 *
 * Two things in this app roll a colour — the base of a new palette, and a
 * whole scheme — and both of them happen inside a reducer, which is the one
 * place a roll cannot happen. A reducer that calls `Math.random` answers
 * differently every time it runs, and React runs it more than once: under
 * StrictMode every reducer is deliberately invoked twice for the same action
 * to surface exactly this, and the colour that survives is not the one the
 * first invocation produced.
 *
 * So the seed is rolled at the edge — in the hook that dispatches — and
 * travels in the action. The reducer goes back to being a pure function of
 * state and action, the same action always lands on the same colour, and a
 * test can name the colour it expects rather than assert a range around it.
 *
 * It lives here rather than beside the generators because a seed is a
 * property of the *action*, not of the colour science: `color/` takes an
 * `rng` and asks no questions about where it came from.
 */

/**
 * A small, fast, seedable PRNG.
 *
 * Mulberry32: one 32-bit word of state, a handful of shifts, and a period
 * long enough that nothing here will ever see it wrap. Good enough for
 * choosing colours, and small enough to read.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * A fresh 32-bit seed for an action to carry.
 *
 * The whole of the app's impurity, gathered into one line. Every caller is a
 * `useCallback` in a hook, dispatching the seed it just rolled.
 */
export const rollSeed = () => (Math.random() * 2 ** 32) >>> 0
