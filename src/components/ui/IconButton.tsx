import type { ComponentPropsWithoutRef, ReactNode } from 'react'

import { cn } from '@/lib/utils'

type IconButtonVariant = 'accent' | 'outline' | 'ghost'
type IconButtonSize = 'sm' | 'md'

const variants: Record<IconButtonVariant, string> = {
  accent: 'bg-accent text-accent-contrast hover:bg-accent/90',
  outline:
    'border border-border bg-elevated text-foreground hover:border-accent/40 hover:text-accent',
  ghost: 'text-muted hover:bg-elevated hover:text-foreground',
}

const sizes: Record<IconButtonSize, string> = {
  sm: 'size-8',
  md: 'size-10',
}

type IconButtonProps = Omit<ComponentPropsWithoutRef<'button'>, 'aria-label'> & {
  /** Required accessible name — icon-only controls have no readable text. */
  label: string
  variant?: IconButtonVariant
  size?: IconButtonSize
  children: ReactNode
}

export function IconButton({
  label,
  variant = 'ghost',
  size = 'sm',
  className,
  type = 'button',
  children,
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full transition-colors duration-150 ease-soft',
        'focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none',
        'disabled:pointer-events-none disabled:opacity-40',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}
