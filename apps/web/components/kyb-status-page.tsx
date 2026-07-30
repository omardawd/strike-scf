'use client'
import React, { useState, useEffect, useCallback, useRef } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useUser } from '@/lib/user-context'
import { DOC_KIND_LABELS } from '@/lib/kyb-document-kinds'
import { useT } from '@/lib/i18n/locale-context'

type TFn = (key: string, vars?: Record<string, string | number>) => string

interface StatusOrg {
  id: string
  legal_name: string | null
  doing_business_as: string | null
  type: string
  business_type: string | null
  country_of_incorporation: string | null
  industry_naics: string | null
  years_in_operation: string | null
  primary_contact_name: string | null
  primary_contact_email: string | null
  kyb_status: string
  kyb_submitted_at: string | null
  passport_score: number | null
}

interface MoreInfo {
  message: string | null
  requested_documents: string[]
  requested_at: string | null
  uploaded_document_kinds: string[]
}

interface Rejection {
  reason: string | null
  decided_at: string
}

interface StatusData {
  organization: StatusOrg
  more_info: MoreInfo | null
  rejection: Rejection | null
}

function fmtDate(ts: string | null): string {
  if (!ts) return '—'
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function Chrome({ children }: { children: React.ReactNode }) {
  const t = useT()
  const router = useRouter()
  function handleSignOut() {
    const supabase = createClient()
    supabase.auth.signOut().then(() => router.push('/login')).catch(() => router.push('/login'))
  }
  return (
    <div style={{ minHeight: '100vh', background: 'var(--offwhite)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 28px' }}>
        <Image src="/logo.png" alt="Strike SCF" width={120} height={36} style={{ objectFit: 'contain', height: 'auto' }} priority />
        <button type="button" className="btn btn-ghost btn-sm" onClick={handleSignOut}>{t('userMenu.signOut')}</button>
      </div>
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '20px 20px 60px' }}>
        {children}
      </div>
    </div>
  )
}

function DocRow({
  kind,
  alreadyUploaded,
  orgId,
  onUploaded,
}: {
  kind: string
  alreadyUploaded: boolean
  orgId: string
  onUploaded: (kind: string) => void
}) {
  const t = useT()
  const inputRef = useRef<HTMLInputElement>(null)
  const [state, setState] = useState<'idle' | 'uploading' | 'done' | 'error'>(alreadyUploaded ? 'done' : 'idle')
  const [error, setError] = useState<string | null>(null)

  async function handleFile(file: File) {
    setState('uploading')
    setError(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('org_id', orgId)
      formData.append('document_kind', kind)
      const res = await fetch('/api/onboarding/documents', { method: 'POST', body: formData })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error ?? t('onboarding.misc.uploadFailed'))
        setState('error')
        return
      }
      setState('done')
      onUploaded(kind)
    } catch {
      setError(t('onboarding.misc.uploadFailed'))
      setState('error')
    }
  }

  const done = state === 'done'
  const uploading = state === 'uploading'

  return (
    <div style={{ marginBottom: 10 }}>
      <div
        onClick={() => !uploading && inputRef.current?.click()}
        className="upload-zone"
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 14,
          textAlign: 'left',
          cursor: uploading ? 'default' : 'pointer',
          padding: '14px 16px',
          borderColor: done ? 'var(--color-green)' : 'var(--color-border-strong)',
          background: done ? 'var(--color-green-bg)' : 'var(--color-bg-2)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <div
            style={{
              width: 32, height: 32, flexShrink: 0, borderRadius: 'var(--radius-sm)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: done ? 'var(--color-green)' : 'var(--color-card)',
              border: done ? 'none' : '1px solid var(--color-border)',
              color: done ? '#fff' : 'var(--color-ink-3)',
            }}
          >
            {done ? '✓' : '↑'}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--ink)' }}>{DOC_KIND_LABELS[kind] ?? kind}</div>
            {error && <div style={{ fontSize: 11.5, color: 'var(--color-red)' }}>{error}</div>}
          </div>
        </div>
        <span className="btn btn-secondary btn-sm" style={{ flexShrink: 0, pointerEvents: 'none' }}>
          {uploading ? t('onboarding.misc.uploading') : done ? t('onboarding.misc.replace') : t('onboarding.misc.upload')}
        </span>
      </div>
      <input
        ref={inputRef}
        type="file"
        style={{ display: 'none' }}
        onChange={e => {
          const file = e.target.files?.[0]
          if (file) handleFile(file)
          e.target.value = ''
        }}
      />
    </div>
  )
}

