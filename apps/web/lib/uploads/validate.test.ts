import { describe, expect, it } from 'vitest'
import { sanitizeFilename, validateUpload, scanForMalware, DEFAULT_MAX_UPLOAD_BYTES } from './validate'

describe('sanitizeFilename', () => {
  it('leaves a normal filename unchanged', () => {
    expect(sanitizeFilename('invoice-2026.pdf')).toBe('invoice-2026.pdf')
  })

  it('replaces path traversal sequences', () => {
    expect(sanitizeFilename('../../etc/passwd')).not.toContain('..')
    expect(sanitizeFilename('../../etc/passwd')).not.toContain('/')
  })

  it('strips spaces and special characters', () => {
    expect(sanitizeFilename('my file (final) v2.docx')).toBe('my_file__final__v2.docx')
  })

  it('handles null bytes and control characters', () => {
    const result = sanitizeFilename('evil\x00.pdf')
    expect(result).not.toContain('\x00')
  })

  it('never returns an empty string', () => {
    expect(sanitizeFilename('')).toBe('file')
    expect(sanitizeFilename('///')).not.toBe('')
  })

  it('bounds excessively long filenames', () => {
    const long = 'a'.repeat(500) + '.pdf'
    expect(sanitizeFilename(long).length).toBeLessThanOrEqual(200)
  })
})

function fakeFile(size: number, type: string): File {
  return { size, type } as File
}

describe('validateUpload', () => {
  it('rejects a file over the default size limit', () => {
    const result = validateUpload(fakeFile(DEFAULT_MAX_UPLOAD_BYTES + 1, 'application/pdf'))
    expect(result.ok).toBe(false)
  })

  it('accepts a file within the default size limit', () => {
    const result = validateUpload(fakeFile(1024, 'application/pdf'))
    expect(result.ok).toBe(true)
  })

  it('respects a custom maxBytes', () => {
    const result = validateUpload(fakeFile(2000, 'application/pdf'), { maxBytes: 1000 })
    expect(result.ok).toBe(false)
  })

  it('rejects a MIME type not in the allowlist', () => {
    const result = validateUpload(fakeFile(100, 'application/x-msdownload'), {
      allowedMimeTypes: ['application/pdf', 'image/png'],
    })
    expect(result.ok).toBe(false)
  })

  it('accepts a MIME type in the allowlist', () => {
    const result = validateUpload(fakeFile(100, 'image/png'), {
      allowedMimeTypes: ['application/pdf', 'image/png'],
    })
    expect(result.ok).toBe(true)
  })
})

describe('scanForMalware', () => {
  it('reports clean when no scanner is configured (documented no-op)', async () => {
    const result = await scanForMalware(new ArrayBuffer(10))
    expect(result.clean).toBe(true)
  })
})
