'use client'

import { useState, useEffect, useRef, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { User } from '@supabase/supabase-js'

// ─────────────────────────────────────────────────────────────
// Document kind mapping (reference id → API document_kind)
// ─────────────────────────────────────────────────────────────
const DOC_KIND_MAP: Record<string, string> = {
  inc:        'certificate_of_incorporation',
  ein_letter: 'ein_letter',
  ownership:  'ownership_structure',
  fin_2y:     'audited_financials',
  bank_stmt:  'bank_statements',
  insurance:  'insurance_certificate',
  license:    'banking_license',
  aml:        'aml_kyc_policy',
  bsa:        'bsa_officer_letter',
  fdic_exam:  'fdic_exam_report',
  fin_stmts:  'audited_financials',
}

type DocStatus = 'idle' | 'uploading' | 'uploaded' | 'error'
type DocState = Record<string, { document_id?: string; status: DocStatus }>
type Role = 'supplier' | 'anchor' | 'bank'

// ─────────────────────────────────────────────────────────────
// Shared helpers — verbatim from onboarding.jsx
// ─────────────────────────────────────────────────────────────

function OBIcon({ name, size = 16 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    check:    <path d="M4 8 L7 11 L12 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>,
    upload:   <><path d="M8 3 L8 11 M5 6 L8 3 L11 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none"/><path d="M3 13 L13 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none"/></>,
    doc:      <><rect x="4" y="2" width="8" height="12" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none"/><path d="M6 6 L10 6 M6 9 L9 9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></>,
    building: <><rect x="3" y="5" width="10" height="9" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none"/><path d="M6 14 L6 10 L10 10 L10 14" stroke="currentColor" strokeWidth="1.4" fill="none"/><path d="M3 5 L8 2 L13 5" stroke="currentColor" strokeWidth="1.4" fill="none"/></>,
    user:     <><circle cx="8" cy="5" r="3" stroke="currentColor" strokeWidth="1.5" fill="none"/><path d="M2 14 C2 11 4.5 9 8 9 C11.5 9 14 11 14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none"/></>,
    bank:     <><rect x="2" y="7" width="12" height="7" rx="1" stroke="currentColor" strokeWidth="1.4" fill="none"/><path d="M2 7 L8 3 L14 7" stroke="currentColor" strokeWidth="1.4" fill="none"/><path d="M5 10 L5 14 M8 10 L8 14 M11 10 L11 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></>,
    arrow:    <path d="M3 8 L13 8 M9 4 L13 8 L9 12" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" fill="none"/>,
    info:     <><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.4" fill="none"/><path d="M8 7 L8 11 M8 5.5 L8 5.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></>,
    x:        <path d="M5 5 L11 11 M11 5 L5 11" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/>,
    eye:      <><path d="M2 8 C4 4 12 4 14 8 C12 12 4 12 2 8" stroke="currentColor" strokeWidth="1.4" fill="none"/><circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.4" fill="none"/></>,
    eyeOff:   <><path d="M2 8 C4 4 12 4 14 8" stroke="currentColor" strokeWidth="1.4" fill="none"/><path d="M3 13 L13 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></>,
  }
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
      {paths[name] ?? null}
    </svg>
  )
}

