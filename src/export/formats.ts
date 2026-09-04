import { formatColor, type Gamut } from '../color/oklch'
import type { Swatch } from '../color/ramp'

/** A palette as an export sees it: a name and the colours under it. */
export type NamedRamp = { name: string; ramp: Swatch[] }

export type TextFormat = {
  id: string
  label: string
  /** File extension used when the value is downloaded rather than copied. */
  extension: string
  build: (ramp: Swatch[], name: string, gamut?: Gamut) => string
  /**
   * Several palettes as one document, where stacking the single-palette
   * output would produce something the target language cannot read — two
   * `:root` blocks, two JSON objects with no array around them. Formats that
   * concatenate cleanly leave this out and take `stacked` instead.
   */
  all?: (palettes: NamedRamp[], gamut?: Gamut) => string
}

/** CSS custom properties and SCSS keys have to survive being pasted. */
export function slugify(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'color'
}

const hexList = (ramp: Swatch[]) => ramp.map((s) => s.hex).join('\n')

const oklchList = (ramp: Swatch[]) =>
  ramp.map((s) => formatColor(s.oklch, 'oklch')).join('\n')

/**
 * The lists are the one pair with nowhere to put a name.
 *
 * One palette stays a bare column of values, which is what makes it
 * pasteable anywhere. Several would arrive as one undifferentiated column, so
 * each block is headed by its palette's name — plain text has no comment
 * syntax to hide it in, and an unlabelled block of hexes is no use at all.
 */
const headedBlocks = (build: (ramp: Swatch[]) => string) => (palettes: NamedRamp[]) =>
  palettes.map((palette) => `${palette.name}\n${build(palette.ramp)}`).join('\n\n')

/**
 * `display` writes what is on screen, which on a wide-gamut palette is the
 * only one of the three that does: hex is sRGB by definition, and OKLCH is
 * the request rather than the colour the display settled on.
 */
type CssValue = 'hex' | 'oklch' | 'display'

const cssLines = (ramp: Swatch[], name: string, kind: CssValue) => {
  const slug = slugify(name)
  return ramp.map((s) => {
    const value =
      kind === 'oklch'
        ? formatColor(s.oklch, 'oklch')
        : kind === 'display'
          ? s.displayColor
          : s.hex
    return `  --${slug}-${s.label}: ${value};`
  })
}

const cssVariables = (ramp: Swatch[], name: string, kind: CssValue) =>
  `:root {\n${cssLines(ramp, name, kind).join('\n')}\n}`

/** One `:root`, every palette inside it — two would be valid CSS and wrong. */
const cssVariablesAll = (palettes: NamedRamp[], kind: CssValue) =>
  `:root {\n${palettes
    .map((palette) => cssLines(palette.ramp, palette.name, kind).join('\n'))
    .join('\n\n')}\n}`

const tailwind = (ramp: Swatch[], name: string) => {
  const lines = ramp.map((s) => `    '${s.label}': '${s.hex}',`)
  return `${slugify(name)}: {\n${lines.join('\n')}\n},`
}

const scss = (ramp: Swatch[], name: string) => {
  const slug = slugify(name)
  const lines = ramp.map((s) => `  '${s.label}': ${s.hex},`)
  return `$${slug}: (\n${lines.join('\n')}\n);`
}

const jsonPalette = (ramp: Swatch[], name: string, gamut: Gamut = 'srgb') => ({
  name: slugify(name),
  space: 'oklch',
  // Named because `clipped` is relative to it, and `hex` is not: a step
  // can be clipped in Rec. 2020 and still have a perfectly good sRGB hex.
  gamut,
  steps: ramp.map((s) => ({
    step: s.label,
    hex: s.hex,
    display: s.displayColor,
    oklch: formatColor(s.oklch, 'oklch'),
    l: Number(s.oklch.l.toFixed(4)),
    c: Number(s.oklch.c.toFixed(4)),
    h: Number(s.oklch.h.toFixed(2)),
    clipped: s.clipped,
    contrastOnWhite: Number(s.contrastOnWhite.toFixed(2)),
    contrastOnBlack: Number(s.contrastOnBlack.toFixed(2)),
  })),
})

const json = (ramp: Swatch[], name: string, gamut: Gamut = 'srgb') =>
  JSON.stringify(jsonPalette(ramp, name, gamut), null, 2)

/** An array, so a multi-palette export is one parseable value. */
const jsonAll = (palettes: NamedRamp[], gamut: Gamut = 'srgb') =>
  JSON.stringify(
    palettes.map((palette) => jsonPalette(palette.ramp, palette.name, gamut)),
    null,
    2,
  )

export const TEXT_FORMATS: TextFormat[] = [
  {
    id: 'hex',
    label: 'Hex list',
    extension: 'txt',
    build: hexList,
    all: headedBlocks(hexList),
  },
  {
    id: 'oklch',
    label: 'OKLCH list',
    extension: 'txt',
    build: oklchList,
    all: headedBlocks(oklchList),
  },
  {
    id: 'css-hex',
    label: 'CSS vars (hex)',
    extension: 'css',
    build: (ramp, name) => cssVariables(ramp, name, 'hex'),
    all: (palettes) => cssVariablesAll(palettes, 'hex'),
  },
  {
    id: 'css-oklch',
    label: 'CSS vars (OKLCH)',
    extension: 'css',
    build: (ramp, name) => cssVariables(ramp, name, 'oklch'),
    all: (palettes) => cssVariablesAll(palettes, 'oklch'),
  },
  {
    id: 'css-display',
    label: 'CSS vars (color())',
    extension: 'css',
    build: (ramp, name) => cssVariables(ramp, name, 'display'),
    all: (palettes) => cssVariablesAll(palettes, 'display'),
  },
  // Tailwind keys and SCSS maps are siblings at the top level of a file, so
  // stacking them is already the right answer — the scale blocks want no
  // blank line between them inside a theme object, the maps read better with.
  {
    id: 'tailwind',
    label: 'Tailwind scale',
    extension: 'js',
    build: tailwind,
    all: (palettes) => palettes.map((p) => tailwind(p.ramp, p.name)).join('\n'),
  },
  { id: 'scss', label: 'SCSS map', extension: 'scss', build: scss },
  { id: 'json', label: 'JSON', extension: 'json', build: json, all: jsonAll },
]

/**
 * One palette or twenty, in whichever format was asked for.
 *
 * A single palette goes through `build` untouched, so every export that ever
 * worked still produces the same bytes: what a person pastes into a stylesheet
 * should not change shape because the document beside it grew.
 */
export function buildText(
  format: TextFormat,
  palettes: NamedRamp[],
  gamut: Gamut = 'srgb',
): string {
  if (palettes.length === 0) return ''
  if (palettes.length === 1) return format.build(palettes[0].ramp, palettes[0].name, gamut)
  if (format.all) return format.all(palettes, gamut)
  return palettes.map((p) => format.build(p.ramp, p.name, gamut)).join('\n\n')
}
