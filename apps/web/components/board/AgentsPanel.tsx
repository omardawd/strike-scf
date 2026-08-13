'use client'

import { useState } from 'react'
import { AgentAvatar } from './TaskPanel'
import type { BoardAgent } from './types'

const PANEL_WIDTH = 440

interface AgentDraft {
  name: string
  role_label: string
  persona: string
  task_types: string
  expected_output: string
  guardrails: string
}

const EMPTY_DRAFT: AgentDraft = {
  name: '', role_label: '', persona: '', task_types: '', expected_output: '', guardrails: '',
}

function toDraft(agent: BoardAgent): AgentDraft {
  return {
    name: agent.name,
    role_label: agent.role_label ?? '',
    persona: agent.persona ?? '',
    task_types: agent.task_types.join(', '),
    expected_output: agent.expected_output ?? '',
    guardrails: agent.guardrails ?? '',
  }
}

const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: 'var(--gray-soft)', marginBottom: 5, display: 'block' }
const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', fontSize: 13.5, border: '1px solid var(--border)',
  borderRadius: 8, padding: '8px 10px', fontFamily: 'inherit',
}

function AgentForm({
  draft, onChange, onSubmit, onCancel, saving, error, submitLabel,
}: {
  draft: AgentDraft
  onChange: (d: AgentDraft) => void
  onSubmit: () => void
  onCancel: () => void
  saving: boolean
  error: string
  submitLabel: string
}) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-card)', padding: 16, marginBottom: 16, background: 'var(--offwhite)' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <label style={labelStyle}>Name</label>
          <input
            autoFocus
            value={draft.name}
            onChange={e => onChange({ ...draft, name: e.target.value })}
            placeholder="e.g. Sourcing Agent"
            maxLength={80}
            style={inputStyle}
          />
        </div>
        <div>
          <label style={labelStyle}>Role</label>
          <input
            value={draft.role_label}
            onChange={e => onChange({ ...draft, role_label: e.target.value })}
            placeholder="e.g. Sourcing, Finance, Legal, Category Manager…"
            maxLength={60}
            style={inputStyle}
          />
        </div>
        <div>
          <label style={labelStyle}>Instructions — what do you expect from this agent?</label>
          <textarea
            value={draft.persona}
            onChange={e => onChange({ ...draft, persona: e.target.value })}
            placeholder='"Hello agent, you are my sourcing agent. Source suppliers that are compliant with company policy, our pricing strategy, and our due diligence requirements…"'
            rows={4}
            maxLength={4000}
            style={{ ...inputStyle, resize: 'vertical' }}
          />
        </div>
        <div>
          <label style={labelStyle}>Task types (comma-separated)</label>
          <input
            value={draft.task_types}
            onChange={e => onChange({ ...draft, task_types: e.target.value })}
            placeholder="e.g. supplier sourcing, RFQ drafting, vendor shortlisting"
            style={inputStyle}
          />
        </div>
        <div>
          <label style={labelStyle}>Expected output</label>
          <textarea
            value={draft.expected_output}
            onChange={e => onChange({ ...draft, expected_output: e.target.value })}
            placeholder="e.g. A shortlist of 3-5 qualified suppliers with pricing and compliance notes"
            rows={2}
            maxLength={2000}
            style={{ ...inputStyle, resize: 'vertical' }}
          />
        </div>
        <div>
          <label style={labelStyle}>Guardrails / limitations</label>
          <textarea
            value={draft.guardrails}
            onChange={e => onChange({ ...draft, guardrails: e.target.value })}
            placeholder="e.g. Never commit to pricing without approval. Only consider suppliers with an active Passport score above 60. Escalate anything outside standard payment terms."
            rows={3}
            maxLength={4000}
            style={{ ...inputStyle, resize: 'vertical' }}
          />
        </div>
      </div>
      {error && <p style={{ color: 'var(--color-red)', fontSize: 12.5, marginTop: 10 }}>{error}</p>}
      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <button
          onClick={onSubmit}
          disabled={saving || !draft.name.trim()}
          className="btn btn-blue btn-sm"
          style={{ opacity: saving || !draft.name.trim() ? 0.6 : 1 }}
        >
          {saving ? 'Saving…' : submitLabel}
        </button>
        <button onClick={onCancel} style={{ border: 'none', background: 'none', color: 'var(--gray)', fontSize: 12.5, cursor: 'pointer' }}>
          Cancel
        </button>
      </div>
    </div>
  )
}

