import { describe, expect, it } from 'vitest'
import { nameForColor } from './names'

describe('nameForColor', () => {
  it('deterministically returns the same name for the same color', () => {
    for (const hex of ['#7c3aed', '#facc15', '#00ff66', '#ff5722', '#1e88e5']) {
      expect(nameForColor(hex)).toBe(nameForColor(hex))
    }
  })

  it('names canonical colours accurately and nicely', () => {
    expect(nameForColor('#7c3aed')).toBe('Bluish Purple')
    expect(nameForColor('#facc15')).toBe('Goldenrod')
    expect(nameForColor('#00ff66')).toBe('Booger Buster')
    expect(nameForColor('#000000')).toBe('Black')
    expect(nameForColor('#ffffff')).toBe('White')
    expect(nameForColor('#ff0000')).toBe('Red')
    expect(nameForColor('#ff5722')).toBe('Smashing Pumpkins')
    expect(nameForColor('#1e88e5')).toBe('Bleu de France')
  })

  it('resolves oklch, rgb, and bare hex inputs', () => {
    expect(nameForColor('ff5722')).toBe('Smashing Pumpkins')
    expect(nameForColor('rgb(255, 87, 34)')).toBe('Smashing Pumpkins')
    expect(typeof nameForColor('oklch(0.65 0.22 35)')).toBe('string')
    expect(nameForColor('oklch(0.65 0.22 35)')).not.toBe('palette')
  })

  it('falls back gracefully on invalid input', () => {
    expect(nameForColor('not-a-colour')).toBe('palette')
  })
})
