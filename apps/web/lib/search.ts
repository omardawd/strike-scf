// Sanitize a user-supplied search term before interpolating it into a
// Supabase/PostgREST `.or(...)` / `.ilike(...)` filter string.
//
// Supabase's JS client does NOT parameterize `.or()` — the term is embedded
// directly into the PostgREST query string. A raw comma splits the or() list,
// and parentheses/colons/backslashes let an attacker append arbitrary column
// predicates (e.g. "zzz,ein.eq.123456789") to blind-exfiltrate columns that
// aren't even in the select. `%`/`*` are ilike wildcards. Strip all of them so
// the term can only ever be a literal substring match.
export function sanitizeSearchTerm(raw: string): string {
  return raw
    .replace(/[,()\\:%*"`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100)
}
