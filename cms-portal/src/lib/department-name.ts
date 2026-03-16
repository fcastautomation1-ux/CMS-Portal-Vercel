export function canonicalDepartmentKey(value: string | null | undefined): string {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['’`]/g, '')
    .replace(/\bapps?\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function splitDepartmentsCsv(value: string | null | undefined): string[] {
  return String(value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

export function mapDepartmentCsvToOfficial(
  csvValue: string | null | undefined,
  canonicalToOfficial: Record<string, string>
): string {
  const mapped = splitDepartmentsCsv(csvValue).map((entry) => {
    const key = canonicalDepartmentKey(entry)
    return canonicalToOfficial[key] || entry
  })

  return Array.from(new Set(mapped)).join(', ')
}