function OBStepper({ steps, current }: { steps: { label: string; sub?: string }[]; current: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '0 0 8px' }}>
      {steps.map((step, i) => {
        const done = i < current
        const active = i === current
        return (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '10px 20px',
            borderLeft: `2px solid ${active ? 'var(--color-blue, #2563eb)' : 'transparent'}`,
            background: active ? 'rgba(37,99,235,0.05)' : 'transparent',
            borderRadius: '0 6px 6px 0',
            cursor: 'default',
          }}>
            <div style={{
              width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 10, fontWeight: 600,
              background: done ? 'var(--color-green, #16a34a)' : active ? 'var(--color-blue, #2563eb)' : 'var(--color-bg-2, #f1f5f9)',
              color: done || active ? 'white' : 'var(--color-ink-3, #94a3b8)',
              border: done || active ? 'none' : '1.5px solid var(--color-border, #e2e8f0)',
            }}>
              {done ? <OBIcon name="check" size={12} /> : i + 1}
            </div>
            <div>
              <div style={{
                fontSize: 12.5, fontWeight: active ? 600 : 400,
                color: active ? 'var(--color-ink-1, #0f172a)' : done ? 'var(--color-ink-2, #475569)' : 'var(--color-ink-3, #94a3b8)',
              }}>{step.label}</div>
              {step.sub && (
                <div style={{ fontSize: 11, color: 'var(--color-ink-4, #cbd5e1)', marginTop: 1 }}>{step.sub}</div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function OBShell({ steps, current, children, role }: {
  steps: { label: string; sub?: string }[]
  current: number
  children: React.ReactNode
  role: Role | null
}) {
  const roleLabels: Record<string, string> = { supplier: 'Supplier', anchor: 'Anchor / Buyer', bank: 'Bank / Lender' }
  return (
    <div style={{
      position: 'fixed', inset: 0,
      display: 'grid', gridTemplateColumns: '280px 1fr',
      background: 'var(--color-bg, #f8fafc)',
      fontFamily: 'var(--font-sans, system-ui, sans-serif)',
    }}>
      <div style={{
        background: 'var(--color-card, white)',
        borderRight: '1px solid var(--color-border, #e2e8f0)',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>
        <div style={{
          padding: '22px 20px 18px',
          borderBottom: '1px solid var(--color-border, #e2e8f0)',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <div style={{
            width: 30, height: 30, borderRadius: 8,
            background: 'var(--color-ink-1, #0f172a)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'white', fontWeight: 800, fontSize: 14, letterSpacing: '-0.02em',
          }}>S</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--color-ink-1)' }}>Strike SCF</div>
            {role && (
              <div style={{
                fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em',
                color: 'var(--color-ink-4)', fontWeight: 500,
              }}>{roleLabels[role] ?? ''}</div>
            )}
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', paddingTop: 16 }}>
          {steps && <OBStepper steps={steps} current={current} />}
        </div>
        <div style={{
          padding: '14px 20px',
          borderTop: '1px solid var(--color-border, #e2e8f0)',
          fontSize: 11, color: 'var(--color-ink-4)',
          display: 'flex', alignItems: 'flex-start', gap: 8,
        }}>
          <OBIcon name="info" size={13} />
          <span>Your data is encrypted and never shared without consent.</span>
        </div>
      </div>
      <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '48px 40px' }}>
        <div style={{ width: '100%', maxWidth: 600 }}>
          {children}
        </div>
      </div>
    </div>
  )
}

function OBField({ label, hint, optional, error, children }: {
  label: string; hint?: string; optional?: boolean; error?: string; children: React.ReactNode
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-ink-1)' }}>{label}</label>
        {optional && <span style={{ fontSize: 11, color: 'var(--color-ink-4)', fontWeight: 400 }}>Optional</span>}
      </div>
      {children}
      {hint && !error && <div style={{ fontSize: 11.5, color: 'var(--color-ink-3)' }}>{hint}</div>}
      {error && <div style={{ fontSize: 11.5, color: 'var(--color-red, #dc2626)' }}>{error}</div>}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  height: 38, padding: '0 12px', borderRadius: 6,
  border: '1.5px solid var(--color-border, #e2e8f0)',
  background: 'var(--color-card, white)',
  fontSize: 13.5, color: 'var(--color-ink-1)',
  outline: 'none', width: '100%', boxSizing: 'border-box',
  transition: 'border-color 0.15s',
}

const selectStyle: React.CSSProperties = { ...inputStyle, cursor: 'pointer' }

function OBInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input style={inputStyle} {...props} />
}
function OBSelect({ children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select style={selectStyle} {...props}>{children}</select>
}

function DocTile({ name, required, status, onUpload }: {
  name: string; required: boolean; status: DocStatus; onUpload: () => void
}) {
  const uploaded = status === 'uploaded'
  const uploading = status === 'uploading'
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '12px 14px', borderRadius: 8,
      border: `1.5px solid ${uploaded ? 'var(--color-green, #16a34a)' : 'var(--color-border)'}`,
      background: uploaded ? 'rgba(22,163,74,0.04)' : 'var(--color-card)',
    }}>
      <div style={{
        width: 32, height: 32, borderRadius: 6, flexShrink: 0,
        background: uploaded ? 'rgba(22,163,74,0.1)' : 'var(--color-bg-2)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: uploaded ? 'var(--color-green)' : 'var(--color-ink-3)',
      }}>
        <OBIcon name={uploaded ? 'check' : 'doc'} size={16} />
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-ink-1)' }}>
          {name}
          {!required && <span style={{ marginLeft: 6, fontSize: 10.5, color: 'var(--color-ink-4)', fontWeight: 400 }}>Optional</span>}
        </div>
        <div style={{ fontSize: 11, color: uploaded ? 'var(--color-green)' : 'var(--color-ink-4)', marginTop: 2 }}>
          {uploaded ? 'Uploaded ✓' : 'PDF · max 20MB'}
        </div>
      </div>
      <button
        type="button"
        onClick={onUpload}
        disabled={uploading}
        style={{
          height: 30, padding: '0 12px', borderRadius: 5, fontSize: 12, fontWeight: 500,
          border: `1px solid ${uploaded ? 'var(--color-border)' : 'var(--color-blue, #2563eb)'}`,
          color: uploaded ? 'var(--color-ink-3)' : 'var(--color-blue)',
          background: 'transparent', cursor: uploading ? 'default' : 'pointer',
          opacity: uploading ? 0.6 : 1,
        }}
      >{uploaded ? 'Replace' : uploading ? 'Uploading…' : status === 'error' ? 'Retry' : 'Upload'}</button>
    </div>
  )
}

function OBActions({ onBack, onNext, nextLabel = 'Continue', loading }: {
  onBack?: () => void; onNext: () => void; nextLabel?: string; loading?: boolean
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 32 }}>
      <button
        type="button"
        onClick={onNext}
        disabled={loading}
        style={{
          height: 40, padding: '0 24px', borderRadius: 7, fontSize: 14, fontWeight: 600,
          background: 'var(--color-ink-1, #0f172a)', color: 'white',
          border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
          opacity: loading ? 0.7 : 1,
        }}
      >
        {loading ? 'Saving…' : nextLabel}
        {!loading && <OBIcon name="arrow" size={14} />}
      </button>
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          style={{
            height: 40, padding: '0 18px', borderRadius: 7, fontSize: 13.5,
            background: 'transparent', color: 'var(--color-ink-3)',
            border: '1.5px solid var(--color-border)', cursor: 'pointer',
          }}
        >← Back</button>
      )}
    </div>
  )
}

