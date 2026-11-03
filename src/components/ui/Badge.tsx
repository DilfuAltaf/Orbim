import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

type BadgeTone = 'neutral' | 'accent' | 'violet'

const tones: Record<BadgeTone, string> = {
  neutral: 'border-border bg-elevated text-muted',
  accent: 'border-accent/25 bg-accent/10 text-accent',
  violet: 'border-accent-secondary/25 bg-accent-secondary/10 text-accent-secondary',
}

type BadgeProps = {
  children: ReactNode
  tone?: BadgeTone
  className?: string
}

export function Badge({ children, tone = 'neutral', className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium tracking-wide',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}
