'use client'
import React, { useState, useRef } from 'react'

interface DocGeneratorProps {
  entityType: 'transaction' | 'kyb' | 'program'
  entityData: Record<string, any>
  portal: 'bank' | 'anchor' | 'supplier'
}

const TEMPLATES = [
  {
    id: 'transaction_summary',
    label: 'Transaction Summary',
    desc: 'Full transaction audit summary',
    availableFor: ['bank', 'anchor', 'supplier'],
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
    id: 'kyb_summary',
    label: 'KYB Due Diligence Summary',
    desc: 'Counterparty due diligence report',
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

function getTemplatePrompt(templateId: string, data: Record<string, any>): string {
  const base = `You are a financial document specialist. Generate a professional, formal document based on the data provided. Use proper financial terminology. Format with clear sections and headers. Use markdown formatting.`

  const prompts: Record<string, string> = {
    transaction_summary: `${base}
Generate a complete transaction audit summary document including: parties involved, transaction terms, status timeline, financial summary, and compliance notes.`,

    bcbs_239: `${base}
Generate a BCBS 239 compliant risk data aggregation report. Include: risk data identification, aggregation capabilities assessment, risk reporting frequency, data accuracy attestation, and recommended actions. Format as a formal regulatory report.`,

    mas_610: `${base}
Generate a MAS Notice 610 credit facilities report. Include: credit facility details, obligor information, exposure classification, collateral details, and risk grading. Follow MAS reporting standards.`,

    eba_finrep: `${base}
Generate an EBA FinRep financial report entry. Include: counterparty details, exposure amount, impairment assessment, collateral coverage, and IFRS 9 stage classification.`,

    kyb_summary: `${base}
Generate a comprehensive KYB due diligence summary report. Include: entity verification, beneficial ownership analysis, risk assessment, document verification status, and compliance recommendation.`,

    invoice_confirmation: `${base}
Generate a formal invoice financing confirmation letter. Include: parties, invoice details, financing terms, disbursement confirmation, and repayment schedule.`,

    anchor_payment_notice: `${base}
Generate a formal payment notice to the anchor/buyer. Include: payment obligation, amount due, due date, payment instructions, and consequences of late payment.`,
  }

  return prompts[templateId] ?? base
}

export function DocGenerator({ entityType, entityData, portal }: DocGeneratorProps) {
  const [mode, setMode] = useState<'templates' | 'custom'>('templates')
  const [selectedTemplate, setSelectedTemplate] = useState<string>('')
  const [customFile, setCustomFile] = useState<File | null>(null)
  const [customTemplateText, setCustomTemplateText] = useState<string>('')
  const [generating, setGenerating] = useState(false)
  const [output, setOutput] = useState<string>('')
  const [error, setError] = useState<string>('')
  const fileRef = useRef<HTMLInputElement>(null)

  const availableTemplates = TEMPLATES.filter(t => t.availableFor.includes(portal))

  async function handleGenerate() {
    setGenerating(true)
    setOutput('')
    setError('')

    try {
      const systemPrompt = mode === 'templates'
        ? getTemplatePrompt(selectedTemplate, entityData)
        : `You are a document completion specialist. The user has provided a document template. Fill in the template with the provided data. Maintain the exact structure and format of the template. Replace any placeholder fields with real data from the context. If data is not available, write [NOT PROVIDED]. Template to fill:\n\n${customTemplateText}`

      const userMessage = mode === 'templates'
        ? `Generate the document using this data:\n\n${JSON.stringify(entityData, null, 2)}`
        : `Fill this template with the provided data:\n\n${JSON.stringify(entityData, null, 2)}`

      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          feature: 'document',
          system: systemPrompt,
          messages: [{ role: 'user', content: userMessage }],
          max_tokens: 4096,
        }),
      })

      if (res.status === 429) {
        setError('Daily AI limit reached. Resets at midnight UTC.')
        setGenerating(false)
        return
      }

      const data = await res.json()
      const text = data.content?.[0]?.text

      if (!text) throw new Error('No response')
      setOutput(text)
    } catch {
      setError('Failed to generate document. Please try again.')
    }
    setGenerating(false)
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
                setOutput('')
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
                  background: selectedTemplate === t.id ? 'rgba(0,82,255,0.03)' : 'var(--white)',
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
          {generating ? 'Generating...' : 'Generate document →'}
        </button>

        {/* Output */}
        {output && (
          <div style={{ marginTop: 16 }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 8,
            }}>
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: 'var(--gray)',
              }}>Generated document</span>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  const blob = new Blob([output], { type: 'text/plain' })
                  const url = URL.createObjectURL(blob)
                  const a = document.createElement('a')
                  a.href = url
                  a.download = `${selectedTemplate || 'document'}_${Date.now()}.md`
                  a.click()
                }}>
                ↓ Download
              </button>
            </div>
            <div style={{
              background: 'var(--offwhite)',
              border: '1px solid var(--border)',
              padding: '16px',
              fontFamily: 'var(--font-body)',
              fontSize: 13,
              lineHeight: 1.7,
              color: 'var(--ink)',
              maxHeight: 400,
              overflowY: 'auto',
              whiteSpace: 'pre-wrap',
            }}>
              {output}
            </div>
          </div>
        )}

        {error && (
          <div style={{
            marginTop: 12,
            fontFamily: 'var(--font-body)',
            fontSize: 13,
            color: '#DC2626',
          }}>{error}</div>
        )}
      </div>
    </div>
  )
}
