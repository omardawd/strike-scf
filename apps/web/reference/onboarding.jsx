/* global React */
/* Strike SCF — Simplified Onboarding (Account creation / KYB application only)
 *
 * Flow per role:
 *   Supplier  → Welcome → Account Setup → Company Info → Documents → Bank Account → Review & Submit
 *   Anchor    → Welcome → Account Setup → Company Info → Documents → Review & Submit
 *   Bank      → Welcome → Institution Profile → Regulatory Docs → Review & Submit
 *
 * NO user invites, NO program setup — those happen inside the platform.
 */

const { useState: useOb, useRef: useObRef } = React;

// ─────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────

function OBIcon({ name, size = 16 }) {
  const paths = {
    check:    <path d="M4 8 L7 11 L12 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>,
    upload:   <><path d="M8 3 L8 11 M5 6 L8 3 L11 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none"/><path d="M3 13 L13 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none"/></>,
    doc:      <><rect x="4" y="2" width="8" height="12" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none"/><path d="M6 6 L10 6 M6 9 L9 9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></>,
    building: <><rect x="3" y="5" width="10" height="9" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none"/><path d="M6 14 L6 10 L10 10 L10 14" stroke="currentColor" strokeWidth="1.4" fill="none"/><path d="M3 5 L8 2 L13 5" stroke="currentColor" strokeWidth="1.4" fill="none"/></>,
    user:     <><circle cx="8" cy="5" r="3" stroke="currentColor" strokeWidth="1.5" fill="none"/><path d="M2 14 C2 11 4.5 9 8 9 C11.5 9 14 11 14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none"/></>,
    bank:     <><rect x="2" y="7" width="12" height="7" rx="1" stroke="currentColor" strokeWidth="1.4" fill="none"/><path d="M2 7 L8 3 L14 7" stroke="currentColor" strokeWidth="1.4" fill="none"/><path d="M5 10 L5 14 M8 10 L8 14 M11 10 L11 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></>,
    arrow:    <path d="M3 8 L13 8 M9 4 L13 8 L9 12" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" fill="none"/>,
    info:     <><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.4" fill="none"/><path d="M8 7 L8 11 M8 5.5 L8 5.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></>,
    x:        <path d="M5 5 L11 11 M11 5 L5 11" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/>,
    eye:      <><path d="M2 8 C4 4 12 4 14 8 C12 12 4 12 2 8" stroke="currentColor" strokeWidth="1.4" fill="none"/><circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.4" fill="none"/></>,
    eyeOff:   <><path d="M2 8 C4 4 12 4 14 8" stroke="currentColor" strokeWidth="1.4" fill="none"/><path d="M3 13 L13 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></>,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
      {paths[name] || null}
    </svg>
  );
}

