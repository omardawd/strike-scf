/* global React */
const { useState: useStateCR } = React;

// ============== Bank: Credit Review Scorecard ==============
function ScreenCreditReview({ navigate, portal }) {
  const [fhScore, setFhScore] = useStateCR(50); // assigned
  const [notes, setNotes] = useStateCR('Reviewed FY2025 statements. Working capital ratio 1.4, debt/equity 0.7. Revenue grew 12% YoY. Some seasonality in Q4 affecting cash conversion.');

  const dims = [
    { name: 'Business longevity',     w: 15, score: 70, tone: 'green' },
    { name: 'Revenue scale',          w: 20, score: 80, tone: 'green' },
    { name: 'Document completeness',  w: 15, score: 90, tone: 'green' },
    { name: 'Financial health',       w: 25, score: fhScore === null ? null : fhScore, tone: fhScore === 0 ? 'red' : fhScore === 100 ? 'green' : 'amber', pending: fhScore === null },
    { name: 'Program fit',            w: 10, score: 85, tone: 'green' },
    { name: 'Counterparty tenure',    w: 15, score: 75, tone: 'green' },
  ];
  const total = Math.round(dims.reduce((acc, d) => acc + (d.score == null ? 0 : (d.score * d.w / 100)), 0));
  const tier = total >= 80 ? 'A' : total >= 60 ? 'B' : total >= 40 ? 'C' : 'D';
  const tierLabel = tier === 'A' ? 'Excellent' : tier === 'B' ? 'Acceptable' : tier === 'C' ? 'Caution' : 'High risk';
  const recColor = tier === 'A' || tier === 'B' ? 'green' : tier === 'C' ? 'amber' : 'red';
  const rec = tier === 'A' || tier === 'B' ? 'Approve' : tier === 'C' ? 'Review carefully' : 'Reject';
  const fhAssigned = fhScore !== null;

  return (
    <>
      <Topbar
        onBack={() => navigate({ screen: 'program', programId: 'factoring' })}
        crumbs={[
          { label: 'Bank Portal' },
          { label: 'Factoring Program', onClick: () => navigate({ screen: 'program', programId: 'factoring' }) },
          { label: 'Credit Review' },
          { label: 'Apex Industrial Ltd' },
        ]}
        actions={<NotifBell count={3} />}
      />
      <div className="page" data-screen-label="Credit Review · Apex">
        <div className="page-header">
          <div className="page-id-title">
            <span className="nowrap" style={{ fontWeight: 500 }}>Apex Industrial Ltd</span>
            <span className="program-type-pill">Supplier · KYB Review</span>
          </div>
          <div className="subtitle">Applied to join Factoring Program · Submitted May 5, 2026 · 2 days waiting</div>
        </div>

        <div className="split-65">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="card">
              <div className="card-head"><h3 className="t-card-head">Automated score</h3></div>
              <div style={{ padding: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
                  <div className="mono" style={{ fontSize: 48, fontWeight: 500, lineHeight: 1, color: 'var(--color-ink-1)' }}>{total}</div>
                  <div style={{ textAlign: 'right' }}>
                    <span className={`badge badge-${tier === 'A' ? 'funded' : tier === 'B' ? 'pending' : tier === 'C' ? 'pending' : 'rejected'}`}>Tier {tier} · {tierLabel}</span>
                    <div style={{ marginTop: 6, fontSize: 12, color: `var(--color-${recColor})`, fontWeight: 500 }}>Recommended: {rec}</div>
                  </div>
                </div>

                {/* Score bar with tier markers */}
                <div className="score-bar-wrap" style={{ marginTop: 16 }}>
                  <div className="score-tri" style={{ left: `calc(${total}% - 5px)` }}>▼</div>
                  <div className="score-bar">
                    <div className="score-bar-fill" style={{ width: `${total}%`, background: 'var(--color-accent)' }} />
                  </div>
                  <div className="score-tier-row">
                    <span className="score-tier-mark" style={{ color: 'var(--color-red)' }}>D 0–39</span>
                    <span className="score-tier-mark" style={{ color: 'var(--color-amber)' }}>C 40–59</span>
                    <span className="score-tier-mark" style={{ color: 'var(--color-amber)' }}>B 60–79</span>
                    <span className="score-tier-mark" style={{ color: 'var(--color-green)' }}>A 80–100</span>
                  </div>
                </div>

                <div className="dim-table">
                  {dims.map((d, i) => (
                    <div key={i} className="dim-row">
                      <div className="dim-name">{d.name}</div>
                      <div className="dim-weight">{d.w}%</div>
                      <div className="dim-score mono">
                        {d.pending ? <span style={{ color: 'var(--color-amber)' }}>—</span> : d.score}
                      </div>
                      <div className="dim-bar"><div className={`dim-bar-fill util-${d.tone}`} style={{ width: `${d.pending ? 0 : d.score}%` }} /></div>
                      {d.pending && <div className="dim-pending">Pending your input</div>}
                    </div>
                  ))}
                </div>

                {!fhAssigned && (
                  <div className="alert alert-warn" style={{ marginTop: 16 }}>
                    <Icon name="warn" size={14} className="alert-icon" />
                    <span className="alert-body">You must assign the financial health sub-score before making a decision. Review the uploaded financials and assign a score.</span>
                  </div>
                )}

                <div style={{ marginTop: 16 }}>
                  <div className="form-label">Financial health sub-score</div>
                  <div className="fh-radio-row">
                    {[
                      { v: 0,   label: '0 · Poor',       tone: 'red' },
                      { v: 50,  label: '50 · Acceptable', tone: 'amber' },
                      { v: 100, label: '100 · Strong',   tone: 'green' },
                    ].map(o => (
                      <button key={o.v} type="button" className={`fh-radio fh-${o.tone} ${fhScore === o.v ? 'selected' : ''}`} onClick={() => setFhScore(o.v)}>
                        <div className="radio-card-radio" />
                        {o.label}
                      </button>
                    ))}
                  </div>

                  <div className="form-field" style={{ marginTop: 12 }}>
                    <div className="form-label-row">
                      <label className="form-label">Notes (required)</label>
                      <span className="form-label-meta">{notes.length} / min 50</span>
                    </div>
                    <textarea className="form-textarea" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Describe your assessment of the financial statements..." />
                  </div>

                  {fhAssigned && (
                    <div style={{ marginTop: 8, fontSize: 13, color: 'var(--color-ink-2)' }}>
                      Updated score: <strong style={{ color: 'var(--color-ink-1)' }}>{total}</strong> · Tier {tier}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-head"><h3 className="t-card-head">Document review</h3></div>
              <div>
                {[
                  { ok: 'ok',   name: 'Certificate of Incorporation',  type: 'Required',         date: 'Feb 12, 2025' },
                  { ok: 'ok',   name: 'Financial statements FY2025',   type: 'Required',         date: 'May 5, 2026' },
                  { ok: 'ok',   name: 'Bank statements (3mo)',         type: 'Required',         date: 'May 5, 2026' },
                  { ok: 'ok',   name: 'Director ID',                   type: 'Required',         date: 'Feb 12, 2025' },
                  { ok: 'ok',   name: 'Void cheque',                   type: 'Required',         date: 'Feb 12, 2025' },
                  { ok: 'warn', name: 'Articles of Organization',      type: 'Required for LLC', meta: 'Not uploaded — not required for Corporation' },
                ].map((d, i) => (
                  <div key={i} className="doc-row" style={{ alignItems: 'center' }}>
                    <span className={`doc-status doc-status-${d.ok}`}>{d.ok === 'ok' ? '✓' : '⚠'}</span>
                    <span className="doc-name">{d.name}</span>
                    <span className="doc-type">{d.type}</span>
                    {d.meta ? <span className="doc-meta-italic">{d.meta}</span> : <span className="doc-date mono">{d.date}</span>}
                    {d.ok === 'ok' && <a className="doc-link">View</a>}
                  </div>
                ))}
              </div>
            </div>

            <div className="card">
              <div className="card-head"><h3 className="t-card-head">Application history</h3></div>
              <div className="hist-tl">
                {[
                  { dot: 'blue',  actor: 'System',    aClass: 'actor-system', text: 'Credit score calculated: 82 · Tier B', time: 'May 5, 14:00' },
                  { dot: 'green', actor: 'Applicant', aClass: 'actor-supplier', text: 'KYB documents submitted', time: 'May 5, 09:30' },
                  { dot: 'blue',  actor: 'System',    aClass: 'actor-system', text: 'Invitation accepted · account created', time: 'Feb 12, 2025' },
                ].map((e, i, arr) => (
                  <div key={i} className="hist-row">
                    <div className="hist-rail">
                      <div className={`hist-dot tone-${e.dot}`} />
                      {i < arr.length - 1 && <div className="hist-line" />}
                    </div>
                    <div className="hist-body">
                      <span className={`actor-pill ${e.aClass}`}>{e.actor}</span>
                      <span className="hist-text">{e.text}</span>
                      <span className="hist-time mono">{e.time}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, position: 'sticky', top: 62, alignSelf: 'flex-start' }}>
            <div className="card">
              <div className="card-head"><h3 className="t-card-head">Applicant details</h3></div>
              <div className="kv-list">
                <div className="kv-row"><span className="k">Company</span><span className="v plain">Apex Industrial Ltd</span></div>
                <div className="kv-row"><span className="k">Type</span><span className="v plain">Supplier</span></div>
                <div className="kv-row"><span className="k">EIN</span><span className="v mono">••-•••1234</span></div>
                <div className="kv-row"><span className="k">Business type</span><span className="v plain">Corporation</span></div>
                <div className="kv-row"><span className="k">State</span><span className="v plain">Delaware</span></div>
                <div className="kv-row"><span className="k">Years operating</span><span className="v plain">8 years</span></div>
                <div className="kv-row"><span className="k">Revenue range</span><span className="v plain">$25M–$100M</span></div>
                <div className="kv-row"><span className="k">Industry</span><span className="v plain">Manufacturing (NAICS 3312)</span></div>
                <div className="kv-row"><span className="k">Contact</span><span className="v plain">Rachel Lin · Finance Manager</span></div>
                <div className="kv-row"><span className="k">Applied to</span><span className="v plain">Factoring Program</span></div>
                <div className="kv-row"><span className="k">Invited by</span><span className="v plain">Continental Foods (Anchor)</span></div>
              </div>
            </div>

            <div className="card">
              <div className="card-head"><h3 className="t-card-head">Your decision</h3></div>
              <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button className="btn btn-primary btn-block" type="button" disabled={!fhAssigned} title={!fhAssigned ? 'Assign financial health sub-score first' : ''} style={{ height: 38 }}>Approve</button>
                <button className="btn btn-secondary btn-block" type="button">Override & approve</button>
                <button className="btn btn-ghost btn-block" type="button">Request more info</button>
                <button className="btn btn-danger btn-block" type="button">Reject</button>
              </div>
            </div>

            <div className="card">
              <div className="card-head" style={{ display: 'flex', justifyContent: 'space-between' }}>
                <h3 className="t-card-head">Collateral requirements</h3>
                <a className="t-link-accent" style={{ fontSize: 12 }}>+ Add</a>
              </div>
              <div style={{ padding: 12 }}>
                <div className="collateral-empty">No collateral required · Add if needed</div>
                <div className="collateral-row">
                  <div>
                    <div style={{ fontSize: 12.5, color: 'var(--color-ink-1)' }}>Post-dated cheque · <span className="mono">$500,000</span></div>
                    <div style={{ fontSize: 11, color: 'var(--color-ink-3)', marginTop: 2 }}>Due by May 20, 2026</div>
                  </div>
                  <a className="collateral-remove">×</a>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ============== Anchor: KYB Step 2 — Company Info ==============
function ScreenAnchorKYB({ navigate }) {
  return (
    <OnboardingShell>
      <StepIndicator steps={['Account', 'Company Info', 'Documents', 'Review', 'Decision']} current={1} />

      <h1 className="onboard-title">Company information</h1>
      <div className="onboard-sub">Tell us about your business. This information is used for credit assessment.</div>

      <div className="card onboard-form">
        <div className="onboard-form-body">
          <div className="form-row-2">
            <div className="form-field">
              <label className="form-label">Legal business name</label>
              <input className="form-input" defaultValue="Continental Foods Inc." />
            </div>
            <div className="form-field">
              <div className="form-label-row">
                <label className="form-label">Doing business as</label>
                <span className="form-label-meta">Optional</span>
              </div>
              <input className="form-input" defaultValue="Continental Foods" />
            </div>
          </div>

          <div className="form-field">
            <label className="form-label">EIN (Employer Identification Number)</label>
            <div className="input-with-status">
              <input className="form-input mono" defaultValue="45-1234567" />
              <span className="input-status verified"><Icon name="check" size={11} /> Valid format</span>
            </div>
          </div>

          <div className="form-row-2">
            <div className="form-field">
              <label className="form-label">Business type</label>
              <select className="form-input form-select" defaultValue="corp">
                <option value="corp">Corporation</option>
                <option value="llc">LLC</option>
                <option value="lp">Limited Partnership</option>
              </select>
            </div>
            <div className="form-field">
              <label className="form-label">State of incorporation</label>
              <select className="form-input form-select" defaultValue="ca">
                <option value="ca">California</option>
                <option value="de">Delaware</option>
                <option value="ny">New York</option>
              </select>
            </div>
          </div>

          <div className="form-section-label">Business address</div>
          <div className="form-field">
            <label className="form-label">Address line 1</label>
            <input className="form-input" defaultValue="1200 Market Street" />
          </div>
          <div className="form-field">
            <div className="form-label-row">
              <label className="form-label">Address line 2</label>
              <span className="form-label-meta">Optional</span>
            </div>
            <input className="form-input" defaultValue="Suite 400" />
          </div>
          <div className="form-row-3">
            <div className="form-field">
              <label className="form-label">City</label>
              <input className="form-input" defaultValue="San Francisco" />
            </div>
            <div className="form-field">
              <label className="form-label">State</label>
              <select className="form-input form-select" defaultValue="ca"><option value="ca">CA</option></select>
            </div>
            <div className="form-field">
              <label className="form-label">ZIP</label>
              <input className="form-input mono" defaultValue="94103" />
            </div>
          </div>

          <div className="form-row-2">
            <div className="form-field">
              <label className="form-label">Years in operation</label>
              <input className="form-input mono" defaultValue="12" />
            </div>
            <div className="form-field">
              <label className="form-label">Annual revenue range</label>
              <select className="form-input form-select" defaultValue="r3"><option value="r3">$25M–$100M</option></select>
            </div>
          </div>

          <div className="form-field">
            <label className="form-label">Industry</label>
            <select className="form-input form-select" defaultValue="fb"><option value="fb">Food & Beverage Manufacturing (NAICS 3112)</option></select>
          </div>

          <div className="form-section-label">Primary contact</div>
          <div className="form-row-3">
            <div className="form-field">
              <label className="form-label">Full name</label>
              <input className="form-input" defaultValue="James Mitchell" />
            </div>
            <div className="form-field">
              <label className="form-label">Title</label>
              <input className="form-input" defaultValue="Treasury Director" />
            </div>
            <div className="form-field">
              <label className="form-label">Phone</label>
              <input className="form-input mono" defaultValue="(415) 555-0142" />
            </div>
          </div>

          <div className="form-actions">
            <button className="btn btn-primary" type="button">Continue →</button>
            <button className="btn btn-ghost" type="button">← Back</button>
          </div>
        </div>
      </div>
    </OnboardingShell>
  );
}

// ============== Reporting Bank ==============
function DateRangePills({ value = '90D' }) {
  const [v, setV] = useStateCR(value);
  return (
    <div className="range-pills">
      {['30D', '90D', '6M', '12M', 'YTD'].map(p => (
        <button key={p} type="button" className={`range-pill ${v === p ? 'selected' : ''}`} onClick={() => setV(p)}>{p}</button>
      ))}
    </div>
  );
}

// Stacked bar chart SVG
function StackedBarChart({ data, height = 160 }) {
  const w = 520;
  const pad = { l: 36, r: 8, t: 8, b: 24 };
  const cw = w - pad.l - pad.r;
  const ch = height - pad.t - pad.b;
  const max = 25; // $25M
  const bw = cw / data.length * 0.7;
  const step = cw / data.length;
  const ygrid = [0, 5, 10, 15, 20, 25];
  return (
    <svg viewBox={`0 0 ${w} ${height}`} width="100%" height={height} className="chart">
      {ygrid.map((g, i) => (
        <g key={i}>
          <line x1={pad.l} x2={w - pad.r} y1={pad.t + ch - (g / max) * ch} y2={pad.t + ch - (g / max) * ch} stroke="var(--color-border)" />
          <text x={pad.l - 6} y={pad.t + ch - (g / max) * ch + 3} textAnchor="end" fontSize="9" fill="var(--color-ink-4)">${g}M</text>
        </g>
      ))}
      {data.map((d, i) => {
        const x = pad.l + step * i + (step - bw) / 2;
        let yCursor = pad.t + ch;
        const segs = [
          { v: d.factoring, c: 'var(--color-accent)' },
          { v: d.reverse,   c: 'var(--color-amber)' },
          { v: d.po,        c: 'var(--color-green)' },
        ];
        return (
          <g key={i}>
            {segs.map((s, j) => {
              const sh = (s.v / max) * ch;
              yCursor -= sh;
              return <rect key={j} x={x} y={yCursor} width={bw} height={sh} fill={s.c} rx="1" />;
            })}
            <text x={x + bw / 2} y={height - 6} textAnchor="middle" fontSize="9" fill="var(--color-ink-4)">{d.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

function HBar({ items, total }) {
  return (
    <div className="hbar-stack">
      {items.map((it, i) => (
        <div className="hbar-row" key={i}>
          <div className="hbar-label">{it.label}</div>
          <div className="hbar-track">
            <div className="hbar-fill" style={{ width: `${(it.value / total) * 100}%`, background: it.color }} />
          </div>
          <div className="hbar-value mono">{it.amount}</div>
          <div className="hbar-pct mono">{Math.round(it.value / total * 100)}%</div>
        </div>
      ))}
    </div>
  );
}

function Donut({ segments, centerNum, centerLabel, size = 140 }) {
  const r = 56, c = 2 * Math.PI * r;
  const total = segments.reduce((a, s) => a + s.value, 0);
  let offset = 0;
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
      <g transform={`translate(${size/2} ${size/2}) rotate(-90)`}>
        <circle r={r} fill="none" stroke="var(--color-bg-2)" strokeWidth="14" />
        {segments.map((s, i) => {
          const len = (s.value / total) * c;
          const dasharr = `${len} ${c - len}`;
          const el = <circle key={i} r={r} fill="none" stroke={s.color} strokeWidth="14" strokeDasharray={dasharr} strokeDashoffset={-offset} />;
          offset += len;
          return el;
        })}
      </g>
      <text x={size/2} y={size/2 - 2} textAnchor="middle" fontSize="14" fontWeight="600" fill="var(--color-ink-1)" fontFamily="ui-monospace, monospace">{centerNum}</text>
      <text x={size/2} y={size/2 + 12} textAnchor="middle" fontSize="9" fill="var(--color-ink-3)">{centerLabel}</text>
    </svg>
  );
}

function ScreenBankReporting({ navigate }) {
  const months = ['Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May'];
  const data = months.map((m, i) => {
    const base = 8 + i * 0.7;
    return { label: m, factoring: base, reverse: base * 0.55, po: base * 0.32 };
  });

  return (
    <>
      <Topbar
        crumbs={[{ label: 'Bank Portal' }, { label: 'Reporting' }]}
        actions={<><button className="btn btn-secondary" type="button">Export all</button><NotifBell count={3} /></>}
      />
      <div className="page" data-screen-label="Reporting · Bank">
        <div className="page-header">
          <h1 className="t-page-title" style={{ fontSize: 20 }}>Portfolio analytics</h1>
          <div className="subtitle">Atlas Bank · All programs · Last updated just now</div>
        </div>
        <DateRangePills />

        <div className="grid-2-1" style={{ gridTemplateColumns: '1fr 1fr', marginTop: 16 }}>
          <div className="card">
            <div className="card-head"><h3 className="t-card-head">Funded volume · last 12 months</h3></div>
            <div style={{ padding: 12 }}>
              <StackedBarChart data={data} />
              <div className="chart-legend">
                <span><span className="legend-dot" style={{ background: 'var(--color-accent)' }} />Factoring</span>
                <span><span className="legend-dot" style={{ background: 'var(--color-amber)' }} />Reverse Factoring</span>
                <span><span className="legend-dot" style={{ background: 'var(--color-green)' }} />PO</span>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-head"><h3 className="t-card-head">Outstanding exposure by program</h3></div>
            <div style={{ padding: 16 }}>
              <HBar
                total={46.6}
                items={[
                  { label: 'Factoring',         amount: '$18.2M', value: 18.2, color: 'var(--color-accent)' },
                  { label: 'Reverse Factoring', amount: '$14.1M', value: 14.1, color: 'var(--color-amber)' },
                  { label: 'PO Financing',      amount: '$9.8M',  value: 9.8,  color: 'var(--color-green)' },
                  { label: 'Open',              amount: '$4.5M',  value: 4.5,  color: 'var(--color-ink-4)' },
                ]}
              />
              <div style={{ marginTop: 12, fontSize: 12, color: 'var(--color-ink-3)', borderTop: '1px solid var(--color-border)', paddingTop: 10 }}>
                <strong style={{ color: 'var(--color-ink-1)' }}>$46.6M</strong> total exposure
              </div>
            </div>
          </div>
        </div>

        <div className="grid-1-1-1" style={{ marginTop: 16 }}>
          <div className="card">
            <div className="card-head"><h3 className="t-card-head">Key metrics</h3></div>
            <div className="kv-list">
              {[
                { k: 'Default rate',           v: '0.31%',     trend: 'green', arrow: '↓ improving' },
                { k: 'Avg deal cycle',         v: '2.4 days',  trend: 'green', arrow: '↓' },
                { k: 'Repayment on-time',      v: '96.8%',     trend: 'green', arrow: '↑' },
                { k: 'Avg APR',                v: '8.42%',     trend: 'amber', arrow: '→ flat' },
                { k: 'Top anchor concentr.',   v: '26%',       trend: 'amber', arrow: '⚠' },
                { k: 'Active programs',        v: '4 / 4',     trend: 'green', arrow: '' },
              ].map((m, i) => (
                <div key={i} className="kv-row">
                  <span className="k">{m.k}</span>
                  <span className="v">
                    <span className="mono" style={{ fontWeight: 500, color: 'var(--color-ink-1)' }}>{m.v}</span>
                    <span style={{ marginLeft: 6, fontSize: 11, color: `var(--color-${m.trend})` }}>{m.arrow}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="card-head"><h3 className="t-card-head">Deal cycle time · by program</h3></div>
            <div style={{ padding: 16 }}>
              {[
                { name: 'Factoring',         days: 2.1, tone: 'green' },
                { name: 'Reverse Factoring', days: 3.4, tone: 'amber' },
                { name: 'PO Financing',      days: 4.8, tone: 'amber' },
                { name: 'Open',              days: 6.2, tone: 'red' },
              ].map((r, i) => (
                <div key={i} className="cycle-row">
                  <span className="cycle-name">{r.name}</span>
                  <span className="cycle-days mono">{r.days}d</span>
                  <div className="cycle-track">
                    <div className={`cycle-fill util-${r.tone}`} style={{ width: `${(r.days / 7) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="card-head"><h3 className="t-card-head">Risk distribution</h3></div>
            <div style={{ padding: 12, display: 'flex', justifyContent: 'center' }}>
              <Donut
                size={140}
                centerNum="86"
                centerLabel="counterparties"
                segments={[
                  { value: 33, color: 'var(--color-green)' },
                  { value: 38, color: 'var(--color-accent)' },
                  { value: 12, color: 'var(--color-amber)' },
                  { value: 3,  color: 'var(--color-red)' },
                ]}
              />
            </div>
            <div style={{ padding: '0 16px 16px', fontSize: 12, color: 'var(--color-ink-3)', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {[
                { l: 'Tier A', v: '38%', n: '33', c: 'green' },
                { l: 'Tier B', v: '44%', n: '38', c: 'accent' },
                { l: 'Tier C', v: '14%', n: '12', c: 'amber' },
                { l: 'Tier D', v: '4%',  n: '3',  c: 'red' },
              ].map((s, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span><span className="legend-dot" style={{ background: `var(--color-${s.c})` }} />{s.l}</span>
                  <span><span className="mono" style={{ color: 'var(--color-ink-1)' }}>{s.v}</span> · {s.n}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ============== Anchor reporting ==============
function LineChart({ values, height = 140, color = 'var(--color-accent)', filled = true, range, labels, dashedAt }) {
  const w = 520;
  const pad = { l: 36, r: 12, t: 8, b: 22 };
  const cw = w - pad.l - pad.r;
  const ch = height - pad.t - pad.b;
  const min = range ? range[0] : Math.min(...values);
  const max = range ? range[1] : Math.max(...values);
  const points = values.map((v, i) => {
    const x = pad.l + (i / (values.length - 1)) * cw;
    const y = pad.t + ch - ((v - min) / (max - min)) * ch;
    return [x, y];
  });
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0]} ${p[1]}`).join(' ');
  const area = `${path} L ${points[points.length - 1][0]} ${pad.t + ch} L ${points[0][0]} ${pad.t + ch} Z`;
  const ygrid = 4;
  return (
    <svg viewBox={`0 0 ${w} ${height}`} width="100%" height={height} className="chart">
      {[...Array(ygrid + 1)].map((_, i) => {
        const v = min + (max - min) * (i / ygrid);
        const y = pad.t + ch - (i / ygrid) * ch;
        return (
          <g key={i}>
            <line x1={pad.l} x2={w - pad.r} y1={y} y2={y} stroke="var(--color-border)" />
            <text x={pad.l - 6} y={y + 3} textAnchor="end" fontSize="9" fill="var(--color-ink-4)">{typeof range === 'object' && range[2] ? range[2](v) : v.toFixed(0)}</text>
          </g>
        );
      })}
      {dashedAt != null && (() => {
        const y = pad.t + ch - ((dashedAt - min) / (max - min)) * ch;
        return <line x1={pad.l} x2={w - pad.r} y1={y} y2={y} stroke="var(--color-ink-4)" strokeDasharray="3 3" />;
      })()}
      {filled && <path d={area} fill={color} opacity="0.12" />}
      <path d={path} fill="none" stroke={color} strokeWidth="2" />
      {points.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r="2.5" fill={color} />)}
      {labels && labels.map((l, i) => (
        <text key={i} x={pad.l + (i / (labels.length - 1)) * cw} y={height - 6} textAnchor="middle" fontSize="9" fill="var(--color-ink-4)">{l}</text>
      ))}
    </svg>
  );
}

function BarChart({ values, labels, height = 140, target, colorFn }) {
  const w = 520;
  const pad = { l: 36, r: 12, t: 8, b: 22 };
  const cw = w - pad.l - pad.r;
  const ch = height - pad.t - pad.b;
  const max = Math.max(...values, target || 0) * 1.1;
  const bw = cw / values.length * 0.6;
  const step = cw / values.length;
  return (
    <svg viewBox={`0 0 ${w} ${height}`} width="100%" height={height} className="chart">
      {[0, 0.25, 0.5, 0.75, 1].map((g, i) => {
        const y = pad.t + ch - g * ch;
        return (
          <g key={i}>
            <line x1={pad.l} x2={w - pad.r} y1={y} y2={y} stroke="var(--color-border)" />
            <text x={pad.l - 6} y={y + 3} textAnchor="end" fontSize="9" fill="var(--color-ink-4)">{Math.round(max * g)}</text>
          </g>
        );
      })}
      {target != null && (() => {
        const y = pad.t + ch - (target / max) * ch;
        return <g>
          <line x1={pad.l} x2={w - pad.r} y1={y} y2={y} stroke="var(--color-amber)" strokeDasharray="3 3" />
          <text x={w - pad.r - 4} y={y - 2} textAnchor="end" fontSize="9" fill="var(--color-amber)">target {target}</text>
        </g>;
      })()}
      {values.map((v, i) => {
        const x = pad.l + step * i + (step - bw) / 2;
        const h = (v / max) * ch;
        const y = pad.t + ch - h;
        const c = colorFn ? colorFn(v) : 'var(--color-accent)';
        return (
          <g key={i}>
            <rect x={x} y={y} width={bw} height={h} fill={c} rx="1" />
            <text x={x + bw / 2} y={height - 6} textAnchor="middle" fontSize="9" fill="var(--color-ink-4)">{labels[i]}</text>
          </g>
        );
      })}
    </svg>
  );
}

function ScreenAnchorReporting({ navigate }) {
  return (
    <>
      <Topbar
        crumbs={[{ label: 'Anchor Portal' }, { label: 'Reporting' }]}
        actions={<><button className="btn btn-secondary" type="button">Export</button><NotifBell count={7} /></>}
      />
      <div className="page" data-screen-label="Reporting · Anchor">
        <div className="page-header">
          <h1 className="t-page-title" style={{ fontSize: 20 }}>Financing analytics</h1>
          <div className="subtitle">Continental Foods · All programs</div>
        </div>
        <DateRangePills />

        <div className="grid-2-1" style={{ gridTemplateColumns: '1fr 1fr', marginTop: 16 }}>
          <div className="card">
            <div className="card-head"><h3 className="t-card-head">Monthly financing cost</h3></div>
            <div style={{ padding: 12 }}>
              <LineChart
                values={[5.2, 5.8, 6.1, 6.4, 6.8, 7.2]}
                labels={['Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May']}
                range={[0, 8, (v) => '$' + v.toFixed(0) + 'M']}
                color="var(--color-accent)"
              />
              <div className="chart-legend">
                <span><span className="legend-dot" style={{ background: 'var(--color-accent)' }} />Total financed</span>
                <span><span className="legend-dot" style={{ background: 'var(--color-amber)' }} />Total fees</span>
              </div>
              <div style={{ marginTop: 8, fontSize: 12, color: 'var(--color-ink-3)' }}>YTD financing cost: <strong className="mono" style={{ color: 'var(--color-ink-1)' }}>$184,320</strong> · Effective cost: 2.97% of total payables financed</div>
            </div>
          </div>

          <div className="card">
            <div className="card-head"><h3 className="t-card-head">Days Payables Outstanding (DPO)</h3></div>
            <div style={{ padding: 12 }}>
              <BarChart
                values={[52, 48, 55, 51, 47, 44]}
                labels={['Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May']}
                target={45}
                colorFn={(v) => v < 45 ? 'var(--color-green)' : v <= 55 ? 'var(--color-amber)' : 'var(--color-red)'}
              />
              <div style={{ marginTop: 8, fontSize: 12, color: 'var(--color-green)', fontWeight: 500 }}>Current DPO: 44 days · improving ↓</div>
            </div>
          </div>
        </div>

        <div className="grid-2-1" style={{ gridTemplateColumns: '1fr 1fr', marginTop: 16 }}>
          <div className="card">
            <div className="card-head"><h3 className="t-card-head">Supplier utilization</h3></div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Supplier</th>
                  <th>Total financed ↓</th>
                  <th>Txns</th>
                  <th>Avg APR</th>
                  <th>Last activity</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['Apex Industrial',   '$4.8M', '18', '8.42%', '2h ago'],
                  ['Pacific Textiles',  '$3.2M', '12', '8.65%', '5h ago'],
                  ['Metro Components',  '$2.8M', '9',  '8.30%', '1d ago'],
                  ['Sunrise Packaging', '$1.9M', '8',  '8.75%', '2d ago'],
                  ['Global Forge',      '$1.5M', '5',  '8.50%', '3d ago'],
                ].map((r, i) => (
                  <tr key={i}>
                    <td>{r[0]}</td>
                    <td className="mono">{r[1]}</td>
                    <td className="mono">{r[2]}</td>
                    <td className="mono">{r[3]}</td>
                    <td style={{ color: 'var(--color-ink-3)' }}>{r[4]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card">
            <div className="card-head"><h3 className="t-card-head">Repayment performance</h3></div>
            <div style={{ padding: 16, display: 'flex', gap: 24 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--color-green)' }} className="mono">96.8%</div>
                <div style={{ fontSize: 11, color: 'var(--color-ink-4)' }}>On-time repayment rate</div>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--color-amber)' }} className="mono">3.2%</div>
                <div style={{ fontSize: 11, color: 'var(--color-ink-4)' }}>Late repayments</div>
              </div>
            </div>
            <div style={{ padding: '0 16px 16px' }}>
              <div className="repay-stack">
                {['Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May'].map((m, i) => (
                  <div key={i} className="repay-stack-col">
                    <div className="repay-stack-bar">
                      <div className="repay-stack-late" style={{ height: `${[3.5, 4, 2.5, 3.8, 3.2, 3][i]}%` }} />
                    </div>
                    <div className="repay-stack-label">{m}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function ScreenSupplierReporting({ navigate }) {
  return (
    <>
      <Topbar
        crumbs={[{ label: 'Supplier Portal' }, { label: 'Reporting' }]}
        actions={<><button className="btn btn-secondary" type="button">Export</button><NotifBell count={2} /></>}
      />
      <div className="page" data-screen-label="Reporting · Supplier">
        <div className="page-header">
          <h1 className="t-page-title" style={{ fontSize: 20 }}>My financing analytics</h1>
          <div className="subtitle">Apex Industrial · All programs</div>
        </div>
        <DateRangePills />

        <div className="grid-2-1" style={{ gridTemplateColumns: '1fr 1fr', marginTop: 16 }}>
          <div className="card">
            <div className="card-head"><h3 className="t-card-head">Net proceeds rate · last 12 submissions</h3></div>
            <div style={{ padding: 12 }}>
              <LineChart
                values={[93.2, 93.8, 94.0, 93.5, 94.2, 94.5, 94.1, 94.3, 94.0, 94.5, 94.2, 94.1]}
                labels={['1','2','3','4','5','6','7','8','9','10','11','12']}
                range={[92, 96, (v) => v.toFixed(1) + '%']}
                color="var(--color-green)"
                dashedAt={94.1}
              />
              <div style={{ marginTop: 8, fontSize: 12, color: 'var(--color-green)', fontWeight: 500 }}>Average net proceeds: 94.1% of invoice value · Best: 94.5% · Improving ↑</div>
            </div>
          </div>

          <div className="card">
            <div className="card-head"><h3 className="t-card-head">Submission outcomes</h3></div>
            <div style={{ padding: 12, display: 'flex', justifyContent: 'center' }}>
              <Donut
                size={140}
                centerNum="23"
                centerLabel="total"
                segments={[
                  { value: 20, color: 'var(--color-green)' },
                  { value: 2,  color: 'var(--color-red)' },
                  { value: 1,  color: 'var(--color-accent)' },
                ]}
              />
            </div>
            <div style={{ padding: '0 16px 16px', fontSize: 12, color: 'var(--color-ink-3)' }}>
              {[
                { l: 'Approved', n: '20', c: 'green' },
                { l: 'Rejected', n: '2', c: 'red' },
                { l: 'Pending',  n: '1', c: 'accent' },
              ].map((s, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
                  <span><span className="legend-dot" style={{ background: `var(--color-${s.c})` }} />{s.l}</span>
                  <span className="mono" style={{ color: 'var(--color-ink-1)' }}>{s.n}</span>
                </div>
              ))}
              <div style={{ marginTop: 8, fontSize: 13, fontWeight: 500, color: 'var(--color-green)' }}>87% approval rate</div>
            </div>
          </div>
        </div>

        <div className="grid-2-1" style={{ gridTemplateColumns: '1fr 1fr', marginTop: 16 }}>
          <div className="card">
            <div className="card-head"><h3 className="t-card-head">Financing by program</h3></div>
            <div>
              {[
                { prog: 'Factoring', sub: 'Atlas + Continental', amt: '$3.1M', txn: '15 txns', np: '94.2%' },
                { prog: 'PO Financing', sub: 'First Capital + Helios', amt: '$1.1M', txn: '8 txns', np: '93.8%' },
              ].map((r, i) => (
                <div key={i} className="prog-fin-row">
                  <div className="prog-fin-left">
                    <div className="prog-fin-name">{r.prog}</div>
                    <div className="prog-fin-sub">{r.sub}</div>
                  </div>
                  <div className="prog-fin-cell">
                    <div className="prog-fin-val mono">{r.amt}</div>
                    <div className="prog-fin-lbl">financed</div>
                  </div>
                  <div className="prog-fin-cell">
                    <div className="prog-fin-val mono">{r.txn}</div>
                    <div className="prog-fin-lbl">activity</div>
                  </div>
                  <div className="prog-fin-cell">
                    <div className="prog-fin-val mono" style={{ color: 'var(--color-green)' }}>{r.np}</div>
                    <div className="prog-fin-lbl">net</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="card-head"><h3 className="t-card-head">Deal cycle performance</h3></div>
            <div style={{ padding: 16, display: 'flex', gap: 16, justifyContent: 'space-between' }}>
              {[
                { v: '2.1 days', l: 'Avg submission to funded', c: 'green' },
                { v: '18 hours', l: 'Fastest ever',             c: 'green' },
                { v: '4.8 days', l: 'Slowest (PO)',             c: 'amber' },
              ].map((s, i) => (
                <div key={i} style={{ flex: 1 }}>
                  <div className="mono" style={{ fontSize: 24, fontWeight: 500, color: `var(--color-${s.c})` }}>{s.v}</div>
                  <div style={{ fontSize: 11, color: 'var(--color-ink-4)' }}>{s.l}</div>
                </div>
              ))}
            </div>
            <div style={{ padding: '0 16px 16px' }}>
              <BarChart
                height={100}
                values={[2.0, 2.4, 1.8, 3.1, 2.2, 4.8, 2.5, 2.1]}
                labels={['1','2','3','4','5','6','7','8']}
                colorFn={(v) => v < 3 ? 'var(--color-green)' : v <= 5 ? 'var(--color-amber)' : 'var(--color-red)'}
              />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

Object.assign(window, {
  ScreenCreditReview, ScreenAnchorKYB,
  ScreenBankReporting, ScreenAnchorReporting, ScreenSupplierReporting,
});
