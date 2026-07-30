'use client'
import React, { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useUser } from '@/lib/user-context'
import { Topbar } from '@/components/portal-shell'
import { SkeletonCard } from '@/components/motion'
import { DOC_KIND_LABELS, REQUESTABLE_DOC_KINDS } from '@/lib/kyb-document-kinds'
import { useT } from '@/lib/i18n/locale-context'

type TFn = (key: string, vars?: Record<string, string | number>) => string

interface OrgDoc {
  id: string
  name: string
  document_kind: string | null
  mime_type: string | null
  created_at: string
  signed_url: string | null
}

interface BankAccountRow {
  id: string
  nickname: string | null
  bank_name: string | null
  account_holder_name: string | null
  account_number: string | null
  routing_number: string | null
  account_type: string | null
  is_primary: boolean
}

interface DecisionRecord {
  id: string
  decision: string
  decided_by_user_name: string | null
  score_at_decision: number | null
  risk_tier_at_decision: string | null
  rejection_reason: string | null
  info_request_message: string | null
  requested_documents: string[] | null
  created_at: string
}

interface KybDetail {
  organization: Record<string, any>
  expert_analysis: {
    total_score: number
    risk_tier: 'green' | 'amber' | 'red'
    executive_summary: string
    key_strengths: string[]
    risk_flags: string[]
    improvement_actions: string[]
    analyst_notes: string
  } | null
  documents: OrgDoc[]
  bank_accounts: BankAccountRow[]
  decision_history: DecisionRecord[]
}

function fmtDate(ts: string | null): string {
  if (!ts) return '—'
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function yn(v: boolean | null, t: TFn): string {
  if (v === null || v === undefined) return '—'
  return v ? t('common.yes') : t('common.no')
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-head">{title}</div>
      {children}
    </div>
  )
}

function Row({ k, v, warn }: { k: string; v: React.ReactNode; warn?: boolean }) {
  return (
    <div className="kv-row">
      <span className="k">{k}</span>
      <span className="v plain" style={warn ? { color: 'var(--color-red)', fontWeight: 600 } : undefined}>{v ?? '—'}</span>
    </div>
  )
}