// Progress rail with steps
function OBStepper({ steps, current }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '0 0 8px' }}>
      {steps.map((step, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '10px 20px',
            borderLeft: `2px solid ${active ? 'var(--color-blue, #2563eb)' : 'transparent'}`,
            background: active ? 'rgba(37,99,235,0.05)' : 'transparent',
            borderRadius: '0 6px 6px 0',
            cursor: 'default',
          }}>
            <div style={{
              width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 10, fontWeight: 600,
              background: done ? 'var(--color-green, #16a34a)' : active ? 'var(--color-blue, #2563eb)' : 'var(--color-bg-2, #f1f5f9)',
              color: done || active ? 'white' : 'var(--color-ink-3, #94a3b8)',
              border: done || active ? 'none' : '1.5px solid var(--color-border, #e2e8f0)',
            }}>
              {done ? <OBIcon name="check" size={12} /> : i + 1}
            </div>
            <div>
              <div style={{
                fontSize: 12.5, fontWeight: active ? 600 : 400,
                color: active ? 'var(--color-ink-1, #0f172a)' : done ? 'var(--color-ink-2, #475569)' : 'var(--color-ink-3, #94a3b8)',
              }}>{step.label}</div>
              {step.sub && (
                <div style={{ fontSize: 11, color: 'var(--color-ink-4, #cbd5e1)', marginTop: 1 }}>{step.sub}</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Shell (left rail + content area)
function OBShell({ steps, current, children, role }) {
  const roleLabels = { supplier: 'Supplier', anchor: 'Anchor / Buyer', bank: 'Bank / Lender' };
  return (
    <div style={{
      position: 'fixed', inset: 0,
      display: 'grid', gridTemplateColumns: '280px 1fr',
      background: 'var(--color-bg, #f8fafc)',
      fontFamily: 'var(--font-sans, system-ui, sans-serif)',
    }}>
      {/* Left rail */}
      <div style={{
        background: 'var(--color-surface, white)',
        borderRight: '1px solid var(--color-border, #e2e8f0)',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Brand */}
        <div style={{
          padding: '22px 20px 18px',
          borderBottom: '1px solid var(--color-border, #e2e8f0)',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <div style={{
            width: 30, height: 30, borderRadius: 8,
            background: 'var(--color-ink-1, #0f172a)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'white', fontWeight: 800, fontSize: 14, letterSpacing: '-0.02em',
          }}>S</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--color-ink-1)' }}>Strike SCF</div>
            {role && (
              <div style={{
                fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em',
                color: 'var(--color-ink-4)', fontWeight: 500,
              }}>{roleLabels[role] || ''}</div>
            )}
          </div>
        </div>

        {/* Progress */}
        <div style={{ flex: 1, overflowY: 'auto', paddingTop: 16 }}>
          {steps && <OBStepper steps={steps} current={current} />}
        </div>

        {/* Footer note */}
        <div style={{
          padding: '14px 20px',
          borderTop: '1px solid var(--color-border, #e2e8f0)',
          fontSize: 11, color: 'var(--color-ink-4)',
          display: 'flex', alignItems: 'flex-start', gap: 8,
        }}>
          <OBIcon name="info" size={13} />
          <span>Your data is encrypted and never shared without consent.</span>
        </div>
      </div>

      {/* Content */}
      <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '48px 40px' }}>
        <div style={{ width: '100%', maxWidth: 600 }}>
          {children}
        </div>
      </div>
    </div>
  );
}

// Shared field components
function OBField({ label, hint, optional, error, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-ink-1)' }}>{label}</label>
        {optional && <span style={{ fontSize: 11, color: 'var(--color-ink-4)', fontWeight: 400 }}>Optional</span>}
      </div>
      {children}
      {hint && !error && <div style={{ fontSize: 11.5, color: 'var(--color-ink-3)' }}>{hint}</div>}
      {error && <div style={{ fontSize: 11.5, color: 'var(--color-red, #dc2626)' }}>{error}</div>}
    </div>
  );
}

const inputStyle = {
  height: 38, padding: '0 12px', borderRadius: 6,
  border: '1.5px solid var(--color-border, #e2e8f0)',
  background: 'var(--color-surface, white)',
  fontSize: 13.5, color: 'var(--color-ink-1)',
  outline: 'none', width: '100%', boxSizing: 'border-box',
  transition: 'border-color 0.15s',
};

const selectStyle = { ...inputStyle, cursor: 'pointer' };

function OBInput(props) {
  return <input style={inputStyle} {...props} />;
}
function OBSelect({ children, ...props }) {
  return <select style={selectStyle} {...props}>{children}</select>;
}

// Doc upload tile
function DocTile({ name, required, status, onUpload }) {
  const uploaded = status === 'uploaded';
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '12px 14px', borderRadius: 8,
      border: `1.5px solid ${uploaded ? 'var(--color-green, #16a34a)' : 'var(--color-border)'}`,
      background: uploaded ? 'rgba(22,163,74,0.04)' : 'var(--color-surface)',
    }}>
      <div style={{
        width: 32, height: 32, borderRadius: 6, flexShrink: 0,
        background: uploaded ? 'rgba(22,163,74,0.1)' : 'var(--color-bg-2)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: uploaded ? 'var(--color-green)' : 'var(--color-ink-3)',
      }}>
        <OBIcon name={uploaded ? 'check' : 'doc'} size={16} />
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-ink-1)' }}>
          {name}
          {!required && <span style={{ marginLeft: 6, fontSize: 10.5, color: 'var(--color-ink-4)', fontWeight: 400 }}>Optional</span>}
        </div>
        <div style={{ fontSize: 11, color: uploaded ? 'var(--color-green)' : 'var(--color-ink-4)', marginTop: 2 }}>
          {uploaded ? 'Uploaded ✓' : 'PDF · max 20MB'}
        </div>
      </div>
      <button
        type="button"
        onClick={onUpload}
        style={{
          height: 30, padding: '0 12px', borderRadius: 5, fontSize: 12, fontWeight: 500,
          border: `1px solid ${uploaded ? 'var(--color-border)' : 'var(--color-blue, #2563eb)'}`,
          color: uploaded ? 'var(--color-ink-3)' : 'var(--color-blue)',
          background: 'transparent', cursor: 'pointer',
        }}
      >{uploaded ? 'Replace' : 'Upload'}</button>
    </div>
  );
}

// Nav buttons
function OBActions({ onBack, onNext, nextLabel = 'Continue', loading }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 32 }}>
      <button
        type="button"
        onClick={onNext}
        disabled={loading}
        style={{
          height: 40, padding: '0 24px', borderRadius: 7, fontSize: 14, fontWeight: 600,
          background: 'var(--color-ink-1, #0f172a)', color: 'white',
          border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
        }}
      >
        {loading ? 'Saving…' : nextLabel}
        {!loading && <OBIcon name="arrow" size={14} />}
      </button>
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          style={{
            height: 40, padding: '0 18px', borderRadius: 7, fontSize: 13.5,
            background: 'transparent', color: 'var(--color-ink-3)',
            border: '1.5px solid var(--color-border)', cursor: 'pointer',
          }}
        >← Back</button>
      )}
    </div>
  );
}

