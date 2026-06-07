'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Organization } from '@strike-scf/types'
import { useWizard, TOTAL_STEPS } from '../wizard-context'

// ─────────────────────────────────────────────────────────────
// Reference data (hardcoded — there is no lib/naics or lib/countries)
// ─────────────────────────────────────────────────────────────
const NAICS_OPTIONS: { code: string; label: string }[] = [
  { code: '11', label: 'Agriculture, Forestry, Fishing & Hunting' },
  { code: '21', label: 'Mining, Quarrying, Oil & Gas Extraction' },
  { code: '22', label: 'Utilities' },
  { code: '23', label: 'Construction' },
  { code: '31', label: 'Manufacturing — Food, Textiles & Apparel' },
  { code: '33', label: 'Manufacturing — Machinery, Electronics & Equipment' },
  { code: '42', label: 'Wholesale Trade' },
  { code: '44', label: 'Retail Trade' },
  { code: '48', label: 'Transportation & Warehousing' },
  { code: '51', label: 'Information & Media' },
  { code: '52', label: 'Finance & Insurance' },
  { code: '53', label: 'Real Estate & Rental' },
  { code: '54', label: 'Professional, Scientific & Technical Services' },
  { code: '56', label: 'Administrative & Support Services' },
  { code: '61', label: 'Educational Services' },
  { code: '62', label: 'Health Care & Social Assistance' },
  { code: '71', label: 'Arts, Entertainment & Recreation' },
  { code: '72', label: 'Accommodation & Food Services' },
  { code: '81', label: 'Other Services' },
  { code: '92', label: 'Public Administration' },
]

const COUNTRIES: { code: string; name: string }[] = [
  { code: 'US', name: 'United States' },
  { code: 'CA', name: 'Canada' },
  { code: 'MX', name: 'Mexico' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'DE', name: 'Germany' },
  { code: 'FR', name: 'France' },
  { code: 'IT', name: 'Italy' },
  { code: 'ES', name: 'Spain' },
  { code: 'NL', name: 'Netherlands' },
  { code: 'CH', name: 'Switzerland' },
  { code: 'SE', name: 'Sweden' },
  { code: 'IE', name: 'Ireland' },
  { code: 'CN', name: 'China' },
  { code: 'JP', name: 'Japan' },
  { code: 'KR', name: 'South Korea' },
  { code: 'IN', name: 'India' },
  { code: 'SG', name: 'Singapore' },
  { code: 'AE', name: 'United Arab Emirates' },
  { code: 'AU', name: 'Australia' },
  { code: 'BR', name: 'Brazil' },
]

// Top 15 sourcing countries (subset of COUNTRIES).
const SOURCING_COUNTRIES = COUNTRIES.slice(0, 15)

const BUSINESS_TYPES = [
  { value: 'corporation', label: 'Corporation' },
  { value: 'llc', label: 'LLC' },
  { value: 'partnership', label: 'Partnership' },
  { value: 'sole_proprietor', label: 'Sole Proprietor' },
  { value: 'other', label: 'Other' },
]

const REVENUE_RANGES = ['<$1M', '$1M–$10M', '$10M–$50M', '$50M–$250M', '$250M+']
const EMPLOYEE_RANGES = ['1–10', '11–50', '51–200', '201–500', '500+']
const PAYMENT_TERMS = ['NET30', 'NET60', 'NET90', 'Letter of Credit', 'Other']

const PRODUCT_CATEGORIES = [
  'Electronics',
  'Industrial Equipment',
  'Raw Materials',
  'Textiles & Apparel',
  'Food & Beverage',
  'Automotive Parts',
  'Chemicals',
  'Packaging',
  'Construction Materials',
  'Medical Supplies',
  'Consumer Goods',
  'Logistics Services',
]

// Document requirements per org type.
interface DocSpec {
  kind: string
  label: string
  required: boolean
}
const SUPPLIER_DOCS: DocSpec[] = [
  { kind: 'certificate_of_incorporation', label: 'Certificate of incorporation', required: true },
  { kind: 'ein_letter', label: 'EIN letter', required: true },
  { kind: 'audited_financials', label: 'Financial statements — last 2 years', required: true },
  { kind: 'bank_statements', label: 'Bank statements — last 6 months', required: true },
  { kind: 'trade_reference', label: 'Trade reference letter — improves your PassportScore', required: false },
]
const ANCHOR_DOCS: DocSpec[] = [
  { kind: 'certificate_of_incorporation', label: 'Certificate of incorporation', required: true },
  { kind: 'ein_letter', label: 'EIN letter', required: true },
  { kind: 'audited_financials', label: 'Financial statements — last 2 years', required: true },
  { kind: 'bank_statements', label: 'Bank statements — last 6 months', required: true },
]

