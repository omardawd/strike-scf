import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const COUNTRY_RISK_UPDATES = [
  {
    country_code: 'CN',
    value: 82,
    metadata: {
      label: 'China',
      tariff_risk: 'high',
      geo_risk: 'high',
      hts_tariff_pct: 145,
      note: 'Section 301 + reciprocal tariffs. 145% effective rate as of May 2025.',
      sources: 'USTR Section 301 action + Executive Order April 2025',
    }
  },
  {
    country_code: 'VN',
    value: 65,
    metadata: {
      label: 'Vietnam',
      tariff_risk: 'high',
      geo_risk: 'low',
      hts_tariff_pct: 46,
      note: '46% reciprocal tariff. 90-day pause in effect — subject to reinstatement.',
      sources: 'Executive Order April 2025, 90-day pause announced May 2025',
    }
  },
  {
    country_code: 'BD',
    value: 48,
    metadata: {
      label: 'Bangladesh',
      tariff_risk: 'high',
      geo_risk: 'low',
      hts_tariff_pct: 37,
      note: '37% reciprocal tariff announced. Garment sector primary exposure.',
      sources: 'Executive Order April 2025',
    }
  },
  {
    country_code: 'IN',
    value: 40,
    metadata: {
      label: 'India',
      tariff_risk: 'medium',
      geo_risk: 'low',
      hts_tariff_pct: 26,
      note: '26% reciprocal tariff. Pharma and electronics most affected.',
      sources: 'Executive Order April 2025',
    }
  },
  {
    country_code: 'MX',
    value: 22,
    metadata: {
      label: 'Mexico',
      tariff_risk: 'low',
      geo_risk: 'low',
      hts_tariff_pct: 0,
      note: 'USMCA-compliant goods exempt. Non-USMCA goods subject to 25% tariff.',
      sources: 'USMCA 2020, Executive Order March 2025',
    }
  },
  {
    country_code: 'US',
    value: 2,
    metadata: {
      label: 'United States',
      tariff_risk: 'none',
      geo_risk: 'none',
      hts_tariff_pct: 0,
      note: 'Domestic sourcing. No tariff exposure.',
      sources: 'N/A',
    }
  },
  {
    country_code: 'TR',
    value: 42,
    metadata: {
      label: 'Turkey',
      tariff_risk: 'medium',
      geo_risk: 'medium',
      hts_tariff_pct: 10,
      note: 'Steel and aluminum tariffs active. Regional geopolitical risk elevated.',
      sources: 'Section 232 tariffs, State Dept advisory',
    }
  },
  {
    country_code: 'PK',
    value: 50,
    metadata: {
      label: 'Pakistan',
      tariff_risk: 'high',
      geo_risk: 'medium',
      hts_tariff_pct: 29,
      note: '29% reciprocal tariff. Textile sector primary exposure.',
      sources: 'Executive Order April 2025',
    }
  },
  {
    country_code: 'KH',
    value: 68,
    metadata: {
      label: 'Cambodia',
      tariff_risk: 'high',
      geo_risk: 'low',
      hts_tariff_pct: 49,
      note: '49% reciprocal tariff. Apparel and footwear sector heavily exposed.',
      sources: 'Executive Order April 2025',
    }
  },
  {
    country_code: 'ID',
    value: 55,
    metadata: {
      label: 'Indonesia',
      tariff_risk: 'high',
      geo_risk: 'low',
      hts_tariff_pct: 32,
      note: '32% reciprocal tariff. Manufacturing and commodities exposed.',
      sources: 'Executive Order April 2025',
    }
  },
  {
    country_code: 'TH',
    value: 52,
    metadata: {
      label: 'Thailand',
      tariff_risk: 'high',
      geo_risk: 'low',
      hts_tariff_pct: 36,
      note: '36% reciprocal tariff. Electronics and auto parts primary exposure.',
      sources: 'Executive Order April 2025',
    }
  },
  {
    country_code: 'MY',
    value: 44,
    metadata: {
      label: 'Malaysia',
      tariff_risk: 'medium',
      geo_risk: 'low',
      hts_tariff_pct: 24,
      note: '24% reciprocal tariff. Semiconductor and electronics exposure.',
      sources: 'Executive Order April 2025',
    }
  },
]

async function fetchFXRates() {
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD', {
      next: { revalidate: 3600 },
    })
    if (!res.ok) return null
    const data = await res.json()
    return data.rates
  } catch {
    return null
  }
}

export async function GET(request: Request) {
  const secret = request.headers.get('x-cron-secret')
  if (secret !== process.env.CRON_SECRET && process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  for (const signal of COUNTRY_RISK_UPDATES) {
    await adminClient
      .from('market_signals')
      .upsert(
        {
          signal_type: 'country_risk',
          country_code: signal.country_code,
          value: signal.value,
          metadata: signal.metadata,
          source: 'cron_refresh',
          fetched_at: new Date().toISOString(),
        },
        { onConflict: 'signal_type,country_code' }
      )
  }

  const fxRates = await fetchFXRates()
  const fxPairs = [
    'CNY', 'VND', 'BDT', 'INR', 'MXN',
    'TRY', 'PKR', 'KHR', 'IDR', 'THB',
    'MYR', 'EUR', 'GBP', 'SGD', 'HKD'
  ]

  if (fxRates) {
    for (const currency of fxPairs) {
      if (fxRates[currency]) {
        await adminClient
          .from('market_signals')
          .upsert(
            {
              signal_type: 'fx_rate',
              country_code: currency,
              value: fxRates[currency],
              metadata: {
                base: 'USD',
                currency,
                rate: fxRates[currency],
                label: `1 USD = ${fxRates[currency].toFixed(2)} ${currency}`,
              },
              source: 'open.er-api.com',
              fetched_at: new Date().toISOString(),
            },
            { onConflict: 'signal_type,country_code' }
          )
      }
    }
  }

  return NextResponse.json({
    refreshed_country_signals: COUNTRY_RISK_UPDATES.length,
    refreshed_fx_rates: fxRates ? fxPairs.length : 0,
    countries_updated: COUNTRY_RISK_UPDATES.map(
      c => `${c.metadata.label}: ${c.metadata.hts_tariff_pct}%`
    ),
    timestamp: new Date().toISOString(),
  })
}
