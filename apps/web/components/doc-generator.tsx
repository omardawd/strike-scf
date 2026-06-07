'use client'
import React, { useState, useRef, useEffect } from 'react'

interface DocGeneratorProps {
  entityType: 'transaction' | 'kyb' | 'program'
  entityData: Record<string, any>
  portal: 'bank' | 'anchor' | 'supplier'
}

interface GeneratedDoc {
  content: string
  filename: string
  generatedAt: string
}

// Merged template set: regulatory/formal templates + the generic Strike AI document
// types. `id` must match a VALID_TYPE in /api/ai/documents.
const TEMPLATES = [
  {
    id: 'transaction_summary',
    label: 'Transaction Summary',
    desc: 'Full transaction audit summary',
    availableFor: ['bank', 'anchor', 'supplier'],
  },
  {
    id: 'audit_log',
    label: 'Transaction Audit Log',
    desc: 'Chronological status-transition log',
    availableFor: ['bank', 'anchor', 'supplier'],
  },
  {
    id: 'passport_report',
    label: 'PassportScore Report',
    desc: 'Score breakdown and risk flags',
    availableFor: ['bank', 'anchor', 'supplier'],
  },
  {
    id: 'financing_request',
    label: 'Financing Request',
    desc: 'Formal financing request document',
    availableFor: ['bank', 'supplier'],
  },
  {
    id: 'kyb_report',
    label: 'KYB Due Diligence Report',
    desc: 'Counterparty due diligence report',
    availableFor: ['bank'],
  },
  {
    id: 'kyb_summary',
    label: 'KYB Due Diligence Summary',
    desc: 'Condensed counterparty due diligence',
    availableFor: ['bank'],
  },
  {
    id: 'bcbs_239',
    label: 'BCBS 239 — Risk Data Report',
    desc: 'Basel Committee risk data aggregation',
    availableFor: ['bank'],
  },
  {
    id: 'mas_610',
    label: 'MAS 610 — Credit Facilities Report',
    desc: 'MAS Notice 610 credit exposure report',
    availableFor: ['bank'],
  },
  {
    id: 'eba_finrep',
    label: 'EBA FinRep — Financial Report',
    desc: 'EBA financial reporting template',
    availableFor: ['bank'],
  },
  {
    id: 'invoice_confirmation',
    label: 'Invoice Confirmation Letter',
    desc: 'Formal invoice financing confirmation',
    availableFor: ['bank', 'supplier'],
  },
  {
    id: 'anchor_payment_notice',
    label: 'Anchor Payment Notice',
    desc: 'Repayment instruction document',
    availableFor: ['bank', 'anchor'],
  },
]

