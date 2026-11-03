import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

type SectionHeaderProps = {
  title: string
  description?: string
  action?: ReactNode
  className?: string
  /** Anchor id for `aria-labelledby` on the surrounding section. */
  id?: string
  /** Heading level matches the surrounding document outline. */
  as?: 'h2' | 'h3'
}

export function SectionHeader({
  title,
  description,
  action,
  className,
  id,
  as: Heading = 'h2',
}: SectionHeaderProps) {
  return (
    <div className={cn('flex flex-wrap items-end justify-between gap-3', className)}>
      <div className="min-w-0">
        <Heading id={id} className="text-base font-semibold text-foreground sm:text-lg">
          {title}
        </Heading>
        {description ? (
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted sm:text-sm">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  )
}
