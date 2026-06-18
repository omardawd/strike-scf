'use client'
import React, { useRef, useState } from 'react'

interface Props {
  isOpen: boolean
  onClose: () => void
  programId: string
  anchorOrgId: string
}

export function BulkInviteModal({ isOpen, onClose, programId, anchorOrgId }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<Array<{ name: string; email: string }>>([])
  const [parseError, setParseError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<{ sent: number; failed: number } | null>(null)

  async function parseCSV(f: File) {
    const text = await f.text()
    const lines = text.split('\n').map(l => l.trim()).filter(l => l)

    const firstLine = lines[0]?.toLowerCase() ?? ''
    const hasHeader = firstLine.includes('email') || firstLine.includes('name')
    const dataLines = hasHeader ? lines.slice(1) : lines

    const parsed = dataLines.map(line => {
      const cols = line.split(',').map(c => c.trim().replace(/"/g, ''))
      const emailCol = cols.find(c => c.includes('@'))
      const nameCol = cols.find(c => c && !c.includes('@'))
      return { email: emailCol ?? '', name: nameCol ?? '' }
    }).filter(r => r.email.includes('@'))

    if (parsed.length === 0) {
      setParseError('No valid email addresses found. Ensure your CSV has an email column.')
      setPreview([])
      return
    }
    setParseError('')
    setPreview(parsed)
  }

  async function handleSubmit() {
    setSubmitting(true)
    const res = await fetch(`/api/programs/${programId}/bulk-invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ suppliers: preview, anchor_org_id: anchorOrgId }),
    })
    const data = await res.json()
    setResult({ sent: data.sent, failed: data.failed })
    setSubmitting(false)
  }

  function handleClose() {
    setFile(null)
    setPreview([])
    setParseError('')
    setResult(null)
    setSubmitting(false)
    onClose()
  }

  if (!isOpen) return null

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 50,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={handleClose}
    >
      <div
        className="card"
        style={{ width: 480, maxWidth: '90vw', boxShadow: '0 8px 32px rgba(0,0,0,0.18)', maxHeight: '90vh', overflowY: 'auto' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="card-head">
          <h3 className="t-card-head">Bulk invite suppliers</h3>
          <button className="btn btn-ghost btn-sm" type="button" onClick={handleClose}>✕</button>
        </div>

        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {result ? (
            <div style={{ padding: '20px 24px', textAlign: 'center' }}>
              <div style={{
                fontFamily: 'var(--font-display)',
                fontSize: 28, fontWeight: 600,
                letterSpacing: '-0.02em',
                color: 'var(--ink)',
                marginBottom: 8,
              }}>
                {result.sent} invitations sent
              </div>
              {result.failed > 0 && (
                <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--gray)' }}>
                  {result.failed} failed — check server logs
                </div>
              )}
              <button
                className="btn btn-primary btn-sm"
                onClick={handleClose}
                style={{ marginTop: 16 }}>
                Done
              </button>
            </div>
          ) : (
            <>
              {/* Upload zone */}
              <div
                style={{
                  border: '2px dashed var(--border)',
                  padding: '32px 24px',
                  textAlign: 'center',
                  cursor: 'pointer',
                  background: file ? 'rgba(20,40,204,0.02)' : '',
                }}
                onClick={() => fileRef.current?.click()}
              >
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv"
                  style={{ display: 'none' }}
                  onChange={e => {
                    const f = e.target.files?.[0]
                    if (f) { setFile(f); parseCSV(f) }
                  }}
                />
                <div style={{
                  fontFamily: 'var(--font-body)',
                  fontSize: 13,
                  fontWeight: 500,
                  color: file ? 'var(--blue)' : 'var(--gray)',
                  marginBottom: 8,
                }}>
                  {file ? file.name : 'Click to upload CSV'}
                </div>
                <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--gray)' }}>
                  CSV with columns: name (optional), email
                </div>
              </div>

              {/* Format example */}
              <div style={{
                background: 'var(--offwhite)',
                border: '1px solid var(--border)',
                padding: '10px 14px',
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                color: 'var(--gray)',
                marginTop: 10,
              }}>
                name,email<br />
                Jane Smith,jane@acme.com<br />
                Bob Jones,bob@corp.com
              </div>

              {/* Parse error */}
              {parseError && (
                <div style={{ color: '#DC2626', fontSize: 13, marginTop: 10 }}>{parseError}</div>
              )}

              {/* Preview table */}
              {preview.length > 0 && (
                <>
                  <div style={{ marginTop: 16, border: '1px solid var(--border)' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, background: 'var(--border)' }}>
                      {['Name', 'Email'].map(h => (
                        <div key={h} style={{
                          background: 'var(--offwhite)',
                          padding: '8px 12px',
                          fontFamily: 'var(--font-body)',
                          fontSize: 11,
                          fontWeight: 500,
                          letterSpacing: '0.04em',
                          textTransform: 'uppercase',
                          color: 'var(--gray)',
                        }}>{h}</div>
                      ))}
                    </div>
                    {preview.slice(0, 5).map((r, i) => (
                      <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, background: 'var(--border)' }}>
                        <div style={{ background: 'var(--offwhite)', padding: '8px 12px', fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--ink)' }}>
                          {r.name || '—'}
                        </div>
                        <div style={{ background: 'var(--offwhite)', padding: '8px 12px', fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--ink)' }}>
                          {r.email}
                        </div>
                      </div>
                    ))}
                    {preview.length > 5 && (
                      <div style={{ padding: '8px 12px', fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--gray)' }}>
                        + {preview.length - 5} more
                      </div>
                    )}
                  </div>

                  <div style={{ marginTop: 10, fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 500, color: 'var(--blue)' }}>
                    {preview.length} suppliers will be invited
                  </div>
                </>
              )}

              <button
                className="btn btn-primary"
                onClick={handleSubmit}
                disabled={preview.length === 0 || submitting}
                style={{ width: '100%', marginTop: 16 }}>
                {submitting
                  ? `Sending ${preview.length} invitations...`
                  : `Send ${preview.length} invitations`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
