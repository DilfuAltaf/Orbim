import { cn } from '@/lib/utils'

type SkeletonProps = {
  className?: string
}

/** Neutral loading placeholder used by pages that await real data in later phases. */
export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded-lg bg-elevated', className)}
    />
  )
}