function SectionHead({ title, sub }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.03em', color: 'var(--color-ink-1)', margin: 0 }}>{title}</h1>
      {sub && <p style={{ fontSize: 13.5, color: 'var(--color-ink-3)', marginTop: 6, lineHeight: 1.6 }}>{sub}</p>}
    </div>
  );
}

function Card({ children, style }) {
  return (
    <div style={{
      background: 'var(--color-surface, white)',
      border: '1.5px solid var(--color-border, #e2e8f0)',
      borderRadius: 10, padding: 24,
      ...style,
    }}>{children}</div>
  );
}

// ─────────────────────────────────────────────────────────────
// Step configs
// ─────────────────────────────────────────────────────────────

const SUPPLIER_STEPS = [
  { label: 'Welcome',      sub: 'Create your account' },
  { label: 'Account',      sub: 'Email & password' },
  { label: 'Company info', sub: 'Legal details & EIN' },
  { label: 'Documents',    sub: 'Incorporation & financials' },
  { label: 'Bank account', sub: 'Disbursement account' },
  { label: 'Review',       sub: 'Submit KYB application' },
];

const ANCHOR_STEPS = [
  { label: 'Welcome',      sub: 'Create your account' },
  { label: 'Account',      sub: 'Email & password' },
  { label: 'Company info', sub: 'Legal details & EIN' },
  { label: 'Documents',    sub: 'Incorporation & financials' },
  { label: 'Review',       sub: 'Submit KYB application' },
];

const BANK_STEPS = [
  { label: 'Welcome',           sub: 'Create your account' },
  { label: 'Account',           sub: 'Email & password' },
  { label: 'Institution info',  sub: 'Legal name & routing' },
  { label: 'Regulatory docs',   sub: 'License & compliance' },
  { label: 'Review',            sub: 'Submit for activation' },
];