function SectionHead({ title, sub }: { title: string; sub?: string }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.03em', color: 'var(--color-ink-1)', margin: 0 }}>{title}</h1>
      {sub && <p style={{ fontSize: 13.5, color: 'var(--color-ink-3)', marginTop: 6, lineHeight: 1.6 }}>{sub}</p>}
    </div>
  )
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: 'var(--color-card, white)',
      border: '1.5px solid var(--color-border, #e2e8f0)',
      borderRadius: 10, padding: 24,
      ...style,
    }}>{children}</div>
  )
}

// ─────────────────────────────────────────────────────────────
// Step configs (Welcome removed — role comes from session)
// ─────────────────────────────────────────────────────────────

const SUPPLIER_STEPS = [
  { label: 'Account',      sub: 'Confirm your details' },
  { label: 'Company info', sub: 'Legal details & EIN' },
  { label: 'Documents',    sub: 'Incorporation & financials' },
  { label: 'Review',       sub: 'Submit KYB application' },
]

const ANCHOR_STEPS = [
  { label: 'Account',      sub: 'Confirm your details' },
  { label: 'Company info', sub: 'Legal details & EIN' },
  { label: 'Documents',    sub: 'Incorporation & financials' },
  { label: 'Review',       sub: 'Submit KYB application' },
]

const BANK_STEPS = [
  { label: 'Account',          sub: 'Confirm your details' },
  { label: 'Institution info', sub: 'Legal name & routing' },
  { label: 'Regulatory docs',  sub: 'License & compliance' },
  { label: 'Review',           sub: 'Submit for activation' },
]