// ─────────────────────────────────────────────────────────────
// Form model
// ─────────────────────────────────────────────────────────────
interface Form {
  legal_name: string
  doing_business_as: string
  business_type: string
  country_of_incorporation: string
  state_of_incorporation: string
  years_in_operation: string
  industry_naics: string
  website: string
  description: string
  primary_contact_name: string
  primary_contact_title: string
  primary_contact_phone: string
  address_line1: string
  address_line2: string
  city: string
  state: string
  zip: string
  country: string
  annual_revenue_range: string
  employee_count_range: string
  ein: string
  country_of_origin: string
  sourcing_countries: string[]
  product_categories: string[]
  payment_terms_preference: string
  network_visible: boolean
}

const EMPTY_FORM: Form = {
  legal_name: '',
  doing_business_as: '',
  business_type: '',
  country_of_incorporation: '',
  state_of_incorporation: '',
  years_in_operation: '',
  industry_naics: '',
  website: '',
  description: '',
  primary_contact_name: '',
  primary_contact_title: '',
  primary_contact_phone: '',
  address_line1: '',
  address_line2: '',
  city: '',
  state: '',
  zip: '',
  country: '',
  annual_revenue_range: '',
  employee_count_range: '',
  ein: '',
  country_of_origin: '',
  sourcing_countries: [],
  product_categories: [],
  payment_terms_preference: '',
  network_visible: false,
}

function mapOrgToForm(org: Organization): Form {
  return {
    legal_name: org.legal_name ?? '',
    doing_business_as: org.doing_business_as ?? '',
    business_type: org.business_type ?? '',
    country_of_incorporation: org.country_of_incorporation ?? '',
    state_of_incorporation: org.state_of_incorporation ?? '',
    years_in_operation: org.years_in_operation != null ? String(org.years_in_operation) : '',
    industry_naics: org.industry_naics ?? '',
    website: org.website ?? '',
    description: org.description ?? '',
    primary_contact_name: org.primary_contact_name ?? '',
    primary_contact_title: org.primary_contact_title ?? '',
    primary_contact_phone: org.primary_contact_phone ?? '',
    address_line1: org.address_line1 ?? '',
    address_line2: org.address_line2 ?? '',
    city: org.city ?? '',
    state: org.state ?? '',
    zip: org.zip ?? '',
    country: org.country ?? '',
    annual_revenue_range: org.annual_revenue_range ?? '',
    employee_count_range: org.employee_count_range ?? '',
    ein: org.ein ?? '',
    country_of_origin: org.country_of_origin ?? '',
    sourcing_countries: org.sourcing_countries ?? [],
    product_categories: org.product_categories ?? [],
    payment_terms_preference: '', // not persisted (no column) — see route note
    network_visible: !!org.network_visible,
  }
}

// Build the PATCH payload. payment_terms_preference is intentionally omitted —
// there is no such column on `organizations`.
function mapFormToData(form: Form): Record<string, unknown> {
  return {
    legal_name: form.legal_name,
    doing_business_as: form.doing_business_as,
    business_type: form.business_type,
    country_of_incorporation: form.country_of_incorporation,
    state_of_incorporation: form.state_of_incorporation,
    years_in_operation: form.years_in_operation,
    industry_naics: form.industry_naics,
    website: form.website,
    description: form.description,
    primary_contact_name: form.primary_contact_name,
    primary_contact_title: form.primary_contact_title,
    primary_contact_phone: form.primary_contact_phone,
    address_line1: form.address_line1,
    address_line2: form.address_line2,
    city: form.city,
    state: form.state,
    zip: form.zip,
    country: form.country,
    annual_revenue_range: form.annual_revenue_range,
    employee_count_range: form.employee_count_range,
    ein: form.ein,
    country_of_origin: form.country_of_origin,
    sourcing_countries: form.sourcing_countries,
    product_categories: form.product_categories,
    network_visible: form.network_visible,
  }
}