// ─────────────────────────────────────────────────────────────
// Step 0 — Welcome (role picker)
// ─────────────────────────────────────────────────────────────
function StepWelcome({ role, setRole, onNext }) {
  const roles = [
    { id: 'supplier', icon: 'doc',      title: 'Supplier',           desc: 'Get paid early on your invoices.' },
    { id: 'anchor',   icon: 'building', title: 'Anchor / Buyer',     desc: 'Offer early payment to your suppliers.' },
    { id: 'bank',     icon: 'bank',     title: 'Bank / Lender',      desc: 'Underwrite and fund SCF programs.' },
  ];

  return (
    <div>
      <div style={{ marginBottom: 32 }}>
        <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--color-ink-4)', marginBottom: 10, fontWeight: 500 }}>Strike SCF</div>
        <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.04em', color: 'var(--color-ink-1)', margin: 0, lineHeight: 1.15 }}>
          Let's get you set up.
        </h1>
        <p style={{ fontSize: 14, color: 'var(--color-ink-3)', marginTop: 10, lineHeight: 1.6 }}>
          Choose your role to start the account and KYB application. Program setup and user invites happen inside the platform once you're approved.
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {roles.map(r => (
          <button
            key={r.id}
            type="button"
            onClick={() => setRole(r.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 16,
              padding: '16px 20px', borderRadius: 10, textAlign: 'left',
              border: `2px solid ${role === r.id ? 'var(--color-ink-1, #0f172a)' : 'var(--color-border, #e2e8f0)'}`,
              background: role === r.id ? 'var(--color-ink-1)' : 'var(--color-surface, white)',
              cursor: 'pointer', transition: 'all 0.12s',
            }}
          >
            <div style={{
              width: 40, height: 40, borderRadius: 8, flexShrink: 0,
              background: role === r.id ? 'rgba(255,255,255,0.12)' : 'var(--color-bg-2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: role === r.id ? 'white' : 'var(--color-ink-2)',
            }}>
              <OBIcon name={r.icon} size={18} />
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: role === r.id ? 'white' : 'var(--color-ink-1)' }}>{r.title}</div>
              <div style={{ fontSize: 12.5, color: role === r.id ? 'rgba(255,255,255,0.65)' : 'var(--color-ink-3)', marginTop: 2 }}>{r.desc}</div>
            </div>
            {role === r.id && (
              <div style={{ marginLeft: 'auto', color: 'white' }}><OBIcon name="check" size={16} /></div>
            )}
          </button>
        ))}
      </div>

      <OBActions onNext={onNext} nextLabel="Start application" />

      <p style={{ marginTop: 16, fontSize: 12, color: 'var(--color-ink-4)' }}>
        Already have an account?{' '}
        <a href="/login" style={{ color: 'var(--color-blue, #2563eb)', fontWeight: 500, textDecoration: 'none' }}>Sign in</a>
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Step 1 — Account (email + password)
// ─────────────────────────────────────────────────────────────
function StepAccount({ data, setData, onBack, onNext }) {
  const [showPwd, setShowPwd] = useOb(false);
  const [showConfirm, setShowConfirm] = useOb(false);

  const pwdRules = [
    { label: '8+ characters',    ok: (data.password || '').length >= 8 },
    { label: 'Uppercase letter', ok: /[A-Z]/.test(data.password || '') },
    { label: 'Number',           ok: /[0-9]/.test(data.password || '') },
    { label: 'Special character',ok: /[^a-zA-Z0-9]/.test(data.password || '') },
  ];
  const pwdMatch = data.password && data.confirmPassword && data.password === data.confirmPassword;

  return (
    <div>
      <SectionHead title="Create your account" sub="You'll use this to sign in to Strike SCF." />
      <Card>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <OBField label="First name">
              <OBInput
                placeholder="Priya"
                value={data.firstName || ''}
                onChange={e => setData({ ...data, firstName: e.target.value })}
              />
            </OBField>
            <OBField label="Last name">
              <OBInput
                placeholder="Shah"
                value={data.lastName || ''}
                onChange={e => setData({ ...data, lastName: e.target.value })}
              />
            </OBField>
          </div>

          <OBField label="Work email" hint="Use your company email address.">
            <OBInput
              type="email"
              placeholder="priya@company.com"
              value={data.email || ''}
              onChange={e => setData({ ...data, email: e.target.value })}
            />
          </OBField>

          <OBField label="Job title" optional>
            <OBInput
              placeholder="CFO, Treasurer, etc."
              value={data.jobTitle || ''}
              onChange={e => setData({ ...data, jobTitle: e.target.value })}
            />
          </OBField>

          <OBField label="Password">
            <div style={{ position: 'relative' }}>
              <OBInput
                type={showPwd ? 'text' : 'password'}
                placeholder="••••••••"
                value={data.password || ''}
                onChange={e => setData({ ...data, password: e.target.value })}
                style={{ ...inputStyle, paddingRight: 38 }}
              />
              <button
                type="button"
                onClick={() => setShowPwd(v => !v)}
                style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-ink-3)', padding: 4 }}
              ><OBIcon name={showPwd ? 'eyeOff' : 'eye'} size={14} /></button>
            </div>
          </OBField>

          {/* Password rules */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {pwdRules.map((r, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 5,
                fontSize: 11.5, color: r.ok ? 'var(--color-green)' : 'var(--color-ink-4)',
              }}>
                <span>{r.ok ? '✓' : '○'}</span>
                <span>{r.label}</span>
              </div>
            ))}
          </div>

          <OBField label="Confirm password" error={data.confirmPassword && !pwdMatch ? 'Passwords don\'t match' : ''}>
            <div style={{ position: 'relative' }}>
              <OBInput
                type={showConfirm ? 'text' : 'password'}
                placeholder="••••••••"
                value={data.confirmPassword || ''}
                onChange={e => setData({ ...data, confirmPassword: e.target.value })}
                style={{ ...inputStyle, paddingRight: 38 }}
              />
              <button
                type="button"
                onClick={() => setShowConfirm(v => !v)}
                style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-ink-3)', padding: 4 }}
              ><OBIcon name={showConfirm ? 'eyeOff' : 'eye'} size={14} /></button>
            </div>
          </OBField>
        </div>
      </Card>

      <OBActions onBack={onBack} onNext={onNext} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Step 2 — Company Info (shared Supplier/Anchor)