// ── Minimal regex-based Markdown → HTML (no external library) ──
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function inline(s: string): string {
  return escapeHtml(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+?)`/g, '<code style="font-family:var(--font-mono);background:var(--offwhite);padding:1px 5px;border-radius:4px;font-size:0.9em;">$1</code>')
}

function rowCells(line: string): string[] {
  const cells = line.split('|').map(c => c.trim())
  if (cells.length && cells[0] === '') cells.shift()
  if (cells.length && cells[cells.length - 1] === '') cells.pop()
  return cells
}

function renderMarkdown(md: string): string {
  const lines = md.split('\n')
  const out: string[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i] ?? ''

    if (/^\s*---\s*$/.test(line)) {
      out.push('<hr style="border:none;border-top:1px solid var(--border);margin:18px 0;" />')
      i++
      continue
    }

    const h = /^(#{1,4})\s+(.*)$/.exec(line)
    if (h) {
      const level = h[1]!.length
      const size = level === 1 ? 22 : level === 2 ? 18 : level === 3 ? 15 : 13
      out.push(`<h${level} style="font-family:var(--font-display);font-size:${size}px;font-weight:700;margin:18px 0 8px;color:var(--ink);">${inline(h[2]!)}</h${level}>`)
      i++
      continue
    }

    if (line.includes('|') && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1] ?? '')) {
      const header = rowCells(line)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && (lines[i] ?? '').includes('|')) {
        rows.push(rowCells(lines[i] ?? ''))
        i++
      }
      let table = '<table style="border-collapse:collapse;width:100%;margin:12px 0;font-size:13px;">'
      table += '<thead><tr>' + header.map(c =>
        `<th style="border:1px solid var(--border);padding:8px 10px;text-align:left;background:var(--offwhite);font-weight:600;">${inline(c)}</th>`
      ).join('') + '</tr></thead><tbody>'
      for (const r of rows) {
        table += '<tr>' + r.map(c =>
          `<td style="border:1px solid var(--border);padding:8px 10px;">${inline(c)}</td>`
        ).join('') + '</tr>'
      }
      table += '</tbody></table>'
      out.push(table)
      continue
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i] ?? '')) {
        items.push(`<li style="margin:3px 0;">${inline((lines[i] ?? '').replace(/^\s*[-*]\s+/, ''))}</li>`)
        i++
      }
      out.push(`<ul style="margin:8px 0;padding-left:20px;">${items.join('')}</ul>`)
      continue
    }

    if (line.trim() === '') {
      i++
      continue
    }

    out.push(`<p style="margin:8px 0;line-height:1.6;font-size:14px;color:var(--ink);">${inline(line)}</p>`)
    i++
  }

  return out.join('\n')
}

export function DocGenerator({ entityType, entityData, portal }: DocGeneratorProps) {
  const [mode, setMode] = useState<'templates' | 'custom'>('templates')
  const [selectedTemplate, setSelectedTemplate] = useState<string>('')
  const [customFile, setCustomFile] = useState<File | null>(null)
  const [customTemplateText, setCustomTemplateText] = useState<string>('')
  const [generating, setGenerating] = useState(false)
  const [doc, setDoc] = useState<GeneratedDoc | null>(null)
  const [error, setError] = useState<string>('')
  const fileRef = useRef<HTMLInputElement>(null)

  const availableTemplates = TEMPLATES.filter(t => t.availableFor.includes(portal))

  // Close preview modal on Escape
  useEffect(() => {
    if (!doc) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setDoc(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [doc])

  async function handleGenerate() {
    setGenerating(true)
    setDoc(null)
    setError('')

    try {
      const payload = mode === 'templates'
        ? { type: selectedTemplate, context: { entityType, ...entityData } }
        : { type: 'custom', context: { entityType, templateText: customTemplateText, ...entityData } }

      const res = await fetch('/api/ai/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (res.status === 429) {
        setError('Daily document limit reached. Resets at midnight UTC.')
        return
      }
      if (!res.ok) {
        setError('Failed to generate document. Please try again.')
        return
      }

      const data = (await res.json()) as GeneratedDoc
      if (!data.content) {
        setError('Failed to generate document. Please try again.')
        return
      }
      setDoc(data)
    } catch {
      setError('Failed to generate document. Please try again.')
    } finally {
      setGenerating(false)
    }
  }

  function downloadMd() {
    if (!doc) return
    const blob = new Blob([doc.content], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = doc.filename
    a.click()
    URL.revokeObjectURL(url)
  }

  function downloadPdf() {
    const style = document.createElement('style')
    style.media = 'print'
    style.textContent = `
      body * { visibility: hidden !important; }
      #strike-doc-print, #strike-doc-print * { visibility: visible !important; }
      #strike-doc-print {
        position: absolute !important; left: 0; top: 0; width: 100%;
        padding: 32px !important; background: #fff !important;
      }
    `
    document.head.appendChild(style)
    window.print()
    setTimeout(() => {
      if (style.parentNode) style.parentNode.removeChild(style)
    }, 2000)
  }

  return (
    <div style={{
      border: '1px solid var(--border)',
      background: 'var(--white)',
      marginTop: 16,
    }}>
      {/* Header */}
      <div style={{
        padding: '14px 20px',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
      }}>
        <div style={{
          width: 6, height: 6,
          borderRadius: '50%',
          background: 'var(--blue)',
          animation: 'badge-pulse 2.4s infinite',
        }} />
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: 'var(--blue)',
        }}>Strike AI · Document Generator</span>
      </div>

      {/* Body */}
      <div style={{ padding: 20 }}>
        {/* Mode tabs */}
        <div style={{
          display: 'flex',
          gap: 1,
          background: 'var(--border)',
          marginBottom: 16,
        }}>
          {(['templates', 'custom'] as const).map(m => (
            <button key={m}
              onClick={() => {
                setMode(m)
                setDoc(null)
                setSelectedTemplate('')
                setCustomFile(null)
              }}
              style={{
                flex: 1, padding: '10px',
                background: mode === m ? 'var(--white)' : 'var(--offwhite)',
                border: 'none', cursor: 'pointer',
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: mode === m ? 'var(--blue)' : 'var(--gray)',
                borderBottom: mode === m ? '2px solid var(--blue)' : '2px solid transparent',
              }}>
              {m === 'templates' ? 'Built-in templates' : 'Upload my template'}
            </button>
          ))}
        </div>

        {/* Templates mode */}
        {mode === 'templates' && (
          <div>
            {availableTemplates.map(t => (
              <div key={t.id}
                onClick={() => setSelectedTemplate(t.id)}
                style={{
                  padding: '12px 14px',
                  border: '1px solid',
                  borderColor: selectedTemplate === t.id ? 'var(--blue)' : 'var(--border)',
                  background: selectedTemplate === t.id ? 'rgba(20,40,204,0.03)' : 'var(--white)',
                  cursor: 'pointer',
                  marginBottom: 6,
                  transition: 'all 0.1s',
                }}>
                <div style={{
                  fontFamily: 'var(--font-body)',
                  fontSize: 13, fontWeight: 500,
                  color: 'var(--ink)',
                  marginBottom: 2,
                }}>{t.label}</div>
                <div style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  letterSpacing: '0.08em',
                  color: 'var(--gray)',
                }}>{t.desc}</div>
              </div>
            ))}
          </div>
        )}

        {/* Custom mode */}
        {mode === 'custom' && (
          <div>
            <div
              style={{
                border: '2px dashed var(--border)',
                padding: '24px',
                textAlign: 'center',
                cursor: 'pointer',
                marginBottom: 12,
              }}
              onClick={() => fileRef.current?.click()}
            >
              <input
                ref={fileRef}
                type="file"
                accept=".txt,.md,.doc,.docx,.pdf"
                style={{ display: 'none' }}
                onChange={async e => {
                  const f = e.target.files?.[0]
                  if (!f) return
                  setCustomFile(f)
                  const text = await f.text()
                  setCustomTemplateText(text)
                }}
              />
              <div style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: customFile ? 'var(--blue)' : 'var(--gray)',
              }}>
                {customFile ? customFile.name : 'Upload template file'}
              </div>
              <div style={{
                fontFamily: 'var(--font-body)',
                fontSize: 12, color: 'var(--gray)',
                marginTop: 4,
              }}>
                TXT, MD, DOC, PDF · Max 2MB
              </div>
            </div>

            {customFile && (
              <div style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                background: 'var(--offwhite)',
                border: '1px solid var(--border)',
                padding: '10px 12px',
                color: 'var(--gray)',
                maxHeight: 80,
                overflow: 'hidden',
                marginBottom: 12,
              }}>
                {customTemplateText.slice(0, 200)}
                {customTemplateText.length > 200 ? '...' : ''}
              </div>
            )}
          </div>
        )}

        {/* Generate button */}
        <button
          className="btn btn-primary"
          style={{ width: '100%', marginTop: 12 }}
          disabled={
            generating ||
            (mode === 'templates' && !selectedTemplate) ||
            (mode === 'custom' && !customFile)
          }
          onClick={handleGenerate}
        >
          {generating ? 'Generating with Strike AI...' : 'Generate document →'}
        </button>

        {error && (
          <div style={{
            marginTop: 12,
            fontFamily: 'var(--font-body)',
            fontSize: 13,
            color: '#DC2626',
          }}>{error}</div>
        )}
      </div>

      {/* Preview modal with PDF / .md export */}
      {doc && (
        <div
          onClick={e => { if (e.target === e.currentTarget) setDoc(null) }}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 200,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
          }}
        >
          <div style={{
            background: 'var(--white)', maxWidth: 800, width: '100%', maxHeight: '80vh',
            borderRadius: 16, overflow: 'hidden', display: 'flex', flexDirection: 'column',
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '14px 18px', borderBottom: '1px solid var(--border)', flexShrink: 0,
            }}>
              <span style={{
                flex: 1, fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {doc.filename}
              </span>
              <button type="button" className="btn btn-secondary btn-sm" onClick={downloadPdf}>
                Download PDF
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={downloadMd}>
                Download .md
              </button>
              <button
                type="button"
                onClick={() => setDoc(null)}
                aria-label="Close"
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: 22, lineHeight: 1, color: 'var(--gray)', padding: '0 4px',
                }}
              >
                ×
              </button>
            </div>
            <div
              id="strike-doc-print"
              style={{ overflowY: 'auto', padding: 32 }}
              dangerouslySetInnerHTML={{ __html: renderMarkdown(doc.content) }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
