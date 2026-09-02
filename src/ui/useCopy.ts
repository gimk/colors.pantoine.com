import { useCallback, useEffect, useRef, useState } from 'react'

const FEEDBACK_MS = 1100

/**
 * Clipboard write plus a short-lived "copied" marker, keyed so several
 * copyable things can share one hook without all flashing at once.
 */
export function useCopy() {
  const [copied, setCopied] = useState<string | null>(null)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(timer.current), [])

  const copy = useCallback(async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // Clipboard can be blocked (insecure origin, denied permission).
      // Nothing to recover, but never leave a false "copied" behind.
      return
    }
    setCopied(key)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setCopied(null), FEEDBACK_MS)
  }, [])

  return { copy, copied }
}