// ─────────────────────────────────────────────────────────────
function StepCompanyInfo({ data, setData, onBack, onNext, role }) {
  const isAnchor = role === 'anchor';
  return (
    <div>
      <SectionHead
        title={isAnchor ? 'About your company' : 'About your business'}
        sub="Used to create your KYB application. We cross-check with public records."
      />
      <Card>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <OBField label="Legal business name" hint="As it appears on your incorporation documents.">
            <OBInput
              placeholder="Acme Corp LLC"
              value={data.legalName || ''}
              onChange={e => setData({ ...data, legalName: e.target.value })}
            />
          </OBField>

          <OBField label="DBA / Trade name" optional>
            <OBInput
              placeholder="Acme"
              value={data.dba || ''}
              onChange={e => setData({ ...data, dba: e.target.value })}
            />
          </OBField>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <OBField label="Entity type">
              <OBSelect
                value={data.entityType || ''}
                onChange={e => setData({ ...data, entityType: e.target.value })}
              >
                <option value="">Select…</option>
                <option value="llc">LLC</option>
                <option value="corporation">Corporation</option>
                <option value="partnership">Partnership</option>
                <option value="sole_proprietor">Sole Proprietor</option>
              </OBSelect>
            </OBField>
            <OBField label="State of incorporation">
              <OBInput
                placeholder="DE"
                value={data.stateOfInc || ''}
                onChange={e => setData({ ...data, stateOfInc: e.target.value })}
              />
            </OBField>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <OBField label="EIN (Federal Tax ID)" hint="9-digit number (XX-XXXXXXX)">
              <OBInput
                placeholder="12-3456789"
                value={data.ein || ''}
                onChange={e => setData({ ...data, ein: e.target.value })}
              />
            </OBField>
            <OBField label="DUNS number" optional>
              <OBInput
                placeholder="XX-XXX-XXXX"
                value={data.duns || ''}
                onChange={e => setData({ ...data, duns: e.target.value })}
              />
            </OBField>
          </div>

          <OBField label="Registered address">
            <OBInput
              placeholder="123 Main St, Suite 400"
              value={data.addressLine1 || ''}
              onChange={e => setData({ ...data, addressLine1: e.target.value })}
            />
          </OBField>

          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12 }}>
            <OBField label="City">
              <OBInput
                placeholder="Portland"
                value={data.city || ''}
                onChange={e => setData({ ...data, city: e.target.value })}
              />
            </OBField>
            <OBField label="State">
              <OBInput
                placeholder="OR"
                value={data.state || ''}
                onChange={e => setData({ ...data, state: e.target.value })}
              />
            </OBField>
            <OBField label="ZIP">
              <OBInput
                placeholder="97201"
                value={data.zip || ''}
                onChange={e => setData({ ...data, zip: e.target.value })}
              />
            </OBField>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <OBField label="Industry (NAICS code)" optional>
              <OBInput
                placeholder="332618"
                value={data.naics || ''}
                onChange={e => setData({ ...data, naics: e.target.value })}
              />
            </OBField>
            <OBField label="Approx. annual revenue (USD)" optional>
              <OBInput
                placeholder="5,000,000"
                value={data.annualRevenue || ''}
                onChange={e => setData({ ...data, annualRevenue: e.target.value })}
              />
            </OBField>
          </div>

          <OBField label="Primary contact phone" optional>
            <OBInput
              type="tel"
              placeholder="+1 (503) 555-0100"
              value={data.phone || ''}
              onChange={e => setData({ ...data, phone: e.target.value })}
            />
          </OBField>
        </div>
      </Card>
      <OBActions onBack={onBack} onNext={onNext} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Step 3 — Documents (Supplier/Anchor)
// ─────────────────────────────────────────────────────────────
function StepDocuments({ docs, setDocs, onBack, onNext, role }) {
  const isAnchor = role === 'anchor';

  const requiredDocs = isAnchor
    ? [
        { id: 'inc',       name: 'Certificate of Incorporation / Articles',  required: true },
        { id: 'ein_letter',name: 'IRS EIN Confirmation Letter',               required: true },
        { id: 'ownership', name: 'Ownership structure / Cap table',           required: true },
        { id: 'fin_2y',    name: 'Audited or reviewed financials (last 2 yrs)', required: true },
        { id: 'bank_stmt', name: 'Bank statements (last 6 months)',           required: true },
      ]
    : [
        { id: 'inc',       name: 'Certificate of Incorporation / Articles',  required: true },
        { id: 'ein_letter',name: 'IRS EIN Confirmation Letter',               required: true },
        { id: 'ownership', name: 'Ownership structure (25%+ owners)',          required: true },
        { id: 'fin_2y',    name: 'Audited or reviewed financials (last 2 yrs)', required: true },
        { id: 'bank_stmt', name: 'Bank statements (last 6 months)',           required: true },
        { id: 'insurance', name: 'Certificate of Insurance',                  required: false },
      ];

  const toggleDoc = (id) => {
    setDocs(prev => ({ ...prev, [id]: prev[id] === 'uploaded' ? null : 'uploaded' }));
  };

  const uploadedRequired = requiredDocs.filter(d => d.required && docs[d.id] === 'uploaded').length;
  const totalRequired = requiredDocs.filter(d => d.required).length;

  return (
    <div>
      <SectionHead
        title="Upload your documents"
        sub="You can come back to upload anything missing — we'll save your progress."
      />

      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
        borderRadius: 8, marginBottom: 20,
        background: 'rgba(37,99,235,0.05)',
        border: '1.5px solid rgba(37,99,235,0.15)',
        fontSize: 12.5, color: 'var(--color-ink-2)',
      }}>
        <OBIcon name="info" size={14} />
        <span>{uploadedRequired} of {totalRequired} required documents uploaded</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {requiredDocs.map(d => (
          <DocTile
            key={d.id}
            name={d.name}
            required={d.required}
            status={docs[d.id]}
            onUpload={() => toggleDoc(d.id)}
          />
        ))}
      </div>

      <OBActions onBack={onBack} onNext={onNext} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Step 4 — Bank Account (Supplier only)
