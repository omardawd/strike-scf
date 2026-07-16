'use client'
// Financing management — contract signature → disbursement → confirm receipt.
// Shared between the financing detail page and the deal detail page (bank view).
import React, { useState, useEffect } from 'react'
import { calcFinancingFees, calcNetDisbursement } from '@/lib/deals/fees'

function fmtAmt(n: number | null | undefined, currency = 'USD'): string {
  if (n == null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n)
}

export interface ManagementTransaction {
  id: string
  status: string
  bank_id: string | null
  financing_amount_approved?: number | null
  financing_rate_apr?: number | null
  tenor_days?: number | null
  esign_document_id: string | null
  bank_signed_at: string | null
  anchor_signed_at: string | null
  supplier_signed_at: string | null
  esign_completed_at: string | null
  disbursed_at: string | null
  disbursed_by_user_id: string | null
  disbursement_reference: string | null
  supplier_paid_at: string | null
}

export interface RequesterBankAccount {
  nickname: string | null
  bank_name: string
  account_holder_name: string
  account_number: string
  routing_number: string | null
  swift_iban: string | null
  account_type: string | null
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

async function readJsonSafe<T = Record<string, unknown>>(res: Response): Promise<T & { error?: string }> {
  try { return await res.json() }
  catch { return { error: `Request failed (${res.status})` } as T & { error?: string } }
}

function ContractDocumentLink({ documentId }: { documentId: string }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    fetch(`/api/documents/${documentId}/url`).then(r => r.json()).then(d => { if (d.url) setUrl(d.url) }).catch(() => {})
  }, [documentId])
  if (!url) return <span style={{ fontSize: 12.5, color: 'var(--gray)' }}>Loading contract…</span>
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 1h6l4 4v10H4V1z"/><path d="M10 1v4h4"/>
      </svg>
      View Contract
    </a>
  )
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path d="M3.5 8.5L6.5 11.5L12.5 5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

function StepCircle({ n, done, active }: { n: number; done: boolean; active: boolean }) {
  return (
    <div style={{
      width: 32, height: 32, borderRadius: '50%',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 13, fontWeight: 700, flexShrink: 0,
      border: done ? '2px solid var(--color-green)' : active ? '2px solid var(--blue)' : '2px solid var(--border-strong)',
      background: done ? 'var(--color-green)' : active ? 'var(--blue)' : 'var(--white)',
      color: done || active ? '#fff' : 'var(--gray)',
      boxShadow: active ? '0 0 0 4px rgba(20,40,204,0.1)' : 'none',
      zIndex: 1,
    }}>
      {done ? <CheckIcon /> : n}
    </div>
  )
}

