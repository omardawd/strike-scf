'use client'
import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Topbar } from '@/components/portal-shell'
import type { ListingType } from '@strike-scf/types'

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
  quantity: string
  unit: string
  target_price: string
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
  quantity: '',
  unit: 'MT',
  target_price: '',
  currency: 'USD',
  incoterms: '',
  delivery_location: '',
  delivery_deadline: '',
  expires_at: '',
  payment_terms: '',
}

export default function NewListingPage() {
  const router = useRouter()
  const [listingType, setListingType] = useState<ListingType>('po_request')
  const [form, setForm] = useState<FormState>(DEFAULT_FORM)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }))
  }

  const buildPayload = (status?: 'draft') => ({
    listing_type: listingType,
    title: form.title.trim(),
    description: form.description.trim() || undefined,
    category: form.category || undefined,
    quantity: form.quantity ? parseFloat(form.quantity) : undefined,
    unit: form.unit || undefined,
    target_price: form.target_price ? parseFloat(form.target_price) : undefined,
    currency: form.currency || 'USD',
    incoterms: form.incoterms || undefined,
    delivery_location: form.delivery_location.trim() || undefined,
    delivery_deadline: form.delivery_deadline || undefined,
    expires_at: form.expires_at || undefined,
    payment_terms: form.payment_terms || undefined,
    ...(status ? { status } : {}),
  })

  const submit = async (asDraft: boolean) => {
    if (!form.title.trim()) {
      setError('Title is required.')
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
      if (asDraft) {
        router.push('/marketplace')
      } else {
        router.push(`/marketplace/listings/${data.listing.id}`)
      }
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
            <button
              className="btn btn-ghost btn-sm"
              disabled={loading}
              onClick={() => submit(true)}
            >
              {loading ? 'Saving…' : 'Save Draft'}
            </button>
            <button
              className="btn btn-blue btn-sm"
              disabled={loading}
              onClick={() => submit(false)}
            >
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

            {/* Quantity + Pricing */}
            <div className="card">
              <div className="card-head">Quantity &amp; Pricing</div>
              <div className="card-body">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
                    <div className="form-field">
                      <label className="field-label">Quantity</label>
                      <input
                        type="number"
                        name="quantity"
                        className="input"
                        value={form.quantity}
                        onChange={handleChange}
                        placeholder="e.g. 500"
                        min="1"
                      />
                    </div>
                    <div className="form-field">
                      <label className="field-label">Unit</label>
                      <select
                        name="unit"
                        className="input form-select"
                        value={form.unit}
                        onChange={handleChange}
                      >
                        <option>MT</option>
                        <option>KG</option>
                        <option>Units</option>
                        <option>Pieces</option>
                        <option>Pallets</option>
                        <option>Containers</option>
                        <option>L</option>
                        <option>M²</option>
                        <option>M³</option>
                      </select>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div className="form-field">
                      <label className="field-label">
                        {listingType === 'po_request' ? 'Target Price per Unit' : 'Asking Price per Unit'}
                      </label>
                      <div className="input-group">
                        <input
                          type="number"
                          name="target_price"
                          className="input"
                          value={form.target_price}
                          onChange={handleChange}
                          placeholder="0.00"
                          step="0.01"
                          style={{ paddingRight: 60 }}
                        />
                        <span className="input-suffix" style={{ right: 8, fontSize: 11, fontFamily: 'var(--font-mono)', letterSpacing: '0.06em' }}>
                          / unit
                        </span>
                      </div>
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

                </div>
              </div>
            </div>

            {/* Inline error */}
            {error && (
              <div className="alert alert-error">
                <span className="alert-icon">⚠</span>
                <span className="alert-body">{error}</span>
              </div>
            )}

            {/* Submit row */}
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
                {form.target_price
                  ? <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'var(--font-display)', color: 'var(--ink)' }}>
                      {parseFloat(form.target_price).toLocaleString()} <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--gray)' }}>{form.currency}</span>
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
                  Listings with a full description, delivery deadline, and incoterms receive <strong>3× more offers</strong> on average. Verified passport organizations get priority placement.
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
