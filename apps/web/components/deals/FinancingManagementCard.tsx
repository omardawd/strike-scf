'use client'
// Financing management — contract signature → disbursement → confirm receipt.
// Shared between the financing detail page and the deal detail page (bank view).
import React, { useState, useEffect } from 'react'

export interface ManagementTransaction {
  id: string
  status: string
  bank_id: string | null
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
  try {
    return await res.json()
  } catch {
    return { error: `Request failed (${res.status})` } as T & { error?: string }
  }
}

function ContractDocumentLink({ documentId }: { documentId: string }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    fetch(`/api/documents/${documentId}/url`).then(r => r.json()).then(d => { if (d.url) setUrl(d.url) }).catch(() => {})
  }, [documentId])
  if (!url) return <span style={{ fontSize: 12, color: 'var(--gray)' }}>Loading contract…</span>
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, alignSelf: 'flex-start' }}>
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 1h6l4 4v10H4V1z"/><path d="M10 1v4h4"/></svg>
      View / Download Contract
    </a>
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
}: {
  requestId: string
  transaction: ManagementTransaction | null
  requesterBankAccount: RequesterBankAccount | null
  isBank: boolean
  isRequester: boolean
  isRequesterBuyer: boolean
  onReload: () => void
  embedded?: boolean
}) {
  const [generating, setGenerating] = useState(false)
  const [contractMode, setContractMode] = useState<'ai' | 'upload'>('ai')
  const [contractFile, setContractFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [signature, setSignature]   = useState('')
  const [signing, setSigning]       = useState(false)
  const [reference, setReference]   = useState('')
  const [disbursing, setDisbursing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError]           = useState<string | null>(null)

  const requesterSignedAt = transaction
    ? (isRequesterBuyer ? transaction.anchor_signed_at : transaction.supplier_signed_at)
    : null

  async function postContract(body: { generate?: boolean; contract_document_id?: string }): Promise<boolean> {
    const res = await fetch(`/api/marketplace/financing/${requestId}/contract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = await readJsonSafe(res)
    if (!res.ok) { setError(json.error ?? 'Failed to submit contract'); return false }
    onReload()
    return true
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
      } catch {
        setError('Network error — failed to upload contract')
      } finally {
        setUploading(false)
      }
      return
    }

    setGenerating(true)
    try {
      await postContract({ generate: true })
    } catch {
      setError('Network error — failed to submit contract')
    } finally {
      setGenerating(false)
    }
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
    } catch {
      setError('Network error — failed to sign contract')
    } finally {
      setSigning(false)
    }
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
    } catch {
      setError('Network error — failed to disburse')
    } finally {
      setDisbursing(false)
    }
  }

  async function confirmReceived() {
    setConfirming(true); setError(null)
    try {
      const res = await fetch(`/api/marketplace/financing/${requestId}/confirm-received`, { method: 'POST' })
      const json = await readJsonSafe(res)
      if (!res.ok) { setError(json.error ?? 'Failed to confirm receipt'); return }
      onReload()
    } catch {
      setError('Network error — failed to confirm receipt')
    } finally {
      setConfirming(false)
    }
  }

  const content = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {error && <div className="alert alert-error" style={{ fontSize: 12 }}>{error}</div>}

        {/* Step 1: Contract */}
        <div>
          <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--gray)', marginBottom: 10 }}>
            Step 1 · Financing Contract
          </div>

          {!transaction?.esign_document_id ? (
            isBank ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    type="button"
                    className={`btn btn-sm ${contractMode === 'ai' ? 'btn-blue' : 'btn-ghost'}`}
                    onClick={() => setContractMode('ai')}
                  >
                    AI Generate
                  </button>
                  <button
                    type="button"
                    className={`btn btn-sm ${contractMode === 'upload' ? 'btn-blue' : 'btn-ghost'}`}
                    onClick={() => setContractMode('upload')}
                  >
                    Upload Document
                  </button>
                </div>
                {contractMode === 'ai' ? (
                  <div style={{ padding: '10px 14px', background: 'var(--offwhite)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, lineHeight: 1.6, color: 'var(--gray)' }}>
                    Strike AI will draft a financing agreement from this request's terms. The borrower will receive it to review and sign.
                  </div>
                ) : (
                  <div className="form-field">
                    <label className="field-label">Contract Document *</label>
                    <input
                      className="input"
                      type="file"
                      accept=".pdf,.doc,.docx,.txt"
                      style={{ paddingTop: 6 }}
                      onChange={e => setContractFile(e.target.files?.[0] ?? null)}
                    />
                    {contractFile && <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 4 }}>{contractFile.name}</div>}
                  </div>
                )}
                <button
                  className="btn btn-blue btn-sm"
                  disabled={generating || uploading || (contractMode === 'upload' && !contractFile)}
                  onClick={submitContract}
                  style={{ alignSelf: 'flex-start' }}
                >
                  {uploading ? 'Uploading…' : generating ? 'Generating…' : 'Submit Contract'}
                </button>
              </div>
            ) : (
              <div style={{ fontSize: 13, color: 'var(--gray)' }}>Waiting for the bank to issue the financing contract.</div>
            )
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <ContractDocumentLink documentId={transaction.esign_document_id} />
              <div className="kv-list">
                <div className="kv-row">
                  <span className="k">Bank Signed</span>
                  <span className="v">{fmtDate(transaction.bank_signed_at)}</span>
                </div>
                <div className="kv-row">
                  <span className="k">Borrower Signed</span>
                  <span className="v">{requesterSignedAt ? fmtDate(requesterSignedAt) : 'Pending'}</span>
                </div>
                {transaction.esign_completed_at && (
                  <div className="kv-row">
                    <span className="k">Contract Status</span>
                    <span className="badge badge-funded">Fully Executed</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {transaction?.esign_document_id && !requesterSignedAt && isRequester && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
              <div className="form-field">
                <label className="field-label">Typed Signature (Full Legal Name) *</label>
                <input
                  className="input"
                  type="text"
                  value={signature}
                  onChange={e => setSignature(e.target.value)}
                  placeholder="Enter your full legal name"
                />
                <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 4 }}>By typing your name you electronically sign this contract.</div>
              </div>
              <button className="btn btn-blue btn-sm" disabled={signing || !signature.trim()} onClick={signContract} style={{ alignSelf: 'flex-start' }}>
                {signing ? 'Signing…' : 'Sign Contract'}
              </button>
            </div>
          )}
        </div>

        {/* Step 2: Disbursement */}
        {transaction?.esign_document_id && (
          <div>
            <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--gray)', marginBottom: 10 }}>
              Step 2 · Disbursement
            </div>

            {!transaction.disbursed_at ? (
              !transaction.esign_completed_at ? (
                <div style={{ fontSize: 13, color: 'var(--gray)' }}>The contract must be signed by both parties before funds can be disbursed.</div>
              ) : isBank ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {requesterBankAccount ? (
                    <div className="kv-list">
                      <div className="kv-row"><span className="k">Receiving Bank</span><span className="v plain">{requesterBankAccount.bank_name}</span></div>
                      <div className="kv-row"><span className="k">Account Holder</span><span className="v plain">{requesterBankAccount.account_holder_name}</span></div>
                      <div className="kv-row">
                        <span className="k">Account No.</span>
                        <span className="v plain" style={{ fontFamily: 'var(--font-mono)' }}>
                          ****{requesterBankAccount.account_number.slice(-4)}
                        </span>
                      </div>
                      {(requesterBankAccount.swift_iban || requesterBankAccount.routing_number) && (
                        <div className="kv-row"><span className="k">Routing / SWIFT</span><span className="v plain" style={{ fontFamily: 'var(--font-mono)' }}>{requesterBankAccount.swift_iban ?? requesterBankAccount.routing_number}</span></div>
                      )}
                    </div>
                  ) : (
                    <div style={{ fontSize: 12, color: 'var(--color-amber)', padding: '8px 12px', background: 'var(--color-amber-bg)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: 8 }}>
                      The borrower has not added a bank account yet. Disbursement cannot proceed until they do.
                    </div>
                  )}
                  <div className="form-field">
                    <label className="field-label">Payment Reference</label>
                    <input className="input" type="text" value={reference} onChange={e => setReference(e.target.value)} placeholder="Wire/payment reference (optional)" />
                  </div>
                  <button
                    className="btn btn-blue btn-sm"
                    disabled={disbursing || !requesterBankAccount}
                    onClick={disburse}
                    style={{ alignSelf: 'flex-start' }}
                  >
                    {disbursing ? 'Sending…' : 'Send Payment Reference'}
                  </button>
                </div>
              ) : (
                <div style={{ fontSize: 13, color: 'var(--gray)' }}>Waiting for the bank to disburse funds.</div>
              )
            ) : (
              <div className="kv-list">
                <div className="kv-row"><span className="k">Disbursed</span><span className="v">{fmtDate(transaction.disbursed_at)}</span></div>
                {transaction.disbursement_reference && (
                  <div className="kv-row"><span className="k">Reference</span><span className="v plain" style={{ fontFamily: 'var(--font-mono)' }}>{transaction.disbursement_reference}</span></div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Step 3: Confirm receipt */}
        {transaction?.disbursed_at && (
          <div>
            <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--gray)', marginBottom: 10 }}>
              Step 3 · Confirm Receipt
            </div>
            {transaction.supplier_paid_at ? (
              <div className="kv-list">
                <div className="kv-row"><span className="k">Confirmed Received</span><span className="v">{fmtDate(transaction.supplier_paid_at)}</span></div>
              </div>
            ) : isRequester ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ fontSize: 13, color: 'var(--gray)' }}>Once the funds arrive in your account, confirm receipt below.</div>
                <button className="btn btn-blue btn-sm" disabled={confirming} onClick={confirmReceived} style={{ alignSelf: 'flex-start' }}>
                  {confirming ? 'Confirming…' : 'Confirm Receipt'}
                </button>
              </div>
            ) : (
              <div style={{ fontSize: 13, color: 'var(--gray)' }}>Waiting for the borrower to confirm receipt of funds.</div>
            )}
          </div>
        )}
    </div>
  )

  if (embedded) return content

  return (
    <div className="card">
      <div className="card-head">Financing Management</div>
      <div className="card-body">{content}</div>
    </div>
  )
}
