import { site } from '@/config/site'
import { cn } from '@/lib/utils'

type LogoProps = {
  /** Render the ORBIM wordmark next to the orbital mark. */
  withWordmark?: boolean
  className?: string
}

/**
 * Brand lockup. Uses the original PNG assets through `public/brand/` while the
 * optimized SVG version is still pending (PRD §5.5, Phase 2).
 */
export function Logo({ withWordmark = true, className }: LogoProps) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <img
        src={site.logoMark}
        alt={withWordmark ? '' : site.name}
        aria-hidden={withWordmark ? true : undefined}
        className="h-7 w-auto select-none"
        draggable={false}
      />
      {withWordmark ? (
        <span className="text-base font-semibold tracking-[0.22em] text-foreground">
          {site.name}
        </span>
      ) : null}
    </span>
  )
}
