/**
 * Which half of the tool is up.
 *
 * Lives here rather than beside the switch that sets it: the link decoder and
 * the storage both have to name it, and neither of them has any business
 * importing a button.
 */
export type Mode = 'ramps' | 'scheme'

/**
 * What a session opens on when nothing says otherwise.
 *
 * Scheme, because that is where a palette starts: you choose the colours that
 * go together first, and open them out into ramps afterwards. Somebody
 * arriving with a colour already in hand is one switch away, and — since the
 * mode is remembered — one switch away for good.
 */
export const DEFAULT_MODE: Mode = 'scheme'

export function isMode(value: string | null | undefined): value is Mode {
  return value === 'ramps' || value === 'scheme'
}
