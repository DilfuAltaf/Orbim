import { NavLink } from 'react-router-dom'

import { primaryNavigation } from '@/lib/navigation'
import { cn } from '@/lib/utils'

/** Bottom tab bar for small screens. Hidden from `lg` upwards. */
export function MobileNavigation() {
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
    >
      <ul
        className="mx-auto grid h-14 max-w-lg"
        style={{ gridTemplateColumns: `repeat(${primaryNavigation.length}, minmax(0, 1fr))` }}
      >
        {primaryNavigation.map((item) => {
          const Icon = item.icon

          return (
            <li key={item.to} className="min-w-0">
              <NavLink
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    'relative flex h-full flex-col items-center justify-center gap-1 text-[10px] font-medium transition-colors duration-150',
                    'focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-inset focus-visible:outline-none',
                    isActive ? 'text-accent' : 'text-muted hover:text-foreground',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <span
                      aria-hidden="true"
                      className={cn(
                        'absolute top-0 h-0.5 w-8 rounded-full transition-opacity',
                        isActive ? 'bg-accent opacity-100' : 'opacity-0',
                      )}
                    />
                    <Icon aria-hidden="true" className="size-5" strokeWidth={1.75} />
                    <span className="max-w-full truncate px-1">{item.shortLabel}</span>
                  </>
                )}
              </NavLink>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