export function FinancingManagementCard({
  requestId,
  transaction,
  requesterBankAccount,
  isBank,
  isRequester,
  isRequesterBuyer,
  onReload,
  embedded,
  financingAmount = null,
  currency = 'USD',
}: {
  requestId: string
  transaction: ManagementTransaction | null
  requesterBankAccount: RequesterBankAccount | null
  isBank: boolean
  isRequester: boolean
  isRequesterBuyer: boolean
  onReload: () => void
  embedded?: boolean
  financingAmount?: number | null
  currency?: string
}) {
  const { requesterFee, bankFee } = calcFinancingFees(financingAmount)
  const netDisbursement = calcNetDisbursement(financingAmount, requesterFee)
  const [generating, setGenerating]   = useState(false)
  const [contractMode, setContractMode] = useState<'ai' | 'upload'>('ai')
  const [contractFile, setContractFile] = useState<File | null>(null)
  const [uploading, setUploading]     = useState(false)
  const [previewText, setPreviewText]   = useState<string>('')
  const [previewDocId, setPreviewDocId] = useState<string | null>(null)
  const [submittingPreview, setSubmittingPreview] = useState(false)
  const [signature, setSignature]     = useState('')
  const [signing, setSigning]         = useState(false)
  const [reference, setReference]     = useState('')
  const [disbursing, setDisbursing]   = useState(false)
  const [confirming, setConfirming]   = useState(false)
  const [error, setError]             = useState<string | null>(null)

  const requesterSignedAt = transaction
    ? (isRequesterBuyer ? transaction.anchor_signed_at : transaction.supplier_signed_at)
    : null

  // Derived step states
  const step1Done   = !!transaction?.esign_completed_at
  const step1Active = !step1Done
  const step2Done   = !!transaction?.disbursed_at
  const step2Active = step1Done && !step2Done
  const step3Done   = !!transaction?.supplier_paid_at
  const step3Active = step2Done && !step3Done

  async function postContract(body: { generate?: boolean; contract_document_id?: string }): Promise<boolean> {
    const res = await fetch(`/api/marketplace/financing/${requestId}/contract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = await readJsonSafe(res)
    if (!res.ok) { setError(json.error ?? 'Failed to submit contract'); return false }
    onReload(); return true
  }

  async function submitContract() {
    setError(null)
    if (contractMode === 'upload') {
      if (!contractFile) { setError('Please select a contract document'); return }
      setUploading(true)
      try {
        const fd = new FormData()
        fd.append('file', contractFile)
        const uploadRes = await fetch(`/api/marketplace/financing/${requestId}/upload-document`, { method: 'POST', body: fd })
        const uploadJson = await readJsonSafe<{ document?: { id: string } }>(uploadRes)
        if (!uploadRes.ok || !uploadJson.document) { setError(uploadJson.error ?? 'Upload failed'); return }
        await postContract({ contract_document_id: uploadJson.document.id })
      } catch { setError('Network error — failed to upload contract') }
      finally { setUploading(false) }
      return
    }
    // AI mode — generate a draft and show it before it's actually sent to the
    // borrower, same as the buyer/supplier trade contract flow on the deal page.
    setGenerating(true)
    try {
      const res = await fetch(`/api/marketplace/financing/${requestId}/contract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preview: true }),
      })
      const json = await readJsonSafe<{ document_id?: string; content?: string }>(res)
      if (!res.ok) { setError(json.error ?? 'Failed to generate contract'); return }
      setPreviewText(json.content ?? '')
      setPreviewDocId(json.document_id ?? null)
    } catch { setError('Network error — failed to generate contract') }
    finally { setGenerating(false) }
  }

  async function confirmPreview() {
    if (!previewDocId) return
    setSubmittingPreview(true)
    try {
      const ok = await postContract({ contract_document_id: previewDocId })
      if (ok) { setPreviewText(''); setPreviewDocId(null) }
    } finally { setSubmittingPreview(false) }
  }

  async function signContract() {
    if (!signature.trim()) { setError('Signature is required'); return }
    setSigning(true); setError(null)
    try {
      const res = await fetch(`/api/marketplace/financing/${requestId}/contract`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signature: signature.trim() }),
      })
      const json = await readJsonSafe(res)
      if (!res.ok) { setError(json.error ?? 'Failed to sign contract'); return }
      onReload()
    } catch { setError('Network error — failed to sign contract') }
    finally { setSigning(false) }
  }

  async function disburse() {
    if (!transaction) return
    setDisbursing(true); setError(null)
    try {
      const res = await fetch(`/api/transactions/${transaction.id}/disburse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ disbursement_reference: reference.trim() || undefined }),
      })
      const json = await readJsonSafe(res)
      if (!res.ok) { setError(json.error ?? 'Failed to disburse'); return }
      onReload()
    } catch { setError('Network error — failed to disburse') }
    finally { setDisbursing(false) }
  }

  async function confirmReceived() {
    setConfirming(true); setError(null)
    try {
      const res = await fetch(`/api/marketplace/financing/${requestId}/confirm-received`, { method: 'POST' })
      const json = await readJsonSafe(res)
      if (!res.ok) { setError(json.error ?? 'Failed to confirm receipt'); return }
      onReload()
    } catch { setError('Network error — failed to confirm receipt') }
    finally { setConfirming(false) }
  }

  const content = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {error && (
        <div className="alert alert-error" style={{ fontSize: 13, marginBottom: 16 }}>{error}</div>
      )}

      {/* Financing summary strip */}
      {financingAmount != null && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: isBank ? '1fr 1fr' : '1fr 1fr 1fr',
          gap: 1,
          background: 'var(--border)',
          borderRadius: 'var(--radius-sm)',
          overflow: 'hidden',
          marginBottom: 28,
        }}>
          {[
            { label: 'Financed Amount', value: fmtAmt(financingAmount, currency), highlight: false },
            { label: isBank ? 'Your Fee (0.15%)' : 'Strike Service Fee', value: fmtAmt(isBank ? bankFee : requesterFee, currency), highlight: false },
            ...(!isBank ? [{ label: "Net You'll Receive", value: fmtAmt(netDisbursement, currency), highlight: true }] : []),
          ].map((cell, i) => (
            <div key={i} style={{
              background: 'var(--white)', padding: '14px 18px',
              display: 'flex', flexDirection: 'column', gap: 4,
            }}>
              <div style={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--gray)' }}>
                {cell.label}
              </div>
              <div style={{
                fontFamily: 'var(--font-display)',
                fontSize: 18, fontWeight: 700,
                letterSpacing: '-0.02em',
                color: cell.highlight ? 'var(--blue)' : 'var(--ink)',
              }}>
                {cell.value}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Steps */}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {/* Step 1: Contract */}
        <div style={{ display: 'grid', gridTemplateColumns: '32px 1fr', gap: 16, position: 'relative', paddingBottom: 28 }}>
          {/* connector */}
          <div style={{ position: 'absolute', left: 15, top: 36, bottom: 0, width: 2, background: step1Done ? 'var(--color-green)' : 'var(--border)' }} />
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <StepCircle n={1} done={step1Done} active={step1Active} />
          </div>
          <div style={{ paddingTop: 4 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: step1Active ? 'var(--ink)' : step1Done ? 'var(--color-ink-2)' : 'var(--gray)', marginBottom: 2 }}>
              Financing Contract
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--gray)', marginBottom: 14 }}>
              {step1Done ? `Fully executed · ${fmtDate(transaction?.esign_completed_at)}` : 'Sign the financing agreement to proceed.'}
            </div>

            {!transaction?.esign_document_id ? (
              isBank ? (
                previewDocId ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>Contract Preview</span>
                      <span className="badge badge-active" style={{ fontSize: 9, fontFamily: 'var(--font-body)', textTransform: 'none', letterSpacing: 0 }}>AI Generated</span>
                    </div>
                    <div style={{ maxHeight: 320, overflowY: 'auto', padding: '14px 16px', background: 'var(--offwhite)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12.5, lineHeight: 1.6, whiteSpace: 'pre-wrap', fontFamily: 'var(--font-mono)' }}>
                      {previewText}
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn btn-blue btn-sm" disabled={submittingPreview} onClick={confirmPreview}>
                        {submittingPreview ? 'Sending…' : 'Send to Borrower'}
                      </button>
                      <button className="btn btn-ghost btn-sm" disabled={submittingPreview} onClick={() => { setPreviewText(''); setPreviewDocId(null) }}>
                        Discard & Regenerate
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button type="button" className={`btn btn-sm ${contractMode === 'ai' ? 'btn-blue' : 'btn-ghost'}`} onClick={() => setContractMode('ai')}>
                        AI Generate
                      </button>
                      <button type="button" className={`btn btn-sm ${contractMode === 'upload' ? 'btn-blue' : 'btn-ghost'}`} onClick={() => setContractMode('upload')}>
                        Upload PDF
                      </button>
                    </div>
                    {contractMode === 'ai' ? (
                      <div style={{ padding: '10px 14px', background: 'var(--offwhite)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12.5, lineHeight: 1.6, color: 'var(--gray)' }}>
                        Strike AI will draft a financing agreement from this request's terms. You'll see a full preview before it's sent to the borrower.
                      </div>
                    ) : (
                      <div className="form-field">
                        <label className="field-label">Contract Document</label>
                        <input className="input" type="file" accept=".pdf,.doc,.docx,.txt" style={{ paddingTop: 6 }} onChange={e => setContractFile(e.target.files?.[0] ?? null)} />
                        {contractFile && <div style={{ fontSize: 11.5, color: 'var(--gray)', marginTop: 4 }}>{contractFile.name}</div>}
                      </div>
                    )}
                    <button className="btn btn-blue btn-sm" disabled={generating || uploading || (contractMode === 'upload' && !contractFile)} onClick={submitContract} style={{ alignSelf: 'flex-start' }}>
                      {uploading ? 'Uploading…' : generating ? 'Generating…' : contractMode === 'ai' ? 'Generate Preview' : 'Submit Contract'}
                    </button>
                  </div>
                )
              ) : (
                <div style={{ fontSize: 13, color: 'var(--gray)', fontStyle: 'italic' }}>Waiting for the bank to issue the financing contract.</div>
              )
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <ContractDocumentLink documentId={transaction.esign_document_id} />
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 12.5 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: transaction.bank_signed_at ? 'var(--color-green)' : 'var(--gray)' }}>
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3.5 8.5L6.5 11.5L12.5 5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    Bank signed {transaction.bank_signed_at ? fmtDate(transaction.bank_signed_at) : '(pending)'}
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: requesterSignedAt ? 'var(--color-green)' : 'var(--gray)' }}>
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3.5 8.5L6.5 11.5L12.5 5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    Borrower signed {requesterSignedAt ? fmtDate(requesterSignedAt) : '(pending)'}
                  </span>
                </div>
              </div>
            )}

            {transaction?.esign_document_id && !requesterSignedAt && isRequester && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14, padding: '14px 16px', background: 'var(--blue-light)', border: '1px solid rgba(20,40,204,0.18)', borderRadius: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--blue)', marginBottom: 2 }}>Sign the contract</div>
                <div className="form-field">
                  <label className="field-label">Type your full legal name</label>
                  <input className="input" type="text" value={signature} onChange={e => setSignature(e.target.value)} placeholder="Your full legal name" />
                  <div style={{ fontSize: 11.5, color: 'var(--gray)', marginTop: 4 }}>By typing your name you electronically sign this contract.</div>
                </div>
                <button className="btn btn-blue btn-sm" disabled={signing || !signature.trim()} onClick={signContract} style={{ alignSelf: 'flex-start' }}>
                  {signing ? 'Signing…' : 'Sign & Execute'}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Step 2: Disbursement */}
        <div style={{ display: 'grid', gridTemplateColumns: '32px 1fr', gap: 16, position: 'relative', paddingBottom: 28 }}>
          <div style={{ position: 'absolute', left: 15, top: 36, bottom: 0, width: 2, background: step2Done ? 'var(--color-green)' : 'var(--border)' }} />
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <StepCircle n={2} done={step2Done} active={step2Active} />
          </div>
          <div style={{ paddingTop: 4 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: step2Active ? 'var(--ink)' : step2Done ? 'var(--color-ink-2)' : 'var(--gray)', marginBottom: 2 }}>
              Disbursement
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--gray)', marginBottom: 14 }}>
              {step2Done ? `Funds sent · ${fmtDate(transaction?.disbursed_at)}${transaction?.disbursement_reference ? ` · Ref: ${transaction.disbursement_reference}` : ''}` : 'Bank wires funds after contract is executed.'}
            </div>

            {!transaction?.esign_document_id ? (
              <div style={{ fontSize: 13, color: 'var(--gray-soft)', fontStyle: 'italic' }}>Awaiting contract execution.</div>
            ) : !transaction.disbursed_at ? (
              !transaction.esign_completed_at ? (
                <div style={{ fontSize: 13, color: 'var(--gray-soft)', fontStyle: 'italic' }}>Awaiting signatures from both parties.</div>
              ) : isBank ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {requesterBankAccount ? (
                    <div style={{
                      padding: '12px 16px',
                      background: 'var(--offwhite)',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      display: 'flex', flexDirection: 'column', gap: 6,
                    }}>
                      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--gray)', marginBottom: 4 }}>Receiving account</div>
                      {[
                        { k: 'Bank', v: requesterBankAccount.bank_name },
                        { k: 'Account Holder', v: requesterBankAccount.account_holder_name },
                        { k: 'Account No.', v: `****${requesterBankAccount.account_number.slice(-4)}`, mono: true },
                        ...(requesterBankAccount.swift_iban || requesterBankAccount.routing_number
                          ? [{ k: 'Routing / SWIFT', v: requesterBankAccount.swift_iban ?? requesterBankAccount.routing_number ?? '', mono: true }]
                          : []),
                        ...(netDisbursement != null ? [{ k: 'Net Amount to Wire', v: fmtAmt(netDisbursement, currency), bold: true }] : []),
                      ].map((row, i) => (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                          <span style={{ color: 'var(--gray)' }}>{row.k}</span>
                          <span style={{ fontFamily: (row as any).mono ? 'var(--font-mono)' : 'inherit', fontWeight: (row as any).bold ? 700 : 500, color: (row as any).bold ? 'var(--blue)' : 'var(--ink)' }}>{row.v}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ fontSize: 13, color: 'var(--color-amber)', padding: '10px 14px', background: 'var(--color-amber-bg)', borderRadius: 8 }}>
                      The borrower hasn't added a bank account yet. Disbursement cannot proceed until they do.
                    </div>
                  )}
                  <div className="form-field">
                    <label className="field-label">Payment Reference (optional)</label>
                    <input className="input" type="text" value={reference} onChange={e => setReference(e.target.value)} placeholder="Wire/payment reference" />
                  </div>
                  <button className="btn btn-blue btn-sm" disabled={disbursing || !requesterBankAccount} onClick={disburse} style={{ alignSelf: 'flex-start' }}>
                    {disbursing ? 'Sending…' : 'Confirm Disbursement'}
                  </button>
                </div>
              ) : (
                <div style={{ fontSize: 13, color: 'var(--gray)', fontStyle: 'italic' }}>Waiting for the bank to disburse funds.</div>
              )
            ) : null}
          </div>
        </div>

        {/* Step 3: Confirm receipt */}
        <div style={{ display: 'grid', gridTemplateColumns: '32px 1fr', gap: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <StepCircle n={3} done={step3Done} active={step3Active} />
          </div>
          <div style={{ paddingTop: 4 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: step3Active ? 'var(--ink)' : step3Done ? 'var(--color-ink-2)' : 'var(--gray)', marginBottom: 2 }}>
              Confirm Receipt
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--gray)', marginBottom: 14 }}>
              {step3Done ? `Funds confirmed received · ${fmtDate(transaction?.supplier_paid_at)}` : 'Confirm once the funds arrive in your account.'}
            </div>

            {!transaction?.disbursed_at ? (
              <div style={{ fontSize: 13, color: 'var(--gray-soft)', fontStyle: 'italic' }}>Awaiting disbursement.</div>
            ) : !transaction.supplier_paid_at ? (
              isRequester ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ fontSize: 13, color: 'var(--gray)', lineHeight: 1.5 }}>
                    Once the funds arrive in your account, click below to confirm receipt and complete the financing.
                  </div>
                  <button className="btn btn-blue btn-sm" disabled={confirming} onClick={confirmReceived} style={{ alignSelf: 'flex-start' }}>
                    {confirming ? 'Confirming…' : 'Confirm Receipt'}
                  </button>
                </div>
              ) : (
                <div style={{ fontSize: 13, color: 'var(--gray)', fontStyle: 'italic' }}>Waiting for the borrower to confirm receipt of funds.</div>
              )
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )

  if (embedded) return content

  return (
    <div className="card">
      <div className="card-head" style={{ gap: 8 }}>
        <span>Financing Management</span>
        {step1Done && step2Done && step3Done && <span className="badge badge-funded">Complete</span>}
        {(step1Done || step2Done) && !step3Done && <span className="badge badge-active">In Progress</span>}
      </div>
      <div className="card-body">{content}</div>
    </div>
  )
}