// ─────────────────────────────────────────────────────────────
function StepBankAccount({ data, setData, onBack, onNext }) {
  const [acctType, setAcctType] = useOb('checking');

  return (
    <div>
      <SectionHead
        title="Disbursement account"
        sub="Where Strike sends your early payments. Encrypted at rest — only the last 4 digits are ever shown."
      />
      <Card>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <OBField label="Account holder name (as on bank account)">
            <OBInput
              placeholder="Pacific Coil & Wire LLC"
              value={data.acctHolderName || ''}
              onChange={e => setData({ ...data, acctHolderName: e.target.value })}
            />
          </OBField>

          <OBField label="Account number" hint="Encrypted and never displayed in full again.">
            <OBInput
              type="password"
              placeholder="Enter account number"
              value={data.accountNumber || ''}
              onChange={e => setData({ ...data, accountNumber: e.target.value })}
            />
          </OBField>

          <OBField label="ABA Routing number" hint="9-digit number on the bottom-left of your check.">
            <OBInput
              placeholder="021000021"
              value={data.routingNumber || ''}
              onChange={e => setData({ ...data, routingNumber: e.target.value })}
            />
          </OBField>

          <OBField label="Account type">
            <div style={{ display: 'flex', gap: 10 }}>
              {['checking', 'savings'].map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setAcctType(t)}
                  style={{
                    flex: 1, height: 38, borderRadius: 6, fontSize: 13, fontWeight: 500,
                    border: `1.5px solid ${acctType === t ? 'var(--color-ink-1)' : 'var(--color-border)'}`,
                    background: acctType === t ? 'var(--color-ink-1)' : 'transparent',
                    color: acctType === t ? 'white' : 'var(--color-ink-2)',
                    cursor: 'pointer',
                    textTransform: 'capitalize',
                  }}
                >{t}</button>
              ))}
            </div>
          </OBField>

          <div style={{
            display: 'flex', alignItems: 'flex-start', gap: 10,
            padding: '12px 14px', borderRadius: 8,
            background: 'rgba(22,163,74,0.05)',
            border: '1.5px solid rgba(22,163,74,0.2)',
            fontSize: 12, color: 'var(--color-ink-2)',
          }}>
            <OBIcon name="info" size={14} />
            <span>AES-256 encryption. Strike SCF never shares your account details. Only the last 4 digits appear in the platform.</span>
          </div>
        </div>
      </Card>
      <OBActions onBack={onBack} onNext={onNext} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Step 3 — Bank Institution Info
