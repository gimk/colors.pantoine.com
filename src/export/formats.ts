import { formatColor } from '../color/oklch'
import type { Swatch } from '../color/ramp'

export type TextFormat = {
  id: string
  label: string
  /** File extension used when the value is downloaded rather than copied. */
  extension: string
  build: (ramp: Swatch[], name: string) => string
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

const cssVariables = (ramp: Swatch[], name: string, oklch: boolean) => {
  const slug = slugify(name)
  const lines = ramp.map((s) => {
    const value = oklch ? formatColor(s.oklch, 'oklch') : s.hex
    return `  --${slug}-${s.label}: ${value};`
  })
  return `:root {\n${lines.join('\n')}\n}`
}

const tailwind = (ramp: Swatch[], name: string) => {
  const lines = ramp.map((s) => `    '${s.label}': '${s.hex}',`)
  return `${slugify(name)}: {\n${lines.join('\n')}\n},`
}

const scss = (ramp: Swatch[], name: string) => {
  const slug = slugify(name)
  const lines = ramp.map((s) => `  '${s.label}': ${s.hex},`)
  return `$${slug}: (\n${lines.join('\n')}\n);`
}

const json = (ramp: Swatch[], name: string) =>
  JSON.stringify(
    {
      name: slugify(name),
      space: 'oklch',
      steps: ramp.map((s) => ({
        step: s.label,
        hex: s.hex,
        oklch: formatColor(s.oklch, 'oklch'),
        l: Number(s.oklch.l.toFixed(4)),
        c: Number(s.oklch.c.toFixed(4)),
        h: Number(s.oklch.h.toFixed(2)),
        clipped: s.clipped,
        contrastOnWhite: Number(s.contrastOnWhite.toFixed(2)),
        contrastOnBlack: Number(s.contrastOnBlack.toFixed(2)),
      })),
    },
    null,
    2,
  )

export const TEXT_FORMATS: TextFormat[] = [
  { id: 'hex', label: 'Hex list', extension: 'txt', build: hexList },
  { id: 'oklch', label: 'OKLCH list', extension: 'txt', build: oklchList },
  {
    id: 'css-hex',
    label: 'CSS vars (hex)',
    extension: 'css',
    build: (ramp, name) => cssVariables(ramp, name, false),
  },
  {
    id: 'css-oklch',
    label: 'CSS vars (OKLCH)',
    extension: 'css',
    build: (ramp, name) => cssVariables(ramp, name, true),
  },
  { id: 'tailwind', label: 'Tailwind scale', extension: 'js', build: tailwind },
  { id: 'scss', label: 'SCSS map', extension: 'scss', build: scss },
  { id: 'json', label: 'JSON', extension: 'json', build: json },
]
