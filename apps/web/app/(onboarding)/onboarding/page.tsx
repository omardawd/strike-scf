'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Organization } from '@strike-scf/types'
import { useWizard, TOTAL_STEPS } from '../wizard-context'
import { useT } from '@/lib/i18n/locale-context'

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
// Common to all orgs (TD.3 — Document Upload, role-split).
const BASE_DOCS: DocSpec[] = [
  { kind: 'certificate_of_incorporation', label: 'Certificate of incorporation / business registration', required: true },
  { kind: 'photo_id', label: 'Government-issued photo ID of authorized signatory (ID document, not a selfie)', required: true },
  { kind: 'proof_of_address', label: 'Proof of business address — utility bill, bank letter or lease dated within 90 days', required: true },
  { kind: 'ubo_declaration', label: 'Corporate ownership / UBO declaration — signed', required: true },
]
// Any org can act as buyer or supplier per deal, so every org uploads the
// same set — the union of what used to be two role-specific lists. Docs that
// were only required for one role become optional rather than dropped, so an
// org that does end up acting as a buyer/supplier hasn't silently lost a
// compliance-relevant document from its KYB file.
const ORG_DOCS: DocSpec[] = [
  ...BASE_DOCS,
  { kind: 'bank_statements', label: 'Business bank statements — last 6 months', required: true },
  { kind: 'audited_financials', label: 'Financial statements — last 2 years', required: false },
  { kind: 'tax_return', label: 'Latest corporate tax return', required: false },
  { kind: 'board_resolution', label: 'Board resolution / authority letter authorizing the signatory', required: false },
]

// Reference data for the new Financial & Trade and Systems & Intent steps.
const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'CNY', 'JPY', 'INR', 'SGD', 'AED', 'AUD']
const INVOICE_SIZES = ['<$10K', '$10K–$50K', '$50K–$250K', '$250K–$1M', '$1M+']
const PAYMENT_TERM_DAYS = ['30', '45', '60', '90', '120']
const CUSTOMER_COUNT_RANGES = ['1–5', '6–20', '21–100', '100+']
const PERCENT_RANGES = ['<10%', '10–25%', '25–50%', '>50%']
const ERP_SYSTEMS = ['SAP', 'Oracle', 'NetSuite', 'QuickBooks', 'Xero', 'Other', 'None']
const FINANCING_NEEDS = ['Invoices', 'POs', 'Both']
const INTENT_OPTIONS = [
  'Supplier financing',
  'Buyer financing',
  'Find new suppliers',
  'Find new buyers',
  'All of the above',
]

// ─────────────────────────────────────────────────────────────
// Bank account model (Step 6)
// ─────────────────────────────────────────────────────────────
interface BankAccount {
  id: string            // temp client id — real UUID assigned by server
  nickname: string
  bank_name: string
  account_holder_name: string
  account_number: string
  routing_number: string
  swift_iban: string
  account_type: 'checking' | 'savings'
  is_primary: boolean
}

const EMPTY_BANK_ACCOUNT: Omit<BankAccount, 'id'> = {
  nickname: '',
  bank_name: '',
  account_holder_name: '',
  account_number: '',
  routing_number: '',
  swift_iban: '',
  account_type: 'checking',
  is_primary: false,
}

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
    payment_terms_preference: org.payment_terms_preference ?? '',
    network_visible: !!org.network_visible,
  }
}

function mapOrgToProfile(org: Organization) {
  const yn = (v: boolean | null): '' | 'yes' | 'no' => (v == null ? '' : v ? 'yes' : 'no')
  return {
    ceo_name: org.ceo_name ?? '',
    ubo_summary: org.ubo_summary ?? '',
    pep: yn(org.is_pep),
    sanctioned: yn(org.has_sanctioned_exposure),
    bankruptcy: yn(org.bankruptcy_filed),
    litigation: yn(org.material_litigation),
    primary_currency: org.primary_currency ?? '',
    avg_invoice_size: org.avg_invoice_size ?? '',
    payment_terms_offered: org.payment_terms_offered ?? '',
    payment_terms_received: org.payment_terms_received ?? '',
    customer_count: org.customer_count ?? '',
    largest_customer_pct: org.largest_customer_pct ?? '',
    financing_need: org.financing_need ?? '',
    supplier_count: org.supplier_count ?? '',
    largest_supplier_pct: org.largest_supplier_pct ?? '',
    supplier_payment_terms: org.supplier_payment_terms ?? '',
    erp_system: org.erp_system ?? '',
    primary_bank_name: org.primary_bank_name ?? '',
    intent: org.platform_intent ?? [],
    ai_matching: org.ai_matching_opt_in ?? true,
  }
}

function mapProfileToData(profile: {
  ceo_name: string; ubo_summary: string
  pep: '' | 'yes' | 'no'; sanctioned: '' | 'yes' | 'no'; bankruptcy: '' | 'yes' | 'no'; litigation: '' | 'yes' | 'no'
  primary_currency: string; avg_invoice_size: string
  payment_terms_offered: string; payment_terms_received: string
  customer_count: string; largest_customer_pct: string; financing_need: string
  supplier_count: string; largest_supplier_pct: string; supplier_payment_terms: string
  erp_system: string; primary_bank_name: string; intent: string[]; ai_matching: boolean
}): Record<string, unknown> {
  const bool = (v: '' | 'yes' | 'no'): boolean | undefined => (v === '' ? undefined : v === 'yes')
  return {
    ceo_name: profile.ceo_name || undefined,
    ubo_summary: profile.ubo_summary || undefined,
    is_pep: bool(profile.pep),
    has_sanctioned_exposure: bool(profile.sanctioned),
    bankruptcy_filed: bool(profile.bankruptcy),
    material_litigation: bool(profile.litigation),
    primary_currency: profile.primary_currency || undefined,
    avg_invoice_size: profile.avg_invoice_size || undefined,
    payment_terms_offered: profile.payment_terms_offered || undefined,
    payment_terms_received: profile.payment_terms_received || undefined,
    customer_count: profile.customer_count || undefined,
    largest_customer_pct: profile.largest_customer_pct || undefined,
    financing_need: profile.financing_need || undefined,
    supplier_count: profile.supplier_count || undefined,
    largest_supplier_pct: profile.largest_supplier_pct || undefined,
    supplier_payment_terms: profile.supplier_payment_terms || undefined,
    erp_system: profile.erp_system || undefined,
    primary_bank_name: profile.primary_bank_name || undefined,
    platform_intent: profile.intent.length > 0 ? profile.intent : undefined,
    ai_matching_opt_in: profile.ai_matching,
  }
}

