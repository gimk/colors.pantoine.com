import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { commitValue, NumberField, parseNumberCommit, parseNumberInput } from './NumberField'

describe('NumberField', () => {
  describe('parseNumberInput', () => {
    it('parses dot decimals correctly', () => {
      expect(parseNumberInput('0.85')).toBe(0.85)
      expect(parseNumberInput('0.97')).toBe(0.97)
      expect(parseNumberInput('0.16')).toBe(0.16)
    })

    it('parses comma decimals correctly without truncating to zero', () => {
      // European/French comma decimal separator
      expect(parseNumberInput('0,85')).toBe(0.85)
      expect(parseNumberInput('0,97')).toBe(0.97)
      expect(parseNumberInput('0,16')).toBe(0.16)
    })

    /**
     * Half-typed numbers that happen to parse. The field reports these only
     * once they are in range, so the first keystroke of "15" does not commit
     * a 1 — see the range guard in `onChange`.
     */
    it('parses a value the caller may still reject as out of range', () => {
      expect(parseNumberInput('1')).toBe(1)
      expect(parseNumberInput('9')).toBe(9)
    })

    it('ignores incomplete intermediate decimal inputs', () => {
      // Intermediate states must not commit 0 mid-typing
      expect(parseNumberInput('0.')).toBeNull()
      expect(parseNumberInput('0,')).toBeNull()
      expect(parseNumberInput('.')).toBeNull()
      expect(parseNumberInput('-')).toBeNull()
      expect(parseNumberInput('')).toBeNull()
    })
  })

  describe('parseNumberCommit', () => {
    it('parses final values with comma or dot on blur', () => {
      expect(parseNumberCommit('0,85')).toBe(0.85)
      expect(parseNumberCommit('0.85')).toBe(0.85)
      expect(parseNumberCommit('0.')).toBe(0)
    })
  })

  /**
   * Blur commits, so that a typed value is not lost when the field is left
   * without pressing Enter. That makes the no-change case load-bearing: a
   * commit marks the channel hand-edited and pushes an undo entry, so
   * clicking into a field and out again must report nothing at all.
   */
  describe('commitValue', () => {
    it('reports nothing when the value has not moved', () => {
      expect(commitValue(0.97, 0.97, 0, 1, 3).changed).toBe(false)
      // What the field round-trips: 0.970 in, 0.970 out.
      expect(commitValue(0.97, 0.9700004, 0, 1, 3).changed).toBe(false)
    })

    it('reports a move the field can actually show', () => {
      expect(commitValue(0.975, 0.97, 0, 1, 3)).toEqual({ value: 0.975, changed: true })
    })

    it('clamps to the channel, and calls the clamp a move only when it is one', () => {
      expect(commitValue(9, 0.97, 0, 1, 3)).toEqual({ value: 1, changed: true })
      expect(commitValue(-4, 0, 0, 1, 3)).toEqual({ value: 0, changed: false })
      expect(commitValue(9, 1, 0, 1, 3)).toEqual({ value: 1, changed: false })
    })
  })

  describe('rendering', () => {
    const html = renderToStaticMarkup(
      <NumberField
        label="Start"
        value={0.97}
        min={0}
        max={1}
        step={0.005}
        decimals={3}
        onCommit={() => {}}
      />,
    )

    it('renders the value at the channel’s precision', () => {
      expect(html).toContain('value="0.970"')
    })

    /**
     * The comma parsing above is only reachable on a text input: a number
     * input runs the value through HTML's sanitiser first, which discards
     * anything that is not a valid float, so "0,85" arrived as "" and the
     * digits were lost. `inputMode` is what keeps the numeric keypad.
     */
    it('is a text input, so a comma decimal survives the DOM', () => {
      expect(html).toContain('type="text"')
      expect(html).not.toContain('type="number"')
      expect(html).toContain('inputMode="decimal"')
    })

    it('is styled by class, since the type no longer names it', () => {
      expect(html).toContain('class="number"')
    })
  })
})