// ─────────────────────────────────────────────────────────────
// Step 0 — Account Confirmation (read-only, from session)
// ─────────────────────────────────────────────────────────────
function StepAccountConfirmation({ fullName, email, onNext }: {
  fullName: string; email: string; onNext: () => void
}) {
  return (
    <div>
      <SectionHead
        title="Confirm your account"
        sub="Your name and email were set during signup. They'll appear on your KYB application."
      />
      <Card>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <OBField label="Full name">
            <OBInput
              value={fullName}
              readOnly
              onChange={() => undefined}
              style={{ ...inputStyle, background: 'var(--color-bg-2)', color: 'var(--color-ink-2)', cursor: 'default' }}
            />
          </OBField>
          <OBField label="Email">
            <OBInput
              type="email"
              value={email}
              readOnly
              onChange={() => undefined}
              style={{ ...inputStyle, background: 'var(--color-bg-2)', color: 'var(--color-ink-2)', cursor: 'default' }}
            />
          </OBField>
        </div>
      </Card>
      <OBActions onNext={onNext} nextLabel="Continue" />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Step 1 — Company Info (Supplier / Anchor)
// ─────────────────────────────────────────────────────────────
function StepCompanyInfo({ data, setData, onBack, onNext, role, loading, error }: {
  data: Record<string, string>; setData: (d: Record<string, string>) => void
  onBack: () => void; onNext: () => void; role: Role; loading?: boolean; error?: string | null
}) {
  const isAnchor = role === 'anchor'
  return (
    <div>
      <SectionHead
        title={isAnchor ? 'About your company' : 'About your business'}
        sub="Used to create your KYB application. We cross-check with public records."
      />
      <Card>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <OBField label="Legal business name" hint="As it appears on your incorporation documents.">
            <OBInput placeholder="Acme Corp LLC" value={data.legalName ?? ''} onChange={e => setData({ ...data, legalName: e.target.value })} />
          </OBField>

          <OBField label="DBA / Trade name" optional>
            <OBInput placeholder="Acme" value={data.dba ?? ''} onChange={e => setData({ ...data, dba: e.target.value })} />
          </OBField>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <OBField label="Entity type">
              <OBSelect value={data.entityType ?? ''} onChange={e => setData({ ...data, entityType: e.target.value })}>
                <option value="">Select…</option>
                <option value="llc">LLC</option>
                <option value="corporation">Corporation</option>
                <option value="partnership">Partnership</option>
                <option value="sole_proprietor">Sole Proprietor</option>
              </OBSelect>
            </OBField>
            <OBField label="State of incorporation">
              <OBInput placeholder="DE" value={data.stateOfInc ?? ''} onChange={e => setData({ ...data, stateOfInc: e.target.value })} />
            </OBField>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <OBField label="EIN (Federal Tax ID)" hint="9-digit number (XX-XXXXXXX)">
              <OBInput placeholder="12-3456789" value={data.ein ?? ''} onChange={e => setData({ ...data, ein: e.target.value })} />
            </OBField>
            <OBField label="DUNS number" optional>
              <OBInput placeholder="XX-XXX-XXXX" value={data.duns ?? ''} onChange={e => setData({ ...data, duns: e.target.value })} />
            </OBField>
          </div>

          <OBField label="Registered address">
            <OBInput placeholder="123 Main St, Suite 400" value={data.addressLine1 ?? ''} onChange={e => setData({ ...data, addressLine1: e.target.value })} />
          </OBField>

          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12 }}>
            <OBField label="City">
              <OBInput placeholder="Portland" value={data.city ?? ''} onChange={e => setData({ ...data, city: e.target.value })} />
            </OBField>
            <OBField label="State">
              <OBInput placeholder="OR" value={data.state ?? ''} onChange={e => setData({ ...data, state: e.target.value })} />
            </OBField>
            <OBField label="ZIP">
              <OBInput placeholder="97201" value={data.zip ?? ''} onChange={e => setData({ ...data, zip: e.target.value })} />
            </OBField>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <OBField label="Industry (NAICS code)" optional>
              <OBInput placeholder="332618" value={data.naics ?? ''} onChange={e => setData({ ...data, naics: e.target.value })} />
            </OBField>
            <OBField label="Approx. annual revenue (USD)" optional>
              <OBInput placeholder="5,000,000" value={data.annualRevenue ?? ''} onChange={e => setData({ ...data, annualRevenue: e.target.value })} />
            </OBField>
          </div>

          <OBField label="Primary contact phone" optional>
            <OBInput type="tel" placeholder="+1 (503) 555-0100" value={data.phone ?? ''} onChange={e => setData({ ...data, phone: e.target.value })} />
          </OBField>
        </div>
      </Card>
      {error && <p style={{ fontSize: 12.5, color: 'var(--color-red, #dc2626)', marginTop: 14 }}>{error}</p>}
      <OBActions onBack={onBack} onNext={onNext} loading={loading} />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Step 2 — Documents (Supplier / Anchor)
// ─────────────────────────────────────────────────────────────
function StepDocuments({ docs, onUpload, onBack, onNext, role }: {
  docs: DocState; onUpload: (id: string) => void
  onBack: () => void; onNext: () => void; role: Role
}) {
  const isAnchor = role === 'anchor'

  const requiredDocs = isAnchor
    ? [
        { id: 'inc',       name: 'Certificate of Incorporation / Articles',    required: true },
        { id: 'ein_letter',name: 'IRS EIN Confirmation Letter',                 required: true },
        { id: 'ownership', name: 'Ownership structure / Cap table',             required: true },
        { id: 'fin_2y',    name: 'Audited or reviewed financials (last 2 yrs)', required: true },
        { id: 'bank_stmt', name: 'Bank statements (last 6 months)',             required: true },
      ]
    : [
        { id: 'inc',       name: 'Certificate of Incorporation / Articles',    required: true },
        { id: 'ein_letter',name: 'IRS EIN Confirmation Letter',                 required: true },
        { id: 'ownership', name: 'Ownership structure (25%+ owners)',           required: true },
        { id: 'fin_2y',    name: 'Audited or reviewed financials (last 2 yrs)', required: true },
        { id: 'bank_stmt', name: 'Bank statements (last 6 months)',             required: true },
        { id: 'insurance', name: 'Certificate of Insurance',                   required: false },
      ]

  const uploadedRequired = requiredDocs.filter(d => d.required && docs[d.id]?.status === 'uploaded').length
  const totalRequired = requiredDocs.filter(d => d.required).length

  return (
    <div>
      <SectionHead
        title="Upload your documents"
        sub="You can come back to upload anything missing — we'll save your progress."
      />

      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
        borderRadius: 8, marginBottom: 20,
        background: 'rgba(37,99,235,0.05)',
        border: '1.5px solid rgba(37,99,235,0.15)',
        fontSize: 12.5, color: 'var(--color-ink-2)',
      }}>
        <OBIcon name="info" size={14} />
        <span>{uploadedRequired} of {totalRequired} required documents uploaded</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {requiredDocs.map(d => (
          <DocTile
            key={d.id}
            name={d.name}
            required={d.required}
            status={docs[d.id]?.status ?? 'idle'}
            onUpload={() => onUpload(d.id)}
          />
        ))}
      </div>

      <OBActions onBack={onBack} onNext={onNext} />
    </div>
  )
}


