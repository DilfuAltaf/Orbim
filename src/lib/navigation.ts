import { Compass, House, Settings } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export type NavItem = {
  label: string
  /** Compact label for the mobile tab bar. */
  shortLabel: string
  to: string
  icon: LucideIcon
  /** Match the route exactly (`/` would otherwise stay active on every page). */
  end?: boolean
}

/** Primary application navigation (PRD §6). */
export const primaryNavigation: NavItem[] = [
  { label: 'Home', shortLabel: 'Home', to: '/', icon: House, end: true },
  { label: 'Explore', shortLabel: 'Explore', to: '/explore', icon: Compass },
  { label: 'Settings', shortLabel: 'Settings', to: '/settings', icon: Settings },
]

export const sidebarNavLinkClass =
  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-150 ease-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70'

export const sidebarNavLinkActiveClass = 'bg-accent/10 text-accent'

export const sidebarNavLinkIdleClass =
  'text-muted hover:bg-elevated/70 hover:text-foreground'
