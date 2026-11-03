import { useEffect, useState } from 'react'

type DebouncedValue<T> = {
  debouncedValue: T
  /** True while the input has moved ahead of the debounced value. */
  isPending: boolean
}

/**
 * Debounces a value so typing does not re-filter on every keystroke. The pending flag
 * lets the search UI show skeletons instead of flashing an empty state.
 */
export function useDebouncedValue<T>(value: T, delayMs = 220): DebouncedValue<T> {
  const [debouncedValue, setDebouncedValue] = useState(value)

  useEffect(() => {
    if (value === debouncedValue) return

    const timeoutId = window.setTimeout(() => setDebouncedValue(value), delayMs)

    return () => window.clearTimeout(timeoutId)
  }, [value, debouncedValue, delayMs])

  return { debouncedValue, isPending: value !== debouncedValue }
}
