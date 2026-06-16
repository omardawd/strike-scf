'use client'
import React, { useState, useEffect, useRef, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Topbar } from '@/components/portal-shell'
import type { ListingType } from '@strike-scf/types'

interface LineItem {
  id: string
  name: string
  description: string
  quantity: string
  unit: string
  unit_price: string
}

const EMPTY_LINE_ITEM = (): LineItem => ({
  id: Math.random().toString(36).slice(2),
  name: '',
  description: '',
  quantity: '',
  unit: 'MT',
  unit_price: '',
})

const CATEGORIES = [
  'Electronics & Components',
  'Raw Materials',
  'Agricultural Commodities',
  'Chemicals & Plastics',
  'Textiles & Apparel',
  'Industrial Equipment',
  'Food & Beverage',
  'Construction Materials',
  'Pharmaceuticals',
  'Packaging',
  'Other',
]

const INCOTERMS = ['EXW', 'FCA', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP', 'FAS', 'FOB', 'CFR', 'CIF']

const PAYMENT_TERMS = [
  'Net 30',
  'Net 60',
  'Net 90',
  '30% upfront, 70% on delivery',
  '50% upfront, 50% on delivery',
  'Letter of Credit (LC)',
  'Documentary Collection',
  'Open Account',
]

const CURRENCIES = ['USD', 'EUR', 'GBP', 'AED', 'SGD', 'JPY', 'CNY']

interface FormState {
  title: string
  description: string
  category: string
  currency: string
  incoterms: string
  delivery_location: string
  delivery_deadline: string
  expires_at: string
  payment_terms: string
}

const DEFAULT_FORM: FormState = {
  title: '',
  description: '',
  category: '',
  currency: 'USD',
  incoterms: '',
  delivery_location: '',
  delivery_deadline: '',
  expires_at: '',
  payment_terms: '',
}

function NewListingPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [listingType, setListingType] = useState<ListingType>('po_request')
  const [form, setForm] = useState<FormState>(DEFAULT_FORM)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [visibility, setVisibility] = useState<'public' | 'network_only'>('public')
  const [networkId, setNetworkId] = useState<string>('')
  const [networks, setNetworks] = useState<any[]>([])
  const [lineItems, setLineItems] = useState<LineItem[]>([EMPTY_LINE_ITEM()])
  const [extracting, setExtracting] = useState(false)
  const [extractError, setExtractError] = useState<string | null>(null)
  const [uploadedFile, setUploadedFile] = useState<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const qNetworkId  = searchParams.get('network_id')
    const qVisibility = searchParams.get('visibility')
    if (qNetworkId)  setNetworkId(qNetworkId)
    if (qVisibility === 'network_only') setVisibility('network_only')
  }, [])

  useEffect(() => {
    fetch('/api/networks')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setNetworks(data.networks ?? []) })
      .catch(() => {})
  }, [])

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }))
  }

  const addLineItem = () => setLineItems(prev => [...prev, EMPTY_LINE_ITEM()])

  const removeLineItem = (id: string) =>
    setLineItems(prev => prev.length > 1 ? prev.filter(i => i.id !== id) : prev)

  const updateLineItem = (id: string, field: keyof LineItem, value: string) =>
    setLineItems(prev => prev.map(i => i.id === id ? { ...i, [field]: value } : i))

  const handleFileSelect = (file: File) => {
    setUploadedFile(file)
    setExtractError(null)
  }

  const handleAutoComplete = async () => {
    if (!uploadedFile) return
    setExtractError(null)
    setExtracting(true)
    try {
      const fd = new FormData()
      fd.append('file', uploadedFile)
      const res = await fetch('/api/marketplace/listings/extract', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) {
        setExtractError(data.error ?? 'Extraction failed. Please enter details manually.')
        return
      }

      // Fill form fields
      setForm(prev => ({
        ...prev,
        title: data.title || prev.title,
        description: data.description || prev.description,
        category: data.category || prev.category,
        currency: data.currency || prev.currency,
        incoterms: data.incoterms || prev.incoterms,
        delivery_location: data.delivery_location || prev.delivery_location,
        delivery_deadline: data.delivery_deadline || prev.delivery_deadline,
        payment_terms: data.payment_terms || prev.payment_terms,
      }))

      // Fill line items
      const extracted = data.items ?? []
      if (extracted.length > 0) {
        setLineItems(extracted.map((item: any) => ({
          id: Math.random().toString(36).slice(2),
          name: item.name ?? '',
          description: item.description ?? '',
          quantity: item.quantity != null ? String(item.quantity) : '',
          unit: item.unit ?? 'MT',
          unit_price: item.unit_price != null ? String(item.unit_price) : '',
        })))
      }
    } catch {
      setExtractError('Could not reach extraction service. Please try again.')
    } finally {
      setExtracting(false)
    }
  }

  const computedTargetPrice = (() => {
    let total = 0
    for (const item of lineItems) {
      const qty = parseFloat(item.quantity)
      const price = parseFloat(item.unit_price)
      if (!isNaN(qty) && !isNaN(price) && qty > 0 && price > 0) {
        total += qty * price
      }
    }
    return total > 0 ? total : undefined
  })()

  const buildPayload = (status?: 'draft') => ({
    listing_type: listingType,
    title: form.title.trim(),
    description: form.description.trim() || undefined,
    category: form.category || undefined,
    target_price: computedTargetPrice,
    currency: form.currency || 'USD',
    incoterms: form.incoterms || undefined,
    delivery_location: form.delivery_location.trim() || undefined,
    delivery_deadline: form.delivery_deadline || undefined,
    expires_at: form.expires_at || undefined,
    payment_terms: form.payment_terms || undefined,
    visibility,
    network_id: visibility === 'network_only' ? (networkId || undefined) : undefined,
    ...(status ? { status } : {}),
  })

  const submit = async (asDraft: boolean) => {
    if (!form.title.trim()) {
      setError('Title is required.')
      return
    }
    if (!asDraft && visibility === 'network_only' && !networkId) {
      setError('Please select a network for this private listing.')
      return
    }
    setError(null)
    setLoading(true)
    try {
      const res = await fetch('/api/marketplace/listings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(asDraft ? buildPayload('draft') : buildPayload()),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Something went wrong. Please try again.')
        return
      }
      const listingId = data.listing.id

      const validItems = lineItems.filter(i => i.name.trim())
      if (validItems.length > 0) {
        await Promise.allSettled(validItems.map((item, idx) =>
          fetch(`/api/marketplace/listings/${listingId}/line-items`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: item.name.trim(),
              description: item.description.trim() || null,
              quantity: item.quantity ? parseFloat(item.quantity) : null,
              unit: item.unit || null,
              unit_price: item.unit_price ? parseFloat(item.unit_price) : null,
              currency: form.currency || 'USD',
              sort_order: idx,
            }),
          })
        ))

        // Compute total from all saved line items and patch the listing
        const total = validItems.reduce((sum, item) => {
          const qty = parseFloat(item.quantity)
          const price = parseFloat(item.unit_price)
          return sum + (isNaN(qty) || isNaN(price) ? 0 : qty * price)
        }, 0)
        if (total > 0) {
          await fetch(`/api/marketplace/listings/${listingId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ target_price: total }),
          })
        }
      }

      // Upload attached document to the listing
      if (uploadedFile) {
        const fd = new FormData()
        fd.append('file', uploadedFile)
        await fetch(`/api/marketplace/listings/${listingId}/document`, {
          method: 'POST',
          body: fd,
        }).catch(() => {})
      }

      router.push(asDraft ? '/marketplace' : `/marketplace/listings/${listingId}`)
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <Topbar
        crumbs={[
          { label: 'Strike Place', onClick: () => router.push('/marketplace') },
          { label: 'New Listing' },
        ]}
        onBack={() => router.push('/marketplace')}
        actions={
          <div className="topbar-right">
            <button className="btn btn-ghost btn-sm" disabled={loading} onClick={() => submit(true)}>
              {loading ? 'Saving…' : 'Save Draft'}
            </button>
            <button className="btn btn-blue btn-sm" disabled={loading} onClick={() => submit(false)}>
              {loading ? 'Publishing…' : 'Publish Listing'}
            </button>
          </div>
        }
      />

      <div className="page" style={{ maxWidth: 1200 }}>
        <div className="page-header">
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em' }}>
            Create a Listing
          </h1>
          <p className="subtitle">Post a purchase request or offer a product to Strike Place.</p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 20, alignItems: 'start' }}>
          {/* Left — Form */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Listing type toggle */}
            <div className="card">
              <div className="card-body" style={{ padding: '20px 24px' }}>
                <div className="mp-form-section-label">Listing Type</div>
                <div className="listing-type-toggle">
                  <button
                    type="button"
                    className={`listing-type-toggle-btn${listingType === 'po_request' ? ' listing-type-toggle-btn-active-po' : ''}`}
                    onClick={() => setListingType('po_request')}
                  >
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 2h10v12l-2-1.2-2 1.2-2-1.2-2 1.2L3 13zM5.5 6h5M5.5 9h5" />
                    </svg>
                    PO Request
                    <span style={{ fontSize: 11, fontWeight: 400, opacity: 0.7 }}>— I want to buy</span>
                  </button>
                  <button
                    type="button"
                    className={`listing-type-toggle-btn${listingType === 'product_service' ? ' listing-type-toggle-btn-active-product' : ''}`}
                    onClick={() => setListingType('product_service')}
                  >
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M2 5l6-3 6 3v6l-6 3-6-3zM2 5l6 3 6-3M8 8v6" />
                    </svg>
                    Product / Service
                    <span style={{ fontSize: 11, fontWeight: 400, opacity: 0.7 }}>— I want to sell</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Core listing fields */}
            <div className="card">
              <div className="card-head">Listing Details</div>
              <div className="card-body">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

                  <div className="form-field">
                    <label className="field-label">Title</label>
                    <input
                      type="text"
                      name="title"
                      className="input"
                      value={form.title}
                      onChange={handleChange}
                      placeholder={listingType === 'po_request'
                        ? 'e.g. 500 MT of HDPE Pellets — Q3 Delivery'
                        : 'e.g. Stainless Steel Sheet 304 Grade — Ex-Works Shanghai'}
                    />
                  </div>

                  <div className="form-field">
                    <label className="field-label">Description</label>
                    <textarea
                      name="description"
                      className="input"
                      rows={4}
                      value={form.description}
                      onChange={handleChange}
                      placeholder="Describe the goods, specifications, quality standards, certifications required, etc."
                      style={{ height: 'auto', padding: '10px 12px', resize: 'vertical', lineHeight: 1.6 }}
                    />
                  </div>

                  <div className="form-field">
                    <label className="field-label">Category</label>
                    <select
                      name="category"
                      className="input form-select"
                      value={form.category}
                      onChange={handleChange}
                    >
                      <option value="">Select category</option>
                      {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>

                </div>
              </div>
            </div>

            {/* Line Items */}
            <div className="card">
              <div className="card-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>Line Items</span>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.txt,.csv,.doc,.docx"
                    style={{ display: 'none' }}
                    onChange={e => {
                      const file = e.target.files?.[0]
                      if (file) handleFileSelect(file)
                      e.target.value = ''
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => fileInputRef.current?.click()}
                    style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 5 }}
                  >
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M8 12V4M4 8l4-4 4 4"/>
                      <path d="M2 14h12"/>
                    </svg>
                    {uploadedFile ? 'Replace Document' : 'Upload PO / Invoice'}
                  </button>
                  {uploadedFile && (
                    <button
                      type="button"
                      className="btn btn-blue btn-sm"
                      disabled={extracting}
                      onClick={handleAutoComplete}
                      style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 5 }}
                    >
                      {extracting ? (
                        <>
                          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" style={{ animation: 'spin 1s linear infinite' }}>
                            <path d="M8 2a6 6 0 1 0 6 6"/>
                          </svg>
                          Extracting…
                        </>
                      ) : (
                        <>
                          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M13 3l-7 7-3-3"/>
                          </svg>
                          Auto complete
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>

              {uploadedFile && (
                <div style={{ margin: '0 20px', padding: '8px 12px', background: 'var(--offwhite)', borderRadius: 8, fontSize: 12, color: 'var(--gray)', display: 'flex', alignItems: 'center', gap: 6, border: '1px solid var(--border)' }}>
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 2H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V6L9 2zM9 2v4h4"/>
                  </svg>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{uploadedFile.name}</span>
                  <button
                    type="button"
                    onClick={() => { setUploadedFile(null); setExtractError(null) }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gray)', padding: 2, lineHeight: 1 }}
                    title="Remove file"
                  >×</button>
                </div>
              )}

              <div className="card-body" style={{ padding: '0 0 16px' }}>
                {extractError && (
                  <div style={{ margin: '8px 20px 4px', padding: '10px 12px', background: 'rgba(239,68,68,0.06)', borderRadius: 8, fontSize: 13, color: 'var(--color-red)', border: '1px solid rgba(239,68,68,0.18)' }}>
                    {extractError}
                  </div>
                )}

                {/* Header row */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 80px 100px 32px', gap: 8, padding: '8px 20px', fontSize: 11, fontFamily: 'var(--font-mono)', letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--gray)', borderBottom: '1px solid var(--border)' }}>
                  <span>Item / Specs</span>
                  <span>Qty</span>
                  <span>Unit</span>
                  <span>Price/Unit</span>
                  <span></span>
                </div>

                {lineItems.map((item) => (
                  <div key={item.id} style={{ display: 'grid', gridTemplateColumns: '1fr 80px 80px 100px 32px', gap: 8, padding: '8px 20px', alignItems: 'start', borderBottom: '1px solid var(--border-light)' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <input
                        type="text"
                        className="input"
                        style={{ fontSize: 13, padding: '6px 10px' }}
                        placeholder="Item name"
                        value={item.name}
                        onChange={e => updateLineItem(item.id, 'name', e.target.value)}
                      />
                      <input
                        type="text"
                        className="input"
                        style={{ fontSize: 12, padding: '4px 10px', color: 'var(--gray)' }}
                        placeholder="Specs — grade, dimensions, certifications…"
                        value={item.description}
                        onChange={e => updateLineItem(item.id, 'description', e.target.value)}
                      />
                    </div>
                    <input
                      type="number"
                      className="input"
                      style={{ fontSize: 13, padding: '6px 10px' }}
                      placeholder="0"
                      value={item.quantity}
                      onChange={e => updateLineItem(item.id, 'quantity', e.target.value)}
                      min="0"
                    />
                    <select
                      className="input form-select"
                      style={{ fontSize: 13, padding: '6px 10px' }}
                      value={item.unit}
                      onChange={e => updateLineItem(item.id, 'unit', e.target.value)}
                    >
                      <option>MT</option>
                      <option>KG</option>
                      <option>Units</option>
                      <option>Pieces</option>
                      <option>Pallets</option>
                      <option>Containers</option>
                      <option>L</option>
                      <option>M2</option>
                      <option>M3</option>
                    </select>
                    <input
                      type="number"
                      className="input"
                      style={{ fontSize: 13, padding: '6px 10px' }}
                      placeholder="0.00"
                      value={item.unit_price}
                      onChange={e => updateLineItem(item.id, 'unit_price', e.target.value)}
                      min="0"
                      step="0.01"
                    />
                    <button
                      type="button"
                      onClick={() => removeLineItem(item.id)}
                      style={{ background: 'none', border: 'none', cursor: lineItems.length === 1 ? 'not-allowed' : 'pointer', color: lineItems.length === 1 ? 'var(--border)' : 'var(--color-red)', padding: 4, borderRadius: 4, marginTop: 4 }}
                      disabled={lineItems.length === 1}
                      title="Remove line item"
                    >
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                        <path d="M4 4l8 8M12 4l-8 8"/>
                      </svg>
                    </button>
                  </div>
                ))}

                <div style={{ padding: '12px 20px 0' }}>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={addLineItem}
                    style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}
                  >
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                      <path d="M8 3v10M3 8h10"/>
                    </svg>
                    Add Line Item
                  </button>
                </div>
              </div>
            </div>

            {/* Logistics & Terms */}
            <div className="card">
              <div className="card-head">Logistics &amp; Terms</div>
              <div className="card-body">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div className="form-field">
                      <label className="field-label">Incoterms</label>
                      <select
                        name="incoterms"
                        className="input form-select"
                        value={form.incoterms}
                        onChange={handleChange}
                      >
                        <option value="">Select Incoterms</option>
                        {INCOTERMS.map((t) => <option key={t}>{t}</option>)}
                      </select>
                    </div>
                    <div className="form-field">
                      <label className="field-label">Delivery Location</label>
                      <input
                        type="text"
                        name="delivery_location"
                        className="input"
                        value={form.delivery_location}
                        onChange={handleChange}
                        placeholder="e.g. Port of Jebel Ali, AE"
                      />
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div className="form-field">
                      <label className="field-label">Required Delivery by</label>
                      <input
                        type="date"
                        name="delivery_deadline"
                        className="input"
                        value={form.delivery_deadline}
                        onChange={handleChange}
                      />
                    </div>
                    <div className="form-field">
                      <label className="field-label">Listing Expires</label>
                      <input
                        type="date"
                        name="expires_at"
                        className="input"
                        value={form.expires_at}
                        onChange={handleChange}
                      />
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div className="form-field">
                      <label className="field-label">Payment Terms</label>
                      <select
                        name="payment_terms"
                        className="input form-select"
                        value={form.payment_terms}
                        onChange={handleChange}
                      >
                        <option value="">Select payment terms</option>
                        {PAYMENT_TERMS.map((t) => <option key={t}>{t}</option>)}
                      </select>
                    </div>
                    <div className="form-field">
                      <label className="field-label">Currency</label>
                      <select
                        name="currency"
                        className="input form-select"
                        value={form.currency}
                        onChange={handleChange}
                      >
                        {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
                      </select>
                    </div>
                  </div>

                </div>
              </div>
            </div>

            {/* Visibility selector */}
            <div style={{ background: 'var(--offwhite)', borderRadius: 'var(--radius-card)', padding: '20px 20px', marginBottom: 16, border: '1.5px solid var(--border)' }}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Visibility</div>
              <div style={{ fontSize: 13, color: 'var(--gray)', marginBottom: 14 }}>Who can see this listing?</div>

              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', marginBottom: 12 }}>
                <input type="radio" name="vis" checked={visibility === 'public'} onChange={() => setVisibility('public')} style={{ marginTop: 2 }} />
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>Public</div>
                  <div style={{ fontSize: 12, color: 'var(--gray)' }}>Visible to all verified organizations on Strike Place</div>
                </div>
              </label>

              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
                <input type="radio" name="vis" checked={visibility === 'network_only'} onChange={() => setVisibility('network_only')} style={{ marginTop: 2 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>My Network</div>
                  <div style={{ fontSize: 12, color: 'var(--gray)' }}>Visible only to suppliers in one of your networks</div>
                  {visibility === 'network_only' && (
                    <div style={{ marginTop: 10 }}>
                      {networks.length === 0 ? (
                        <p style={{ fontSize: 13, color: 'var(--color-amber)' }}>
                          You don't have any networks yet.{' '}
                          <a href="/networks" style={{ color: 'var(--blue)', fontWeight: 600 }}>Create one →</a>
                        </p>
                      ) : (
                        <select
                          value={networkId}
                          onChange={e => setNetworkId(e.target.value)}
                          style={{
                            width: '100%', padding: '9px 12px', borderRadius: 'var(--radius-input)',
                            border: '1.5px solid var(--border)', fontSize: 13, background: 'var(--white)',
                          }}
                        >
                          <option value="">Select a network…</option>
                          {networks.map((n: any) => (
                            <option key={n.id} value={n.id}>{n.name}</option>
                          ))}
                        </select>
                      )}
                    </div>
                  )}
                </div>
              </label>
            </div>

            {error && (
              <div className="alert alert-error">
                <span className="alert-icon">⚠</span>
                <span className="alert-body">{error}</span>
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, paddingBottom: 32 }}>
              <button
                className="btn btn-blue"
                style={{ flex: 1, height: 44, fontSize: 14 }}
                disabled={loading}
                onClick={() => submit(false)}
              >
                {loading ? 'Publishing…' : 'Publish Listing'}
              </button>
              <button
                className="btn btn-ghost"
                style={{ height: 44 }}
                disabled={loading}
                onClick={() => submit(true)}
              >
                {loading ? 'Saving…' : 'Save Draft'}
              </button>
              <button
                className="btn btn-ghost"
                style={{ height: 44 }}
                disabled={loading}
                onClick={() => router.push('/marketplace')}
              >
                Cancel
              </button>
            </div>

          </div>

          {/* Right — Preview + AI tip */}
          <div>
            <div className="listing-preview-card">
              <div className="listing-preview-label">Preview</div>
              <div className="listing-preview-body">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 10, borderBottom: '1px solid var(--border)' }}>
                  <span className={`listing-type-badge ${listingType === 'po_request' ? 'listing-type-po' : 'listing-type-product'}`}>
                    {listingType === 'po_request' ? 'PO Request' : 'Product / Service'}
                  </span>
                  {form.category
                    ? <span className="listing-category-tag">{form.category}</span>
                    : <span className="listing-category-tag">Category</span>}
                </div>
                {form.title
                  ? <div style={{ fontSize: 15, fontWeight: 600, fontFamily: 'var(--font-display)', color: 'var(--ink)' }}>{form.title}</div>
                  : <div className="listing-preview-placeholder" style={{ height: 22 }} />}
                {computedTargetPrice != null
                  ? <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'var(--font-display)', color: 'var(--ink)' }}>
                      {computedTargetPrice.toLocaleString()} <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--gray)' }}>{form.currency}</span>
                    </div>
                  : <div className="listing-preview-placeholder" style={{ height: 32, width: '55%' }} />}
                <div style={{ display: 'flex', gap: 12 }}>
                  <div className="listing-preview-placeholder" style={{ height: 10, flex: 1 }} />
                  <div className="listing-preview-placeholder" style={{ height: 10, flex: 1 }} />
                  <div className="listing-preview-placeholder" style={{ height: 10, flex: 1 }} />
                </div>
                <div className="listing-preview-placeholder" style={{ height: 10 }} />
                <div className="listing-preview-placeholder" style={{ height: 10, width: '80%' }} />
                <div style={{ paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                  <div className="listing-preview-placeholder" style={{ height: 44 }} />
                </div>
              </div>
            </div>

            <div className="ai-tip-card" style={{ marginTop: 12 }}>
              <div className="ai-tip-icon">⚡</div>
              <div className="ai-tip-body">
                <div className="ai-tip-label">Strike AI Tip</div>
                <div className="ai-tip-text">
                  Upload your PO or Invoice and click <strong>Auto complete</strong> — Strike AI will fill in your title, description, line items, and delivery terms automatically.
                </div>
              </div>
            </div>

            <div className="ai-tip-card" style={{ marginTop: 8, background: 'var(--color-accent-light)', borderColor: 'var(--blue)', borderLeft: '3px solid var(--blue)' }}>
              <div className="ai-tip-icon" style={{ color: 'var(--blue)' }}>ℹ</div>
              <div className="ai-tip-body">
                <div className="ai-tip-label" style={{ color: 'var(--blue)' }}>Passport Visibility</div>
                <div className="ai-tip-text" style={{ color: 'var(--blue)' }}>
                  Your PassportScore is shown to all counterparties who view this listing. A higher score builds trust and accelerates offers.
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

export default function NewListingPage() {
  return (
    <Suspense>
      <NewListingPageInner />
    </Suspense>
  )
}