export function AgentsPanel({
  agents, onClose, onChanged,
}: {
  agents: BoardAgent[]
  onClose: () => void
  onChanged: () => void
}) {
  const [creating, setCreating] = useState(false)
  const [newDraft, setNewDraft] = useState<AgentDraft>(EMPTY_DRAFT)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<AgentDraft>(EMPTY_DRAFT)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function payloadFrom(d: AgentDraft) {
    return {
      name: d.name.trim(),
      role_label: d.role_label.trim() || null,
      persona: d.persona.trim() || null,
      task_types: d.task_types.split(',').map(s => s.trim()).filter(Boolean),
      expected_output: d.expected_output.trim() || null,
      guardrails: d.guardrails.trim() || null,
    }
  }

  async function handleCreate() {
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/board/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payloadFrom(newDraft)),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to create agent')
      setNewDraft(EMPTY_DRAFT)
      setCreating(false)
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create agent')
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveEdit(id: string) {
    setSaving(true)
    setError('')
    try {
      const res = await fetch(`/api/board/agents/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payloadFrom(editDraft)),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to update agent')
      setEditingId(null)
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update agent')
    } finally {
      setSaving(false)
    }
  }

  async function handleToggleActive(agent: BoardAgent) {
    await fetch(`/api/board/agents/${agent.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !agent.is_active }),
    })
    onChanged()
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this agent? Tasks assigned to it must be reassigned first.')) return
    const res = await fetch(`/api/board/agents/${id}`, { method: 'DELETE' })
    if (res.ok) onChanged()
    else {
      const json = await res.json().catch(() => ({}))
      setError(json.error ?? 'Failed to delete agent')
    }
  }

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 90 }} />
      <div
        onClick={e => e.stopPropagation()}
        style={{
          position: 'fixed', top: 0, right: 0, height: '100vh', width: PANEL_WIDTH,
          background: 'var(--white)', borderLeft: '1px solid var(--border)',
          boxShadow: '-8px 0 32px rgba(0,0,0,0.07)', zIndex: 100,
          display: 'flex', flexDirection: 'column',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, fontFamily: 'var(--font-display)' }}>Agents</h2>
          <button onClick={onClose} aria-label="Close" style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--gray)', fontSize: 13 }}>
            Close
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 20px' }}>
          <p style={{ fontSize: 12.5, color: 'var(--gray-soft)', marginBottom: 16, lineHeight: 1.5 }}>
            Configure an agent once — its role, instructions, task types, and guardrails — then assign it to tasks on the board like any teammate. Assigning a task to an agent never executes anything automatically; a human always reviews the result.
          </p>

          {!creating && editingId === null && (
            <button
              onClick={() => setCreating(true)}
              className="btn btn-blue btn-sm"
              style={{ marginBottom: 16 }}
            >
              + New Agent
            </button>
          )}

          {creating && (
            <AgentForm
              draft={newDraft}
              onChange={setNewDraft}
              onSubmit={handleCreate}
              onCancel={() => { setCreating(false); setNewDraft(EMPTY_DRAFT); setError('') }}
              saving={saving}
              error={error}
              submitLabel="Create Agent"
            />
          )}

          {agents.length === 0 && !creating && (
            <p style={{ fontSize: 13, color: 'var(--gray-soft)', textAlign: 'center', padding: '30px 0' }}>
              No agents configured yet.
            </p>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {agents.map(agent => (
              editingId === agent.id ? (
                <AgentForm
                  key={agent.id}
                  draft={editDraft}
                  onChange={setEditDraft}
                  onSubmit={() => handleSaveEdit(agent.id)}
                  onCancel={() => { setEditingId(null); setError('') }}
                  saving={saving}
                  error={error}
                  submitLabel="Save Changes"
                />
              ) : (
                <div key={agent.id} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-card)', padding: 14, opacity: agent.is_active ? 1 : 0.55 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <AgentAvatar name={agent.name} size={26} />
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 700 }}>{agent.name}</div>
                        {agent.role_label && <div style={{ fontSize: 11.5, color: 'var(--gray-soft)' }}>{agent.role_label}</div>}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                      <button onClick={() => handleToggleActive(agent)} style={{ border: 'none', background: 'none', color: 'var(--gray-soft)', fontSize: 11.5, cursor: 'pointer' }}>
                        {agent.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                      <button onClick={() => { setEditingId(agent.id); setEditDraft(toDraft(agent)); setError('') }} style={{ border: 'none', background: 'none', color: 'var(--blue)', fontSize: 11.5, cursor: 'pointer' }}>
                        Edit
                      </button>
                      <button onClick={() => handleDelete(agent.id)} style={{ border: 'none', background: 'none', color: 'var(--gray-soft)', fontSize: 11.5, cursor: 'pointer' }}>
                        Delete
                      </button>
                    </div>
                  </div>
                  {agent.persona && (
                    <p style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginTop: 10, lineHeight: 1.5 }}>{agent.persona}</p>
                  )}
                  {agent.task_types.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 10 }}>
                      {agent.task_types.map(tt => (
                        <span key={tt} style={{ fontSize: 10.5, fontWeight: 600, padding: '2px 8px', borderRadius: 'var(--radius-badge)', background: 'var(--offwhite)', color: 'var(--gray)' }}>
                          {tt}
                        </span>
                      ))}
                    </div>
                  )}
                  {agent.guardrails && (
                    <p style={{ fontSize: 11.5, color: 'var(--gray-soft)', marginTop: 8, lineHeight: 1.5 }}>
                      <strong style={{ color: 'var(--gray)' }}>Guardrails:</strong> {agent.guardrails}
                    </p>
                  )}
                </div>
              )
            ))}
          </div>
        </div>
      </div>
    </>
  )
}
