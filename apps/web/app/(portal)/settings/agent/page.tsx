'use client'
import React, { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useUser } from '@/lib/user-context'
import { PortalShell, Topbar, NotifBell } from '@/components/portal-shell'
import { PassportScoreRing } from '@/components/passport-score-ring'
import { useT } from '@/lib/i18n/locale-context'

type TFn = (key: string, vars?: Record<string, string | number>) => string

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

function riskTierLabel(score: number, t: TFn): { label: string; color: string } {
  if (score >= 70) return { label: t('agentSettings.greenTier'),  color: 'var(--color-green)' }
  if (score >= 45) return { label: t('agentSettings.amberTier'),  color: 'var(--color-amber)' }
  return               { label: t('agentSettings.redTier'),    color: 'var(--color-red)' }
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
  const t = useT()
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
        {checked ? t('teamPage.active') : t('teamPage.inactive')}
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
  const t = useT()
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
            label={t('agentSettings.enableLabel', { title })}
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
            {saving ? t('newListing.saving') : saved ? t('agentSettings.savedCheck') : t('agentSettings.save')}
          </button>
          {state.updated_at && (
            <span style={{ fontSize: 11.5, color: 'var(--gray)' }}>
              {t('agentSettings.lastUpdated')} {fmtDate(state.updated_at)}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

interface AgentConfig {
  id?: string
  name: string
  persona: string
  goals: string[]
  is_active: boolean
}

const DEFAULT_AGENT: AgentConfig = { name: 'Strike Agent', persona: '', goals: [], is_active: false }

export default function AgentSettingsPage() {
  const user   = useUser()
  const router = useRouter()
  const t = useT()

  const [prefs, setPrefs]     = useState<Record<PrefType, PrefState>>({ ...DEFAULTS })
  const [saving, setSaving]   = useState<PrefType | null>(null)
  const [saved,  setSaved]    = useState<Partial<Record<PrefType, boolean>>>({})

  // Agent config state
  const [agent, setAgent]         = useState<AgentConfig>(DEFAULT_AGENT)
  const [agentSaving, setAgentSaving] = useState(false)
  const [agentSaved,  setAgentSaved]  = useState(false)
  const [scanLoading, setScanLoading] = useState(false)
  const [scanResult,  setScanResult]  = useState<string | null>(null)
  const [tickLoading, setTickLoading] = useState(false)
  const [tickResult,  setTickResult]  = useState<string | null>(null)

  const updatePref = (type: PrefType, partial: Partial<PrefState>) =>
    setPrefs((p) => ({ ...p, [type]: { ...p[type], ...partial } }))

  const loadAgentConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/agents/config')
      if (!res.ok) return
      const { agent: a } = await res.json()
      if (a) setAgent({
        id: a.id,
        name: a.name ?? 'Strike Agent',
        persona: a.persona ?? '',
        goals: a.goals ?? [],
        is_active: a.is_active ?? false,
      })
    } catch { /* ignore */ }
  }, [])

  async function saveAgentConfig() {
    setAgentSaving(true)
    try {
      // Save name/persona/goals
      await fetch('/api/agents/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: agent.name, persona: agent.persona, goals: agent.goals }),
      })
      setAgentSaved(true)
      setTimeout(() => setAgentSaved(false), 2800)
    } catch { /* ignore */ } finally { setAgentSaving(false) }
  }

  async function toggleAgent(active: boolean) {
    setAgentSaving(true)
    try {
      const res = await fetch('/api/agents/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active }),
      })
      if (res.ok) setAgent((a) => ({ ...a, is_active: active }))
    } catch { /* ignore */ } finally { setAgentSaving(false) }
  }

  async function runScan() {
    setScanLoading(true)
    setScanResult(null)
    try {
      const res = await fetch('/api/agents/scan', { method: 'POST' })
      const json = await res.json()
      setScanResult(json.message ?? t('agentSettings.scanComplete'))
    } catch { setScanResult(t('agentSettings.scanFailed')) }
    finally { setScanLoading(false) }
  }

  // Runs the negotiation tick loop for this org only, right now — bypasses
  // the GitHub Actions cron entirely (org_admin session auth, see
  // app/api/agents/tick/route.ts POST branch), so it works even if the cron
  // secrets were never configured or the schedule hasn't fired yet.
  async function runTick() {
    setTickLoading(true)
    setTickResult(null)
    try {
      const res = await fetch('/api/agents/tick', { method: 'POST' })
      const json = await res.json()
      if (!res.ok) { setTickResult(json.error ?? t('agentSettings.tickFailed')); return }
      if (!json.processed) { setTickResult(t('agentSettings.noActiveNegotiations')); return }
      const summary = (json.results ?? []).map((r: { outcome: string }) => r.outcome).join(', ')
      setTickResult(t('agentSettings.processedNegotiations', { count: json.processed, summary }))
    } catch { setTickResult(t('agentSettings.tickFailedConsole')) }
    finally { setTickLoading(false) }
  }

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

  useEffect(() => { loadPrefs(); loadAgentConfig() }, [loadPrefs, loadAgentConfig])

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
          { label: t('teamPage.settings'), onClick: () => router.push('/settings') },
          { label: t('agentSettings.aiAgentPreferences') },
        ]}
        actions={<NotifBell />}
      />

      <div className="page">
        <div className="page-header">
          <h1 className="t-page-title">{t('agentSettings.aiAgentPreferences')}</h1>
          <div className="subtitle">{t('agentSettings.subtitle')}</div>
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
            {t('agentSettings.introHint')}
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
              ← {t('agentSettings.generalSettings')}
            </button>
            <button type="button" className="btn btn-primary btn-sm" style={{ cursor: 'default' }}>
              {t('agentSettings.aiAgent')}
            </button>
          </div>

          {/* ── Autonomous Agent Config ── */}
          <div style={{
            background: 'var(--white)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-card)',
            padding: '20px 22px',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{t('agentSettings.autonomousAgent')}</div>
                <div style={{ fontSize: 12.5, color: 'var(--gray)', marginTop: 3, lineHeight: 1.5 }}>
                  {t('agentSettings.autonomousAgentHint')}
                </div>
              </div>
              <Toggle
                checked={agent.is_active}
                onChange={toggleAgent}
                label={t('agentSettings.activateAgent')}
              />
            </div>

            {agent.is_active && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--gray)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '.04em' }}>
                    {t('agentSettings.agentName')}
                  </label>
                  <input
                    type="text"
                    className="input"
                    value={agent.name}
                    onChange={(e) => setAgent((a) => ({ ...a, name: e.target.value }))}
                    placeholder="e.g. Westcoast Agent"
                    style={{ maxWidth: 320 }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--gray)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '.04em' }}>
                    {t('agentSettings.focusPersona')}
                  </label>
                  <textarea
                    className="input"
                    rows={2}
                    value={agent.persona}
                    onChange={(e) => setAgent((a) => ({ ...a, persona: e.target.value }))}
                    placeholder="e.g. Optimise cash flow and find the lowest-cost financing options for AR invoices"
                    style={{ resize: 'vertical', width: '100%' }}
                  />
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={saveAgentConfig}
                    disabled={agentSaving}
                  >
                    {agentSaving ? t('newListing.saving') : agentSaved ? t('agentSettings.savedCheck') : t('agentSettings.saveAgentConfig')}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={runScan}
                    disabled={scanLoading}
                  >
                    {scanLoading ? t('agentSettings.scanning') : t('agentSettings.runScanNow')}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={runTick}
                    disabled={tickLoading}
                    title={t('agentSettings.runTickTitle')}
                  >
                    {tickLoading ? t('agentSettings.ticking') : t('agentSettings.runNegotiationTickNow')}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => router.push('/ai?tab=agent')}
                  >
                    {t('agentSettings.viewTaskQueue')}
                  </button>
                </div>
                {scanResult && (
                  <div style={{ fontSize: 13, color: 'var(--color-green)', padding: '8px 12px', background: '#EDFAF4', borderRadius: 'var(--radius-sm)' }}>
                    {scanResult}
                  </div>
                )}
                {tickResult && (
                  <div style={{ fontSize: 13, color: 'var(--color-green)', padding: '8px 12px', background: '#EDFAF4', borderRadius: 'var(--radius-sm)' }}>
                    {tickResult}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Rate Floor ── */}
          <PrefCard
            title={t('agentSettings.minRateTitle')}
            description={t('agentSettings.minRateDesc')}
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
            title={t('agentSettings.maxRateTitle')}
            description={t('agentSettings.maxRateDesc')}
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
            title={t('agentSettings.minScoreTitle')}
            description={t('agentSettings.minScoreDesc')}
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
                    color: riskTierLabel(p.min_passport_score.value as number, t).color,
                  }}
                >
                  {riskTierLabel(p.min_passport_score.value as number, t).label}
                </span>
              )}
            </div>
          </PrefCard>

          {/* ── Auto-reject Below Score ── */}
          <PrefCard
            title={t('agentSettings.autoRejectTitle')}
            description={t('agentSettings.autoRejectDesc')}
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
                    color: riskTierLabel(p.auto_reject_below_score.value as number, t).color,
                  }}
                >
                  {riskTierLabel(p.auto_reject_below_score.value as number, t).label}
                </span>
              )}
            </div>
          </PrefCard>

          {/* ── Max Deal Value (Auto) ── */}
          <PrefCard
            title={t('agentSettings.maxDealValueTitle')}
            description={t('agentSettings.maxDealValueDesc')}
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
            title={t('agentSettings.preferredTenorTitle')}
            description={t('agentSettings.preferredTenorDesc')}
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
            title={t('agentSettings.blacklistedTitle')}
            description={t('agentSettings.blacklistedDesc')}
            state={p.blacklist_countries}
            onStateChange={(s) => updatePref('blacklist_countries', s)}
            onSave={() => savePref('blacklist_countries')}
            saving={saving === 'blacklist_countries'}
            saved={!!saved.blacklist_countries}
          >
            <div>
              <div style={{ fontSize: 12, color: 'var(--gray)', marginBottom: 4 }}>
                {t('agentSettings.countriesSelected', { count: (p.blacklist_countries.value as string[]).length })}
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
            title={t('agentSettings.preferredIncotermsTitle')}
            description={t('agentSettings.preferredIncotermsDesc')}
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
