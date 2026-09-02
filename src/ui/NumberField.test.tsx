import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { NumberField, parseNumberCommit, parseNumberInput } from './NumberField'

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

  describe('rendering', () => {
    it('renders with formatted value and english locale attribute', () => {
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
      expect(html).toContain('value="0.970"')
      expect(html).toContain('lang="en"')
      expect(html).toContain('inputMode="decimal"')
    })
  })
})
