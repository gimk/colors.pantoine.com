import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { claimsName, NameField } from './NameField'

describe('NameField', () => {
  describe('claimsName', () => {
    it('treats typed text as a name', () => {
      expect(claimsName('Mine')).toBe(true)
      expect(claimsName('  Mine  ')).toBe(true)
    })

    /**
     * The reason the rename is not reported on every keystroke: an empty
     * field is what you see after selecting all and before typing the
     * replacement, and answering it there refills the field under the caret.
     */
    it('does not treat an emptied field as a name', () => {
      expect(claimsName('')).toBe(false)
      expect(claimsName('   ')).toBe(false)
      expect(claimsName('\t')).toBe(false)
    })

    it('agrees with the reducer about what counts as custom', () => {
      // `documentReducer`'s `rename` decides `nameCustom` the same way, so a
      // name this field reports is always one the document keeps.
      for (const raw of ['Mine', ' Mine ', '', '  ', 'A']) {
        expect(claimsName(raw)).toBe(raw.trim().length > 0)
      }
    })
  })

  it('shows the name it is given', () => {
    const html = renderToStaticMarkup(<NameField name="Bleu de France" onRename={() => {}} />)
    expect(html).toContain('value="Bleu de France"')
    expect(html).toContain('Palette name')
  })
})