// ─────────────────────────────────────────────────────────────
// Step 1 — Institution Info (Bank)
// ─────────────────────────────────────────────────────────────
function StepInstitutionInfo({ data, setData, onBack, onNext, loading, error }: {
  data: Record<string, string>; setData: (d: Record<string, string>) => void
  onBack: () => void; onNext: () => void; loading?: boolean; error?: string | null
}) {
  return (
    <div>
      <SectionHead
        title="Institution profile"
        sub="We'll cross-check with FFIEC public data. Confirm or correct anything that's off."
      />
      <Card>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <OBField label="Legal institution name">
              <OBInput placeholder="Atlas Bank, N.A." value={data.legalName ?? ''} onChange={e => setData({ ...data, legalName: e.target.value })} />
            </OBField>
            <OBField label="Display name">
              <OBInput placeholder="Atlas Bank" value={data.displayName ?? ''} onChange={e => setData({ ...data, displayName: e.target.value })} />
            </OBField>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <OBField label="Institution type">
              <OBSelect value={data.institutionType ?? ''} onChange={e => setData({ ...data, institutionType: e.target.value })}>
                <option value="">Select…</option>
                <option value="commercial_bank">Commercial Bank</option>
                <option value="fund">Fund</option>
                <option value="fintech_lender">Fintech Lender</option>
              </OBSelect>
            </OBField>
            <OBField label="Primary regulator">
              <OBInput placeholder="OCC / Federal Reserve / FDIC" value={data.regulator ?? ''} onChange={e => setData({ ...data, regulator: e.target.value })} />
            </OBField>
          </div>

          <OBField label="ABA Routing number" hint="Used to verify your institution identity.">
            <OBInput placeholder="021000021" value={data.routingNumber ?? ''} onChange={e => setData({ ...data, routingNumber: e.target.value })} />
          </OBField>

          <OBField label="FDIC certificate number" optional>
            <OBInput placeholder="33486" value={data.fdicCert ?? ''} onChange={e => setData({ ...data, fdicCert: e.target.value })} />
          </OBField>

          <OBField label="Primary contact name">
            <OBInput placeholder="Sarah Chen" value={data.primaryContact ?? ''} onChange={e => setData({ ...data, primaryContact: e.target.value })} />
          </OBField>

          <OBField label="Website" optional>
            <OBInput placeholder="https://atlasbank.com" value={data.website ?? ''} onChange={e => setData({ ...data, website: e.target.value })} />
          </OBField>

          <OBField label="Institution logo" optional>
            <div style={{
              border: '1.5px dashed var(--color-border)',
              borderRadius: 8, padding: '20px 16px',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
              background: 'var(--color-bg-2)', cursor: 'pointer',
            }}>
              <OBIcon name="upload" size={20} />
              <div style={{ fontSize: 12.5, color: 'var(--color-ink-3)' }}>PNG or JPG · Max 2MB</div>
            </div>
          </OBField>
        </div>
      </Card>
      {error && <p style={{ fontSize: 12.5, color: 'var(--color-red, #dc2626)', marginTop: 14 }}>{error}</p>}
      <OBActions onBack={onBack} onNext={onNext} loading={loading} />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Step 2 — Regulatory Docs (Bank)
// ─────────────────────────────────────────────────────────────
function StepRegulatoryDocs({ docs, onUpload, onBack, onNext }: {
  docs: DocState; onUpload: (id: string) => void; onBack: () => void; onNext: () => void
}) {
  const bankDocs = [
    { id: 'license',   name: 'Banking license / Charter',             required: true },
    { id: 'aml',       name: 'AML / KYC policy',                      required: true },
    { id: 'bsa',       name: 'BSA Officer designation letter',         required: true },
    { id: 'fdic_exam', name: 'Most recent FDIC / regulator exam',      required: false },
    { id: 'fin_stmts', name: 'Audited financial statements (last FY)', required: false },
  ]

  return (
    <div>
      <SectionHead
        title="Regulatory documents"
        sub="Upload your banking license and compliance policies. We'll verify with your regulator."
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {bankDocs.map(d => (
          <DocTile
            key={d.id}
            name={d.name}
            required={d.required}
            status={docs[d.id]?.status ?? 'idle'}
            onUpload={() => onUpload(d.id)}
          />
        ))}
      </div>
      <OBActions onBack={onBack} onNext={onNext} />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Final Review step
// ─────────────────────────────────────────────────────────────
function StepReview({ formData, docs, role, onBack, onSubmit, loading, error }: {
  formData: { account: { firstName?: string; lastName?: string; email?: string }; company: Record<string, string> }
  docs: DocState; role: Role; onBack: () => void; onSubmit: () => void; loading?: boolean; error?: string | null
}) {
  const roleLabel = { supplier: 'Supplier', anchor: 'Anchor / Buyer', bank: 'Bank / Lender' }[role]
  const docCount = Object.values(docs).filter(v => v?.status === 'uploaded').length

  return (
    <div>
      <SectionHead
        title="Review your application"
        sub="Check that everything looks right before submitting. You'll hear from us within 1–3 business days."
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-ink-4)', fontWeight: 600 }}>Account</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
              <span style={{ color: 'var(--color-ink-3)' }}>Name</span>
              <span style={{ color: 'var(--color-ink-1)', fontWeight: 500 }}>{[formData.account.firstName, formData.account.lastName].filter(Boolean).join(' ') || '—'}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
              <span style={{ color: 'var(--color-ink-3)' }}>Email</span>
              <span style={{ color: 'var(--color-ink-1)' }}>{formData.account.email || '—'}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
              <span style={{ color: 'var(--color-ink-3)' }}>Role</span>
              <span style={{ color: 'var(--color-ink-1)' }}>{roleLabel}</span>
            </div>
          </div>
        </Card>

        <Card>
          <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-ink-4)', fontWeight: 600, marginBottom: 14 }}>
            {role === 'bank' ? 'Institution' : 'Company'}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {([
              ['Legal name', formData.company.legalName],
              ['EIN / Routing', formData.company.ein ?? formData.company.routingNumber],
              ['Address', [formData.company.city, formData.company.state].filter(Boolean).join(', ')],
            ] as [string, string | undefined][]).map(([k, v]) => v ? (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span style={{ color: 'var(--color-ink-3)' }}>{k}</span>
                <span style={{ color: 'var(--color-ink-1)' }}>{v}</span>
              </div>
            ) : null)}
          </div>
        </Card>

        <Card>
          <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-ink-4)', fontWeight: 600, marginBottom: 14 }}>Documents</div>
          <div style={{ fontSize: 13, color: 'var(--color-ink-2)' }}>
            {docCount} document{docCount !== 1 ? 's' : ''} uploaded
            <span style={{ color: 'var(--color-ink-4)', marginLeft: 8, fontSize: 12 }}>You can upload more after submitting.</span>
          </div>
        </Card>

        <div style={{
          padding: '14px 16px', borderRadius: 8, fontSize: 12, color: 'var(--color-ink-3)', lineHeight: 1.7,
          background: 'var(--color-bg-2)', border: '1.5px solid var(--color-border)',
        }}>
          By submitting, you confirm that all information provided is accurate and authorize Strike SCF to verify your identity and company details with third-party data providers.
        </div>
      </div>

      {error && <p style={{ fontSize: 12.5, color: 'var(--color-red, #dc2626)', marginTop: 14 }}>{error}</p>}
      <OBActions onBack={onBack} onNext={onSubmit} nextLabel="Submit application →" loading={loading} />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Success screen
// ─────────────────────────────────────────────────────────────
function ScreenOBSuccess({ role, fromInvite }: { role: Role; fromInvite?: boolean }) {
  const standardLabels: Record<Role, string> = {
    supplier: 'Your KYB application has been submitted.',
    anchor:   'Your KYB application has been submitted.',
    bank:     'Your institution profile has been submitted for review.',
  }
  return (
    <div style={{
      position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      background: 'var(--color-card, white)', fontFamily: 'var(--font-sans)',
    }}>
      <div style={{ textAlign: 'center', maxWidth: 440, padding: '0 24px' }}>
        <div style={{
          width: 64, height: 64, borderRadius: '50%',
          background: 'rgba(22,163,74,0.1)', display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 20px',
        }}>
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
            <path d="M7 14 L12 19 L21 10" stroke="var(--color-green, #16a34a)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.04em', margin: '0 0 10px', color: 'var(--color-ink-1)' }}>
          Application submitted!
        </h1>
        <p style={{ fontSize: 14, color: 'var(--color-ink-3)', lineHeight: 1.7, margin: '0 0 24px' }}>
          {fromInvite
            ? <>We&apos;ve notified your administrator that you&apos;ve completed onboarding. Once approved, you&apos;ll have full access to the platform.</>
            : <>{standardLabels[role]} Our team reviews applications within <strong>1–3 business days</strong>. We&apos;ll email you with next steps.</>
          }
        </p>
        <div style={{
          padding: '16px 20px', borderRadius: 10,
          background: 'var(--color-bg-2, #f8fafc)',
          border: '1.5px solid var(--color-border)',
          fontSize: 13, color: 'var(--color-ink-2)', textAlign: 'left', lineHeight: 1.8,
        }}>
          <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-ink-4)' }}>What happens next</div>
          <div>① Strike reviews your KYB application</div>
          <div>② We may reach out for any missing documents</div>
          <div>③ Once approved, you&apos;ll receive platform access</div>
          <div>④ Set up programs and invite users inside the platform</div>
        </div>
        <a
          href="/dashboard"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            marginTop: 24, height: 42, padding: '0 24px', borderRadius: 8,
            background: 'var(--color-ink-1)', color: 'white',
            textDecoration: 'none', fontSize: 14, fontWeight: 600,
          }}
        >Go to dashboard <OBIcon name="arrow" size={14} /></a>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────
function OnboardingPageContent() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const fromInvite   = searchParams.get('from') === 'invite'
  const [initialized, setInitialized] = useState(false)
  const [user, setUser] = useState<User | null>(null)
  const [step, setStep] = useState(0)
  const [role, setRole] = useState<Role>('supplier')
  const [orgId, setOrgId] = useState<string | null>(null)
  const [bankId, setBankId] = useState<string | null>(null)
  const [companyData, setCompanyData] = useState<Record<string, string>>({})
  const [docs, setDocs] = useState<DocState>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const pendingUpload = useRef<{ docId: string; docKind: string } | null>(null)

  useEffect(() => {
    async function init() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }
      setUser(user)

      const metaRole = user.user_metadata?.role as string
      const inviteRoleMap: Record<string, Role> = {
        anchor:              'anchor',
        supplier:            'supplier',
        bank_credit_officer: 'bank',
      }
      const standardRoleMap: Record<string, Role> = {
        supplier_admin: 'supplier',
        anchor_admin:   'anchor',
        bank_admin:     'bank',
      }
      const mappedRole: Role = fromInvite
        ? (inviteRoleMap[metaRole] ?? 'supplier')
        : (standardRoleMap[metaRole] ?? 'supplier')
      setRole(mappedRole)

      // bank_credit_officer has no KYB — skip status check
      const isInvitedCO = fromInvite && metaRole === 'bank_credit_officer'
      if (!isInvitedCO) {
        try {
          const res = await fetch('/api/onboarding/status')
          if (res.ok) {
            const status = await res.json()
            if (status.kyb_status === 'submitted' || status.bank_status === 'active') {
              setSubmitted(true)
            } else if (status.org_id) {
              setOrgId(status.org_id)
              setStep(2)
            } else if (status.bank_id) {
              setBankId(status.bank_id)
              setStep(2)
            }
          }
        } catch { /* ignore — start fresh */ }
      }

      setInitialized(true)
    }
    init()
  }, [router, fromInvite])

  async function handleCompanyInfoNext() {
    if (role === 'bank') {
      if (!companyData.legalName) {
        setError('Legal institution name is required.')
        return
      }
      setError(null)
      setLoading(true)
      try {
        const res = await fetch('/api/onboarding/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            legal_name: companyData.legalName,
            display_business_as: companyData.displayName || undefined,
            institution_type: companyData.institutionType || undefined,
            routing_number: companyData.routingNumber || undefined,
          }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error)
        setBankId(data.bank_id)
        setStep(s => s + 1)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to save institution info.')
      } finally {
        setLoading(false)
      }
      return
    }

    if (!companyData.legalName || !companyData.ein) {
      setError('Legal business name and EIN are required.')
      return
    }
    setError(null)
    setLoading(true)
    const inviteBankId = fromInvite
      ? (user?.user_metadata?.bank_id as string | undefined)
      : process.env.NEXT_PUBLIC_DEV_BANK_ID
    try {
      const res = await fetch('/api/onboarding/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bank_id: inviteBankId,
          type: role,
          legal_name: companyData.legalName,
          ein: companyData.ein,
          doing_business_as: companyData.dba || undefined,
          business_type: (companyData.entityType as 'corporation' | 'llc' | 'partnership' | 'sole_proprietor') || undefined,
          state_of_incorporation: companyData.stateOfInc || undefined,
          address_line1: companyData.addressLine1 || undefined,
          city: companyData.city || undefined,
          state: companyData.state || undefined,
          zip: companyData.zip || undefined,
          ...(fromInvite && role === 'supplier' && user?.user_metadata?.anchor_org_id
            ? { anchor_org_id: user.user_metadata.anchor_org_id as string }
            : {}),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setOrgId(data.org_id)
      setStep(s => s + 1)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save company info.')
    } finally {
      setLoading(false)
    }
  }

  function triggerUpload(docId: string) {
    const docKind = DOC_KIND_MAP[docId]
    if (!docKind) return
    pendingUpload.current = { docId, docKind }
    fileInputRef.current?.click()
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !pendingUpload.current || !orgId) return
    const { docId, docKind } = pendingUpload.current
    setDocs(prev => ({ ...prev, [docId]: { status: 'uploading' } }))
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('org_id', orgId)
      fd.append('document_kind', docKind)
      const res = await fetch('/api/onboarding/documents', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setDocs(prev => ({ ...prev, [docId]: { document_id: data.document_id, status: 'uploaded' } }))
    } catch {
      setDocs(prev => ({ ...prev, [docId]: { status: 'error' } }))
    }
    e.target.value = ''
  }

  async function handleSubmit() {
    setError(null)
    if (role === 'bank') {
      if (!bankId) { setError('Institution not set. Please complete institution info first.'); return }
      setLoading(true)
      try {
        const res = await fetch('/api/onboarding/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bank_id: bankId }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error)
        setSubmitted(true)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Submission failed.')
      } finally {
        setLoading(false)
      }
      return
    }
    if (!orgId) { setError('Organization not found. Please complete company info first.'); return }
    setLoading(true)
    try {
      const res = await fetch('/api/onboarding/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ org_id: orgId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setSubmitted(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Submission failed.')
    } finally {
      setLoading(false)
    }
  }

  const isCreditOfficer = fromInvite && user?.user_metadata?.role === 'bank_credit_officer'
  const BCO_STEPS = [{ label: 'Account', sub: 'Confirm your details' }]
  const steps = isCreditOfficer ? BCO_STEPS
    : role === 'supplier' ? SUPPLIER_STEPS
    : role === 'anchor'   ? ANCHOR_STEPS
    : BANK_STEPS
  const next = () => {
    setError(null)
    if (isCreditOfficer) { router.push('/dashboard'); return }
    setStep(s => s + 1)
  }
  const back = () => { setError(null); setStep(s => s - 1) }

  const fullName = (user?.user_metadata?.full_name as string) ?? ''
  const nameParts = fullName.split(' ')
  const accountInfo = {
    firstName: nameParts[0] ?? '',
    lastName: nameParts.slice(1).join(' '),
    email: user?.email ?? '',
  }

  const content = (() => {
    if (!initialized) {
      return (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-bg)' }}>
          <div style={{ color: 'var(--color-ink-3)', fontSize: 13 }}>Loading…</div>
        </div>
      )
    }
    if (submitted) return <ScreenOBSuccess role={role} fromInvite={fromInvite} />

    if (step === 0) return (
      <OBShell steps={steps} current={0} role={role}>
        <StepAccountConfirmation fullName={fullName} email={user?.email ?? ''} onNext={next} />
      </OBShell>
    )

    // Supplier flow
    if (role === 'supplier') {
      if (step === 1) return (
        <OBShell steps={steps} current={1} role={role}>
          <StepCompanyInfo data={companyData} setData={setCompanyData} onBack={back} onNext={handleCompanyInfoNext} role={role} loading={loading} error={error} />
        </OBShell>
      )
      if (step === 2) return (
        <OBShell steps={steps} current={2} role={role}>
          <StepDocuments docs={docs} onUpload={triggerUpload} onBack={back} onNext={next} role={role} />
        </OBShell>
      )
      if (step === 3) return (
        <OBShell steps={steps} current={3} role={role}>
          <StepReview formData={{ account: accountInfo, company: companyData }} docs={docs} role={role} onBack={back} onSubmit={handleSubmit} loading={loading} error={error} />
        </OBShell>
      )
    }

    // Anchor flow
    if (role === 'anchor') {
      if (step === 1) return (
        <OBShell steps={steps} current={1} role={role}>
          <StepCompanyInfo data={companyData} setData={setCompanyData} onBack={back} onNext={handleCompanyInfoNext} role={role} loading={loading} error={error} />
        </OBShell>
      )
      if (step === 2) return (
        <OBShell steps={steps} current={2} role={role}>
          <StepDocuments docs={docs} onUpload={triggerUpload} onBack={back} onNext={next} role={role} />
        </OBShell>
      )
      if (step === 3) return (
        <OBShell steps={steps} current={3} role={role}>
          <StepReview formData={{ account: accountInfo, company: companyData }} docs={docs} role={role} onBack={back} onSubmit={handleSubmit} loading={loading} error={error} />
        </OBShell>
      )
    }

    // Bank flow
    if (role === 'bank') {
      if (step === 1) return (
        <OBShell steps={steps} current={1} role={role}>
          <StepInstitutionInfo data={companyData} setData={setCompanyData} onBack={back} onNext={handleCompanyInfoNext} loading={loading} error={error} />
        </OBShell>
      )
      if (step === 2) return (
        <OBShell steps={steps} current={2} role={role}>
          <StepRegulatoryDocs docs={docs} onUpload={triggerUpload} onBack={back} onNext={next} />
        </OBShell>
      )
      if (step === 3) return (
        <OBShell steps={steps} current={3} role={role}>
          <StepReview formData={{ account: accountInfo, company: companyData }} docs={docs} role={role} onBack={back} onSubmit={handleSubmit} loading={loading} error={error} />
        </OBShell>
      )
    }

    return null
  })()

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,image/*"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
      {content}
    </>
  )
}

export default function OnboardingPage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-bg)' }}>
        <div style={{ color: 'var(--color-ink-3)', fontSize: 13 }}>Loading…</div>
      </div>
    }>
      <OnboardingPageContent />
    </Suspense>
  )
}
