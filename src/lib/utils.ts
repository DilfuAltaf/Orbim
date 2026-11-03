type ClassValue = string | false | null | undefined

/** Join conditional class names without pulling in an extra dependency. */
export function cn(...values: ClassValue[]): string {
  return values.filter(Boolean).join(' ')
}
