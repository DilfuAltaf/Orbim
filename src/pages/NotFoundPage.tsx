import { Compass, House } from 'lucide-react'
import { Link } from 'react-router-dom'

import { Badge } from '@/components/ui/Badge'
import { buttonVariants } from '@/lib/styles'

export function NotFoundPage() {
  return (
    <div className="flex min-h-[60svh] items-center">
      <div className="w-full max-w-lg">
        <div aria-hidden="true" className="relative mb-8 size-28">
          <span className="absolute inset-0 rounded-full border border-border" />
          <span className="absolute inset-4 rounded-full border border-border/70" />
          <span className="absolute top-1/2 left-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent" />
          <span className="absolute top-2 right-5 size-1.5 rounded-full bg-accent-secondary" />
        </div>

        <Badge tone="neutral">404 · Off course</Badge>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight sm:text-3xl">
          This page is off the orbit
        </h1>
        <p className="mt-2 max-w-md text-sm leading-relaxed text-muted">
          The address does not match any ORBIM route. If you followed a playlist or invitation
          link, it may not exist in this demo catalog.
        </p>

        <div className="mt-6 flex flex-wrap gap-2">
          <Link to="/" className={buttonVariants()}>
            <House aria-hidden="true" className="size-4" strokeWidth={1.75} />
            Back to home
          </Link>
          <Link to="/explore" className={buttonVariants({ variant: 'secondary' })}>
            <Compass aria-hidden="true" className="size-4" strokeWidth={1.75} />
            Explore tracks
          </Link>
        </div>
      </div>
    </div>
  )
}
