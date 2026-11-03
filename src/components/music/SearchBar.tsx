import { Search, X } from 'lucide-react'
import { useRef } from 'react'
import type { FormEvent } from 'react'

import { IconButton } from '@/components/ui/IconButton'
import { cn } from '@/lib/utils'

type SearchBarProps = {
  value: string
  onChange: (value: string) => void
  label?: string
  placeholder?: string
  /** Describes the live result count for assistive technology. */
  resultLabel?: string
  className?: string
  /** Unique input id; pages render one search field at a time. */
  id?: string
}

export function SearchBar({
  value,
  onChange,
  label = 'Search music catalog',
  placeholder = 'Search songs, artists, genres',
  resultLabel,
  className,
  id = 'catalog-search',
}: SearchBarProps) {
  const statusId = `${id}-status`
  const inputRef = useRef<HTMLInputElement>(null)

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    // Filtering happens locally; submitting must not reload the page.
    event.preventDefault()
  }

  function handleClear() {
    onChange('')
    inputRef.current?.focus()
  }

  return (
    <form role="search" onSubmit={handleSubmit} className={cn('relative', className)}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted"
        strokeWidth={1.75}
      />
      <input
        ref={inputRef}
        id={id}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        enterKeyHint="search"
        aria-describedby={resultLabel ? statusId : undefined}
        className="h-11 w-full rounded-xl border border-border bg-surface pr-12 pl-11 text-sm text-foreground transition-colors placeholder:text-muted hover:border-border/80 focus-visible:border-accent/50 focus-visible:ring-2 focus-visible:ring-accent/20 focus-visible:outline-none [&::-webkit-search-cancel-button]:appearance-none"
      />
      {value ? (
        <IconButton
          label="Clear search"
          onClick={handleClear}
          className="absolute top-1/2 right-1.5 -translate-y-1/2"
        >
          <X aria-hidden="true" className="size-4" strokeWidth={1.75} />
        </IconButton>
      ) : null}
      {resultLabel ? (
        <p id={statusId} aria-live="polite" className="sr-only">
          {resultLabel}
        </p>
      ) : null}
    </form>
  )
}