export default function AdminKybDetailPage() {
  const t = useT()
  const { org_id } = useParams<{ org_id: string }>()
  const router = useRouter()
  const user = useUser()

  const [data, setData] = useState<KybDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [moreInfoMessage, setMoreInfoMessage] = useState('')
  const [requestedDocs, setRequestedDocs] = useState<string[]>([])
  const [showReject, setShowReject] = useState(false)
  const [showMoreInfo, setShowMoreInfo] = useState(false)
  const [actionDone, setActionDone] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/kyb/${org_id}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error ?? t('adminKyb.loadFailed'))
        return
      }
      setData(await res.json())
    } catch {
      setError(t('adminKyb.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [org_id, t])

  useEffect(() => { load() }, [load])

  function toggleRequestedDoc(kind: string) {
    setRequestedDocs(prev => prev.includes(kind) ? prev.filter(k => k !== kind) : [...prev, kind])
  }

  async function handleAction(action: 'approve' | 'reject' | 'more_info', extra?: { reason?: string; message?: string; requested_documents?: string[] }) {
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/kyb/${org_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      })
      const body = await res.json()
      if (!res.ok) { setError(body.error ?? t('admin.actionFailed')); return }
      setActionDone(action)
      setShowReject(false)
      setShowMoreInfo(false)
      setMoreInfoMessage('')
      setRequestedDocs([])
      await load()
    } catch {
      setError(t('common.networkError'))
    } finally {
      setSubmitting(false)
    }
  }

  if (user && user.role !== 'strike_admin') return null

  const org = data?.organization
  const name = org?.doing_business_as || org?.legal_name || org_id
  const isSupplier = org?.type === 'supplier'

  return (
    <>
      <Topbar
        crumbs={[
          { label: t('admin.title'), onClick: () => router.push('/admin') },
          { label: t('adminKyb.kybQueue'), onClick: () => router.push('/admin') },
          { label: name },
        ]}
        onBack={() => router.push('/admin')}
      />
      <div className="page" style={{ maxWidth: 900 }} data-page-name="Admin KYB Detail" data-ai-context={JSON.stringify({ role: 'strike_admin', org_id, kyb_status: org?.kyb_status ?? null, passport_score: org?.passport_score ?? null })}>
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <SkeletonCard height={100} />
            <SkeletonCard height={220} />
            <SkeletonCard height={220} />
          </div>
        ) : error ? (
          <div className="card" style={{ padding: 20, color: 'var(--color-red)' }}>{error}</div>
        ) : !data || !org ? null : (
          <>
            {/* Header */}
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-body" style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 240 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--ink)' }}>
                      {name}
                    </span>
                    <span className="badge badge-draft" style={{ textTransform: 'capitalize' }}>{org.type}</span>
                    <span className="badge badge-pending" style={{ textTransform: 'capitalize' }}>{(org.kyb_status ?? '').replace(/_/g, ' ')}</span>
                  </div>
                  <div style={{ fontSize: 12.5, color: 'var(--gray)', marginTop: 4 }}>
                    {t('adminKyb.submittedOn', { date: fmtDate(org.kyb_submitted_at) })} · {org.primary_contact_email ?? t('adminKyb.noContactEmail')}
                  </div>
                </div>
                {org.passport_score != null && (
                  <div style={{ textAlign: 'center' }}>
                    <div style={{
                      fontFamily: 'var(--font-display)', fontSize: 36, fontWeight: 700,
                      color: org.passport_score >= 70 ? 'var(--color-green)' : org.passport_score >= 45 ? 'var(--color-amber)' : 'var(--color-red)',
                    }}>
                      {org.passport_score}
                    </div>
                    <div style={{ fontSize: 10.5, color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{t('adminKyb.aiScore')}</div>
                  </div>
                )}
              </div>

              {actionDone && (
                <div style={{ margin: '0 16px 16px', padding: '10px 14px', background: 'var(--color-green-bg)', color: 'var(--color-green)', borderRadius: 8, fontSize: 13 }}>
                  {actionDone === 'approve' ? t('adminKyb.approvedDone') : actionDone === 'reject' ? t('adminKyb.rejectedDone') : t('adminKyb.moreInfoDone')}
                </div>
              )}
              {error && (
                <div style={{ margin: '0 16px 16px', padding: '10px 14px', background: 'var(--color-red-bg)', color: 'var(--color-red)', borderRadius: 8, fontSize: 13 }}>
                  {error}
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, padding: '0 16px 16px', flexWrap: 'wrap' }}>
                <button
                  className="btn btn-sm"
                  style={{ background: 'var(--color-green)', borderColor: 'var(--color-green)', color: '#fff' }}
                  disabled={submitting}
                  onClick={() => handleAction('approve')}
                >
                  {t('admin.approve')}
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  disabled={submitting}
                  onClick={() => { setShowMoreInfo(v => !v); setShowReject(false) }}
                >
                  {t('adminKyb.requestMoreInfo')}
                </button>
                <button
                  className="btn btn-sm"
                  style={{ background: 'var(--color-red-bg)', borderColor: 'var(--color-red)', color: 'var(--color-red)' }}
                  disabled={submitting}
                  onClick={() => { setShowReject(v => !v); setShowMoreInfo(false) }}
                >
                  {t('admin.reject')}
                </button>
              </div>

              {showReject && (
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', padding: '0 16px 16px' }}>
                  <div style={{ flex: 1 }}>
                    <label className="field-label" style={{ color: 'var(--color-red)' }}>{t('admin.rejectionReason')}</label>
                    <input className="input" type="text" value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder={t('adminKyb.rejectionReasonPlaceholder')} />
                  </div>
                  <button className="btn btn-sm btn-danger" disabled={submitting} onClick={() => handleAction('reject', { reason: rejectReason })}>
                    {submitting ? t('admin.rejecting') : t('admin.confirmReject')}
                  </button>
                </div>
              )}
              {showMoreInfo && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '0 16px 16px' }}>
                  <div>
                    <label className="field-label">{t('adminKyb.messageToApplicant')}</label>
                    <input className="input" type="text" value={moreInfoMessage} onChange={e => setMoreInfoMessage(e.target.value)} placeholder={t('adminKyb.messageWhatsMissing')} />
                  </div>
                  <div>
                    <label className="field-label">{t('admin.requestDocsOptional')}</label>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                      {REQUESTABLE_DOC_KINDS.map(kind => (
                        <label
                          key={kind}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5,
                            padding: '5px 10px', borderRadius: 999, cursor: 'pointer',
                            border: `1px solid ${requestedDocs.includes(kind) ? 'var(--color-amber)' : 'var(--border)'}`,
                            background: requestedDocs.includes(kind) ? 'var(--color-amber-bg)' : 'transparent',
                            color: requestedDocs.includes(kind) ? 'var(--color-amber)' : 'var(--gray)',
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={requestedDocs.includes(kind)}
                            onChange={() => toggleRequestedDoc(kind)}
                            style={{ margin: 0 }}
                          />
                          {DOC_KIND_LABELS[kind]}
                        </label>
                      ))}
                    </div>
                  </div>
                  <div>
                    <button
                      className="btn btn-secondary btn-sm"
                      disabled={submitting || !moreInfoMessage.trim()}
                      onClick={() => handleAction('more_info', { message: moreInfoMessage, requested_documents: requestedDocs })}
                    >
                      {submitting ? t('admin.sending') : t('adminKyb.send')}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* AI Expert Analysis */}
            {data.expert_analysis && (
              <Section title={t('adminKyb.expertAssessment')}>
                <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <p style={{ fontSize: 13.5, color: 'var(--ink)', lineHeight: 1.6, margin: 0 }}>
                    {data.expert_analysis.executive_summary}
                  </p>
                  {data.expert_analysis.risk_flags.length > 0 && (
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-red)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>{t('admin.riskFlags')}</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {data.expert_analysis.risk_flags.map((f, i) => (
                          <div key={i} style={{ fontSize: 13, color: 'var(--ink)' }}>• {f}</div>
                        ))}
                      </div>
                    </div>
                  )}
                  {data.expert_analysis.analyst_notes && (
                    <div style={{ fontSize: 12, color: 'var(--gray)', fontStyle: 'italic', borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                      {data.expert_analysis.analyst_notes}
                    </div>
                  )}
                </div>
              </Section>
            )}

            {/* Identity & Legal */}
            <Section title={t('adminKyb.identityLegal')}>
              <Row k={t('onboarding.field.legalName')} v={org.legal_name} />
              <Row k={t('onboarding.field.dba')} v={org.doing_business_as} />
              <Row k={t('onboarding.field.businessType')} v={org.business_type} />
              <Row k={t('onboarding.field.countryIncorp')} v={org.country_of_incorporation} />
              <Row k={t('adminKyb.stateProvince')} v={org.state_of_incorporation} />
              <Row k={t('onboarding.field.yearsOperation')} v={org.years_in_operation} />
              <Row k={t('adminKyb.industryNaics')} v={org.industry_naics} />
              <Row k={t('onboarding.field.website')} v={org.website} />
              <Row k={t('adminKyb.einTaxId')} v={org.ein} />
              <Row k={t('adminKyb.productsServices')} v={org.description} />
            </Section>

            {/* Address & Contact */}
            <Section title={t('adminKyb.addressContact')}>
              <Row k={t('onboarding.review.contact')} v={org.primary_contact_name} />
              <Row k={t('onboarding.field.title')} v={org.primary_contact_title} />
              <Row k={t('onboarding.review.phone')} v={org.primary_contact_phone} />
              <Row k={t('adminKyb.email')} v={org.primary_contact_email} />
              <Row k={t('onboarding.review.address')} v={[org.address_line1, org.address_line2].filter(Boolean).join(', ') || null} />
              <Row k={t('adminKyb.cityStateZip')} v={[org.city, org.state, org.zip].filter(Boolean).join(', ') || null} />
              <Row k={t('onboarding.field.country')} v={org.country} />
            </Section>

            {/* Ownership & Compliance */}
            <Section title={t('onboarding.review.ownershipCompliance')}>
              <Row k={t('onboarding.field.ceoName')} v={org.ceo_name} />
              <Row k={t('onboarding.review.beneficialOwners')} v={org.ubo_summary} />
              <Row k={t('adminKyb.pepFull')} v={yn(org.is_pep, t)} warn={org.is_pep === true} />
              <Row k={t('adminKyb.sanctionedExposureFull')} v={yn(org.has_sanctioned_exposure, t)} warn={org.has_sanctioned_exposure === true} />
              <Row k={t('adminKyb.bankruptcy7yFull')} v={yn(org.bankruptcy_filed, t)} warn={org.bankruptcy_filed === true} />
              <Row k={t('onboarding.review.materialLitigation')} v={yn(org.material_litigation, t)} warn={org.material_litigation === true} />
            </Section>

            {/* Financial & Trade */}
            <Section title={t('onboarding.review.financialTradeProfile')}>
              <Row k={t('onboarding.field.annualRevenue')} v={org.annual_revenue_range} />
              <Row k={t('adminKyb.employeeCount')} v={org.employee_count_range} />
              <Row k={t('onboarding.field.primaryCurrency')} v={org.primary_currency} />
              <Row k={t('onboarding.field.avgInvoiceSize')} v={org.avg_invoice_size} />
              <Row k={t('onboarding.field.countryOfOrigin')} v={org.country_of_origin} />
              <Row k={t('onboarding.field.sourcingCountries')} v={(org.sourcing_countries ?? []).join(', ') || null} />
              <Row k={t('onboarding.field.productCategories')} v={(org.product_categories ?? []).join(', ') || null} />
              {isSupplier ? (
                <>
                  <Row k={t('onboarding.field.customerCount')} v={org.customer_count} />
                  <Row k={t('onboarding.field.largestCustomerPct')} v={org.largest_customer_pct} />
                  <Row k={t('onboarding.field.financingNeed')} v={org.financing_need} />
                </>
              ) : (
                <>
                  <Row k={t('onboarding.field.supplierCount')} v={org.supplier_count} />
                  <Row k={t('onboarding.field.largestSupplierPct')} v={org.largest_supplier_pct} />
                  <Row k={t('onboarding.field.supplierPaymentTermsOffered')} v={org.supplier_payment_terms} />
                </>
              )}
              <Row k={t('onboarding.field.paymentTermsOffered')} v={org.payment_terms_offered} />
              <Row k={t('onboarding.field.paymentTermsReceived')} v={org.payment_terms_received} />
              <Row k={t('onboarding.field.paymentTermsPreference')} v={org.payment_terms_preference} />
            </Section>

            {/* Systems & Intent */}
            <Section title={t('onboarding.review.systemsIntent')}>
              <Row k={t('onboarding.field.erpSystem')} v={org.erp_system} />
              <Row k={t('onboarding.field.primaryBankName')} v={org.primary_bank_name} />
              <Row k={t('onboarding.field.platformIntent')} v={(org.platform_intent ?? []).join(', ') || null} />
              <Row k={t('adminKyb.aiMatchingOptIn')} v={yn(org.ai_matching_opt_in, t)} />
            </Section>

            {/* Bank Accounts */}
            <Section title={t('adminKyb.bankAccountsCount', { count: String(data.bank_accounts.length) })}>
              {data.bank_accounts.length === 0 ? (
                <div style={{ padding: '20px 24px', color: 'var(--gray)', fontSize: 13 }}>{t('adminKyb.noBankAccounts')}</div>
              ) : (
                data.bank_accounts.map(acc => (
                  <Row
                    key={acc.id}
                    k={acc.nickname || acc.bank_name || t('adminKyb.account')}
                    v={`${acc.bank_name ?? ''} · ${acc.account_type ?? ''} · ****${(acc.account_number ?? '').slice(-4)}${acc.is_primary ? ` · ${t('onboarding.misc.primary')}` : ''}`}
                  />
                ))
              )}
            </Section>

            {/* Documents */}
            <Section title={t('adminKyb.documentsCount', { count: String(data.documents.length) })}>
              {data.documents.length === 0 ? (
                <div style={{ padding: '20px 24px', color: 'var(--gray)', fontSize: 13 }}>{t('adminKyb.noDocuments')}</div>
              ) : (
                data.documents.map(doc => (
                  <div key={doc.id} className="kv-row">
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>
                        {DOC_KIND_LABELS[doc.document_kind ?? ''] ?? doc.document_kind ?? t('adminKyb.document')}
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--gray)', marginTop: 2 }}>{doc.name} · {fmtDate(doc.created_at)}</div>
                    </div>
                    {doc.signed_url ? (
                      <a href={doc.signed_url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm">{t('adminKyb.view')}</a>
                    ) : (
                      <span style={{ fontSize: 12, color: 'var(--gray)' }}>{t('adminKyb.unavailable')}</span>
                    )}
                  </div>
                ))
              )}
            </Section>

            {/* Decision history */}
            {data.decision_history.length > 0 && (
              <Section title={t('adminKyb.decisionHistory')}>
                {data.decision_history.map(d => (
                  <div key={d.id} className="kv-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                      <span className="k">{fmtDate(d.created_at)}</span>
                      <span className="v plain" style={{ textTransform: 'capitalize' }}>
                        {d.decision.replace(/_/g, ' ')}{d.decided_by_user_name ? ` ${t('adminKyb.byUser', { name: d.decided_by_user_name })}` : ''}{d.score_at_decision != null ? ` ${t('adminKyb.scoreSuffix', { score: d.score_at_decision })}` : ''}
                      </span>
                    </div>
                    {d.rejection_reason && (
                      <div style={{ fontSize: 12, color: 'var(--gray)' }}>{t('adminKyb.reasonPrefix')} {d.rejection_reason}</div>
                    )}
                    {d.info_request_message && (
                      <div style={{ fontSize: 12, color: 'var(--gray)' }}>{t('adminKyb.messagePrefix')} {d.info_request_message}</div>
                    )}
                    {(d.requested_documents ?? []).length > 0 && (
                      <div style={{ fontSize: 12, color: 'var(--gray)' }}>
                        {t('adminKyb.requestedPrefix')} {(d.requested_documents ?? []).map(k => DOC_KIND_LABELS[k] ?? k).join(', ')}
                      </div>
                    )}
                  </div>
                ))}
              </Section>
            )}
          </>
        )}
      </div>
    </>
  )
}