// Build the PATCH payload.
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
    payment_terms_preference: form.payment_terms_preference,
    network_visible: form.network_visible,
  }
}

// ─────────────────────────────────────────────────────────────
// Small presentational helpers
// ─────────────────────────────────────────────────────────────
function StepHeader({ step, title, sub }: { step: number; title: string; sub: string }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div
        style={{
          fontFamily: 'var(--font-body)',
          fontSize: 12,
          fontWeight: 600,
          letterSpacing: '0.05em',
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
  cols = 2,
}: {
  options: { value: string; label: string }[]
  selected: string[]
  onToggle: (value: string) => void
  cols?: 2 | 3
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 8 }}>
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

// Yes/No segmented control for compliance declarations (Step 3).
function YesNo({
  label,
  value,
  onChange,
}: {
  label: string
  value: '' | 'yes' | 'no'
  onChange: (v: 'yes' | 'no') => void
}) {
  const t = useT()
  return (
    <div className="form-field">
      <div className="form-label-row">
        <label className="form-label">{label}</label>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        {(['no', 'yes'] as const).map((opt) => {
          const on = value === opt
          return (
            <button
              type="button"
              key={opt}
              onClick={() => onChange(opt)}
              className={`radio-card ${on ? 'selected' : ''}`.trim()}
              style={{ flex: 1, justifyContent: 'center', textTransform: 'capitalize' }}
            >
              {opt === 'yes' ? t('common.yes') : t('common.no')}
            </button>
          )
        })}
      </div>
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
  const t = useT()
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
                <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 400, color: 'var(--color-ink-4)' }}>{t('common.optional')}</span>
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
                ? t('onboarding.misc.uploading')
                : done
                  ? `${state.name} - ${formatBytes(state.size)}`
                  : state.status === 'error'
                    ? t('onboarding.misc.uploadFailed')
                    : t('onboarding.misc.dragDropHint')}
            </div>
          </div>
        </div>
        <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--blue)', whiteSpace: 'nowrap' }}>
          {done ? t('onboarding.misc.replace') : uploading ? '' : t('onboarding.misc.upload')}
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
              <span style={{ fontFamily: 'var(--font-body)', fontWeight: 500, color: 'var(--color-ink-4)', marginRight: 8 }}>
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
  const t = useT()
  const { step, setStep } = useWizard()

  const [org, setOrg] = useState<Organization | null>(null)
  const [form, setForm] = useState<Form>(EMPTY_FORM)
  const [docs, setDocs] = useState<Record<string, DocState>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showEin, setShowEin] = useState(false)
  // Final attestation (Step 8) — gates submission per TD.3.
  const [attested, setAttested] = useState(false)

  // ── Step 6 — Bank Accounts ───────────────────────────────────
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([])
  const [addingAccount, setAddingAccount] = useState(false)
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null)
  const [accountDraft, setAccountDraft] = useState<Omit<BankAccount, 'id'>>(EMPTY_BANK_ACCOUNT)
  const [accountSaving, setAccountSaving] = useState(false)
  const [showAccountNumber, setShowAccountNumber] = useState(false)

  function startAddAccount() {
    setAccountDraft(EMPTY_BANK_ACCOUNT)
    setShowAccountNumber(false)
    setEditingAccountId(null)
    setAddingAccount(true)
  }

  function startEditAccount(acc: BankAccount) {
    setAccountDraft({
      nickname: acc.nickname,
      bank_name: acc.bank_name,
      account_holder_name: acc.account_holder_name,
      account_number: acc.account_number,
      routing_number: acc.routing_number,
      swift_iban: acc.swift_iban,
      account_type: acc.account_type,
      is_primary: acc.is_primary,
    })
    setShowAccountNumber(false)
    setEditingAccountId(acc.id)
    setAddingAccount(true)
  }

  function cancelAccountForm() {
    setAddingAccount(false)
    setEditingAccountId(null)
    setAccountDraft(EMPTY_BANK_ACCOUNT)
  }

  async function saveAccount() {
    if (!accountDraft.bank_name.trim() || !accountDraft.account_number.trim() || !accountDraft.routing_number.trim()) {
      setError('Bank name, account number, and routing number are required.')
      return
    }
    setAccountSaving(true)
    setError(null)
    try {
      const method = editingAccountId ? 'PATCH' : 'POST'
      const url = editingAccountId
        ? `/api/settings/bank-accounts/${editingAccountId}`
        : '/api/settings/bank-accounts'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(accountDraft),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to save account')
      if (editingAccountId) {
        setBankAccounts(prev => prev.map(a => a.id === editingAccountId ? { ...data.account } : a))
      } else {
        setBankAccounts(prev => {
          const updated = accountDraft.is_primary ? prev.map(a => ({ ...a, is_primary: false })) : prev
          return [...updated, { ...data.account }]
        })
      }
      cancelAccountForm()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save account')
    } finally {
      setAccountSaving(false)
    }
  }

  async function deleteAccount(id: string) {
    setAccountSaving(true)
    try {
      await fetch(`/api/settings/bank-accounts/${id}`, { method: 'DELETE' })
      setBankAccounts(prev => prev.filter(a => a.id !== id))
    } finally {
      setAccountSaving(false)
    }
  }

  function setPrimary(id: string) {
    setBankAccounts(prev => prev.map(a => ({ ...a, is_primary: a.id === id })))
    const acc = bankAccounts.find(a => a.id === id)
    if (acc) {
      fetch(`/api/settings/bank-accounts/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...acc, is_primary: true }),
      })
    }
  }

  // ── Supplemental KYB profile (Steps 3 & 5) ──────────────────────────────────
  // These TD.3 fields have no dedicated column on `organizations` (TD = existing
  // columns only, no migration). They are collected to complete the activation
  // flow and gate progression, kept in local state. Persisted KYB data (legal,
  // contact, financial, docs) still flows through /api/onboarding/progress.
  const [profile, setProfile] = useState({
    // Step 3 — Ownership & Compliance
    ceo_name: '',
    ubo_summary: '',
    pep: '' as '' | 'yes' | 'no',
    sanctioned: '' as '' | 'yes' | 'no',
    bankruptcy: '' as '' | 'yes' | 'no',
    litigation: '' as '' | 'yes' | 'no',
    // Step 4 — Trade profile extras
    primary_currency: '',
    avg_invoice_size: '',
    payment_terms_offered: '',
    payment_terms_received: '',
    // Step 4 — supplier-only
    customer_count: '',
    largest_customer_pct: '',
    financing_need: '',
    // Step 4 — anchor-only
    supplier_count: '',
    largest_supplier_pct: '',
    supplier_payment_terms: '',
    // Step 5 — Systems & Intent
    erp_system: '',
    primary_bank_name: '',
    intent: [] as string[],
    ai_matching: true,
  })
  function updateProfile(patch: Partial<typeof profile>) {
    setProfile((p) => ({ ...p, ...patch }))
  }
  function toggleIntent(value: string) {
    setProfile((p) => ({
      ...p,
      intent: p.intent.includes(value) ? p.intent.filter((v) => v !== value) : [...p.intent, value],
    }))
  }

  const docSpecs = ORG_DOCS

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
          setProfile(p => ({ ...p, ...mapOrgToProfile(data.org) }))
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
        body: JSON.stringify({ step, data: { ...mapFormToData(form), ...mapProfileToData(profile) } }),
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
    // Step 1 — Identity & Legal
    if (current === 1) {
      if (!form.legal_name.trim()) return t('onboarding.validation.legalName')
      if (!form.business_type) return t('onboarding.validation.businessType')
      if (!form.country_of_incorporation) return t('onboarding.validation.countryIncorp')
      if (!form.years_in_operation.trim()) return t('onboarding.validation.yearsOperation')
      if (!form.industry_naics) return t('onboarding.validation.industry')
      if (!form.ein.trim()) return t('onboarding.validation.taxId')
    }
    // Step 2 — Address & Contact
    if (current === 2) {
      if (!form.primary_contact_name.trim()) return t('onboarding.validation.primaryContactName')
      if (!form.primary_contact_title.trim()) return t('onboarding.validation.primaryContactTitle')
      if (!form.primary_contact_phone.trim()) return t('onboarding.validation.primaryContactPhone')
      if (!form.address_line1.trim()) return t('onboarding.validation.address')
      if (!form.city.trim()) return t('onboarding.validation.city')
      if (!form.state.trim()) return t('onboarding.validation.state')
      if (!form.zip.trim()) return t('onboarding.validation.zip')
      if (!form.country) return t('onboarding.validation.country')
    }
    // Step 3 — Ownership & Compliance
    if (current === 3) {
      if (!profile.ceo_name.trim()) return t('onboarding.validation.ceoName')
      if (!profile.pep) return t('onboarding.validation.pep')
      if (!profile.sanctioned) return t('onboarding.validation.sanctioned')
      if (!profile.bankruptcy) return t('onboarding.validation.bankruptcy')
      if (!profile.litigation) return t('onboarding.validation.litigation')
    }
    // Step 4 — Financial & Trade Profile. Selling-activity and buying-activity
    // fields are both shown (any org can do either) and both optional — only
    // the fields that applied to every org regardless of role stay required.
    if (current === 4) {
      if (!form.annual_revenue_range) return t('onboarding.validation.annualRevenue')
      if (!form.employee_count_range) return t('onboarding.validation.employeeCount')
      if (!profile.primary_currency) return t('onboarding.validation.primaryCurrency')
      if (!form.payment_terms_preference) return t('onboarding.validation.paymentTermsPreference')
    }
    // Step 5 — Systems & Intent
    if (current === 5) {
      if (!profile.erp_system) return t('onboarding.validation.erpSystem')
      if (profile.intent.length === 0) return t('onboarding.validation.intent')
    }
    // Step 6 — Bank Accounts (at least one required)
    if (current === 6) {
      if (bankAccounts.length === 0) return t('onboarding.validation.bankAccounts')
    }
    // Step 7 — Documents
    if (current === 7) {
      const missing = docSpecs.filter((d) => d.required && docs[d.kind]?.status !== 'done')
      if (missing.length > 0) return t('onboarding.validation.documentsMissing', { list: missing.map((d) => d.label).join(', ') })
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
    // Persist the steps that write to existing columns (1 Identity, 2 Address,
    // 4 Financial). Steps 3 & 5 are local-only; documents save on upload.
    if (step === 1 || step === 2 || step === 4) {
      const ok = await saveProgress()
      if (!ok) return
    }
    // Load existing bank accounts when entering step 6 for the first time
    const nextStep = Math.min(step + 1, TOTAL_STEPS)
    if (nextStep === 6 && bankAccounts.length === 0) {
      fetch('/api/settings/bank-accounts')
        .then(r => r.json())
        .then(d => { if (d.accounts) setBankAccounts(d.accounts) })
        .catch(() => {})
    }
    setStep(nextStep)
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
      setError(t('onboarding.error.orgNotFound'))
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
    if (!attested) {
      setError(t('onboarding.error.confirmAttestation'))
      return
    }
    const ok = await saveProgress()
    if (!ok) return
    if (!org) {
      setError(t('onboarding.error.orgNotFound'))
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
      if (!res.ok) throw new Error(data.error || t('onboarding.error.submissionFailed'))
      // Submission moves kyb_status to under_review/approved (or 'submitted'); the
      // KYB access gate in (portal)/layout.tsx shows the status page until approved.
      router.push('/home?activated=1')
    } catch (e) {
      setError(e instanceof Error ? e.message : t('onboarding.error.submissionFailed'))
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
      {/* ── Step 1 — Identity & Legal ────────────────────────── */}
      {step === 1 && (
        <>
          <StepHeader step={1} title={t('onboarding.step1.title')} sub={t('onboarding.step1.sub')} />
          <div className="card">
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="form-row-2">
                <Field label={t('onboarding.field.legalName')}>
                  <input className="form-input" value={form.legal_name} onChange={(e) => update({ legal_name: e.target.value })} placeholder="Acme Corp LLC" />
                </Field>
                <Field label={t('onboarding.field.dba')} optional>
                  <input className="form-input" value={form.doing_business_as} onChange={(e) => update({ doing_business_as: e.target.value })} placeholder="Acme" />
                </Field>
              </div>
              <div className="form-row-3">
                <Field label={t('onboarding.field.businessType')}>
                  <select className="form-input form-select" value={form.business_type} onChange={(e) => update({ business_type: e.target.value })}>
                    <option value="">{t('common.select')}</option>
                    {BUSINESS_TYPES.map((b) => (
                      <option key={b.value} value={b.value}>{b.label}</option>
                    ))}
                  </select>
                </Field>
                <Field label={t('onboarding.field.countryIncorp')}>
                  <select className="form-input form-select" value={form.country_of_incorporation} onChange={(e) => update({ country_of_incorporation: e.target.value })}>
                    <option value="">{t('common.select')}</option>
                    {COUNTRIES.map((c) => (
                      <option key={c.code} value={c.code}>{c.name}</option>
                    ))}
                  </select>
                </Field>
                <Field label={t('onboarding.field.stateIncorp')} optional>
                  <input className="form-input" value={form.state_of_incorporation} onChange={(e) => update({ state_of_incorporation: e.target.value })} placeholder="DE" />
                </Field>
              </div>
              <div className="form-row-3">
                <Field label={t('onboarding.field.yearsOperation')}>
                  <input className="form-input" type="number" min={0} value={form.years_in_operation} onChange={(e) => update({ years_in_operation: e.target.value })} placeholder="5" />
                </Field>
                <Field label={t('onboarding.field.website')} optional>
                  <input className="form-input" value={form.website} onChange={(e) => update({ website: e.target.value })} placeholder="https://acme.com" />
                </Field>
                <Field label={t('onboarding.field.taxId')} hint={t('onboarding.field.taxIdHint')}>
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
              </div>
              <Field label={t('onboarding.field.industry')}>
                <NaicsSelect value={form.industry_naics} onChange={(code) => update({ industry_naics: code })} />
              </Field>
              <Field label={t('onboarding.field.productsServices')} optional hint={t('onboarding.field.productsServicesHint')}>
                <textarea
                  className="form-textarea"
                  rows={3}
                  maxLength={500}
                  value={form.description}
                  onChange={(e) => update({ description: e.target.value })}
                  placeholder={t('onboarding.field.productsServicesPlaceholder')}
                />
                <div style={{ textAlign: 'right', fontSize: 11, color: 'var(--color-ink-4)', marginTop: 4 }}>
                  {form.description.length}/500
                </div>
              </Field>
            </div>
          </div>
        </>
      )}

      {/* ── Step 2 — Address & Contact ───────────────────────── */}
      {step === 2 && (
        <>
          <StepHeader step={2} title={t('onboarding.step2.title')} sub={t('onboarding.step2.sub')} />
          <div className="card">
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="form-row-3">
                <Field label={t('onboarding.field.primaryContactName')}>
                  <input className="form-input" value={form.primary_contact_name} onChange={(e) => update({ primary_contact_name: e.target.value })} placeholder="Jane Doe" />
                </Field>
                <Field label={t('onboarding.field.title')}>
                  <input className="form-input" value={form.primary_contact_title} onChange={(e) => update({ primary_contact_title: e.target.value })} placeholder="CFO" />
                </Field>
                <Field label={t('onboarding.field.phone')}>
                  <input className="form-input" type="tel" value={form.primary_contact_phone} onChange={(e) => update({ primary_contact_phone: e.target.value })} placeholder="+1 (555) 010-0100" />
                </Field>
              </div>
              <div className="form-row-2">
                <Field label={t('onboarding.field.addressLine1')}>
                  <input className="form-input" value={form.address_line1} onChange={(e) => update({ address_line1: e.target.value })} placeholder="123 Main St" />
                </Field>
                <Field label={t('onboarding.field.addressLine2')} optional>
                  <input className="form-input" value={form.address_line2} onChange={(e) => update({ address_line2: e.target.value })} placeholder="Suite 400" />
                </Field>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 2fr', gap: 12 }}>
                <Field label={t('onboarding.field.city')}>
                  <input className="form-input" value={form.city} onChange={(e) => update({ city: e.target.value })} placeholder="Portland" />
                </Field>
                <Field label={t('onboarding.field.state')}>
                  <input className="form-input" value={form.state} onChange={(e) => update({ state: e.target.value })} placeholder="OR" />
                </Field>
                <Field label={t('onboarding.field.zip')}>
                  <input className="form-input" value={form.zip} onChange={(e) => update({ zip: e.target.value })} placeholder="97201" />
                </Field>
                <Field label={t('onboarding.field.country')}>
                  <select className="form-input form-select" value={form.country} onChange={(e) => update({ country: e.target.value })}>
                    <option value="">{t('common.select')}</option>
                    {COUNTRIES.map((c) => (
                      <option key={c.code} value={c.code}>{c.name}</option>
                    ))}
                  </select>
                </Field>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── Step 3 — Ownership & Compliance ──────────────────── */}
      {step === 3 && (
        <>
          <StepHeader step={3} title={t('onboarding.step3.title')} sub={t('onboarding.step3.sub')} />
          <div className="card">
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="form-row-2">
                <Field label={t('onboarding.field.ceoName')}>
                  <input className="form-input" value={profile.ceo_name} onChange={(e) => updateProfile({ ceo_name: e.target.value })} placeholder="Jane Doe, John Smith" />
                </Field>
                <Field label={t('onboarding.field.uboSummary')} optional hint={t('onboarding.field.uboSummaryHint')}>
                  <input className="form-input" value={profile.ubo_summary} onChange={(e) => updateProfile({ ubo_summary: e.target.value })} placeholder="Jane Doe — 60%, John Smith — 40%" />
                </Field>
              </div>
              <div className="form-row-2">
                <YesNo label={t('onboarding.field.pep')} value={profile.pep} onChange={(v) => updateProfile({ pep: v })} />
                <YesNo label={t('onboarding.field.sanctioned')} value={profile.sanctioned} onChange={(v) => updateProfile({ sanctioned: v })} />
              </div>
              <div className="form-row-2">
                <YesNo label={t('onboarding.field.bankruptcy')} value={profile.bankruptcy} onChange={(v) => updateProfile({ bankruptcy: v })} />
                <YesNo label={t('onboarding.field.litigation')} value={profile.litigation} onChange={(v) => updateProfile({ litigation: v })} />
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── Step 4 — Financial & Trade Profile ───────────────── */}
      {step === 4 && (
        <>
          <StepHeader step={4} title={t('onboarding.step4.title')} sub={t('onboarding.step4.sub')} />
          <div className="card">
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="form-row-2">
                <Field label={t('onboarding.field.annualRevenue')}>
                  <select className="form-input form-select" value={form.annual_revenue_range} onChange={(e) => update({ annual_revenue_range: e.target.value })}>
                    <option value="">{t('common.select')}</option>
                    {REVENUE_RANGES.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </Field>
                <Field label={t('onboarding.field.employeeCount')}>
                  <select className="form-input form-select" value={form.employee_count_range} onChange={(e) => update({ employee_count_range: e.target.value })}>
                    <option value="">{t('common.select')}</option>
                    {EMPLOYEE_RANGES.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </Field>
              </div>
              <div className="form-row-2">
                <Field label={t('onboarding.field.primaryCurrency')}>
                  <select className="form-input form-select" value={profile.primary_currency} onChange={(e) => updateProfile({ primary_currency: e.target.value })}>
                    <option value="">{t('common.select')}</option>
                    {CURRENCIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </Field>
                <Field label={t('onboarding.field.avgInvoiceSize')} optional>
                  <select className="form-input form-select" value={profile.avg_invoice_size} onChange={(e) => updateProfile({ avg_invoice_size: e.target.value })}>
                    <option value="">{t('common.select')}</option>
                    {INVOICE_SIZES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </Field>
              </div>

              {/* Any org can act as either side per deal, so both activity
                  blocks are shown unconditionally rather than branched on a
                  fixed org type — fill in whichever applies to you. */}
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-soft)', marginTop: 6 }}>
                {t('onboarding.field.sellingActivity')}
              </div>
              <Field label={t('onboarding.field.countryOfOrigin')} optional>
                <select className="form-input form-select" value={form.country_of_origin} onChange={(e) => update({ country_of_origin: e.target.value })}>
                  <option value="">{t('common.select')}</option>
                  {COUNTRIES.map((c) => (
                    <option key={c.code} value={c.code}>{c.name}</option>
                  ))}
                </select>
              </Field>
              <Field label={t('onboarding.field.sourcingCountries')} optional>
                <MultiSelect
                  options={SOURCING_COUNTRIES.map((c) => ({ value: c.code, label: c.name }))}
                  selected={form.sourcing_countries}
                  onToggle={(v) => toggleInArray('sourcing_countries', v)}
                  cols={3}
                />
              </Field>
              <div className="form-row-2">
                <Field label={t('onboarding.field.customerCount')} optional>
                  <select className="form-input form-select" value={profile.customer_count} onChange={(e) => updateProfile({ customer_count: e.target.value })}>
                    <option value="">{t('common.select')}</option>
                    {CUSTOMER_COUNT_RANGES.map((c) => (<option key={c} value={c}>{c}</option>))}
                  </select>
                </Field>
                <Field label={t('onboarding.field.largestCustomerPct')} optional>
                  <select className="form-input form-select" value={profile.largest_customer_pct} onChange={(e) => updateProfile({ largest_customer_pct: e.target.value })}>
                    <option value="">{t('common.select')}</option>
                    {PERCENT_RANGES.map((c) => (<option key={c} value={c}>{c}</option>))}
                  </select>
                </Field>
              </div>
              <Field label={t('onboarding.field.financingNeed')} optional>
                <select className="form-input form-select" value={profile.financing_need} onChange={(e) => updateProfile({ financing_need: e.target.value })}>
                  <option value="">{t('common.select')}</option>
                  {FINANCING_NEEDS.map((c) => (<option key={c} value={c}>{c}</option>))}
                </select>
              </Field>

              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-soft)', marginTop: 6 }}>
                {t('onboarding.field.buyingActivity')}
              </div>
              <Field label={t('onboarding.field.productCategories')} optional>
                <MultiSelect
                  options={PRODUCT_CATEGORIES.map((c) => ({ value: c, label: c }))}
                  selected={form.product_categories}
                  onToggle={(v) => toggleInArray('product_categories', v)}
                  cols={3}
                />
              </Field>
              <div className="form-row-2">
                <Field label={t('onboarding.field.supplierCount')} optional>
                  <select className="form-input form-select" value={profile.supplier_count} onChange={(e) => updateProfile({ supplier_count: e.target.value })}>
                    <option value="">{t('common.select')}</option>
                    {CUSTOMER_COUNT_RANGES.map((c) => (<option key={c} value={c}>{c}</option>))}
                  </select>
                </Field>
                <Field label={t('onboarding.field.largestSupplierPct')} optional>
                  <select className="form-input form-select" value={profile.largest_supplier_pct} onChange={(e) => updateProfile({ largest_supplier_pct: e.target.value })}>
                    <option value="">{t('common.select')}</option>
                    {PERCENT_RANGES.map((c) => (<option key={c} value={c}>{c}</option>))}
                  </select>
                </Field>
              </div>
              <Field label={t('onboarding.field.supplierPaymentTerms')} optional>
                <select className="form-input form-select" value={profile.supplier_payment_terms} onChange={(e) => updateProfile({ supplier_payment_terms: e.target.value })}>
                  <option value="">{t('common.select')}</option>
                  {PAYMENT_TERM_DAYS.map((c) => (<option key={c} value={c}>{c} days</option>))}
                </select>
              </Field>

              <div className="form-row-2">
                <Field label={t('onboarding.field.paymentTermsOffered')} optional>
                  <select className="form-input form-select" value={profile.payment_terms_offered} onChange={(e) => updateProfile({ payment_terms_offered: e.target.value })}>
                    <option value="">{t('common.select')}</option>
                    {PAYMENT_TERM_DAYS.map((c) => (<option key={c} value={c}>{c} days</option>))}
                  </select>
                </Field>
                <Field label={t('onboarding.field.paymentTermsReceived')} optional>
                  <select className="form-input form-select" value={profile.payment_terms_received} onChange={(e) => updateProfile({ payment_terms_received: e.target.value })}>
                    <option value="">{t('common.select')}</option>
                    {PAYMENT_TERM_DAYS.map((c) => (<option key={c} value={c}>{c} days</option>))}
                  </select>
                </Field>
              </div>

              <Field label={t('onboarding.field.paymentTermsPreference')}>
                <select className="form-input form-select" value={form.payment_terms_preference} onChange={(e) => update({ payment_terms_preference: e.target.value })}>
                  <option value="">{t('common.select')}</option>
                  {PAYMENT_TERMS.map((tv) => (
                    <option key={tv} value={tv}>{tv}</option>
                  ))}
                </select>
              </Field>
            </div>
          </div>
        </>
      )}

      {/* ── Step 5 — Systems & Intent ────────────────────────── */}
      {step === 5 && (
        <>
          <StepHeader step={5} title={t('onboarding.step5.title')} sub={t('onboarding.step5.sub')} />
          <div className="card">
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="form-row-2">
                <Field label={t('onboarding.field.erpSystem')}>
                  <select className="form-input form-select" value={profile.erp_system} onChange={(e) => updateProfile({ erp_system: e.target.value })}>
                    <option value="">{t('common.select')}</option>
                    {ERP_SYSTEMS.map((c) => (<option key={c} value={c}>{c}</option>))}
                  </select>
                </Field>
                <Field label={t('onboarding.field.primaryBankName')} optional>
                  <input className="form-input" value={profile.primary_bank_name} onChange={(e) => updateProfile({ primary_bank_name: e.target.value })} placeholder="e.g. Atlas Bank" />
                </Field>
              </div>
              <Field label={t('onboarding.field.platformIntent')}>
                <MultiSelect
                  options={INTENT_OPTIONS.map((c) => ({ value: c, label: c }))}
                  selected={profile.intent}
                  onToggle={toggleIntent}
                  cols={3}
                />
              </Field>
              <label style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
                <span
                  onClick={() => updateProfile({ ai_matching: !profile.ai_matching })}
                  style={{
                    width: 38, height: 22, flexShrink: 0,
                    background: profile.ai_matching ? 'var(--blue)' : 'var(--color-border-strong)',
                    borderRadius: '999px', position: 'relative', transition: 'background 0.15s',
                  }}
                >
                  <span style={{ position: 'absolute', top: 2, left: profile.ai_matching ? 18 : 2, width: 18, height: 18, background: '#fff', borderRadius: '50%', transition: 'left 0.15s' }} />
                </span>
                <span style={{ fontSize: 13, color: 'var(--color-ink-1)' }}>
                  {t('onboarding.misc.aiMatchingLabel')}
                </span>
              </label>
            </div>
          </div>
        </>
      )}

      {/* ── Step 6 — Bank Accounts ───────────────────────────── */}
      {step === 6 && (
        <>
          <StepHeader step={6} title={t('onboarding.step6.title')} sub={t('onboarding.step6.sub')} />

          {/* Account list */}
          {bankAccounts.length > 0 && !addingAccount && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
              {bankAccounts.map((acc) => (
                <div
                  key={acc.id}
                  className="card"
                  style={{ padding: 0 }}
                >
                  <div className="card-body" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    <div
                      style={{
                        width: 40, height: 40, flexShrink: 0, borderRadius: 'var(--radius-sm)',
                        background: 'var(--blue-light)', color: 'var(--blue)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}
                    >
                      <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                        <rect x="2" y="8" width="16" height="10" rx="2" stroke="currentColor" strokeWidth="1.5"/>
                        <path d="M6 8V6a4 4 0 018 0v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                        <path d="M8 13h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                      </svg>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--ink)' }}>
                        {acc.nickname || acc.bank_name}
                        {acc.is_primary && (
                          <span className="badge" style={{ marginLeft: 8, color: 'var(--blue)', fontSize: 10 }}>{t('onboarding.misc.primary')}</span>
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--gray)', marginTop: 2 }}>
                        {acc.bank_name} - {acc.account_type === 'checking' ? t('onboarding.misc.checking') : t('onboarding.misc.savings')} - ****{acc.account_number.slice(-4)}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      {!acc.is_primary && (
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPrimary(acc.id)}>
                          {t('onboarding.misc.setAsPrimary')}
                        </button>
                      )}
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => startEditAccount(acc)}>
                        {t('onboarding.misc.editAccount')}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        style={{ color: 'var(--color-red)' }}
                        onClick={() => deleteAccount(acc.id)}
                        disabled={accountSaving}
                      >
                        {t('onboarding.misc.remove')}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Add / Edit form */}
          {addingAccount ? (
            <div className="card">
              <div className="card-head">
                <h3 className="t-card-head">{editingAccountId ? t('onboarding.misc.editAccount') : t('onboarding.misc.addBankAccountTitle')}</h3>
              </div>
              <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div className="form-row-2">
                  <Field label={t('onboarding.field.accountNickname')} optional hint={t('onboarding.field.accountNicknameHint')}>
                    <input className="form-input" value={accountDraft.nickname} onChange={e => setAccountDraft(d => ({ ...d, nickname: e.target.value }))} placeholder="Operating Account" />
                  </Field>
                  <Field label={t('onboarding.field.bankName')}>
                    <input className="form-input" value={accountDraft.bank_name} onChange={e => setAccountDraft(d => ({ ...d, bank_name: e.target.value }))} placeholder="Chase" />
                  </Field>
                </div>
                <Field label={t('onboarding.field.accountHolderName')}>
                  <input className="form-input" value={accountDraft.account_holder_name} onChange={e => setAccountDraft(d => ({ ...d, account_holder_name: e.target.value }))} placeholder="Acme Corp LLC" />
                </Field>
                <div className="form-row-2">
                  <Field label={t('onboarding.field.accountNumber')}>
                    <div className="input-with-status">
                      <input
                        className="form-input mono"
                        type={showAccountNumber ? 'text' : 'password'}
                        value={accountDraft.account_number}
                        onChange={e => setAccountDraft(d => ({ ...d, account_number: e.target.value }))}
                        placeholder="**********"
                      />
                      <button
                        type="button"
                        onClick={() => setShowAccountNumber(s => !s)}
                        className="input-status"
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gray)' }}
                      >
                        {showAccountNumber ? t('onboarding.misc.hide') : t('onboarding.misc.show')}
                      </button>
                    </div>
                  </Field>
                  <Field label={t('onboarding.field.routingNumber')}>
                    <input className="form-input mono" value={accountDraft.routing_number} onChange={e => setAccountDraft(d => ({ ...d, routing_number: e.target.value }))} placeholder="021000021" />
                  </Field>
                </div>
                <div className="form-row-2">
                  <Field label={t('onboarding.field.accountType')}>
                    <select className="form-input form-select" value={accountDraft.account_type} onChange={e => setAccountDraft(d => ({ ...d, account_type: e.target.value as 'checking' | 'savings' }))}>
                      <option value="checking">{t('onboarding.misc.checking')}</option>
                      <option value="savings">{t('onboarding.misc.savings')}</option>
                    </select>
                  </Field>
                  <Field label={t('onboarding.field.swiftIban')} optional hint={t('onboarding.field.swiftIbanHint')}>
                    <input className="form-input mono" value={accountDraft.swift_iban} onChange={e => setAccountDraft(d => ({ ...d, swift_iban: e.target.value }))} placeholder="CHASUS33 / DE89…" />
                  </Field>
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
                  <span
                    onClick={() => setAccountDraft(d => ({ ...d, is_primary: !d.is_primary }))}
                    style={{
                      width: 38, height: 22, flexShrink: 0,
                      background: accountDraft.is_primary ? 'var(--blue)' : 'var(--border)',
                      borderRadius: '999px', position: 'relative', transition: 'background 0.15s',
                    }}
                  >
                    <span style={{ position: 'absolute', top: 2, left: accountDraft.is_primary ? 18 : 2, width: 18, height: 18, background: '#fff', borderRadius: '50%', transition: 'left 0.15s' }} />
                  </span>
                  <span style={{ fontSize: 13, color: 'var(--ink)' }}>{t('onboarding.misc.setAsPrimary')}</span>
                </label>
                <div style={{ display: 'flex', gap: 8, paddingTop: 4 }}>
                  <button type="button" className="btn btn-blue" onClick={saveAccount} disabled={accountSaving}>
                    {accountSaving ? t('onboarding.btn.saving') : editingAccountId ? t('onboarding.btn.updateAccount') : t('onboarding.btn.addAccount')}
                  </button>
                  <button type="button" className="btn btn-secondary" onClick={cancelAccountForm}>{t('onboarding.btn.cancel')}</button>
                </div>
              </div>
            </div>
          ) : (
            <button type="button" className="btn btn-secondary" style={{ width: '100%' }} onClick={startAddAccount}>
              {t('onboarding.btn.addBankAccount')}
            </button>
          )}
        </>
      )}

      {/* ── Step 7 — Document upload ──────────────────────────── */}
      {step === 7 && (
        <>
          <StepHeader step={7} title={t('onboarding.step7.title')} sub={t('onboarding.step7.sub')} />
          <div className="info-box" style={{ margin: '0 0 16px' }}>
            <span>
              {t('onboarding.misc.requiredDocsUploaded', {
                done: String(docSpecs.filter((d) => d.required && docs[d.kind]?.status === 'done').length),
                total: String(docSpecs.filter((d) => d.required).length),
              })}
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

      {/* ── Step 8 — Review & Submit ─────────────────────────── */}
      {step === 8 && (
        <>
          <StepHeader step={8} title={t('onboarding.step8.title')} sub={t('onboarding.step8.sub')} />

          {/* Passport preview */}
          <div
            className="card"
            style={{ borderColor: 'var(--blue)', marginBottom: 16, background: 'var(--color-accent-light)' }}
          >
            <div className="card-body">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-ink-1)' }}>
                    {form.legal_name || t('onboarding.review.yourOrganization')}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--color-ink-1)' }}>55–75</div>
                  <div style={{ fontSize: 11, color: 'var(--color-ink-4)' }}>{t('onboarding.review.estScore')}</div>
                </div>
              </div>
              <p style={{ fontSize: 12, color: 'var(--color-ink-3)', marginTop: 12, lineHeight: 1.6 }}>
                {t('onboarding.review.scoreNote')}
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
                  {t('onboarding.review.visibilityToggle')}
                </span>
              </label>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>
            <div>
              {/* Business */}
              <ReviewSection label={t('onboarding.review.business')} onEdit={() => goTo(1)}>
                <ReviewRow k={t('onboarding.field.legalName')} v={form.legal_name} />
                <ReviewRow k={t('onboarding.field.dba')} v={form.doing_business_as} />
                <ReviewRow k={t('onboarding.field.businessType')} v={businessTypeLabel(form.business_type)} />
                <ReviewRow k={t('onboarding.field.countryIncorp')} v={countryName(form.country_of_incorporation)} />
                <ReviewRow k={t('onboarding.field.stateIncorp')} v={form.state_of_incorporation} />
                <ReviewRow k={t('onboarding.field.yearsOperation')} v={form.years_in_operation} />
                <ReviewRow k={t('onboarding.field.industry')} v={naicsLabel(form.industry_naics)} />
                <ReviewRow k={t('onboarding.field.website')} v={form.website} />
              </ReviewSection>

              {/* Contact */}
              <ReviewSection label={t('onboarding.review.contactAddress')} onEdit={() => goTo(2)}>
                <ReviewRow k={t('onboarding.review.contact')} v={[form.primary_contact_name, form.primary_contact_title].filter(Boolean).join(' - ')} />
                <ReviewRow k={t('onboarding.review.phone')} v={form.primary_contact_phone} />
                <ReviewRow
                  k={t('onboarding.review.address')}
                  v={[form.address_line1, form.address_line2, form.city, form.state, form.zip, countryName(form.country)]
                    .filter(Boolean)
                    .join(', ')}
                />
              </ReviewSection>

              {/* Ownership & Compliance */}
              <ReviewSection label={t('onboarding.review.ownershipCompliance')} onEdit={() => goTo(3)}>
                <ReviewRow k={t('onboarding.field.ceoName')} v={profile.ceo_name} />
                <ReviewRow k={t('onboarding.review.beneficialOwners')} v={profile.ubo_summary} />
                <ReviewRow k={t('onboarding.review.pep')} v={profile.pep ? profile.pep.toUpperCase() : ''} />
                <ReviewRow k={t('onboarding.review.sanctionedExposure')} v={profile.sanctioned ? profile.sanctioned.toUpperCase() : ''} />
                <ReviewRow k={t('onboarding.review.bankruptcy7y')} v={profile.bankruptcy ? profile.bankruptcy.toUpperCase() : ''} />
                <ReviewRow k={t('onboarding.review.materialLitigation')} v={profile.litigation ? profile.litigation.toUpperCase() : ''} />
              </ReviewSection>
            </div>

            <div>
              {/* Financial & Trade */}
              <ReviewSection label={t('onboarding.review.financialTradeProfile')} onEdit={() => goTo(4)}>
                <ReviewRow k={t('onboarding.review.annualRevenue')} v={form.annual_revenue_range} />
                <ReviewRow k={t('onboarding.review.employees')} v={form.employee_count_range} />
                <ReviewRow k={t('onboarding.review.operatingCurrency')} v={profile.primary_currency} />
                {/* Both activity blocks — ReviewRow hides itself when empty,
                    so only whichever the org actually filled in shows up. */}
                <ReviewRow k={t('onboarding.field.countryOfOrigin')} v={countryName(form.country_of_origin)} />
                <ReviewRow k={t('onboarding.field.sourcingCountries')} v={form.sourcing_countries.map(countryName).join(', ')} />
                <ReviewRow k={t('onboarding.field.financingNeed')} v={profile.financing_need} />
                <ReviewRow k={t('onboarding.field.productCategories')} v={form.product_categories.join(', ')} />
                <ReviewRow k={t('onboarding.review.paymentTerms')} v={form.payment_terms_preference} />
              </ReviewSection>

              {/* Systems & Intent */}
              <ReviewSection label={t('onboarding.review.systemsIntent')} onEdit={() => goTo(5)}>
                <ReviewRow k={t('onboarding.field.erpSystem')} v={profile.erp_system} />
                <ReviewRow k={t('onboarding.field.primaryBankName')} v={profile.primary_bank_name} />
                <ReviewRow k={t('onboarding.review.intent')} v={profile.intent.join(', ')} />
                <ReviewRow k={t('onboarding.review.aiMatching')} v={profile.ai_matching ? t('onboarding.review.enabled') : t('onboarding.review.disabled')} />
              </ReviewSection>

              {/* Bank Accounts */}
              <ReviewSection label={t('onboarding.review.bankAccounts')} onEdit={() => goTo(6)}>
                {bankAccounts.length === 0 ? (
                  <div style={{ fontSize: 12.5, color: 'var(--gray)', padding: '4px 0' }}>{t('onboarding.misc.noAccountsAdded')}</div>
                ) : (
                  bankAccounts.map(acc => (
                    <div key={acc.id} className="kv-row" style={{ padding: '6px 0' }}>
                      <span className="k">{acc.nickname || acc.bank_name}</span>
                      <span className="v plain">
                        {acc.bank_name} - {acc.account_type} - ****{acc.account_number.slice(-4)}
                        {acc.is_primary ? ` - ${t('onboarding.misc.primary')}` : ''}
                      </span>
                    </div>
                  ))
                )}
              </ReviewSection>

              {/* Documents */}
              <ReviewSection label={t('onboarding.review.documents')} onEdit={() => goTo(7)}>
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
                        <span className="doc-meta">{done ? t('onboarding.misc.uploaded') : spec.required ? t('onboarding.misc.missing') : t('common.optional')}</span>
                      </div>
                    )
                  })}
                </div>
              </ReviewSection>
            </div>
          </div>

          <label
            className="submit-disclaimer"
            style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}
          >
            <input
              type="checkbox"
              checked={attested}
              onChange={(e) => setAttested(e.target.checked)}
              style={{ marginTop: 2, flexShrink: 0, accentColor: 'var(--blue)' }}
            />
            <span>
              {t('onboarding.misc.disclaimer')}
            </span>
          </label>
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
          {t('onboarding.btn.back')}
        </button>
        {step < TOTAL_STEPS ? (
          <button type="button" className="btn btn-blue" onClick={next} disabled={saving}>
            {saving ? t('onboarding.btn.saving') : t('onboarding.btn.continue')}
          </button>
        ) : (
          <button type="button" className="btn btn-blue" onClick={submit} disabled={saving || !attested}>
            {saving ? t('onboarding.btn.submitting') : t('onboarding.btn.activatePassport')}
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
