import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

type EmptyStateProps = {
  icon: LucideIcon
  title: string
  description: string
  action?: ReactNode
  className?: string
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <section
      className={cn(
        'flex flex-col items-center justify-center rounded-card border border-dashed border-border bg-surface/60 px-6 py-12 text-center',
        className,
      )}
    >
      <span className="mb-4 flex size-11 items-center justify-center rounded-full border border-border bg-elevated text-accent">
        <Icon aria-hidden="true" className="size-5" strokeWidth={1.75} />
      </span>
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted">{description}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </section>
  )
}