function ProfileSummary({ org, t }: { org: StatusOrg; t: TFn }) {
  const name = org.doing_business_as || org.legal_name || t('onboarding.review.yourOrganization')
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-head">{t('kybStatus.yourSubmission')}</div>
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div className="kv-row"><span className="k">{t('kybStatus.organization')}</span><span className="v plain">{name}</span></div>
        <div className="kv-row"><span className="k">{t('kybStatus.type')}</span><span className="v plain" style={{ textTransform: 'capitalize' }}>{org.type}</span></div>
        <div className="kv-row"><span className="k">{t('onboarding.field.businessType')}</span><span className="v plain">{org.business_type ?? '—'}</span></div>
        <div className="kv-row"><span className="k">{t('onboarding.field.countryIncorp')}</span><span className="v plain">{org.country_of_incorporation ?? '—'}</span></div>
        <div className="kv-row"><span className="k">{t('onboarding.field.industry')}</span><span className="v plain">{org.industry_naics ?? '—'}</span></div>
        <div className="kv-row"><span className="k">{t('kybStatus.primaryContact')}</span><span className="v plain">{org.primary_contact_name ?? '—'}</span></div>
        <div className="kv-row"><span className="k">{t('kybStatus.submitted')}</span><span className="v plain">{fmtDate(org.kyb_submitted_at)}</span></div>
      </div>
    </div>
  )
}

