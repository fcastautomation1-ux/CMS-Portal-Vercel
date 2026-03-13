export function splitTaskMeta(value: string | null | undefined): string[] {
  if (!value) return []
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
}

export function joinTaskMeta(values: string[]): string | null {
  const unique = Array.from(
    new Set(values.map((value) => value.trim()).filter(Boolean))
  )
  return unique.length ? unique.join(', ') : null
}
