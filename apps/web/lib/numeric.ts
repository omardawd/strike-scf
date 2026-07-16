// Claude sometimes writes a number with its unit attached (e.g. "500MT",
// "500 MT", "$475,000") into what's supposed to be a plain numeric tool
// argument — Postgres numeric columns reject that outright. Coerce
// defensively wherever AI-generated input reaches a numeric DB column.
export function coerceNumber(value: unknown): number | null {
  if (value == null) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string') return null
  const match = value.replace(/,/g, '').match(/-?\d+(\.\d+)?/)
  if (!match) return null
  const n = Number(match[0])
  return Number.isFinite(n) ? n : null
}
