import type { ChangeEvent } from 'react'

type TextFieldProps = {
  id: string
  label: string
  type?: 'text' | 'email' | 'password'
  autoComplete?: string
  placeholder?: string
  disabled?: boolean
  value?: string
  onChange?: (e: ChangeEvent<HTMLInputElement>) => void
  required?: boolean
}

export function TextField({
  id,
  label,
  type = 'text',
  autoComplete,
  placeholder,
  disabled,
  value,
  onChange,
  required,
}: TextFieldProps) {
  return (
    <div className="space-y-1.5">
      <label
        htmlFor={id}
        className="block text-[11px] font-semibold tracking-[0.14em] text-muted uppercase"
      >
        {label}
      </label>
      <input
        id={id}
        name={id}
        type={type}
        autoComplete={autoComplete}
        placeholder={placeholder}
        disabled={disabled}
        value={value}
        onChange={onChange}
        required={required}
        className="h-10 w-full rounded-lg border border-border bg-elevated px-3 text-sm text-foreground transition-colors placeholder:text-muted hover:border-border/80 focus-visible:border-accent/50 focus-visible:ring-2 focus-visible:ring-accent/25 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
      />
    </div>
  )
}
