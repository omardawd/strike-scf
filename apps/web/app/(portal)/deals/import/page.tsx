'use client'
import React, { useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Topbar } from '@/components/portal-shell'
import { PassportScoreRing } from '@/components/passport-score-ring'
import { useUser } from '@/lib/user-context'
import { useT } from '@/lib/i18n/locale-context'

const INCOTERMS = ['EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP']
const PAYMENT_TERMS_OPTS = ['NET30', 'NET60', 'NET90', 'Letter of Credit', 'Cash in Advance', 'Open Account', 'Other']
const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CNY', 'AUD', 'CAD', 'SGD', 'AED']

interface OrgResult {
  id: string
  legal_name: string | null
  doing_business_as: string | null
  type: string
  passport_score: number | null
  risk_tier: string | null
  country: string
}

interface DealForm {
  initiating_side: 'buyer' | 'supplier'
  counterparty_org_id: string
  counterparty_name: string
  counterparty_email: string
  goods_description: string
  total_value: string
  currency: string
  agreed_delivery_date: string
  agreed_incoterms: string
  agreed_payment_terms: string
  po_number: string
}

const INITIAL_FORM: DealForm = {
  initiating_side: 'buyer',
  counterparty_org_id: '',
  counterparty_name: '',
  counterparty_email: '',
  goods_description: '',
  total_value: '',
  currency: 'USD',
  agreed_delivery_date: '',
  agreed_incoterms: '',
  agreed_payment_terms: '',
  po_number: '',
}

function ExtractedChip() {
  const t = useT()
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      fontFamily: 'var(--font-body)', fontSize: 10.5, fontWeight: 600, letterSpacing: '0.04em',
      textTransform: 'uppercase', color: 'var(--teal)',
      border: '1px solid var(--teal)', background: 'var(--teal-dim)',
      padding: '2px 7px', marginLeft: 8, borderRadius: 'var(--radius-badge)',
    }}>
      ✦ {t('dealImport.extracted')}
    </span>
  )
}

function PassportMiniCompact({ org }: { org: OrgResult }) {
  const t = useT()
  const name = org.doing_business_as ?? org.legal_name ?? t('listingDetail.unknown')
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0' }}>
      <PassportScoreRing score={org.passport_score} size="sm" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
        <div style={{ fontSize: 11, fontFamily: 'var(--font-body)', fontWeight: 500, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--gray-soft)', marginTop: 2 }}>
          {org.type} · {org.country}
        </div>
      </div>
    </div>
  )
}

