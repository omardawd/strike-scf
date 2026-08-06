import ExcelJS from 'exceljs'
import PDFDocument from 'pdfkit'
import { adminClient } from '../admin'
import { getOrgTradeStats } from '@/lib/passport/trade-stats'

export interface GenerateDocumentInput {
  document_type: 'trades_export' | 'passport_score_report'
  org_id?: string
  bank_id?: string
  date_range_days?: number
  title?: string
}

const BUCKET = 'ai-generated-documents'
const SIGNED_URL_TTL_SECONDS = 30 * 60

async function ensureBucket() {
  const { error } = await adminClient.storage.createBucket(BUCKET, {
    public: false,
    fileSizeLimit: 10 * 1024 * 1024,
  })
  if (error && !String(error.message ?? '').toLowerCase().includes('already')) {
    console.error('[generate_document] bucket create error:', error)
  }
}

async function uploadAndSign(path: string, buffer: Buffer, contentType: string): Promise<{ url: string } | { error: string }> {
  await ensureBucket()
  const { error: upErr } = await adminClient.storage.from(BUCKET).upload(path, buffer, { contentType, upsert: true })
  if (upErr) return { error: `Upload failed: ${upErr.message}` }
  const { data, error: signErr } = await adminClient.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_TTL_SECONDS)
  if (signErr || !data) return { error: `Failed to create a download link: ${signErr?.message ?? 'unknown error'}` }
  return { url: data.signedUrl }
}

interface DealRow {
  id: string
  deal_source: string
  status: string
  created_at: string
  total_value: number | null
  agreed_price: number | null
  buyer_org_id: string
  supplier_org_id: string
  buyer: { legal_name: string | null; doing_business_as: string | null } | null
  supplier: { legal_name: string | null; doing_business_as: string | null } | null
}

interface TransactionRow {
  id: string
  type: string
  status: string
  created_at: string
  invoice_amount: number | null
  financing_amount_approved: number | null
  financing_rate_apr: number | null
  anchor: { legal_name: string | null } | null
  supplier: { legal_name: string | null } | null
}

