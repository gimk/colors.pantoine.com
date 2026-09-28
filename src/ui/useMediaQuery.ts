import { useEffect, useState } from 'react'

/**
 * Whether a media query matches, kept up to date as it changes.
 *
 * `false` without a window, so a DOM-less render gets the desktop tree — the
 * one every test was written against.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => read(query))

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const list = window.matchMedia(query)
    const onChange = () => setMatches(list.matches)
    onChange()
    list.addEventListener('change', onChange)
    return () => list.removeEventListener('change', onChange)
  }, [query])

  return matches
}

function read(query: string): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia(query).matches
}

/**
 * A phone, by width. The same line the scheme board already turns its bars on,
 * and the one every phone-only layout in the stylesheet is written against —
 * so the tree and the styles agree on which one is up.
 */
export const PHONE_QUERY = '(max-width: 720px)'

export function usePhone(): boolean {
  return useMediaQuery(PHONE_QUERY)
}
