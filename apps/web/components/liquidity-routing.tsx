'use client'

import { useState, useEffect } from 'react'

interface LiquidityRoutingProps {
  program: any
  orgId: string
  invoiceAmount?: number
  onSuggestion?: (rate: number) => void
}

export function LiquidityRouting({ program, orgId, invoiceAmount, onSuggestion }: LiquidityRoutingProps) {
  const [recommendation, setRecommendation] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!program || !orgId) return
    generateRecommendation()
  }, [program?.id])

  async function generateRecommendation() {
    setLoading(true)
    try {
      const riskRes = await fetch('/api/risk/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ org_id: orgId }),
      })

      const riskData = riskRes.ok ? await riskRes.json() : null

      const financingType = program.financing_types?.[0]
      const flags = riskData?.risk_flags ?? []
      const hasTariff = flags.some((f: any) => f.code === 'tariff_exposed')
      const isHighRisk = riskData?.risk_tier === 'red'

      let rec = {
        financing_type: financingType,
        advance_rate_suggestion: 80,
        rationale: '',
        urgency: 'normal',
      }

      if (financingType === 'po_financing' && hasTariff) {
        rec.rationale = `PO Financing recommended. Your tariff exposure means early capital is critical to lock in production costs before further volatility.`
        rec.urgency = 'high'
        rec.advance_rate_suggestion = 85
      } else if (financingType === 'reverse_factoring' && isHighRisk) {
        rec.rationale = `Your risk profile suggests submitting invoices promptly. Early payment strengthens your financial position and improves your platform trust score.`
        rec.urgency = 'medium'
        rec.advance_rate_suggestion = 75
      } else if (financingType === 'invoice_factoring') {
        rec.rationale = `Invoice Factoring allows you to access capital immediately after delivery. Submit your invoice as soon as goods are delivered for fastest processing.`
        rec.advance_rate_suggestion = 80
      } else {
        rec.rationale = `Based on your profile and this program's terms, an advance rate of ${rec.advance_rate_suggestion}% is a strong opening offer.`
      }

      const full = { ...rec, riskData }
      setRecommendation(full)
      onSuggestion?.(rec.advance_rate_suggestion)
    } catch (err) {
      console.error('Routing error:', err)
    }
    setLoading(false)
  }

  if (loading) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '12px 16px',
        border: '1px solid rgba(20,40,204,0.2)',
        background: 'rgba(20,40,204,0.02)',
        fontFamily: 'var(--font-mono)',
        fontSize: 10,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color: 'var(--blue)',
      }}>
        <div style={{
          width: 5, height: 5,
          borderRadius: '50%',
          background: 'var(--blue)',
          animation: 'badge-pulse 2.4s infinite',
        }} />
        Strike AI · Analyzing your profile...
      </div>
    )
  }

  if (!recommendation) return null

  return (
    <div style={{
      border: '1px solid rgba(20,40,204,0.2)',
      background: 'rgba(20,40,204,0.02)',
    }}>
      <div style={{
        padding: '10px 16px',
        borderBottom: '1px solid rgba(20,40,204,0.1)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}>
        <div style={{
          width: 5, height: 5,
          borderRadius: '50%',
          background: 'var(--blue)',
          animation: 'badge-pulse 2.4s infinite',
        }} />
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: 'var(--blue)',
        }}>Strike AI · Financing Insight</span>

        {recommendation.urgency === 'high' && (
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 9,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: '#DC2626',
            border: '1px solid rgba(220,38,38,0.3)',
            padding: '2px 6px',
            marginLeft: 'auto',
          }}>⚠ Urgent</span>
        )}
      </div>

      <div style={{ padding: '14px 16px' }}>
        <div style={{
          fontFamily: 'var(--font-body)',
          fontSize: 13,
          color: 'var(--ink)',
          lineHeight: 1.6,
          marginBottom: 12,
        }}>
          {recommendation.rationale}
        </div>

        <div style={{ display: 'flex', gap: 1, background: 'var(--border)' }}>
          {([
            ['Suggested advance rate', `${recommendation.advance_rate_suggestion}%`],
            ['Risk tier', recommendation.riskData?.risk_tier?.toUpperCase() ?? 'UNSCORED'],
            ['Program type', recommendation.financing_type?.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()) ?? '—'],
          ] as [string, string][]).map(([label, value]) => (
            <div key={label} style={{ flex: 1, background: 'var(--white)', padding: '10px 12px' }}>
              <div style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 9,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: 'var(--gray)',
                marginBottom: 4,
              }}>{label}</div>
              <div style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 14,
                color: label === 'Suggested advance rate' ? 'var(--blue)' : 'var(--ink)',
                fontWeight: 500,
              }}>{value}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
