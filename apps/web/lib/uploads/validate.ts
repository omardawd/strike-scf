// Shared upload validation — size cap, MIME allowlist, filename
// sanitization. Applied inconsistently across the app's 12 upload routes
// before this (ASSESSMENT.md P1-5); this is the one place the logic now
// lives, so a route no longer has to remember to do it.

export const DEFAULT_MAX_UPLOAD_BYTES = 20 * 1024 * 1024 // 20 MB, matches ai/upload's existing limit

export const DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'text/plain',
]

export const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp']

/**
 * Strips a client-supplied filename down to a safe subset before it's used
 * to build a storage path — never trust it directly (path traversal via
 * `../`, null bytes, control characters, or just an unreasonably long name
 * are all possible from a client). Preserves the extension where present.
 */
export function sanitizeFilename(name: string): string {
  const trimmed = name.trim().slice(-200) // keep it bounded; take the tail so the extension survives truncation
  const safe = trimmed
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/\.{2,}/g, '_') // collapse repeated dots ("..") even though '/' is already stripped above
  return safe.length > 0 ? safe : 'file'
}

export interface UploadValidationOptions {
  maxBytes?: number
  allowedMimeTypes?: string[]
}

export interface UploadValidationResult {
  ok: boolean
  error?: string
}

/**
 * Validates a File before it's read/stored. Does NOT do content-based
 * (magic-byte) sniffing — the client-supplied Content-Type is trusted for
 * the allowlist check, which is a known limitation (see ASSESSMENT.md P1-5)
 * and the reason this never substitutes for the malware-scanning
 * integration point below.
 */
export function validateUpload(file: File, options: UploadValidationOptions = {}): UploadValidationResult {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_UPLOAD_BYTES
  if (file.size > maxBytes) {
    return { ok: false, error: `File exceeds the ${Math.round(maxBytes / (1024 * 1024))}MB limit` }
  }
  if (options.allowedMimeTypes && !options.allowedMimeTypes.includes(file.type)) {
    return { ok: false, error: `Unsupported file type: ${file.type || 'unknown'}` }
  }
  return { ok: true }
}

/**
 * Malware-scanning extension point. Always reports clean today — no scanner
 * is integrated (documented as Phase 2/3 in ROADMAP.md 1.I). Wiring a real
 * provider (e.g. an AV engine behind a queue, or a hosted scanning API) is
 * a matter of implementing this function's body; every upload route that
 * calls it will pick up real scanning with no other changes.
 */
export async function scanForMalware(_bytes: ArrayBuffer): Promise<{ clean: boolean; reason?: string }> {
  void _bytes
  return { clean: true }
}
