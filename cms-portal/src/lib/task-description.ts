const TAG_RE = /<\/?[a-z][\s\S]*>/i

function splitTableRow(line: string) {
  const trimmed = line.trim()
  const normalized = trimmed.startsWith('|') && trimmed.endsWith('|')
    ? trimmed.slice(1, -1)
    : trimmed
  return normalized.split('|').map((cell) => cell.trim())
}

function isMarkdownSeparatorRow(line: string) {
  const cells = splitTableRow(line)
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell))
}

function looksLikeDelimitedTable(lines: string[]) {
  if (lines.length < 2) return false
  const candidateLines = lines.filter((line) => line.trim())
  if (candidateLines.length < 2) return false

  const pipeRows = candidateLines.filter((line) => line.includes('|'))
  if (pipeRows.length >= 2) return true

  const tabRows = candidateLines.filter((line) => line.includes('\t'))
  if (tabRows.length >= 2) return true

  const commaRows = candidateLines.filter((line) => line.split(',').length > 1)
  return commaRows.length >= 2
}

function parseDelimitedRows(lines: string[]) {
  const nonEmpty = lines.filter((line) => line.trim())
  if (!nonEmpty.length) return []

  if (nonEmpty.some((line) => line.includes('|'))) {
    const rows = nonEmpty.map(splitTableRow)
    if (rows.length >= 2 && isMarkdownSeparatorRow(nonEmpty[1])) {
      return [rows[0], ...rows.slice(2)]
    }
    return rows
  }

  if (nonEmpty.some((line) => line.includes('\t'))) {
    return nonEmpty.map((line) => line.split('\t').map((cell) => cell.trim()))
  }

  return nonEmpty.map((line) => line.split(',').map((cell) => cell.trim()))
}

function buildTableHtml(rows: string[][]) {
  if (!rows.length) return ''
  const columnCount = Math.max(...rows.map((row) => row.length))
  const renderRow = (cells: string[], tag: 'th' | 'td') =>
    Array.from({ length: columnCount }, (_, index) => `<${tag}>${escapeHtml(cells[index] ?? '')}</${tag}>`).join('')

  const header = rows[0]
  const body = rows.length > 1 ? rows.slice(1) : [Array.from({ length: columnCount }, () => '')]

  return [
    '<table><tbody>',
    `<tr>${renderRow(header, 'th')}</tr>`,
    ...body.map((row) => `<tr>${renderRow(row, 'td')}</tr>`),
    '</tbody></table>',
  ].join('')
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function sanitizeTaskDescriptionHtml(value: string): string {
  return value
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, '')
    .replace(/<(iframe|object|embed|link|meta)[^>]*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(['"]).*?\1/gi, '')
    .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '')
    .replace(/\sstyle\s*=\s*(['"]).*?\1/gi, '')
    .replace(/\sclass\s*=\s*(['"]).*?\1/gi, '')
}

export function normalizeTaskDescription(value: string | null | undefined): string {
  if (!value?.trim()) return ''

  if (!TAG_RE.test(value)) {
    const lines = value.split(/\r?\n/)
    if (looksLikeDelimitedTable(lines)) {
      const tableHtml = buildTableHtml(parseDelimitedRows(lines))
      if (tableHtml) return tableHtml
    }

    return lines.map((line) => `<p>${escapeHtml(line) || '<br />'}</p>`).join('')
  }

  return sanitizeTaskDescriptionHtml(value)
}

export function taskDescriptionToPlainText(value: string | null | undefined): string {
  if (!value) return ''
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<\/(td|th)>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}