async function buildTradesExport(input: GenerateDocumentInput) {
  if (!input.org_id && !input.bank_id) return { error: 'org_id or bank_id is required for trades_export' }

  const days = input.date_range_days ?? 28
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString()

  const wb = new ExcelJS.Workbook()
  wb.creator = 'Strike AI'
  wb.created = new Date()
  const sheet = wb.addWorksheet('Trades')
  let rowCount = 0

  if (input.org_id) {
    const { data, error } = await adminClient
      .from('deals')
      .select(
        'id, deal_source, status, created_at, total_value, agreed_price, buyer_org_id, supplier_org_id, ' +
        'buyer:organizations!deals_buyer_org_id_fkey(legal_name, doing_business_as), ' +
        'supplier:organizations!deals_supplier_org_id_fkey(legal_name, doing_business_as)'
      )
      .or(`buyer_org_id.eq.${input.org_id},supplier_org_id.eq.${input.org_id}`)
      .gte('created_at', cutoff)
      .order('created_at', { ascending: false })
      .limit(500)
    if (error) return { error: `Failed to fetch deals: ${error.message}` }
    const deals = (data ?? []) as unknown as DealRow[]
    rowCount = deals.length

    sheet.columns = [
      { header: 'Deal ID', key: 'id', width: 38 },
      { header: 'Source', key: 'deal_source', width: 12 },
      { header: 'Status', key: 'status', width: 20 },
      { header: 'Role', key: 'role', width: 10 },
      { header: 'Counterparty', key: 'counterparty', width: 30 },
      { header: 'Value (USD)', key: 'value', width: 14 },
      { header: 'Created', key: 'created_at', width: 14 },
    ]
    for (const d of deals) {
      const isBuyer = d.buyer_org_id === input.org_id
      sheet.addRow({
        id: d.id,
        deal_source: d.deal_source,
        status: d.status,
        role: isBuyer ? 'Buyer' : 'Supplier',
        counterparty: isBuyer
          ? (d.supplier?.doing_business_as ?? d.supplier?.legal_name ?? '—')
          : (d.buyer?.doing_business_as ?? d.buyer?.legal_name ?? '—'),
        value: Number(d.total_value ?? d.agreed_price ?? 0),
        created_at: new Date(d.created_at).toISOString().slice(0, 10),
      })
    }
  } else {
    const { data, error } = await adminClient
      .from('transactions')
      .select(
        'id, type, status, created_at, invoice_amount, financing_amount_approved, financing_rate_apr, ' +
        'anchor:organizations!transactions_anchor_id_fkey(legal_name), ' +
        'supplier:organizations!transactions_supplier_id_fkey(legal_name)'
      )
      .eq('bank_id', input.bank_id)
      .gte('created_at', cutoff)
      .order('created_at', { ascending: false })
      .limit(500)
    if (error) return { error: `Failed to fetch transactions: ${error.message}` }
    const txns = (data ?? []) as unknown as TransactionRow[]
    rowCount = txns.length

    sheet.columns = [
      { header: 'Transaction ID', key: 'id', width: 38 },
      { header: 'Type', key: 'type', width: 18 },
      { header: 'Status', key: 'status', width: 24 },
      { header: 'Anchor', key: 'anchor', width: 28 },
      { header: 'Supplier', key: 'supplier', width: 28 },
      { header: 'Invoice Amount (USD)', key: 'invoice_amount', width: 18 },
      { header: 'Financed Amount (USD)', key: 'financed', width: 18 },
      { header: 'Rate (APR %)', key: 'rate', width: 12 },
      { header: 'Created', key: 'created_at', width: 14 },
    ]
    for (const t of txns) {
      sheet.addRow({
        id: t.id,
        type: t.type,
        status: t.status,
        anchor: t.anchor?.legal_name ?? '—',
        supplier: t.supplier?.legal_name ?? '—',
        invoice_amount: Number(t.invoice_amount ?? 0),
        financed: Number(t.financing_amount_approved ?? 0),
        rate: t.financing_rate_apr ?? null,
        created_at: new Date(t.created_at).toISOString().slice(0, 10),
      })
    }
  }

  const headerRow = sheet.getRow(1)
  headerRow.font = { bold: true }
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF0FF' } }

  const arrayBuffer = await wb.xlsx.writeBuffer()
  const filename = `strike_trades_export_${Date.now()}.xlsx`
  const scopeId = input.org_id ?? input.bank_id
  const path = `${scopeId}/${filename}`
  const uploaded = await uploadAndSign(
    path,
    Buffer.from(arrayBuffer),
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  )
  if ('error' in uploaded) return uploaded

  return {
    success: true,
    document_type: 'trades_export',
    format: 'xlsx',
    filename,
    download_url: uploaded.url,
    row_count: rowCount,
    date_range_days: days,
    expires_in_minutes: SIGNED_URL_TTL_SECONDS / 60,
  }
}

