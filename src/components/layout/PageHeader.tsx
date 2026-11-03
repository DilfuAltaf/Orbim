import type { ReactNode } from 'react'

import { Badge } from '@/components/ui/Badge'

type PageHeaderProps = {
  title: string
  description?: string
  /** Phase label so preview screens never read as finished features. */
  phase?: string
  actions?: ReactNode
}

export function PageHeader({ title, description, phase, actions }: PageHeaderProps) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4 sm:mb-8">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-[1.75rem]">{title}</h1>
          {phase ? (
            <Badge tone="violet" className="py-0.5">
              {phase}
            </Badge>
          ) : null}
        </div>
        {description ? (
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  )
}
