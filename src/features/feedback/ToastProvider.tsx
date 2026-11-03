import { Check, Info, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { ToastContext } from '@/features/feedback/toast-context'
import type { ToastInput, ToastMessage } from '@/features/feedback/toast-context'
import { IconButton } from '@/components/ui/IconButton'
import { cn } from '@/lib/utils'

const TOAST_DURATION_MS = 4500

/** Single-toast feedback used for local demo actions (never for saved data). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastMessage | null>(null)
  const timeoutRef = useRef<number | null>(null)

  const clearTimer = useCallback(() => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }, [])

  const dismiss = useCallback(() => {
    clearTimer()
    setToast(null)
  }, [clearTimer])

  const notify = useCallback(
    (input: ToastInput) => {
      clearTimer()
      setToast({ ...input, id: Date.now() })
      timeoutRef.current = window.setTimeout(() => setToast(null), TOAST_DURATION_MS)
    },
    [clearTimer],
  )

  useEffect(() => clearTimer, [clearTimer])

  const value = useMemo(() => ({ notify, dismiss }), [dismiss, notify])

  return (
    <ToastContext.Provider value={value}>
      {children}

      <div
        aria-live="polite"
        aria-atomic="true"
        className="pointer-events-none fixed inset-x-4 bottom-40 z-50 flex justify-center sm:inset-x-auto sm:right-6 sm:bottom-28 sm:justify-end"
      >
        {toast ? (
          <div
            role="status"
            className={cn(
              'pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-card border border-border bg-elevated/95 p-3.5 shadow-2xl shadow-background/60 backdrop-blur',
              'motion-safe:animate-[toast-in_180ms_ease-out]',
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full',
                toast.tone === 'success'
                  ? 'bg-accent/15 text-accent'
                  : 'bg-accent-secondary/15 text-accent-secondary',
              )}
            >
              {toast.tone === 'success' ? (
                <Check className="size-4" strokeWidth={2} />
              ) : (
                <Info className="size-4" strokeWidth={2} />
              )}
            </span>

            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">{toast.title}</p>
              {toast.description ? (
                <p className="mt-1 text-xs leading-relaxed text-muted">{toast.description}</p>
              ) : null}
            </div>

            <IconButton label="Dismiss notification" size="sm" onClick={dismiss}>
              <X className="size-4" strokeWidth={1.75} />
            </IconButton>
          </div>
        ) : null}
      </div>
    </ToastContext.Provider>
  )
}