// ─────────────────────────────────────────────────────────────
// Small presentational helpers
// ─────────────────────────────────────────────────────────────
function StepHeader({ step, title, sub }: { step: number; title: string; sub: string }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: 'var(--blue)',
          marginBottom: 10,
        }}
      >
        Step {step} of {TOTAL_STEPS}
      </div>
      <h1
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 26,
          fontWeight: 600,
          letterSpacing: '-0.025em',
          color: 'var(--color-ink-1)',
          margin: 0,
        }}
      >
        {title}
      </h1>
      <p style={{ fontSize: 13.5, color: 'var(--color-ink-3)', marginTop: 8, lineHeight: 1.6 }}>{sub}</p>
    </div>
  )
}

function Field({
  label,
  optional,
  hint,
  children,
}: {
  label: string
  optional?: boolean
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="form-field">
      <div className="form-label-row">
        <label className="form-label">{label}</label>
        {optional && <span className="form-label-meta">Optional</span>}
      </div>
      {children}
      {hint && <div className="form-helper">{hint}</div>}
    </div>
  )
}

function MultiSelect({
  options,
  selected,
  onToggle,
}: {
  options: { value: string; label: string }[]
  selected: string[]
  onToggle: (value: string) => void
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
      {options.map((o) => {
        const on = selected.includes(o.value)
        return (
          <button
            type="button"
            key={o.value}
            onClick={() => onToggle(o.value)}
            className={`radio-card ${on ? 'selected' : ''}`.trim()}
            style={{ gap: 10 }}
          >
            <span
              style={{
                width: 16,
                height: 16,
                flexShrink: 0,
                border: `1.5px solid ${on ? 'var(--color-accent)' : 'var(--color-border-strong)'}`,
                background: on ? 'var(--color-accent)' : 'transparent',
                color: '#fff',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 11,
              }}
            >
              {on ? '✓' : ''}
            </span>
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Document drop zone
// ─────────────────────────────────────────────────────────────
type DocStatus = 'idle' | 'uploading' | 'done' | 'error'
interface DocState {
  status: DocStatus
  name?: string
  size?: number
  document_id?: string
}

function formatBytes(bytes?: number): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function DropZone({
  spec,
  state,
  onFile,
}: {
  spec: DocSpec
  state: DocState
  onFile: (file: File) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [drag, setDrag] = useState(false)
  const done = state.status === 'done'
  const uploading = state.status === 'uploading'

  return (
    <div style={{ marginBottom: 10 }}>
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setDrag(true)
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDrag(false)
          const file = e.dataTransfer.files?.[0]
          if (file) onFile(file)
        }}
        className="upload-zone"
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 14,
          textAlign: 'left',
          cursor: uploading ? 'default' : 'pointer',
          padding: '14px 16px',
          borderColor: done
            ? 'var(--color-green)'
            : drag
              ? 'var(--color-accent)'
              : 'var(--color-border-strong)',
          background: done ? 'var(--color-green-bg)' : drag ? 'var(--color-accent-light)' : 'var(--color-bg-2)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <div
            style={{
              width: 32,
              height: 32,
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: done ? 'var(--color-green)' : 'var(--color-card)',
              border: done ? 'none' : '1px solid var(--color-border)',
              color: done ? '#fff' : 'var(--color-ink-3)',
            }}
          >
            {done ? (
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M4 8 L7 11 L12 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M8 3 L8 11 M5 6 L8 3 L11 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                <path d="M3 13 L13 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none" />
              </svg>
            )}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-ink-1)' }}>
              {spec.label}
              {!spec.required && (
                <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 400, color: 'var(--color-ink-4)' }}>Optional</span>
              )}
            </div>
            <div
              style={{
                fontSize: 11.5,
                color: done ? 'var(--color-green)' : 'var(--color-ink-4)',
                marginTop: 2,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {uploading
                ? 'Uploading…'
                : done
                  ? `${state.name} · ${formatBytes(state.size)}`
                  : state.status === 'error'
                    ? 'Upload failed — click to retry'
                    : 'Drag & drop or click to upload · PDF, max 20MB'}
            </div>
          </div>
        </div>
        <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--blue)', whiteSpace: 'nowrap' }}>
          {done ? 'Replace' : uploading ? '' : 'Upload'}
        </span>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,image/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) onFile(file)
          e.target.value = ''
        }}
      />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Searchable NAICS select
// ─────────────────────────────────────────────────────────────
function NaicsSelect({ value, onChange }: { value: string; onChange: (code: string) => void }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const wrapRef = useRef<HTMLDivElement>(null)

  const selectedLabel = NAICS_OPTIONS.find((n) => n.code === value)?.label ?? ''
  const filtered = NAICS_OPTIONS.filter((n) =>
    `${n.code} ${n.label}`.toLowerCase().includes(query.toLowerCase()),
  )

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <input
        className="form-input"
        placeholder="Search industry…"
        value={open ? query : selectedLabel}
        onFocus={() => {
          setOpen(true)
          setQuery('')
        }}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
        }}
      />
      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            right: 0,
            maxHeight: 240,
            overflowY: 'auto',
            background: 'var(--color-card)',
            border: '1px solid var(--color-border)',
            boxShadow: '0 8px 24px var(--color-shadow)',
            zIndex: 20,
          }}
        >
          {filtered.length === 0 && (
            <div style={{ padding: '10px 12px', fontSize: 12.5, color: 'var(--color-ink-4)' }}>No matches</div>
          )}
          {filtered.map((n) => (
            <button
              type="button"
              key={n.code}
              onClick={() => {
                onChange(n.code)
                setOpen(false)
              }}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '9px 12px',
                fontSize: 13,
                background: n.code === value ? 'var(--color-accent-light)' : 'transparent',
                color: 'var(--color-ink-1)',
                border: 'none',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-4)', marginRight: 8 }}>
                {n.code}
              </span>
              {n.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// Display helpers for the review step.
function countryName(code: string): string {
  return COUNTRIES.find((c) => c.code === code)?.name ?? code
}
function naicsLabel(code: string): string {
  return NAICS_OPTIONS.find((n) => n.code === code)?.label ?? code
}
function businessTypeLabel(value: string): string {
  return BUSINESS_TYPES.find((b) => b.value === value)?.label ?? value
}

// ─────────────────────────────────────────────────────────────
// Main wizard
// ─────────────────────────────────────────────────────────────
export default function OnboardingWizard() {
  const router = useRouter()
  const { step, setStep } = useWizard()

  const [org, setOrg] = useState<Organization | null>(null)
  const [form, setForm] = useState<Form>(EMPTY_FORM)
  const [docs, setDocs] = useState<Record<string, DocState>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showEin, setShowEin] = useState(false)

  const orgType: 'anchor' | 'supplier' = org?.type === 'anchor' ? 'anchor' : 'supplier'
  const docSpecs = orgType === 'anchor' ? ANCHOR_DOCS : SUPPLIER_DOCS

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch('/api/onboarding/progress')
        if (res.status === 401) {
          router.push('/login')
          return
        }
        const data = await res.json()
        if (!cancelled && data.org) {
          setOrg(data.org)
          setForm(mapOrgToForm(data.org))
        }
      } catch {
        /* fall through — wizard still renders */
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [router])

  function update(patch: Partial<Form>) {
    setForm((f) => ({ ...f, ...patch }))
  }

  function toggleInArray(field: 'sourcing_countries' | 'product_categories', value: string) {
    setForm((f) => {
      const arr = f[field]
      return { ...f, [field]: arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value] }
    })
  }

  async function saveProgress(): Promise<boolean> {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/onboarding/progress', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step, data: mapFormToData(form) }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to save your progress.')
      if (data.org) setOrg(data.org)
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save your progress.')
      return false
    } finally {
      setSaving(false)
    }
  }

  function validate(current: number): string | null {
    if (current === 1) {
      if (!form.legal_name.trim()) return 'Legal business name is required.'
      if (!form.business_type) return 'Please select a business type.'
      if (!form.country_of_incorporation) return 'Country of incorporation is required.'
      if (!form.years_in_operation.trim()) return 'Years in operation is required.'
      if (!form.industry_naics) return 'Please select your industry.'
    }
    if (current === 2) {
      if (!form.primary_contact_name.trim()) return 'Primary contact name is required.'
      if (!form.primary_contact_title.trim()) return 'Primary contact title is required.'
      if (!form.primary_contact_phone.trim()) return 'Primary contact phone is required.'
      if (!form.address_line1.trim()) return 'Address is required.'
      if (!form.city.trim()) return 'City is required.'
      if (!form.state.trim()) return 'State is required.'
      if (!form.zip.trim()) return 'ZIP is required.'
      if (!form.country) return 'Country is required.'
    }
    if (current === 3) {
      if (!form.annual_revenue_range) return 'Annual revenue range is required.'
      if (!form.employee_count_range) return 'Employee count range is required.'
      if (!form.ein.trim()) return 'EIN is required.'
      if (orgType === 'supplier') {
        if (!form.country_of_origin) return 'Country of origin is required.'
        if (form.sourcing_countries.length === 0) return 'Select at least one sourcing country.'
      } else {
        if (form.product_categories.length === 0) return 'Select at least one product category.'
      }
      if (!form.payment_terms_preference) return 'Payment terms preference is required.'
    }
    if (current === 4) {
      const missing = docSpecs.filter((d) => d.required && docs[d.kind]?.status !== 'done')
      if (missing.length > 0) return `Please upload: ${missing.map((d) => d.label).join(', ')}.`
    }
    return null
  }

  async function next() {
    const v = validate(step)
    if (v) {
      setError(v)
      return
    }
    setError(null)
    // Persist data-bearing steps; the documents step saves on upload.
    if (step <= 3 || step === 5) {
      const ok = await saveProgress()
      if (!ok) return
    }
    setStep(Math.min(step + 1, TOTAL_STEPS))
  }

  function back() {
    setError(null)
    setStep(Math.max(step - 1, 1))
  }

  function goTo(s: number) {
    setError(null)
    setStep(s)
  }

  async function uploadDoc(kind: string, file: File) {
    if (!org) {
      setError('We could not find your organization. Please refresh and try again.')
      return
    }
    setDocs((p) => ({ ...p, [kind]: { status: 'uploading', name: file.name, size: file.size } }))
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('org_id', org.id)
      fd.append('document_kind', kind)
      const res = await fetch('/api/onboarding/documents', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Upload failed')
      setDocs((p) => ({
        ...p,
        [kind]: { status: 'done', name: file.name, size: file.size, document_id: data.document_id },
      }))
    } catch {
      setDocs((p) => ({ ...p, [kind]: { status: 'error', name: file.name, size: file.size } }))
    }
  }

  async function submit() {
    const ok = await saveProgress()
    if (!ok) return
    if (!org) {
      setError('We could not find your organization. Please refresh and try again.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/onboarding/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ org_id: org.id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Submission failed.')
      router.push('/dashboard')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Submission failed.')
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div style={{ paddingTop: 80, textAlign: 'center', color: 'var(--color-ink-3)', fontSize: 13 }}>Loading…</div>
    )
  }

  return (
    <div className="page" style={{ padding: 0, maxWidth: 'none', animation: 'page-fade 0.3s ease' }}>
      {/* ── Step 1 — Business basics ─────────────────────────── */}
      {step === 1 && (
        <>
          <StepHeader step={1} title="Tell us about your business" sub="Start with your legal details. We cross-check these against public records." />
          <div className="card">
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <Field label="Legal business name">
                <input className="form-input" value={form.legal_name} onChange={(e) => update({ legal_name: e.target.value })} placeholder="Acme Corp LLC" />
              </Field>
              <Field label="Doing business as" optional>
                <input className="form-input" value={form.doing_business_as} onChange={(e) => update({ doing_business_as: e.target.value })} placeholder="Acme" />
              </Field>
              <div className="form-row-2">
                <Field label="Business type">
                  <select className="form-input form-select" value={form.business_type} onChange={(e) => update({ business_type: e.target.value })}>
                    <option value="">Select…</option>
                    {BUSINESS_TYPES.map((b) => (
                      <option key={b.value} value={b.value}>{b.label}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Country of incorporation">
                  <select className="form-input form-select" value={form.country_of_incorporation} onChange={(e) => update({ country_of_incorporation: e.target.value })}>
                    <option value="">Select…</option>
                    {COUNTRIES.map((c) => (
                      <option key={c.code} value={c.code}>{c.name}</option>
                    ))}
                  </select>
                </Field>
              </div>
              <div className="form-row-2">
                <Field label="State / province of incorporation" optional>
                  <input className="form-input" value={form.state_of_incorporation} onChange={(e) => update({ state_of_incorporation: e.target.value })} placeholder="DE" />
                </Field>
                <Field label="Years in operation">
                  <input className="form-input" type="number" min={0} value={form.years_in_operation} onChange={(e) => update({ years_in_operation: e.target.value })} placeholder="5" />
                </Field>
              </div>
              <Field label="Industry (NAICS)">
                <NaicsSelect value={form.industry_naics} onChange={(code) => update({ industry_naics: code })} />
              </Field>
              <Field label="Website" optional>
                <input className="form-input" value={form.website} onChange={(e) => update({ website: e.target.value })} placeholder="https://acme.com" />
              </Field>
              <Field label="Description" optional>
                <textarea
                  className="form-textarea"
                  rows={3}
                  maxLength={500}
                  value={form.description}
                  onChange={(e) => update({ description: e.target.value })}
                  placeholder="What does your business do?"
                />
                <div style={{ textAlign: 'right', fontSize: 11, color: 'var(--color-ink-4)', marginTop: 4 }}>
                  {form.description.length}/500
                </div>
              </Field>
            </div>
          </div>
        </>
      )}

      {/* ── Step 2 — Contact & address ───────────────────────── */}
      {step === 2 && (
        <>
          <StepHeader step={2} title="Contact & address" sub="Who should we reach out to, and where is your business registered?" />
          <div className="card">
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <Field label="Primary contact name">
                <input className="form-input" value={form.primary_contact_name} onChange={(e) => update({ primary_contact_name: e.target.value })} placeholder="Jane Doe" />
              </Field>
              <div className="form-row-2">
                <Field label="Title">
                  <input className="form-input" value={form.primary_contact_title} onChange={(e) => update({ primary_contact_title: e.target.value })} placeholder="CFO" />
                </Field>
                <Field label="Phone">
                  <input className="form-input" type="tel" value={form.primary_contact_phone} onChange={(e) => update({ primary_contact_phone: e.target.value })} placeholder="+1 (555) 010-0100" />
                </Field>
              </div>
              <Field label="Address line 1">
                <input className="form-input" value={form.address_line1} onChange={(e) => update({ address_line1: e.target.value })} placeholder="123 Main St" />
              </Field>
              <Field label="Address line 2" optional>
                <input className="form-input" value={form.address_line2} onChange={(e) => update({ address_line2: e.target.value })} placeholder="Suite 400" />
              </Field>
              <div className="form-row-3">
                <Field label="City">
                  <input className="form-input" value={form.city} onChange={(e) => update({ city: e.target.value })} placeholder="Portland" />
                </Field>
                <Field label="State">
                  <input className="form-input" value={form.state} onChange={(e) => update({ state: e.target.value })} placeholder="OR" />
                </Field>
                <Field label="ZIP">
                  <input className="form-input" value={form.zip} onChange={(e) => update({ zip: e.target.value })} placeholder="97201" />
                </Field>
              </div>
              <Field label="Country">
                <select className="form-input form-select" value={form.country} onChange={(e) => update({ country: e.target.value })}>
                  <option value="">Select…</option>
                  {COUNTRIES.map((c) => (
                    <option key={c.code} value={c.code}>{c.name}</option>
                  ))}
                </select>
              </Field>
            </div>
          </div>
        </>
      )}

      {/* ── Step 3 — Financial profile ───────────────────────── */}
      {step === 3 && (
        <>
          <StepHeader step={3} title="Financial profile" sub="This helps us size financing and tailor your Strike Passport." />
          <div className="card">
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="form-row-2">
                <Field label="Annual revenue range">
                  <select className="form-input form-select" value={form.annual_revenue_range} onChange={(e) => update({ annual_revenue_range: e.target.value })}>
                    <option value="">Select…</option>
                    {REVENUE_RANGES.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Employee count">
                  <select className="form-input form-select" value={form.employee_count_range} onChange={(e) => update({ employee_count_range: e.target.value })}>
                    <option value="">Select…</option>
                    {EMPLOYEE_RANGES.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field label="EIN (Federal Tax ID)" hint="Stored securely and only shared with verification partners.">
                <div className="input-with-status">
                  <input
                    className="form-input mono"
                    type={showEin ? 'text' : 'password'}
                    value={form.ein}
                    onChange={(e) => update({ ein: e.target.value })}
                    placeholder="12-3456789"
                  />
                  <button
                    type="button"
                    onClick={() => setShowEin((s) => !s)}
                    className="input-status"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-ink-3)' }}
                  >
                    {showEin ? 'Hide' : 'Show'}
                  </button>
                </div>
              </Field>

              {orgType === 'supplier' ? (
                <>
                  <Field label="Country of origin">
                    <select className="form-input form-select" value={form.country_of_origin} onChange={(e) => update({ country_of_origin: e.target.value })}>
                      <option value="">Select…</option>
                      {COUNTRIES.map((c) => (
                        <option key={c.code} value={c.code}>{c.name}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Sourcing countries">
                    <MultiSelect
                      options={SOURCING_COUNTRIES.map((c) => ({ value: c.code, label: c.name }))}
                      selected={form.sourcing_countries}
                      onToggle={(v) => toggleInArray('sourcing_countries', v)}
                    />
                  </Field>
                </>
              ) : (
                <Field label="Product categories">
                  <MultiSelect
                    options={PRODUCT_CATEGORIES.map((c) => ({ value: c, label: c }))}
                    selected={form.product_categories}
                    onToggle={(v) => toggleInArray('product_categories', v)}
                  />
                </Field>
              )}

              <Field label="Payment terms preference">
                <select className="form-input form-select" value={form.payment_terms_preference} onChange={(e) => update({ payment_terms_preference: e.target.value })}>
                  <option value="">Select…</option>
                  {PAYMENT_TERMS.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </Field>
            </div>
          </div>
        </>
      )}

      {/* ── Step 4 — Document upload ──────────────────────────── */}
      {step === 4 && (
        <>
          <StepHeader step={4} title="Upload your documents" sub="We’ll save your progress — you can return to finish any time." />
          <div className="info-box" style={{ margin: '0 0 16px' }}>
            <span>
              {docSpecs.filter((d) => d.required && docs[d.kind]?.status === 'done').length} of{' '}
              {docSpecs.filter((d) => d.required).length} required documents uploaded
            </span>
          </div>
          {docSpecs.map((spec) => (
            <DropZone
              key={spec.kind}
              spec={spec}
              state={docs[spec.kind] ?? { status: 'idle' }}
              onFile={(file) => uploadDoc(spec.kind, file)}
            />
          ))}
        </>
      )}

      {/* ── Step 5 — Review & submit ─────────────────────────── */}
      {step === 5 && (
        <>
          <StepHeader step={5} title="Review & submit" sub="Check everything looks right, then submit for verification." />

          {/* Passport preview */}
          <div
            className="card"
            style={{ borderColor: 'var(--blue)', marginBottom: 16, background: 'var(--color-accent-light)' }}
          >
            <div className="card-body">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-ink-1)' }}>
                    {form.legal_name || 'Your organization'}
                  </div>
                  <span
                    className="badge"
                    style={{
                      marginTop: 6,
                      color: orgType === 'anchor' ? 'var(--blue)' : 'var(--color-green)',
                    }}
                  >
                    {orgType === 'anchor' ? 'Anchor / Buyer' : 'Supplier'}
                  </span>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 22, color: 'var(--color-ink-1)' }}>55–75</div>
                  <div style={{ fontSize: 11, color: 'var(--color-ink-4)' }}>Est. PassportScore</div>
                </div>
              </div>
              <p style={{ fontSize: 12, color: 'var(--color-ink-3)', marginTop: 12, lineHeight: 1.6 }}>
                Your PassportScore will be calculated upon verification. Based on your submission, estimated range: 55–75.
              </p>
              <label style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14, cursor: 'pointer' }}>
                <span
                  onClick={() => update({ network_visible: !form.network_visible })}
                  style={{
                    width: 38,
                    height: 22,
                    flexShrink: 0,
                    background: form.network_visible ? 'var(--blue)' : 'var(--color-border-strong)',
                    borderRadius: '999px',
                    position: 'relative',
                    transition: 'background 0.15s',
                  }}
                >
                  <span
                    style={{
                      position: 'absolute',
                      top: 2,
                      left: form.network_visible ? 18 : 2,
                      width: 18,
                      height: 18,
                      background: '#fff',
                      borderRadius: '50%',
                      transition: 'left 0.15s',
                    }}
                  />
                </span>
                <span style={{ fontSize: 13, color: 'var(--color-ink-1)' }}>
                  Make my profile visible on the Strike Place marketplace
                </span>
              </label>
            </div>
          </div>

          {/* Business */}
          <ReviewSection label="Business" onEdit={() => goTo(1)}>
            <ReviewRow k="Legal name" v={form.legal_name} />
            <ReviewRow k="Doing business as" v={form.doing_business_as} />
            <ReviewRow k="Business type" v={businessTypeLabel(form.business_type)} />
            <ReviewRow k="Country of incorporation" v={countryName(form.country_of_incorporation)} />
            <ReviewRow k="State of incorporation" v={form.state_of_incorporation} />
            <ReviewRow k="Years in operation" v={form.years_in_operation} />
            <ReviewRow k="Industry" v={naicsLabel(form.industry_naics)} />
            <ReviewRow k="Website" v={form.website} />
          </ReviewSection>

          {/* Contact */}
          <ReviewSection label="Contact & address" onEdit={() => goTo(2)}>
            <ReviewRow k="Contact" v={[form.primary_contact_name, form.primary_contact_title].filter(Boolean).join(' · ')} />
            <ReviewRow k="Phone" v={form.primary_contact_phone} />
            <ReviewRow
              k="Address"
              v={[form.address_line1, form.address_line2, form.city, form.state, form.zip, countryName(form.country)]
                .filter(Boolean)
                .join(', ')}
            />
          </ReviewSection>

          {/* Financial */}
          <ReviewSection label="Financial profile" onEdit={() => goTo(3)}>
            <ReviewRow k="Annual revenue" v={form.annual_revenue_range} />
            <ReviewRow k="Employees" v={form.employee_count_range} />
            <ReviewRow k="EIN" v={form.ein ? '•••••' + form.ein.slice(-4) : ''} />
            {orgType === 'supplier' ? (
              <>
                <ReviewRow k="Country of origin" v={countryName(form.country_of_origin)} />
                <ReviewRow k="Sourcing countries" v={form.sourcing_countries.map(countryName).join(', ')} />
              </>
            ) : (
              <ReviewRow k="Product categories" v={form.product_categories.join(', ')} />
            )}
            <ReviewRow k="Payment terms" v={form.payment_terms_preference} />
          </ReviewSection>

          {/* Documents */}
          <ReviewSection label="Documents" onEdit={() => goTo(4)}>
            <div className="doc-list-inset">
              {docSpecs.map((spec) => {
                const done = docs[spec.kind]?.status === 'done'
                return (
                  <div className="doc-row-check" key={spec.kind}>
                    {done ? (
                      <span className="check-circle">
                        <svg width="11" height="11" viewBox="0 0 16 16" aria-hidden="true">
                          <path d="M4 8 L7 11 L12 5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                        </svg>
                      </span>
                    ) : (
                      <span
                        style={{
                          width: 18,
                          height: 18,
                          flexShrink: 0,
                          border: '1.5px solid var(--color-border-strong)',
                        }}
                      />
                    )}
                    <span className="doc-name">{spec.label}</span>
                    <span className="doc-meta">{done ? 'Uploaded' : spec.required ? 'Missing' : 'Optional'}</span>
                  </div>
                )
              })}
            </div>
          </ReviewSection>

          <p className="submit-disclaimer">
            By submitting, you confirm the information provided is accurate and authorize Strike SCF to verify your
            identity and company details with third-party data providers.
          </p>
        </>
      )}

      {/* ── Error + footer ───────────────────────────────────── */}
      {error && (
        <div className="alert alert-error" style={{ marginTop: 20 }}>
          <span className="alert-body">{error}</span>
        </div>
      )}

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          marginTop: 28,
        }}
      >
        <button type="button" className="btn btn-secondary" onClick={back} disabled={step === 1 || saving} style={{ visibility: step === 1 ? 'hidden' : 'visible' }}>
          ← Back
        </button>
        {step < TOTAL_STEPS ? (
          <button type="button" className="btn btn-blue" onClick={next} disabled={saving}>
            {saving ? 'Saving…' : 'Continue'}
          </button>
        ) : (
          <button type="button" className="btn btn-blue" onClick={submit} disabled={saving}>
            {saving ? 'Submitting…' : 'Submit for verification'}
          </button>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Review section helpers
// ─────────────────────────────────────────────────────────────
function ReviewSection({
  label,
  onEdit,
  children,
}: {
  label: string
  onEdit: () => void
  children: React.ReactNode
}) {
  return (
    <div className="review-section">
      <div className="review-section-head">
        <span className="review-section-label">{label}</span>
        <span className="review-edit" onClick={onEdit}>
          Edit
        </span>
      </div>
      <div className="kv-list inset">{children}</div>
    </div>
  )
}

function ReviewRow({ k, v }: { k: string; v: string }) {
  if (!v) return null
  return (
    <div className="kv-row">
      <span className="k">{k}</span>
      <span className="v plain">{v}</span>
    </div>
  )
}