export function KybStatusPage() {
  const t = useT()
  const router = useRouter()
  const user = useUser()
  const [data, setData] = useState<StatusData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [uploadedKinds, setUploadedKinds] = useState<string[]>([])
  const [resubmitted, setResubmitted] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/kyb/status')
      const body = await res.json()
      if (!res.ok) { setError(body.error ?? t('kybStatus.loadFailed')); return }
      setData(body)
      setUploadedKinds(body.more_info?.uploaded_document_kinds ?? [])
    } catch {
      setError(t('kybStatus.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => { load() }, [load])

  async function handleResubmit() {
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/kyb/status', { method: 'POST' })
      const body = await res.json()
      if (!res.ok) { setError(body.error ?? t('kybStatus.resubmitFailed')); return }
      setResubmitted(true)
    } catch {
      setError(t('common.networkError'))
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <Chrome>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="mp-skeleton-card" style={{ height: 100 }} />
          <div className="mp-skeleton-card" style={{ height: 220 }} />
        </div>
      </Chrome>
    )
  }

  if (error && !data) {
    return (
      <Chrome>
        <div className="card" style={{ padding: 20, color: 'var(--color-red)' }}>{error}</div>
      </Chrome>
    )
  }

  if (!data) return <Chrome><></></Chrome>

  const { organization: org, more_info: moreInfo, rejection } = data
  const kyb = org.kyb_status
  const requestedDocs = moreInfo?.requested_documents ?? []
  const allRequestedDocsUploaded = requestedDocs.every(k => uploadedKinds.includes(k))

  // ── Not started / in progress ──────────────────────────────────────────
  if (kyb === 'not_started' || kyb === 'in_progress') {
    return (
      <Chrome>
        <div className="card" style={{ padding: 32, textAlign: 'center' }}>
          <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--ink)', marginBottom: 8 }}>
            {kyb === 'in_progress' ? t('kybStatus.continueTitle') : t('kybStatus.activateTitle')}
          </div>
          <p style={{ fontSize: 13.5, color: 'var(--gray)', margin: '0 0 20px', lineHeight: 1.6 }}>
            {t('kybStatus.activateBody')}
          </p>
          <button type="button" className="btn btn-blue" onClick={() => router.push('/onboarding')}>
            {kyb === 'in_progress' ? t('kybStatus.continueBtn') : t('kybStatus.startBtn')}
          </button>
        </div>
      </Chrome>
    )
  }

  // ── Rejected ────────────────────────────────────────────────────────────
  if (kyb === 'rejected') {
    return (
      <Chrome>
        <div className="card" style={{ marginBottom: 16, borderColor: 'var(--color-red)', background: 'var(--color-red-bg)' }}>
          <div className="card-body">
            <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-red)', marginBottom: 6 }}>
              {t('kybStatus.rejectedTitle')}
            </div>
            <p style={{ fontSize: 13.5, color: 'var(--ink)', lineHeight: 1.6, margin: 0 }}>
              {rejection?.reason || t('kybStatus.rejectedFallback')}
            </p>
          </div>
        </div>
        <ProfileSummary org={org} t={t} />
        <p style={{ fontSize: 12.5, color: 'var(--gray)', textAlign: 'center' }}>
          {t('kybStatus.rejectedContact')} <a href="mailto:support@strikescf.com" style={{ color: 'var(--blue)' }}>support@strikescf.com</a>.
        </p>
      </Chrome>
    )
  }

  // ── More info requested ─────────────────────────────────────────────────
  if (kyb === 'more_info_requested') {
    if (resubmitted) {
      return (
        <Chrome>
          <div className="card" style={{ padding: 32, textAlign: 'center' }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-green)', marginBottom: 6 }}>{t('kybStatus.submittedTitle')}</div>
            <p style={{ fontSize: 13, color: 'var(--gray)', margin: 0 }}>{t('kybStatus.submittedBody')}</p>
          </div>
        </Chrome>
      )
    }
    return (
      <Chrome>
        <div className="page-header" style={{ marginBottom: 16 }}>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em', margin: 0 }}>
            {t('kybStatus.moreInfoTitle')}
          </h1>
          <p className="subtitle">{t('kybStatus.moreInfoSubtitle', { date: fmtDate(moreInfo?.requested_at ?? null) })}</p>
        </div>

        <div className="card" style={{ marginBottom: 16, borderColor: 'var(--color-amber)', background: 'var(--color-amber-bg)' }}>
          <div className="card-body">
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-amber)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
              {t('kybStatus.messageFromStrike')}
            </div>
            <p style={{ fontSize: 13.5, color: 'var(--ink)', lineHeight: 1.6, margin: 0 }}>{moreInfo?.message}</p>
          </div>
        </div>

        {requestedDocs.length > 0 && (
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-head">{t('kybStatus.requestedDocuments')}</div>
            <div className="card-body">
              {requestedDocs.map(kind => (
                <DocRow
                  key={kind}
                  kind={kind}
                  orgId={org.id}
                  alreadyUploaded={uploadedKinds.includes(kind)}
                  onUploaded={k => setUploadedKinds(prev => Array.from(new Set([...prev, k])))}
                />
              ))}
            </div>
          </div>
        )}

        {error && (
          <div className="alert alert-error" style={{ marginBottom: 16 }}>
            <span className="alert-body">{error}</span>
          </div>
        )}

        <button
          className="btn btn-blue"
          style={{ width: '100%' }}
          disabled={submitting || (requestedDocs.length > 0 && !allRequestedDocsUploaded)}
          onClick={handleResubmit}
        >
          {submitting ? t('kybStatus.submitting') : t('kybStatus.resubmit')}
        </button>
        {requestedDocs.length > 0 && !allRequestedDocsUploaded && (
          <p style={{ fontSize: 11.5, color: 'var(--gray)', textAlign: 'center', marginTop: 8 }}>
            {t('kybStatus.uploadAllHint')}
          </p>
        )}
      </Chrome>
    )
  }

  // ── Submitted / under review (default) ───────────────────────────────────
  return (
    <Chrome>
      <div className="card" style={{ marginBottom: 16, borderColor: 'var(--blue)', background: 'var(--color-accent-light)' }}>
        <div className="card-body">
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)', marginBottom: 6 }}>
            {t('kybStatus.reviewingTitle')}
          </div>
          <p style={{ fontSize: 13.5, color: 'var(--color-ink-3)', lineHeight: 1.6, margin: 0 }}>
            {t('kybStatus.reviewingBody', {
              greeting: user?.full_name ? `, ${user.full_name.split(' ')[0]}` : '',
              org: org.doing_business_as || org.legal_name || t('onboarding.review.yourOrganization'),
            })}
          </p>
        </div>
      </div>
      <ProfileSummary org={org} t={t} />
    </Chrome>
  )
}
