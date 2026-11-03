export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md'

const base =
  'inline-flex select-none items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap transition-colors duration-150 ease-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-45'

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-contrast hover:bg-accent/90',
  secondary:
    'border border-border bg-elevated text-foreground hover:border-accent/40 hover:bg-elevated/80',
  ghost: 'text-muted hover:bg-elevated hover:text-foreground',
  danger:
    'border border-red-500/40 bg-red-500/10 text-red-400 hover:bg-red-500/20 hover:border-red-500/60 focus-visible:ring-red-500/70',
}

const sizes: Record<ButtonSize, string> = {
  sm: 'h-9 px-3 text-sm',
  md: 'h-10 px-4 text-sm',
}

type ButtonVariantOptions = {
  variant?: ButtonVariant
  size?: ButtonSize
  className?: string
}

/**
 * Shared button styling so links and buttons stay visually identical.
 * Lives outside `Button.tsx` to keep that module component-only.
 */
export function buttonVariants({
  variant = 'primary',
  size = 'md',
  className,
}: ButtonVariantOptions = {}): string {
  return [base, variants[variant], sizes[size], className].filter(Boolean).join(' ')
}
