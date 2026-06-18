'use client'
import React, { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useUser } from '@/lib/user-context'
import { PortalShell, Topbar, NotifBell } from '@/components/portal-shell'
import { PassportScoreRing } from '@/components/passport-score-ring'

// ── Constants ─────────────────────────────────────────────────────────────────

const INCOTERMS = ['EXW', 'FOB', 'CIF', 'DDP', 'DAP', 'FCA']
const TENOR_OPTIONS = [30, 60, 90, 120, 180]
const TOP_COUNTRIES = [
  'US', 'CN', 'DE', 'GB', 'FR', 'JP', 'CA', 'AU', 'IN', 'BR',
  'IT', 'ES', 'KR', 'MX', 'RU', 'NL', 'SA', 'TR', 'CH', 'PL',
  'SE', 'BE', 'SG', 'NO', 'AT', 'AE', 'ZA', 'MY', 'TH', 'ID',
]

type PrefType =
  | 'rate_floor'
  | 'rate_ceiling'
  | 'min_passport_score'
  | 'auto_reject_below_score'
  | 'max_deal_value_auto'
  | 'preferred_tenor_days'
  | 'blacklist_countries'
  | 'preferred_incoterms'

interface PrefState {
  value: number | number[] | string[]
  is_active: boolean
  updated_at: string | null
}

const DEFAULTS: Record<PrefType, PrefState> = {
  rate_floor:             { value: 0,    is_active: false, updated_at: null },
  rate_ceiling:           { value: 0,    is_active: false, updated_at: null },
  min_passport_score:     { value: 0,    is_active: false, updated_at: null },
  auto_reject_below_score:{ value: 0,    is_active: false, updated_at: null },
  max_deal_value_auto:    { value: 0,    is_active: false, updated_at: null },
  preferred_tenor_days:   { value: 60,   is_active: false, updated_at: null },
  blacklist_countries:    { value: [],   is_active: false, updated_at: null },
  preferred_incoterms:    { value: [],   is_active: false, updated_at: null },
}

function riskTierLabel(score: number): { label: string; color: string } {
  if (score >= 70) return { label: 'Green Tier',  color: 'var(--color-green)' }
  if (score >= 45) return { label: 'Amber Tier',  color: 'var(--color-amber)' }
  return               { label: 'Red Tier',    color: 'var(--color-red)' }
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        style={{
          width: 36,
          height: 20,
          padding: 2,
          border: '1px solid var(--border-strong)',
          background: checked ? 'var(--blue)' : 'var(--offwhite)',
          cursor: 'pointer',
          display: 'inline-flex',
          justifyContent: checked ? 'flex-end' : 'flex-start',
          transition: 'background .15s',
          flexShrink: 0,
        }}
      >
        <span style={{ width: 14, height: 14, background: checked ? '#fff' : 'var(--gray)' }} />
      </button>
      <span
        style={{ fontSize: 12, color: checked ? 'var(--ink)' : 'var(--gray)', fontWeight: checked ? 500 : 400 }}
      >
        {checked ? 'Active' : 'Inactive'}
      </span>
    </div>
  )
}

function ChipSelect({
  options,
  selected,
  onChange,
}: {
  options: string[]
  selected: string[]
  onChange: (v: string[]) => void
}) {
  function toggle(opt: string) {
    onChange(
      selected.includes(opt) ? selected.filter((v) => v !== opt) : [...selected, opt]
    )
  }
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
      {options.map((opt) => {
        const active = selected.includes(opt)
        return (
          <button
            key={opt}
            type="button"
            onClick={() => toggle(opt)}
            style={{
              height: 28,
              padding: '0 10px',
              border: `1px solid ${active ? 'var(--blue)' : 'var(--border)'}`,
              background: active ? 'var(--color-accent-light)' : 'var(--white)',
              color: active ? 'var(--blue)' : 'var(--gray)',
              fontSize: 12,
              fontWeight: active ? 500 : 400,
              cursor: 'pointer',
              fontFamily: 'inherit',
              transition: 'all .12s',
            }}
          >
            {opt}
          </button>
        )
      })}
    </div>
  )
}