async function buildPassportScoreReport(input: GenerateDocumentInput) {
  if (!input.org_id) return { error: 'org_id is required for passport_score_report' }

  const { data: org, error } = await adminClient
    .from('organizations')
    .select('legal_name, doing_business_as, type, passport_score, risk_tier, kyb_status, passport_score_reasoning, passport_expert_analysis')
    .eq('id', input.org_id)
    .single()
  if (error || !org) return { error: `Failed to fetch organization: ${error?.message ?? 'not found'}` }

  const [{ data: creditScore }, { data: reviews }, tradeStats] = await Promise.all([
    adminClient
      .from('credit_scores')
      .select('total_score, risk_tier, score_business_longevity, score_revenue_scale, score_document_completeness, score_financial_health, score_program_fit, score_counterparty_tenure, created_at')
      .eq('org_id', input.org_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    adminClient
      .from('passport_peer_reviews')
      .select('rating')
      .eq('reviewed_org_id', input.org_id)
      .eq('is_public', true),
    getOrgTradeStats(adminClient, input.org_id),
  ])

  const name = org.doing_business_as ?? org.legal_name ?? 'Organization'
  const reviewList: { rating: number }[] = reviews ?? []
  const avgRating = reviewList.length > 0
    ? reviewList.reduce((s, r) => s + r.rating, 0) / reviewList.length
    : null

  const chunks: Buffer[] = []
  const buffer = await new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margins: { top: 50, bottom: 50, left: 50, right: 50 }, bufferPages: true })
    doc.on('data', (c: Buffer) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    const BLUE = '#1428CC'
    const DARK = '#0D0D0D'
    const GRAY = '#6B7280'

    doc.rect(50, 50, 3, 40).fill(BLUE)
    doc.font('Helvetica-Bold').fontSize(18).fillColor(DARK).text(name, 65, 50)
    doc.font('Helvetica').fontSize(9).fillColor(GRAY).text('Strike PassportScore Report', 65, 74)
    doc.font('Helvetica').fontSize(8).fillColor(GRAY).text(`Generated ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`, 65, 88)
    doc.moveTo(50, 110).lineTo(545, 110).strokeColor(BLUE).lineWidth(1).stroke()

    let y = 130
    doc.font('Helvetica-Bold').fontSize(40).fillColor(BLUE).text(org.passport_score != null ? String(org.passport_score) : '—', 50, y)
    doc.font('Helvetica').fontSize(10).fillColor(GRAY).text('PassportScore', 50, y + 46)
    doc.font('Helvetica-Bold').fontSize(11).fillColor(DARK).text(`Risk tier: ${org.risk_tier ?? 'Unrated'}`, 200, y + 6)
    doc.font('Helvetica').fontSize(10).fillColor(GRAY).text(`KYB status: ${org.kyb_status}`, 200, y + 22)

    y += 90
    doc.font('Helvetica-Bold').fontSize(12).fillColor(DARK).text('Trade History', 50, y)
    y += 20
    doc.font('Helvetica').fontSize(10).fillColor(DARK)
      .text(`Total trades: ${tradeStats.trade_count_total}`, 50, y)
      .text(`Total volume: $${tradeStats.trade_volume_total.toLocaleString('en-US')}`, 50, y + 16)
      .text(`On-time payment rate: ${tradeStats.on_time_payment_rate != null ? tradeStats.on_time_payment_rate.toFixed(0) + '%' : 'N/A'}`, 50, y + 32)
      .text(`Avg peer review: ${avgRating != null ? avgRating.toFixed(1) + ' / 5 (' + reviewList.length + ' reviews)' : 'No reviews yet'}`, 50, y + 48)

    if (creditScore) {
      y += 80
      doc.font('Helvetica-Bold').fontSize(12).fillColor(DARK).text('Credit Score Breakdown', 50, y)
      y += 20
      const rows: [string, number | null][] = [
        ['Business longevity', creditScore.score_business_longevity],
        ['Revenue scale', creditScore.score_revenue_scale],
        ['Document completeness', creditScore.score_document_completeness],
        ['Financial health', creditScore.score_financial_health],
        ['Program fit', creditScore.score_program_fit],
        ['Counterparty tenure', creditScore.score_counterparty_tenure],
      ]
      for (const [label, val] of rows) {
        doc.font('Helvetica').fontSize(9.5).fillColor(GRAY).text(label, 50, y)
        doc.font('Helvetica-Bold').fontSize(9.5).fillColor(DARK).text(val != null ? String(val) : '—', 250, y)
        y += 15
      }
    }

    if (org.passport_score_reasoning) {
      y += 20
      doc.font('Helvetica-Bold').fontSize(12).fillColor(DARK).text('AI Assessment', 50, y)
      y += 18
      doc.font('Helvetica').fontSize(9.5).fillColor(DARK).text(org.passport_score_reasoning, 50, y, { width: 495, lineGap: 2 })
    }

    doc.end()
  })

  const filename = `strike_passport_report_${Date.now()}.pdf`
  const path = `${input.org_id}/${filename}`
  const uploaded = await uploadAndSign(path, buffer, 'application/pdf')
  if ('error' in uploaded) return uploaded

  return {
    success: true,
    document_type: 'passport_score_report',
    format: 'pdf',
    filename,
    download_url: uploaded.url,
    org_name: name,
    passport_score: org.passport_score,
    expires_in_minutes: SIGNED_URL_TTL_SECONDS / 60,
  }
}

export async function generateDocument(input: GenerateDocumentInput) {
  if (input.document_type === 'trades_export') return buildTradesExport(input)
  if (input.document_type === 'passport_score_report') return buildPassportScoreReport(input)
  return { error: `Unknown document_type: ${input.document_type}` }
}