// ─────────────────────────────────────────────────────────────
function StepInstitutionInfo({ data, setData, onBack, onNext }) {
  return (
    <div>
      <SectionHead
        title="Institution profile"
        sub="We'll cross-check with FFIEC public data. Confirm or correct anything that's off."
      />
      <Card>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <OBField label="Legal institution name">
              <OBInput
                placeholder="Atlas Bank, N.A."
                value={data.legalName || ''}
                onChange={e => setData({ ...data, legalName: e.target.value })}
              />
            </OBField>
            <OBField label="Display name">
              <OBInput
                placeholder="Atlas Bank"
                value={data.displayName || ''}
                onChange={e => setData({ ...data, displayName: e.target.value })}
              />
            </OBField>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <OBField label="Institution type">
              <OBSelect
                value={data.institutionType || ''}
                onChange={e => setData({ ...data, institutionType: e.target.value })}
              >
                <option value="">Select…</option>
                <option value="commercial_bank">Commercial Bank</option>
                <option value="fund">Fund</option>
                <option value="fintech_lender">Fintech Lender</option>
              </OBSelect>
            </OBField>
            <OBField label="Primary regulator">
              <OBInput
                placeholder="OCC / Federal Reserve / FDIC"
                value={data.regulator || ''}
                onChange={e => setData({ ...data, regulator: e.target.value })}
              />
            </OBField>
          </div>

          <OBField label="ABA Routing number" hint="Used to verify your institution identity.">
            <OBInput
              placeholder="021000021"
              value={data.routingNumber || ''}
              onChange={e => setData({ ...data, routingNumber: e.target.value })}
            />
          </OBField>

          <OBField label="FDIC certificate number" optional>
            <OBInput
              placeholder="33486"
              value={data.fdicCert || ''}
              onChange={e => setData({ ...data, fdicCert: e.target.value })}
            />
          </OBField>

          <OBField label="Primary contact name">
            <OBInput
              placeholder="Sarah Chen"
              value={data.primaryContact || ''}
              onChange={e => setData({ ...data, primaryContact: e.target.value })}
            />
          </OBField>

          <OBField label="Website" optional>
            <OBInput
              placeholder="https://atlasbank.com"
              value={data.website || ''}
              onChange={e => setData({ ...data, website: e.target.value })}
            />
          </OBField>

          <OBField label="Institution logo" optional>
            <div style={{
              border: '1.5px dashed var(--color-border)',
              borderRadius: 8, padding: '20px 16px',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
              background: 'var(--color-bg-2)', cursor: 'pointer',
            }}>
              <OBIcon name="upload" size={20} />
              <div style={{ fontSize: 12.5, color: 'var(--color-ink-3)' }}>PNG or JPG · Max 2MB</div>
            </div>
          </OBField>
        </div>
      </Card>
      <OBActions onBack={onBack} onNext={onNext} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Step 4 — Regulatory Docs (Bank)
// ─────────────────────────────────────────────────────────────
function StepRegulatoryDocs({ docs, setDocs, onBack, onNext }) {
  const bankDocs = [
    { id: 'license',  name: 'Banking license / Charter',            required: true },
    { id: 'aml',      name: 'AML / KYC policy',                     required: true },
    { id: 'bsa',      name: 'BSA Officer designation letter',        required: true },
    { id: 'fdic_exam',name: 'Most recent FDIC / regulator exam',     required: false },
    { id: 'fin_stmts',name: 'Audited financial statements (last FY)', required: false },
  ];

  const toggleDoc = (id) => {
    setDocs(prev => ({ ...prev, [id]: prev[id] === 'uploaded' ? null : 'uploaded' }));
  };

  return (
    <div>
      <SectionHead
        title="Regulatory documents"
        sub="Upload your banking license and compliance policies. We'll verify with your regulator."
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {bankDocs.map(d => (
          <DocTile
            key={d.id}
            name={d.name}
            required={d.required}
            status={docs[d.id]}
            onUpload={() => toggleDoc(d.id)}
          />
        ))}
      </div>
      <OBActions onBack={onBack} onNext={onNext} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Final Review step
// ─────────────────────────────────────────────────────────────
function StepReview({ formData, docs, role, onBack, onSubmit }) {
  const roleLabel = { supplier: 'Supplier', anchor: 'Anchor / Buyer', bank: 'Bank / Lender' }[role];
  const docCount = Object.values(docs).filter(v => v === 'uploaded').length;

  return (
    <div>
      <SectionHead
        title="Review your application"
        sub="Check that everything looks right before submitting. You'll hear from us within 1–3 business days."
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Account */}
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-ink-4)', fontWeight: 600 }}>Account</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
              <span style={{ color: 'var(--color-ink-3)' }}>Name</span>
              <span style={{ color: 'var(--color-ink-1)', fontWeight: 500 }}>{[formData.account?.firstName, formData.account?.lastName].filter(Boolean).join(' ') || '—'}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
              <span style={{ color: 'var(--color-ink-3)' }}>Email</span>
              <span style={{ color: 'var(--color-ink-1)' }}>{formData.account?.email || '—'}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
              <span style={{ color: 'var(--color-ink-3)' }}>Role</span>
              <span style={{ color: 'var(--color-ink-1)' }}>{roleLabel}</span>
            </div>
          </div>
        </Card>

        {/* Company */}
        <Card>
          <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-ink-4)', fontWeight: 600, marginBottom: 14 }}>
            {role === 'bank' ? 'Institution' : 'Company'}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[
              ['Legal name', formData.company?.legalName || formData.company?.institutionName],
              ['EIN / Routing', formData.company?.ein || formData.company?.routingNumber],
              ['Address', [formData.company?.city, formData.company?.state].filter(Boolean).join(', ')],
            ].map(([k, v]) => v ? (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span style={{ color: 'var(--color-ink-3)' }}>{k}</span>
                <span style={{ color: 'var(--color-ink-1)' }}>{v}</span>
              </div>
            ) : null)}
          </div>
        </Card>

        {/* Documents */}
        <Card>
          <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-ink-4)', fontWeight: 600, marginBottom: 14 }}>Documents</div>
          <div style={{ fontSize: 13, color: 'var(--color-ink-2)' }}>
            {docCount} document{docCount !== 1 ? 's' : ''} uploaded
            <span style={{ color: 'var(--color-ink-4)', marginLeft: 8, fontSize: 12 }}>You can upload more after submitting.</span>
          </div>
        </Card>

        {/* Disclaimer */}
        <div style={{
          padding: '14px 16px', borderRadius: 8, fontSize: 12, color: 'var(--color-ink-3)', lineHeight: 1.7,
          background: 'var(--color-bg-2)', border: '1.5px solid var(--color-border)',
        }}>
          By submitting, you confirm that all information provided is accurate and authorize Strike SCF to verify your identity and company details with third-party data providers.
        </div>
      </div>

      <OBActions onBack={onBack} onNext={onSubmit} nextLabel="Submit application →" />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Success screen
// ─────────────────────────────────────────────────────────────
function ScreenOBSuccess({ role }) {
  const labels = {
    supplier: 'Your KYB application has been submitted.',
    anchor:   'Your KYB application has been submitted.',
    bank:     'Your institution profile has been submitted for review.',
  };
  return (
    <div style={{
      position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      background: 'var(--color-surface, white)', fontFamily: 'var(--font-sans)',
    }}>
      <div style={{ textAlign: 'center', maxWidth: 440, padding: '0 24px' }}>
        <div style={{
          width: 64, height: 64, borderRadius: '50%',
          background: 'rgba(22,163,74,0.1)', display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 20px',
        }}>
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
            <path d="M7 14 L12 19 L21 10" stroke="var(--color-green, #16a34a)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.04em', margin: '0 0 10px', color: 'var(--color-ink-1)' }}>
          Application submitted!
        </h1>
        <p style={{ fontSize: 14, color: 'var(--color-ink-3)', lineHeight: 1.7, margin: '0 0 24px' }}>
          {labels[role]} Our team reviews applications within <strong>1–3 business days</strong>. We'll email you with next steps.
        </p>
        <div style={{
          padding: '16px 20px', borderRadius: 10,
          background: 'var(--color-bg-2, #f8fafc)',
          border: '1.5px solid var(--color-border)',
          fontSize: 13, color: 'var(--color-ink-2)', textAlign: 'left', lineHeight: 1.8,
        }}>
          <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-ink-4)' }}>What happens next</div>
          <div>① Strike reviews your KYB application</div>
          <div>② We may reach out for any missing documents</div>
          <div>③ Once approved, you'll receive platform access</div>
          <div>④ Set up programs and invite users inside the platform</div>
        </div>
        <a
          href="/login"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            marginTop: 24, height: 42, padding: '0 24px', borderRadius: 8,
            background: 'var(--color-ink-1)', color: 'white',
            textDecoration: 'none', fontSize: 14, fontWeight: 600,
          }}
        >Go to sign in <OBIcon name="arrow" size={14} /></a>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Main Onboarding Controller
