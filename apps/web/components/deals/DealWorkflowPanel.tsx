'use client'
import { useState } from 'react'
import type { DealWorkflowStep } from '@strike-scf/types'

export function DealWorkflowPanel({ dealId, steps, currentUserRole, onRefresh }: {
  dealId: string
  steps: DealWorkflowStep[]
  currentUserRole: 'buyer' | 'supplier' | 'bank'
  onRefresh: () => void
}) {
  const [showForm, setShowForm] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [responsibleParty, setResponsibleParty] = useState<'buyer' | 'supplier' | 'both'>('supplier')
  const [requiresDocument, setRequiresDocument] = useState(false)
  const [dueAt, setDueAt] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function request(url: string, method: string, body?: Record<string, unknown>) {
    setBusy(url)
    setError(null)
    try {
      const response = await fetch(url, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? 'Request failed')
      onRefresh()
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed')
      return false
    } finally { setBusy(null) }
  }

  async function addStep(event: React.FormEvent) {
    event.preventDefault()
    const ok = await request(`/api/deals/${dealId}/workflow`, 'POST', {
      title,
      description: description || undefined,
      responsible_party: responsibleParty,
      requires_document: requiresDocument,
      due_at: dueAt ? new Date(`${dueAt}T23:59:59`).toISOString() : undefined,
    })
    if (ok) {
      setTitle(''); setDescription(''); setDueAt(''); setRequiresDocument(false); setShowForm(false)
    }
  }

  return (
    <div className="card">
      <div className="card-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span>Custom deal flow</span>
        {currentUserRole === 'buyer' && (
          <button className="btn btn-ghost btn-sm" onClick={() => setShowForm(value => !value)}>
            {showForm ? 'Cancel' : 'Add step'}
          </button>
        )}
      </div>
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p style={{ margin: 0, color: 'var(--gray)', fontSize: 12, lineHeight: 1.5 }}>
          Buyer-proposed checkpoints agreed with the supplier. These complement the fixed deal lifecycle.
        </p>

        {showForm && (
          <form onSubmit={addStep} style={{ padding: 14, border: '1px solid var(--border)', borderRadius: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="form-field">
              <label className="field-label">Step title *</label>
              <input className="input" value={title} maxLength={120} required onChange={e => setTitle(e.target.value)} placeholder="Quality inspection" />
            </div>
            <div className="form-field">
              <label className="field-label">Description</label>
              <textarea className="input" value={description} onChange={e => setDescription(e.target.value)} rows={3} placeholder="Define what success looks like and what each party needs to provide." />
            </div>
            <div className="form-row-2">
              <div className="form-field">
                <label className="field-label">Responsible party *</label>
                <select className="input" value={responsibleParty} onChange={e => setResponsibleParty(e.target.value as typeof responsibleParty)}>
                  <option value="buyer">Buyer</option><option value="supplier">Supplier</option><option value="both">Both</option>
                </select>
              </div>
              <div className="form-field">
                <label className="field-label">Due date</label>
                <input className="input" type="date" value={dueAt} onChange={e => setDueAt(e.target.value)} />
              </div>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
              <input type="checkbox" checked={requiresDocument} onChange={e => setRequiresDocument(e.target.checked)} />
              This checkpoint requires a document
            </label>
            <button className="btn btn-primary btn-sm" disabled={!!busy || !title.trim()} type="submit">
              {busy ? 'Adding…' : 'Propose step'}
            </button>
          </form>
        )}

        {error && <div style={{ color: 'var(--color-red)', fontSize: 12 }}>{error}</div>}
        {steps.length === 0 ? (
          <div style={{ padding: '16px 0', color: 'var(--gray-soft)', fontSize: 12 }}>No custom checkpoints yet.</div>
        ) : steps.map((step, index) => (
          <div key={step.id} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <div style={{ width: 24, height: 24, borderRadius: 12, background: step.status === 'completed' ? 'var(--color-green)' : 'var(--blue-light)', color: step.status === 'completed' ? '#fff' : 'var(--blue)', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{step.status === 'completed' ? '✓' : index + 1}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <strong style={{ fontSize: 13 }}>{step.title}</strong>
                <span className={`badge ${step.status === 'completed' ? 'badge-completed' : step.status === 'declined' ? 'badge-rejected' : step.status === 'accepted' ? 'badge-active' : 'badge-pending'}`} style={{ fontSize: 9 }}>{step.status}</span>
                <span className="badge badge-draft" style={{ fontSize: 9 }}>{step.responsible_party}</span>
              </div>
              {step.description && <p style={{ margin: '6px 0 0', color: 'var(--gray)', fontSize: 12, lineHeight: 1.5 }}>{step.description}</p>}
              <div style={{ marginTop: 7, display: 'flex', gap: 12, color: 'var(--gray-soft)', fontSize: 10 }}>
                {step.due_at && <span>Due {new Date(step.due_at).toLocaleDateString()}</span>}
                {step.requires_document && <span>Document required</span>}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                {currentUserRole === 'supplier' && step.status === 'proposed' && <>
                  <button className="btn btn-primary btn-sm" disabled={!!busy} onClick={() => request(`/api/deals/${dealId}/workflow/${step.id}`, 'PATCH', { response: 'accepted' })}>Accept</button>
                  <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => request(`/api/deals/${dealId}/workflow/${step.id}`, 'PATCH', { response: 'declined' })}>Decline</button>
                </>}
                {currentUserRole !== 'bank' && step.status === 'accepted' && (
                  <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => request(`/api/deals/${dealId}/workflow/${step.id}/complete`, 'POST')}>Mark complete</button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