// ── Preference card ───────────────────────────────────────────────────────────

function PrefCard({
  title,
  description,
  state,
  onStateChange,
  onSave,
  saving,
  saved,
  children,
}: {
  title: string
  description: string
  state: PrefState
  onStateChange: (s: PrefState) => void
  onSave: () => void
  saving: boolean
  saved: boolean
  children: React.ReactNode
}) {
  return (
    <div className="card">
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>{title}</div>
            <div style={{ fontSize: 12.5, color: 'var(--gray)', marginTop: 3, lineHeight: 1.5 }}>
              {description}
            </div>
          </div>
          <Toggle
            checked={state.is_active}
            onChange={(v) => onStateChange({ ...state, is_active: v })}
            label={`Enable ${title}`}
          />
        </div>

        <div style={{ opacity: state.is_active ? 1 : 0.45, pointerEvents: state.is_active ? 'auto' : 'none', transition: 'opacity .15s' }}>
          {children}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={onSave}
            disabled={saving}
          >
            {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save'}
          </button>
          {state.updated_at && (
            <span style={{ fontSize: 11.5, color: 'var(--gray)' }}>
              Last updated: {fmtDate(state.updated_at)}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AgentSettingsPage() {
  const user   = useUser()
  const router = useRouter()

  const [prefs, setPrefs]     = useState<Record<PrefType, PrefState>>({ ...DEFAULTS })
  const [saving, setSaving]   = useState<PrefType | null>(null)
  const [saved,  setSaved]    = useState<Partial<Record<PrefType, boolean>>>({})

  const updatePref = (type: PrefType, partial: Partial<PrefState>) =>
    setPrefs((p) => ({ ...p, [type]: { ...p[type], ...partial } }))

  const loadPrefs = useCallback(async () => {
    try {
      const res = await fetch('/api/settings/agent')
      if (!res.ok) return
      const { preferences } = await res.json()
      if (!Array.isArray(preferences)) return
      const next = { ...DEFAULTS }
      for (const p of preferences) {
        const t = p.preference_type as PrefType
        if (t in next) {
          next[t] = {
            value:      p.value,
            is_active:  p.is_active,
            updated_at: p.updated_at ?? null,
          }
        }
      }
      setPrefs(next)
    } catch { /* ignore */ }
  }, [])

  useEffect(() => { loadPrefs() }, [loadPrefs])

  async function savePref(type: PrefType) {
    setSaving(type)
    const pref = prefs[type]
    try {
      const res = await fetch('/api/settings/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          preference_type: type,
          value:     pref.value,
          is_active: pref.is_active,
        }),
      })
      if (!res.ok) return
      const { preference } = await res.json()
      if (preference?.updated_at) {
        updatePref(type, { updated_at: preference.updated_at })
      }
      setSaved((s) => ({ ...s, [type]: true }))
      setTimeout(() => setSaved((s) => ({ ...s, [type]: false })), 2800)
    } catch { /* ignore */ } finally {
      setSaving(null)
    }
  }

  if (!user?.org_id) return null

  const p = prefs

  return (
    <PortalShell activeSection="settings">
      <Topbar
        crumbs={[
          { label: 'Settings', onClick: () => router.push('/settings') },
          { label: 'AI Agent Preferences' },
        ]}
        actions={<NotifBell />}
      />

      <div className="page">
        <div className="page-header">
          <h1 className="t-page-title">AI Agent Preferences</h1>
          <div className="subtitle">Configure the boundaries your AI agent operates within.</div>
        </div>

        {/* Intro card */}
        <div
          style={{
            border: '1px solid rgba(20,40,204,0.22)',
            background: 'rgba(20,40,204,0.02)',
            padding: '14px 18px',
            marginBottom: 24,
            display: 'flex',
            gap: 12,
            alignItems: 'flex-start',
          }}
        >
          <div
            style={{
              width: 6,
              height: 6,
              background: 'var(--blue)',
              marginTop: 6,
              flexShrink: 0,
              animation: 'badge-pulse 2.4s infinite',
            }}
          />
          <div style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.6 }}>
            Your AI agent acts on your behalf within the limits you set here. It never exceeds
            these boundaries without your explicit approval.
          </div>
        </div>

        <div style={{ maxWidth: 680, display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* Settings nav strip */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => router.push('/settings')}
            >
              ← General Settings
            </button>
            <button type="button" className="btn btn-primary btn-sm" style={{ cursor: 'default' }}>
              AI Agent
            </button>
          </div>

          {/* ── Rate Floor ── */}
          <PrefCard
            title="Minimum Acceptable Financing Rate"
            description="The agent will not accept any financing offer below this rate (APR %)."
            state={p.rate_floor}
            onStateChange={(s) => updatePref('rate_floor', s)}
            onSave={() => savePref('rate_floor')}
            saving={saving === 'rate_floor'}
            saved={!!saved.rate_floor}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input
                type="number"
                className="input"
                min={0}
                max={100}
                step={0.1}
                style={{ width: 120 }}
                value={p.rate_floor.value as number}
                onChange={(e) => updatePref('rate_floor', { value: parseFloat(e.target.value) || 0 })}
              />
              <span style={{ fontSize: 13, color: 'var(--gray)' }}>APR %</span>
            </div>
          </PrefCard>

          {/* ── Rate Ceiling ── */}
          <PrefCard
            title="Maximum Acceptable Financing Rate"
            description="The agent will reject any financing offer above this rate (APR %)."
            state={p.rate_ceiling}
            onStateChange={(s) => updatePref('rate_ceiling', s)}
            onSave={() => savePref('rate_ceiling')}
            saving={saving === 'rate_ceiling'}
            saved={!!saved.rate_ceiling}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input
                type="number"
                className="input"
                min={0}
                max={100}
                step={0.1}
                style={{ width: 120 }}
                value={p.rate_ceiling.value as number}
                onChange={(e) => updatePref('rate_ceiling', { value: parseFloat(e.target.value) || 0 })}
              />
              <span style={{ fontSize: 13, color: 'var(--gray)' }}>APR %</span>
            </div>
          </PrefCard>

          {/* ── Min Passport Score ── */}
          <PrefCard
            title="Minimum PassportScore™"
            description="Auto-reject offers from organizations below this PassportScore."
            state={p.min_passport_score}
            onStateChange={(s) => updatePref('min_passport_score', s)}
            onSave={() => savePref('min_passport_score')}
            saving={saving === 'min_passport_score'}
            saved={!!saved.min_passport_score}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <input
                  type="number"
                  className="input"
                  min={0}
                  max={100}
                  style={{ width: 90 }}
                  value={p.min_passport_score.value as number}
                  onChange={(e) =>
                    updatePref('min_passport_score', {
                      value: Math.max(0, Math.min(100, parseInt(e.target.value) || 0)),
                    })
                  }
                />
                <span style={{ fontSize: 13, color: 'var(--gray)' }}>/ 100</span>
              </div>
              <PassportScoreRing score={p.min_passport_score.value as number} size="sm" />
              {(p.min_passport_score.value as number) > 0 && (
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 500,
                    color: riskTierLabel(p.min_passport_score.value as number).color,
                  }}
                >
                  {riskTierLabel(p.min_passport_score.value as number).label}
                </span>
              )}
            </div>
          </PrefCard>

          {/* ── Auto-reject Below Score ── */}
          <PrefCard
            title="Auto-reject Below Score"
            description="Automatically reject financing offers from organizations with PassportScore below this threshold."
            state={p.auto_reject_below_score}
            onStateChange={(s) => updatePref('auto_reject_below_score', s)}
            onSave={() => savePref('auto_reject_below_score')}
            saving={saving === 'auto_reject_below_score'}
            saved={!!saved.auto_reject_below_score}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <input
                  type="number"
                  className="input"
                  min={0}
                  max={100}
                  style={{ width: 90 }}
                  value={p.auto_reject_below_score.value as number}
                  onChange={(e) =>
                    updatePref('auto_reject_below_score', {
                      value: Math.max(0, Math.min(100, parseInt(e.target.value) || 0)),
                    })
                  }
                />
                <span style={{ fontSize: 13, color: 'var(--gray)' }}>/ 100</span>
              </div>
              {(p.auto_reject_below_score.value as number) > 0 && (
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 500,
                    color: riskTierLabel(p.auto_reject_below_score.value as number).color,
                  }}
                >
                  {riskTierLabel(p.auto_reject_below_score.value as number).label}
                </span>
              )}
            </div>
          </PrefCard>

          {/* ── Max Deal Value (Auto) ── */}
          <PrefCard
            title="Maximum Deal Value (Auto-approve)"
            description="Maximum deal value your agent can accept without requiring your approval."
            state={p.max_deal_value_auto}
            onStateChange={(s) => updatePref('max_deal_value_auto', s)}
            onSave={() => savePref('max_deal_value_auto')}
            saving={saving === 'max_deal_value_auto'}
            saved={!!saved.max_deal_value_auto}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 14, color: 'var(--gray)', fontFamily: 'var(--font-body)', fontWeight: 500 }}>
                $
              </span>
              <input
                type="number"
                className="input"
                min={0}
                step={1000}
                style={{ width: 160 }}
                value={p.max_deal_value_auto.value as number}
                onChange={(e) =>
                  updatePref('max_deal_value_auto', { value: parseFloat(e.target.value) || 0 })
                }
              />
              <span style={{ fontSize: 13, color: 'var(--gray)' }}>USD</span>
            </div>
          </PrefCard>

          {/* ── Preferred Tenor ── */}
          <PrefCard
            title="Preferred Financing Tenor"
            description="Preferred financing tenor in days. The agent will favor offers matching this tenor."
            state={p.preferred_tenor_days}
            onStateChange={(s) => updatePref('preferred_tenor_days', s)}
            onSave={() => savePref('preferred_tenor_days')}
            saving={saving === 'preferred_tenor_days'}
            saved={!!saved.preferred_tenor_days}
          >
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
              {TENOR_OPTIONS.map((days) => {
                const active = p.preferred_tenor_days.value === days
                return (
                  <button
                    key={days}
                    type="button"
                    onClick={() => updatePref('preferred_tenor_days', { value: days })}
                    style={{
                      height: 36,
                      padding: '0 16px',
                      border: `1px solid ${active ? 'var(--blue)' : 'var(--border)'}`,
                      background: active ? 'var(--color-accent-light)' : 'var(--white)',
                      color: active ? 'var(--blue)' : 'var(--gray)',
                      fontSize: 13,
                      fontWeight: active ? 500 : 400,
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}
                  >
                    {days}d
                  </button>
                )
              })}
            </div>
          </PrefCard>

          {/* ── Blacklist Countries ── */}
          <PrefCard
            title="Blacklisted Countries"
            description="Never accept deals or financing involving these countries."
            state={p.blacklist_countries}
            onStateChange={(s) => updatePref('blacklist_countries', s)}
            onSave={() => savePref('blacklist_countries')}
            saving={saving === 'blacklist_countries'}
            saved={!!saved.blacklist_countries}
          >
            <div>
              <div style={{ fontSize: 12, color: 'var(--gray)', marginBottom: 4 }}>
                {(p.blacklist_countries.value as string[]).length} countr
                {(p.blacklist_countries.value as string[]).length === 1 ? 'y' : 'ies'} selected
              </div>
              <ChipSelect
                options={TOP_COUNTRIES}
                selected={p.blacklist_countries.value as string[]}
                onChange={(v) => updatePref('blacklist_countries', { value: v })}
              />
            </div>
          </PrefCard>

          {/* ── Preferred Incoterms ── */}
          <PrefCard
            title="Preferred Incoterms"
            description="Preferred delivery terms. The agent will prioritize offers with these terms."
            state={p.preferred_incoterms}
            onStateChange={(s) => updatePref('preferred_incoterms', s)}
            onSave={() => savePref('preferred_incoterms')}
            saving={saving === 'preferred_incoterms'}
            saved={!!saved.preferred_incoterms}
          >
            <ChipSelect
              options={INCOTERMS}
              selected={p.preferred_incoterms.value as string[]}
              onChange={(v) => updatePref('preferred_incoterms', { value: v })}
            />
          </PrefCard>
        </div>
      </div>
    </PortalShell>
  )
}
