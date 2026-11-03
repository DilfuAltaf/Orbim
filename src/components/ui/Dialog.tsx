import { X } from 'lucide-react'
import { useEffect, useId, useRef } from 'react'
import type { MouseEvent, ReactNode } from 'react'

import { IconButton } from '@/components/ui/IconButton'
import { cn } from '@/lib/utils'

type DialogProps = {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children?: ReactNode
  footer?: ReactNode
  className?: string
}

/**
 * Modal built on the native `<dialog>` element, which supplies focus trapping, the
 * backdrop, Escape handling and inertness of the page behind it for free.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className,
}: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    const node = dialogRef.current

    if (!node) return

    if (open && !node.open) {
      node.showModal()
    } else if (!open && node.open) {
      node.close()
    }
  }, [open])

  // Native dialogs do not lock page scroll on their own.
  useEffect(() => {
    if (!open) return

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [open])

  function handleBackdropClick(event: MouseEvent<HTMLDialogElement>) {
    if (event.target === dialogRef.current) onClose()
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onClose={onClose}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClick={handleBackdropClick}
      className={cn(
        'm-auto w-[min(92vw,32rem)] rounded-card border border-border bg-elevated p-0 text-foreground shadow-2xl shadow-background/70',
        'backdrop:bg-background/80 backdrop:backdrop-blur-sm',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <h2 id={titleId} className="text-base font-semibold">
            {title}
          </h2>
          {description ? (
            <p id={descriptionId} className="mt-1 text-sm leading-relaxed text-muted">
              {description}
            </p>
          ) : null}
        </div>
        <IconButton label="Close dialog" onClick={onClose}>
          <X aria-hidden="true" className="size-4" strokeWidth={1.75} />
        </IconButton>
      </div>

      {children ? <div className="px-5 py-4">{children}</div> : null}
      {footer ? (
        <div className="flex flex-wrap justify-end gap-2 border-t border-border px-5 py-4">
          {footer}
        </div>
      ) : null}
    </dialog>
  )
}