export default function ImportDealPage() {
  const router = useRouter()
  const user = useUser()
  const t = useT()
  const [step, setStep] = useState(1)
  const [form, setForm] = useState<DealForm>(INITIAL_FORM)
  const [extractedFields, setExtractedFields] = useState<Set<string>>(new Set())
  const [counterpartyMode, setCounterpartyMode] = useState<'search' | 'manual'>('search')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<OrgResult[]>([])
  const [selectedOrg, setSelectedOrg] = useState<OrgResult | null>(null)
  const [uploadedDocId, setUploadedDocId] = useState<string | null>(null)
  const [extracting, setExtracting] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null)
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function patch(updates: Partial<DealForm>) {
    setForm(prev => ({ ...prev, ...updates }))
  }

  // Debounced counterparty search
  function handleSearchChange(q: string) {
    setSearchQuery(q)
    if (searchTimeout.current) clearTimeout(searchTimeout.current)
    if (q.length < 2) { setSearchResults([]); return }
    searchTimeout.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/organizations/search?q=${encodeURIComponent(q)}`)
        const data = await res.json()
        setSearchResults(data.organizations ?? [])
      } catch { setSearchResults([]) }
    }, 300)
  }

  function selectOrg(org: OrgResult) {
    setSelectedOrg(org)
    patch({ counterparty_org_id: org.id, counterparty_name: '', counterparty_email: '' })
    setSearchResults([])
    setSearchQuery(org.doing_business_as ?? org.legal_name ?? '')
  }

  function clearOrg() {
    setSelectedOrg(null)
    patch({ counterparty_org_id: '' })
    setSearchQuery('')
  }

  async function handleFileUpload(file: File) {
    if (!file || !user?.org_id) return
    setUploading(true)
    setUploadedFileName(file.name)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('org_id', user.org_id)
      fd.append('document_kind', 'certificate_of_incorporation') // placeholder kind for deal docs
      fd.append('entity_type', 'deal')

      const res = await fetch('/api/onboarding/documents', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok || !data.document_id) { alert(t('dealImport.uploadFailed')); return }

      setUploadedDocId(data.document_id)
      setExtracting(true)

      const extractRes = await fetch(`/api/deals/extract?document_id=${data.document_id}`)
      const extractData = await extractRes.json()
      const ex = extractData.extracted ?? {}

      const newExtracted = new Set<string>()
      const updates: Partial<DealForm> = {}
      if (ex.goods_description && !form.goods_description) { updates.goods_description = ex.goods_description; newExtracted.add('goods_description') }
      if (ex.total_value && !form.total_value) { updates.total_value = String(ex.total_value); newExtracted.add('total_value') }
      if (ex.currency && !form.currency) { updates.currency = ex.currency; newExtracted.add('currency') }
      if (ex.delivery_date && !form.agreed_delivery_date) { updates.agreed_delivery_date = ex.delivery_date; newExtracted.add('agreed_delivery_date') }
      if (ex.payment_terms && !form.agreed_payment_terms) { updates.agreed_payment_terms = ex.payment_terms; newExtracted.add('agreed_payment_terms') }
      if (ex.incoterms && !form.agreed_incoterms) { updates.agreed_incoterms = ex.incoterms; newExtracted.add('agreed_incoterms') }
      if (ex.po_number && !form.po_number) { updates.po_number = ex.po_number; newExtracted.add('po_number') }

      patch(updates)
      setExtractedFields(newExtracted)
    } finally {
      setUploading(false)
      setExtracting(false)
    }
  }

  async function handleSubmit() {
    setSubmitting(true)
    try {
      const payload = {
        initiating_side: form.initiating_side,
        counterparty_org_id: form.counterparty_org_id || undefined,
        counterparty_name: form.counterparty_name || undefined,
        counterparty_email: form.counterparty_email || undefined,
        goods_description: form.goods_description,
        total_value: Number(form.total_value),
        currency: form.currency,
        agreed_delivery_date: form.agreed_delivery_date || undefined,
        agreed_incoterms: form.agreed_incoterms || undefined,
        agreed_payment_terms: form.agreed_payment_terms || undefined,
        po_number: form.po_number || undefined,
      }
      const res = await fetch('/api/deals/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) { alert(data.error ?? t('dealImport.submissionFailed')); return }
      router.push(`/deals/${data.deal_id}`)
    } finally {
      setSubmitting(false)
    }
  }

  function canProceedStep1(): boolean {
    if (!form.goods_description || !form.total_value || !form.currency) return false
    if (!form.counterparty_org_id && !form.counterparty_name) return false
    return true
  }

  const STEPS = [t('dealImport.stepYourDeal'), t('dealImport.stepDocuments'), t('dealImport.stepReviewSubmit')]

  return (
    <>
      <Topbar
        crumbs={[{ label: t('deals.myDeals'), onClick: () => router.push('/deals') }, { label: t('marketplace.financeExistingTrade') }]}
      />

      <div className="page" style={{ maxWidth: 680 }}>
        <div className="page-header">
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em' }}>
            {t('marketplace.financeExistingTrade')}
          </h1>
          <p className="subtitle">{t('dealImport.subtitle')}</p>
        </div>

        {/* Stepper */}
        <div className="h-stepper" style={{ marginBottom: 32 }}>
          {STEPS.map((label, i) => {
            const stepNum = i + 1
            const state = stepNum < step ? 'done' : stepNum === step ? 'current' : ''
            return (
              <React.Fragment key={label}>
                <div className={`h-stepper-step${state ? ` state-${state}` : ''}`}>
                  <div className="h-stepper-dot">
                    {stepNum < step ? '✓' : stepNum}
                  </div>
                  <div className="h-stepper-label">{label}</div>
                </div>
                {i < STEPS.length - 1 && (
                  <div className={`h-stepper-line${stepNum < step ? ' done' : ''}`} />
                )}
              </React.Fragment>
            )
          })}
        </div>

        {/* ── STEP 1: Your Deal ── */}
        {step === 1 && (
          <div className="card">
            <div className="card-head">{t('dealImport.step1Title')}</div>
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

              {/* Role */}
              <div className="form-field">
                <label className="form-label">{t('dealImport.iAmThe')}</label>
                <div className="radio-cards">
                  {(['buyer', 'supplier'] as const).map(side => (
                    <button
                      key={side}
                      type="button"
                      className={`radio-card${form.initiating_side === side ? ' selected' : ''}`}
                      onClick={() => patch({ initiating_side: side })}
                    >
                      <div className="radio-card-radio" />
                      <span style={{ textTransform: 'capitalize' }}>{side === 'buyer' ? t('passport.buyer') : t('passport.supplier')}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Counterparty search */}
              <div className="form-field">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                  <label className="form-label" style={{ marginBottom: 0 }}>{t('dealImport.counterparty')}</label>
                  <button
                    type="button"
                    className="inline-link"
                    style={{ fontSize: 11 }}
                    onClick={() => {
                      setCounterpartyMode(m => m === 'search' ? 'manual' : 'search')
                      clearOrg()
                    }}
                  >
                    {counterpartyMode === 'search' ? t('dealImport.notOnStrike') : t('dealImport.searchOnStrike')}
                  </button>
                </div>

                {counterpartyMode === 'search' ? (
                  <div style={{ position: 'relative' }}>
                    {selectedOrg ? (
                      <div style={{ border: '1px solid var(--border)', padding: '8px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <PassportMiniCompact org={selectedOrg} />
                        <button type="button" onClick={clearOrg} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gray)', fontSize: 14, padding: '0 4px' }}>✕</button>
                      </div>
                    ) : (
                      <>
                        <input
                          className="input"
                          placeholder={t('dealImport.searchByCompanyName')}
                          value={searchQuery}
                          onChange={e => handleSearchChange(e.target.value)}
                        />
                        {searchResults.length > 0 && (
                          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--white)', border: '1px solid var(--border)', borderTop: 'none', zIndex: 50, maxHeight: 240, overflowY: 'auto' }}>
                            {searchResults.map(org => (
                              <button
                                key={org.id}
                                type="button"
                                onClick={() => selectOrg(org)}
                                style={{ display: 'block', width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 12px', textAlign: 'left' }}
                              >
                                <PassportMiniCompact org={org} />
                              </button>
                            ))}
                          </div>
                        )}
                        {searchQuery.length >= 2 && searchResults.length === 0 && (
                          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--white)', border: '1px solid var(--border)', borderTop: 'none', padding: '12px 16px', fontSize: 12, color: 'var(--gray)' }}>
                            {t('dealImport.noResults')} <button type="button" className="inline-link" onClick={() => setCounterpartyMode('manual')}>{t('dealImport.enterManually')}</button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <input
                      className="input"
                      placeholder={t('dealImport.companyName')}
                      value={form.counterparty_name}
                      onChange={e => patch({ counterparty_name: e.target.value })}
                    />
                    <input
                      className="input"
                      type="email"
                      placeholder={t('dealImport.contactEmailOptional')}
                      value={form.counterparty_email}
                      onChange={e => patch({ counterparty_email: e.target.value })}
                    />
                  </div>
                )}
              </div>

              {/* Goods */}
              <div className="form-field">
                <label className="form-label">
                  {t('dealImport.goodsDescription')}
                  {extractedFields.has('goods_description') && <ExtractedChip />}
                </label>
                <textarea
                  className="input"
                  rows={3}
                  placeholder={t('dealImport.goodsDescriptionPlaceholder')}
                  value={form.goods_description}
                  onChange={e => patch({ goods_description: e.target.value })}
                />
              </div>

              {/* Value + Currency */}
              <div className="form-row-2">
                <div className="form-field">
                  <label className="form-label">
                    {t('dealImport.totalValue')}
                    {extractedFields.has('total_value') && <ExtractedChip />}
                  </label>
                  <input
                    className="input"
                    type="number"
                    min="0"
                    placeholder="0.00"
                    value={form.total_value}
                    onChange={e => patch({ total_value: e.target.value })}
                  />
                </div>
                <div className="form-field">
                  <label className="form-label">
                    {t('newListing.currency')}
                    {extractedFields.has('currency') && <ExtractedChip />}
                  </label>
                  <select
                    className="input form-select"
                    value={form.currency}
                    onChange={e => patch({ currency: e.target.value })}
                  >
                    {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>

              {/* Delivery + Incoterms */}
              <div className="form-row-2">
                <div className="form-field">
                  <label className="form-label">
                    {t('listingDetail.deliveryDate')}
                    {extractedFields.has('agreed_delivery_date') && <ExtractedChip />}
                  </label>
                  <input
                    className="input"
                    type="date"
                    value={form.agreed_delivery_date}
                    onChange={e => patch({ agreed_delivery_date: e.target.value })}
                  />
                </div>
                <div className="form-field">
                  <label className="form-label">
                    {t('newListing.incoterms')}
                    {extractedFields.has('agreed_incoterms') && <ExtractedChip />}
                  </label>
                  <select
                    className="input form-select"
                    value={form.agreed_incoterms}
                    onChange={e => patch({ agreed_incoterms: e.target.value })}
                  >
                    <option value="">{t('common.select')}</option>
                    {INCOTERMS.map(it => <option key={it} value={it}>{it}</option>)}
                  </select>
                </div>
              </div>

              {/* Payment terms + PO */}
              <div className="form-row-2">
                <div className="form-field">
                  <label className="form-label">
                    {t('newListing.paymentTerms')}
                    {extractedFields.has('agreed_payment_terms') && <ExtractedChip />}
                  </label>
                  <select
                    className="input form-select"
                    value={form.agreed_payment_terms}
                    onChange={e => patch({ agreed_payment_terms: e.target.value })}
                  >
                    <option value="">{t('common.select')}</option>
                    {PAYMENT_TERMS_OPTS.map(pt => <option key={pt} value={pt}>{pt}</option>)}
                  </select>
                </div>
                <div className="form-field">
                  <label className="form-label">
                    {t('dealImport.poNumber')}
                    {extractedFields.has('po_number') && <ExtractedChip />}
                    <span style={{ fontWeight: 400, color: 'var(--gray)', marginLeft: 6, fontSize: 11 }}>({t('reviewForm.optional')})</span>
                  </label>
                  <input
                    className="input"
                    placeholder="e.g. PO-2024-0042"
                    value={form.po_number}
                    onChange={e => patch({ po_number: e.target.value })}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
                <button
                  className="btn btn-blue"
                  disabled={!canProceedStep1()}
                  onClick={() => setStep(2)}
                >
                  {t('dealImport.nextUploadDocuments')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── STEP 2: Documents ── */}
        {step === 2 && (
          <div className="card">
            <div className="card-head">{t('dealImport.step2Title')}</div>
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <p style={{ fontSize: 13, color: 'var(--gray)', lineHeight: 1.6 }}>
                {t('dealImport.step2Hint')}
              </p>

              <div
                className="upload-zone"
                style={{ cursor: 'pointer' }}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={e => e.preventDefault()}
                onDrop={e => {
                  e.preventDefault()
                  const file = e.dataTransfer.files[0]
                  if (file) handleFileUpload(file)
                }}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.doc,.docx,.xlsx,.csv,.png,.jpg,.jpeg"
                  style={{ display: 'none' }}
                  onChange={e => {
                    const file = e.target.files?.[0]
                    if (file) handleFileUpload(file)
                  }}
                />
                <svg className="upload-icon" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                {uploading ? (
                  <p className="upload-title">{t('dealImport.uploading')}</p>
                ) : uploadedFileName ? (
                  <>
                    <p className="upload-title" style={{ color: 'var(--color-green)' }}>✓ {uploadedFileName}</p>
                    <p className="upload-sub">{t('dealImport.clickToReplace')}</p>
                  </>
                ) : (
                  <>
                    <p className="upload-title">{t('dealImport.dropDocumentHint')}</p>
                    <p className="upload-sub">{t('dealImport.fileTypesHint')}</p>
                  </>
                )}
              </div>

              {extracting && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: 'var(--teal-dim)', border: '1px solid var(--teal)', borderLeft: '3px solid var(--teal)' }}>
                  <div style={{ width: 16, height: 16, borderRadius: '50%', border: '2px solid var(--teal)', borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite', flexShrink: 0 }} />
                  <span style={{ fontSize: 13, color: 'var(--teal)' }}>{t('dealImport.aiReadingDocument')}</span>
                </div>
              )}

              {extractedFields.size > 0 && !extracting && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--teal)' }}>
                  <span>✦</span>
                  <span>{t('dealImport.extractedFieldsHint', { count: extractedFields.size })}</span>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                <button className="btn btn-ghost" onClick={() => setStep(1)}>← {t('dealImport.back')}</button>
                <button className="btn btn-blue" onClick={() => setStep(3)}>
                  {uploadedDocId ? t('dealImport.nextReview') : t('dealImport.skipAndReview')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── STEP 3: Review & Submit ── */}
        {step === 3 && (
          <div className="card">
            <div className="card-head">{t('dealImport.step3Title')}</div>
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>

              <div className="review-section">
                <div className="review-section-head">
                  <span className="review-section-label">{t('dealImport.yourRole')}</span>
                  <button className="review-edit" onClick={() => setStep(1)}>{t('dealImport.editStep')}</button>
                </div>
                <div className="kv-list inset">
                  <div className="kv-row">
                    <span className="k">{t('dealImport.iAmThe')}</span>
                    <span className="v plain" style={{ textTransform: 'capitalize' }}>{form.initiating_side === 'buyer' ? t('passport.buyer') : t('passport.supplier')}</span>
                  </div>
                </div>
              </div>

              <div className="review-section">
                <div className="review-section-head">
                  <span className="review-section-label">{t('dealImport.counterparty')}</span>
                  <button className="review-edit" onClick={() => setStep(1)}>{t('dealImport.editStep')}</button>
                </div>
                <div className="kv-list inset">
                  {selectedOrg ? (
                    <div className="kv-row">
                      <span className="k">{t('dealImport.organization')}</span>
                      <span className="v plain">{selectedOrg.doing_business_as ?? selectedOrg.legal_name}</span>
                    </div>
                  ) : (
                    <>
                      {form.counterparty_name && (
                        <div className="kv-row">
                          <span className="k">{t('dealImport.name')}</span>
                          <span className="v plain">{form.counterparty_name}</span>
                        </div>
                      )}
                      {form.counterparty_email && (
                        <div className="kv-row">
                          <span className="k">{t('dealImport.email')}</span>
                          <span className="v plain">{form.counterparty_email}</span>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>

              <div className="review-section">
                <div className="review-section-head">
                  <span className="review-section-label">{t('dealImport.dealTerms')}</span>
                  <button className="review-edit" onClick={() => setStep(1)}>{t('dealImport.editStep')}</button>
                </div>
                <div className="kv-list inset">
                  <div className="kv-row">
                    <span className="k">{t('financingDetail.goods')}</span>
                    <span className="v plain">{form.goods_description || '—'}</span>
                  </div>
                  <div className="kv-row">
                    <span className="k">{t('dealImport.value')}</span>
                    <span className="v">{form.total_value ? `${form.currency} ${Number(form.total_value).toLocaleString()}` : '—'}</span>
                  </div>
                  {form.agreed_delivery_date && (
                    <div className="kv-row">
                      <span className="k">{t('dealImport.delivery')}</span>
                      <span className="v">{form.agreed_delivery_date}</span>
                    </div>
                  )}
                  {form.agreed_incoterms && (
                    <div className="kv-row">
                      <span className="k">{t('newListing.incoterms')}</span>
                      <span className="v">{form.agreed_incoterms}</span>
                    </div>
                  )}
                  {form.agreed_payment_terms && (
                    <div className="kv-row">
                      <span className="k">{t('newListing.paymentTerms')}</span>
                      <span className="v plain">{form.agreed_payment_terms}</span>
                    </div>
                  )}
                  {form.po_number && (
                    <div className="kv-row">
                      <span className="k">{t('dealImport.poNumber')}</span>
                      <span className="v">{form.po_number}</span>
                    </div>
                  )}
                </div>
              </div>

              {uploadedDocId && (
                <div className="review-section">
                  <div className="review-section-head">
                    <span className="review-section-label">{t('listingDetail.documents')}</span>
                    <button className="review-edit" onClick={() => setStep(2)}>{t('dealImport.editStep')}</button>
                  </div>
                  <div className="doc-list-inset">
                    <div className="doc-row-check">
                      <div className="check-circle">
                        <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M2.5 6L5 8.5L9.5 3.5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      </div>
                      <span className="doc-name">{uploadedFileName}</span>
                    </div>
                  </div>
                </div>
              )}

              <div className="alert alert-info" style={{ margin: '20px 0 0', fontSize: 12 }}>
                <span className="alert-icon">ℹ</span>
                <span className="alert-body">
                  {t('dealImport.submitCreatesAgreedDeal')}
                  {form.counterparty_org_id
                    ? ' ' + t('dealImport.counterpartyNotifiedOnStrike')
                    : form.counterparty_email
                    ? ' ' + t('dealImport.inviteWillBeSent')
                    : ' ' + t('dealImport.inviteLater')}
                </span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 24 }}>
                <button className="btn btn-ghost" onClick={() => setStep(2)}>← {t('dealImport.back')}</button>
                <button
                  className="btn btn-blue"
                  disabled={submitting}
                  onClick={handleSubmit}
                >
                  {submitting ? t('newListing.saving') : t('dealImport.submitDeal')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </>
  )
}