// ─────────────────────────────────────────────────────────────
function ScreenOnboarding({ navigate }) {
  const [role, setRole] = useOb('supplier');
  const [step, setStep] = useOb(0);
  const [submitted, setSubmitted] = useOb(false);

  const [accountData, setAccountData] = useOb({});
  const [companyData, setCompanyData] = useOb({});
  const [bankAcctData, setBankAcctData] = useOb({});
  const [docs, setDocs] = useOb({});

  const steps = role === 'supplier' ? SUPPLIER_STEPS : role === 'anchor' ? ANCHOR_STEPS : BANK_STEPS;

  const next = () => setStep(s => Math.min(s + 1, steps.length - 1));
  const back = () => setStep(s => Math.max(s - 1, 0));

  if (submitted) return <ScreenOBSuccess role={role} />;

  // Step 0 = Welcome (no shell/stepper)
  if (step === 0) {
    return (
      <OBShell steps={steps} current={0} role={null}>
        <StepWelcome
          role={role}
          setRole={r => { setRole(r); setStep(0); }}
          onNext={next}
        />
      </OBShell>
    );
  }

  // Supplier flow steps
  if (role === 'supplier') {
    if (step === 1) return <OBShell steps={steps} current={1} role={role}><StepAccount data={accountData} setData={setAccountData} onBack={back} onNext={next} /></OBShell>;
    if (step === 2) return <OBShell steps={steps} current={2} role={role}><StepCompanyInfo data={companyData} setData={setCompanyData} onBack={back} onNext={next} role={role} /></OBShell>;
    if (step === 3) return <OBShell steps={steps} current={3} role={role}><StepDocuments docs={docs} setDocs={setDocs} onBack={back} onNext={next} role={role} /></OBShell>;
    if (step === 4) return <OBShell steps={steps} current={4} role={role}><StepBankAccount data={bankAcctData} setData={setBankAcctData} onBack={back} onNext={next} /></OBShell>;
    if (step === 5) return <OBShell steps={steps} current={5} role={role}><StepReview formData={{ account: accountData, company: companyData }} docs={docs} role={role} onBack={back} onSubmit={() => setSubmitted(true)} /></OBShell>;
  }

  // Anchor flow steps
  if (role === 'anchor') {
    if (step === 1) return <OBShell steps={steps} current={1} role={role}><StepAccount data={accountData} setData={setAccountData} onBack={back} onNext={next} /></OBShell>;
    if (step === 2) return <OBShell steps={steps} current={2} role={role}><StepCompanyInfo data={companyData} setData={setCompanyData} onBack={back} onNext={next} role={role} /></OBShell>;
    if (step === 3) return <OBShell steps={steps} current={3} role={role}><StepDocuments docs={docs} setDocs={setDocs} onBack={back} onNext={next} role={role} /></OBShell>;
    if (step === 4) return <OBShell steps={steps} current={4} role={role}><StepReview formData={{ account: accountData, company: companyData }} docs={docs} role={role} onBack={back} onSubmit={() => setSubmitted(true)} /></OBShell>;
  }

  // Bank flow steps
  if (role === 'bank') {
    if (step === 1) return <OBShell steps={steps} current={1} role={role}><StepAccount data={accountData} setData={setAccountData} onBack={back} onNext={next} /></OBShell>;
    if (step === 2) return <OBShell steps={steps} current={2} role={role}><StepInstitutionInfo data={companyData} setData={setCompanyData} onBack={back} onNext={next} /></OBShell>;
    if (step === 3) return <OBShell steps={steps} current={3} role={role}><StepRegulatoryDocs docs={docs} setDocs={setDocs} onBack={back} onNext={next} /></OBShell>;
    if (step === 4) return <OBShell steps={steps} current={4} role={role}><StepReview formData={{ account: accountData, company: companyData }} docs={docs} role={role} onBack={back} onSubmit={() => setSubmitted(true)} /></OBShell>;
  }

  return null;
}

Object.assign(window, { ScreenOnboarding });
