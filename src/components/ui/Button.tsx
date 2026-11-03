import type { ComponentPropsWithoutRef } from 'react'

import { buttonVariants, type ButtonSize, type ButtonVariant } from '@/lib/styles'
import { cn } from '@/lib/utils'

type ButtonProps = ComponentPropsWithoutRef<'button'> & {
  variant?: ButtonVariant
  size?: ButtonSize
}

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  )
}
