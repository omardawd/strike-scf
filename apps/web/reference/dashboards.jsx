/* global React */
const { useState: useStateD } = React;

// ============== Helpers ==============
function smoothPath(points, w, h, padX = 0, padY = 0) {
  // points: array of [x, y] in data coords; returns SVG path with cubic smoothing
  if (points.length < 2) return '';
  let d = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;
    const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
    const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
    const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
    const cp2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2[0]} ${p2[1]}`;
  }
  return d;
}

function Sparkline({ data, color = 'var(--color-green)', height = 36, fill = false }) {
  const w = 200, h = height, pad = 2;
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => [
    pad + (i / (data.length - 1)) * (w - pad * 2),
    h - pad - ((v - min) / range) * (h - pad * 2),
  ]);
  const d = smoothPath(pts, w, h);
  const area = `${d} L ${pts[pts.length - 1][0]} ${h} L ${pts[0][0]} ${h} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: '100%', height, display: 'block' }}>
      {fill && <path d={area} fill={color} fillOpacity="0.12" />}
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ============== BANK DASHBOARD ==============
const BANK_KPIS = [
  { label: 'Outstanding',  value: '$46.6M', delta: '+2.2% vs last month',     deltaClass: 'kpi-delta-pos',  spark: [38,40,39,41,42,43,44,46.6], color: 'var(--color-green)' },
  { label: 'Funded YTD',   value: '$218.4M',delta: '+18.4% vs last year',     deltaClass: 'kpi-delta-pos',  spark: [80,95,110,140,160,180,200,218], color: 'var(--color-green)' },
  { label: 'Avg APR',      value: '8.42%',  delta: '−0.18pp spread compression', deltaClass: 'kpi-delta-warn', spark: [8.6,8.55,8.6,8.5,8.45,8.5,8.45,8.42], color: 'var(--color-amber)' },
  { label: 'Default rate', value: '0.31%',  delta: '−0.08pp improvement',     deltaClass: 'kpi-delta-pos',  spark: [0.42,0.40,0.38,0.39,0.36,0.34,0.33,0.31], color: 'var(--color-green)' },
  { label: 'Deal cycle',   value: '2.4d',   delta: 'Avg submission to funded', deltaClass: 'kpi-delta-mut', spark: [2.5,2.4,2.6,2.5,2.4,2.5,2.4,2.4], color: 'var(--color-ink-3)' },
];

function PortfolioBar() {
  const segs = [
    { pct: 39, color: 'var(--color-accent)', label: 'Factoring $18.2M' },
    { pct: 30, color: 'var(--color-amber)',  label: 'Reverse $14.1M' },
    { pct: 21, color: 'var(--color-green)',  label: 'PO $9.8M' },
    { pct: 10, color: 'var(--color-ink-4)',  label: 'Open $4.5M' },
  ];
  return (
    <div>
      <div className="portfolio-bar">
        {segs.map((s, i) => (
          <div key={i} className="portfolio-seg" style={{ width: `${s.pct}%`, background: s.color }}>
            <span>{s.label}</span>
          </div>
        ))}
      </div>
      <div className="portfolio-meta">Total portfolio exposure: <strong>$46.6M</strong> · 4 active programs · Updated just now</div>
    </div>
  );
}

function BankExposureChart() {
  const data = [28,31,29,33,35,32,38,40,37,42,44,47];
  const months = ['Jun','Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar','Apr','May'];
  const w = 720, h = 180, padL = 40, padR = 40, padT = 20, padB = 28;
  const max = 60;
  const xFor = i => padL + (i / (data.length - 1)) * (w - padL - padR);
  const yFor = v => padT + (1 - v / max) * (h - padT - padB);
  const pts = data.map((v, i) => [xFor(i), yFor(v)]);
  const d = smoothPath(pts);
  const area = `${d} L ${xFor(data.length - 1)} ${yFor(0)} L ${xFor(0)} ${yFor(0)} Z`;
  const annotateX = xFor(4); // Oct
  const peakIdx = data.length - 1;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: '100%', height: 'auto', display: 'block' }}>
      {[0,20,40,60].map(v => (
        <g key={v}>
          <line x1={padL} x2={w - padR} y1={yFor(v)} y2={yFor(v)} stroke="var(--color-border)" strokeDasharray={v===0?'':'2 3'} />
          <text x={w - padR + 6} y={yFor(v) + 3} fontSize="10" fill="var(--color-ink-4)">${v}M</text>
        </g>
      ))}
      <path d={area} fill="var(--color-accent)" fillOpacity="0.08" />
      <path d={d} fill="none" stroke="var(--color-accent)" strokeWidth="1.5" />
      {/* annotation at Oct */}
      <line x1={annotateX} x2={annotateX} y1={padT} y2={h - padB} stroke="var(--color-ink-4)" strokeDasharray="3 3" opacity="0.6" />
      <text x={annotateX + 4} y={padT + 10} fontSize="10" fill="var(--color-ink-3)">New program launched</text>
      {/* peak callout */}
      <circle cx={xFor(peakIdx)} cy={yFor(data[peakIdx])} r="3.5" fill="var(--color-accent)" />
      <text x={xFor(peakIdx) - 8} y={yFor(data[peakIdx]) - 8} fontSize="10" fill="var(--color-ink-2)" textAnchor="end">Current: $46.6M</text>
      {months.map((m, i) => (
        <text key={i} x={xFor(i)} y={h - 8} fontSize="10" fill="var(--color-ink-4)" textAnchor="middle">{m}</text>
      ))}
    </svg>
  );
}

function ScreenBankDashboard({ navigate, portal }) {
  return (
    <>
      <Topbar
        crumbs={[{ label: 'Bank Portal' }, { label: 'Dashboard' }]}
        actions={<>
          <NotifBell count={3} />
          <button className="btn btn-primary" type="button"><Icon name="plus" size={14} /> New Program</button>
        </>}
      />
      <div className="page" data-screen-label="Dashboard · Bank">
        <div className="page-header">
          <div className="eyebrow">Atlas Bank · Portfolio Command</div>
          <h1 className="t-page-title">Good morning, Sarah</h1>
          <div className="subtitle">3 items need immediate attention · May 7, 2026</div>
        </div>

        <PortfolioBar />

        <div className="kpi-strip-5" style={{ marginTop: 24 }}>
          {BANK_KPIS.map((k, i) => (
            <div key={i} className="kpi-card-spark">
              <div className="kpi-label">{k.label}</div>
              <div className="kpi-value mono">{k.value}</div>
              <div className={`kpi-delta ${k.deltaClass}`}>{k.delta}</div>
              <Sparkline data={k.spark} color={k.color} fill={true} />
            </div>
          ))}
        </div>

        <div className="grid-2-1" style={{ marginTop: 24 }}>
          <div className="card">
            <div className="card-head"><h3 className="t-card-head">Portfolio exposure · trailing 12 months</h3></div>
            <div style={{ padding: 16 }}><BankExposureChart /></div>
            <div className="inline-kpi-row">
              <div><span className="strong">274 deals</span> funded</div>
              <div>Avg ticket <span className="strong">$170K</span></div>
              <div><span className="strong">0.31%</span> default rate</div>
            </div>
          </div>

          <div className="card">
            <div className="card-head"><h3 className="t-card-head">Action required</h3></div>
            <div className="action-list">
              <button className="action-row" data-tone="red" onClick={() => navigate({ screen: 'myprograms' })}>
                <div>
                  <div className="action-label">Overdue repayments</div>
                  <div className="action-sub">$284K at risk · 2 transactions</div>
                </div>
                <span className="action-num red">2</span>
                <Icon name="chev-right" size={14} className="action-chev" />
              </button>
              <button className="action-row" data-tone="amber" onClick={() => navigate({ screen: 'program', programId: 'factoring' })}>
                <div>
                  <div className="action-label">Financing queue</div>
                  <div className="action-sub">Avg wait 2.4 days · oldest 3d</div>
                </div>
                <span className="action-num">12</span>
                <Icon name="chev-right" size={14} className="action-chev" />
              </button>
              <button className="action-row" data-tone="amber" onClick={() => navigate({ screen: 'program', programId: 'factoring' })}>
                <div>
                  <div className="action-label">Credit review</div>
                  <div className="action-sub">1 needs Tier D countersign</div>
                </div>
                <span className="action-num">5</span>
                <Icon name="chev-right" size={14} className="action-chev" />
              </button>
              <button className="action-row" data-tone="blue">
                <div>
                  <div className="action-label">More info pending</div>
                  <div className="action-sub">From counterparties</div>
                </div>
                <span className="action-num">4</span>
                <Icon name="chev-right" size={14} className="action-chev" />
              </button>
            </div>
          </div>
        </div>

        <div className="grid-1-1-1" style={{ marginTop: 24 }}>
          <div className="card">
            <div className="card-head"><h3 className="t-card-head">Repayment timeline · next 30 days</h3></div>
            <div style={{ padding: '24px 16px 12px' }}>
              <RepaymentTimeline />
              <div style={{ fontSize: 11.5, color: 'var(--color-ink-3)', marginTop: 12, textAlign: 'center' }}>Total due: <strong>$1.48M</strong> across 4 repayments</div>
            </div>
          </div>

          <div className="card">
            <div className="card-head"><h3 className="t-card-head">Program utilization</h3></div>
            <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[
                { name: 'Factoring',         pct: 74, tone: 'amber' },
                { name: 'Reverse Factoring', pct: 82, tone: 'amber' },
                { name: 'PO Financing',      pct: 40, tone: 'green' },
                { name: 'Open',              pct: 0,  tone: 'gray'  },
              ].map((p, i) => (
                <div key={i}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 12, fontWeight: 500 }}>{p.name}</span>
                    <span className="mono" style={{ fontSize: 11.5, color: 'var(--color-ink-3)' }}>{p.pct}%</span>
                  </div>
                  <div className="util-bar"><div className={`util-bar-fill util-${p.tone}`} style={{ width: `${p.pct}%` }} /></div>
                </div>
              ))}
              <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 8, fontSize: 11.5, color: 'var(--color-ink-4)', textAlign: 'right' }}>Avg utilization: <strong>49%</strong></div>
            </div>
          </div>

          <div className="card">
            <div className="card-head"><h3 className="t-card-head">Recent activity</h3></div>
            <div className="dash-activity">
              {[
                { tone: 'green',  text: 'Apex Industrial funded · $820K',          time: '2m' },
                { tone: 'blue',   text: 'Pacific Textiles submitted · $340K',      time: '18m' },
                { tone: 'amber',  text: '$820K disbursed · Metro Components',      time: '1h' },
                { tone: 'red',    text: 'Global Forge rejected · Tier D',          time: '3h' },
                { tone: 'green',  text: 'Continental Foods repayment · $1.2M',     time: '5h' },
              ].map((a, i) => (
                <div key={i} className={`dash-act-row tone-${a.tone}`}>
                  <span className={`dash-act-dot tone-${a.tone}`} />
                  <span className="dash-act-text">{a.text}</span>
                  <span className="dash-act-time">{a.time} ago</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="onboarding-demo-row">
          <span className="onboarding-demo-label">Onboarding flows (demo):</span>
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => navigate({ screen: 'bank-setup' })}>Bank setup</button>
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => navigate({ screen: 'anchor-kyb' })}>Anchor KYB</button>
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => navigate({ screen: 'supplier-kyb' })}>Supplier KYB</button>
        </div>
      </div>
    </>
  );
}

function RepaymentTimeline() {
  const events = [
    { day: 1,  amt: '$99K',  tone: 'red',   date: 'May 8' },
    { day: 2,  amt: '$218K', tone: 'red',   date: 'May 9' },
    { day: 15, amt: '$342K', tone: 'amber', date: 'May 22' },
    { day: 28, amt: '$824K', tone: 'green', date: 'Jun 4' },
  ];
  const w = 600, h = 100;
  const padL = 30, padR = 30;
  const yMid = 50;
  const xFor = day => padL + (day / 30) * (w - padL - padR);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      <line x1={padL} x2={w - padR} y1={yMid} y2={yMid} stroke="var(--color-border-strong)" strokeWidth="1" />
      {[0, 7, 14, 21, 30].map(d => (
        <g key={d}>
          <line x1={xFor(d)} x2={xFor(d)} y1={yMid - 3} y2={yMid + 3} stroke="var(--color-border-strong)" />
          <text x={xFor(d)} y={yMid + 18} fontSize="9" fill="var(--color-ink-4)" textAnchor="middle">{d === 0 ? 'Today' : d === 30 ? '+30d' : `+${d}d`}</text>
        </g>
      ))}
      {events.map((e, i) => {
        const above = i % 2 === 0;
        const labelY = above ? yMid - 22 : yMid + 32;
        const lineY1 = above ? yMid - 8 : yMid + 8;
        const lineY2 = above ? labelY + 4 : labelY - 14;
        const colorMap = { red: 'var(--color-red)', amber: 'var(--color-amber)', green: 'var(--color-green)' };
        return (
          <g key={i}>
            <line x1={xFor(e.day)} x2={xFor(e.day)} y1={lineY1} y2={lineY2} stroke={colorMap[e.tone]} strokeWidth="1" />
            <circle cx={xFor(e.day)} cy={yMid} r="5" fill={colorMap[e.tone]} />
            <text x={xFor(e.day)} y={labelY} fontSize="11" fill="var(--color-ink-1)" fontWeight="500" textAnchor="middle">{e.amt}</text>
            <text x={xFor(e.day)} y={labelY + (above ? -12 : 14)} fontSize="9" fill="var(--color-ink-4)" textAnchor="middle">{e.date}</text>
          </g>
        );
      })}
    </svg>
  );
}

// ============== ANCHOR DASHBOARD ==============
function AnchorVolumeChart() {
  const months = ['Dec','Jan','Feb','Mar','Apr','May'];
  const data = [
    { fac: 0.6, rev: 0.4, po: 0.2 },
    { fac: 0.7, rev: 0.5, po: 0.3 },
    { fac: 0.9, rev: 0.4, po: 0.4 },
    { fac: 1.0, rev: 0.6, po: 0.3 },
    { fac: 1.2, rev: 0.7, po: 0.4 },
    { fac: 1.4, rev: 0.8, po: 0.5 },
  ];
  const w = 600, h = 140, padL = 30, padR = 12, padT = 10, padB = 22;
  const max = 3;
  const yFor = v => padT + (1 - v / max) * (h - padT - padB);
  const barW = (w - padL - padR) / data.length * 0.55;
  const groupW = (w - padL - padR) / data.length;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      {[0,1,2,3].map(v => (
        <line key={v} x1={padL} x2={w - padR} y1={yFor(v)} y2={yFor(v)} stroke="var(--color-border)" strokeDasharray={v===0?'':'2 3'} />
      ))}
      {data.map((d, i) => {
        const cx = padL + groupW * i + groupW / 2;
        const x = cx - barW / 2;
        const total = d.fac + d.rev + d.po;
        let yCursor = yFor(total);
        const facH = yFor(0) - yFor(d.fac);
        const revH = yFor(0) - yFor(d.rev);
        const poH = yFor(0) - yFor(d.po);
        return (
          <g key={i}>
            <rect x={x} y={yCursor} width={barW} height={poH} fill="var(--color-green)" />
            <rect x={x} y={yCursor + poH} width={barW} height={revH} fill="var(--color-amber)" />
            <rect x={x} y={yCursor + poH + revH} width={barW} height={facH} fill="var(--color-accent)" />
            <text x={cx} y={h - 6} fontSize="10" fill="var(--color-ink-4)" textAnchor="middle">{months[i]}</text>
          </g>
        );
      })}
    </svg>
  );
}

function ScreenAnchorDashboard({ navigate, portal }) {
  const [checked, setChecked] = useStateD({});
  const invoices = [
    { id: 'INV-0842', supplier: 'Apex Industrial',   amount: '$820,000', amountNum: 820000, due: 'Jun 27', wait: 4, tone: 'red' },
    { id: 'INV-0791', supplier: 'Pacific Textiles',  amount: '$340,000', amountNum: 340000, due: 'Jul 2',  wait: 3, tone: 'red' },
    { id: 'INV-0756', supplier: 'Metro Components',  amount: '$215,000', amountNum: 215000, due: 'Jul 8',  wait: 1, tone: 'amber' },
    { id: 'INV-0743', supplier: 'Sunrise Packaging', amount: '$98,500',  amountNum: 98500,  due: 'Jul 15', wait: 1, tone: 'amber' },
  ];
  const selectedIds = Object.keys(checked).filter(k => checked[k]);
  const selectedSum = invoices.filter(i => checked[i.id]).reduce((s, i) => s + i.amountNum, 0);

  return (
    <>
      <Topbar
        crumbs={[{ label: 'Anchor Portal' }, { label: 'Dashboard' }]}
        actions={<>
          <NotifBell count={7} />
          <button className="btn btn-primary" type="button"><Icon name="plus" size={14} /> Request to join program</button>
        </>}
      />
      <div className="page" data-screen-label="Dashboard · Anchor">
        <div className="page-header">
          <div className="eyebrow">Continental Foods · Anchor Portal</div>
          <h1 className="t-page-title">Good morning, James</h1>
          <div className="subtitle">7 invoices awaiting your approval · $3.1M due in 30 days</div>
        </div>

        <div className="payables-flow">
          <div className="payables-seg neutral">
            <div className="ps-label">Total payables</div>
            <div className="ps-value">$24.8M</div>
          </div>
          <div className="payables-arrow"><Icon name="chev-right" size={14} /></div>
          <div className="payables-seg accent">
            <div className="ps-label">Being financed</div>
            <div className="ps-value">$6.2M</div>
          </div>
          <div className="payables-arrow"><Icon name="chev-right" size={14} /></div>
          <div className="payables-seg neutral">
            <div className="ps-label">Unfinanced</div>
            <div className="ps-value muted">$18.6M</div>
          </div>
        </div>
        <div className="payables-meta">25% of your payables are currently being financed through Strike SCF</div>

        <div className="alert alert-warn" style={{ marginTop: 16 }}>
          <Icon name="warn" size={16} className="alert-icon" />
          <div className="alert-body">
            <span style={{ fontWeight: 500 }}>7 invoices awaiting your approval</span>
            <span style={{ color: 'var(--color-ink-3)' }}> · Oldest waiting 4 days</span>
          </div>
          <a className="alert-link" onClick={() => navigate({ screen: 'anchor-invoice' })}>Review now →</a>
        </div>

        <div className="kpi-strip-4" style={{ marginTop: 16 }}>
          <div className="kpi-card-spark">
            <div className="kpi-label">Payables financed</div>
            <div className="kpi-value mono">$24.8M</div>
            <div className="kpi-delta kpi-delta-mut">138 suppliers</div>
            <Sparkline data={[18,19,20,22,23,23.5,24,24.8]} color="var(--color-anchor)" fill />
          </div>
          <div className="kpi-card-spark">
            <div className="kpi-label">Pending approval</div>
            <div className="kpi-value mono" style={{ color: 'var(--color-amber)' }}>7</div>
            <div className="kpi-delta kpi-delta-warn">Oldest 4 days</div>
            <Sparkline data={[5,6,7,7,8,7,8,7]} color="var(--color-amber)" fill />
          </div>
          <div className="kpi-card-spark">
            <div className="kpi-label">Financed this month</div>
            <div className="kpi-value mono">$6.2M</div>
            <div className="kpi-delta kpi-delta-pos">+4.2%</div>
            <Sparkline data={[4.8,5.0,5.4,5.6,5.9,6.0,6.1,6.2]} color="var(--color-green)" fill />
          </div>
          <div className="kpi-card-spark">
            <div className="kpi-label">Due in 30 days</div>
            <div className="kpi-value mono">$3.1M</div>
            <div className="kpi-delta kpi-delta-warn">Next: May 8</div>
            <Sparkline data={[2.4,2.6,2.8,2.9,3.0,3.1,3.1,3.1]} color="var(--color-amber)" fill />
          </div>
        </div>

        <div className="grid-2-1" style={{ marginTop: 24 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="card">
              <div className="card-head">
                <h3 className="t-card-head">Invoice approvals · urgent first</h3>
                {selectedIds.length > 0 && (
                  <span className="t-label">{selectedIds.length} selected</span>
                )}
              </div>
              <table className="table approval-table">
                <thead>
                  <tr>
                    <th style={{ width: 28 }}></th>
                    <th>Supplier</th>
                    <th>Invoice</th>
                    <th className="amount">Amount</th>
                    <th>Due</th>
                    <th>Wait</th>
                    <th className="row-actions"></th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map(inv => (
                    <tr key={inv.id} className={`urgency-${inv.tone}`} style={{ cursor: 'pointer' }} onClick={() => navigate({ screen: 'anchor-invoice' })}>
                      <td><input type="checkbox" checked={!!checked[inv.id]} onChange={e => setChecked({ ...checked, [inv.id]: e.target.checked })} /></td>
                      <td>{inv.supplier}</td>
                      <td className="strike-id">{inv.id}</td>
                      <td className="amount">{inv.amount}</td>
                      <td className="mono">{inv.due}</td>
                      <td><span className={`wait-badge wait-${inv.tone}`}>{inv.wait}d</span></td>
                      <td className="row-actions"><a className="approve-link" onClick={(e) => { e.stopPropagation(); navigate({ screen: 'anchor-invoice' }); }}>Approve →</a></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {selectedIds.length > 0 && (
                <div className="bulk-bar">
                  <span>{selectedIds.length} selected · ${selectedSum.toLocaleString()}</span>
                  <button className="btn btn-primary btn-sm" type="button">Approve selected ({selectedIds.length})</button>
                </div>
              )}
            </div>

            <div className="card">
              <div className="card-head"><h3 className="t-card-head">Financing volume · last 6 months</h3></div>
              <div style={{ padding: 16 }}>
                <AnchorVolumeChart />
                <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 11, color: 'var(--color-ink-3)' }}>
                  <span><span className="legend-dot" style={{ background: 'var(--color-accent)' }} /> Factoring</span>
                  <span><span className="legend-dot" style={{ background: 'var(--color-amber)' }} /> Reverse Factoring</span>
                  <span><span className="legend-dot" style={{ background: 'var(--color-green)' }} /> PO</span>
                </div>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="card">
              <div className="card-head"><h3 className="t-card-head">My programs</h3></div>
              <div className="prog-mini-list">
                {[
                  { name: 'Factoring',         bank: 'Atlas Bank',   type: 'Factoring' },
                  { name: 'Reverse Factoring', bank: 'Atlas Bank',   type: 'Reverse Factoring' },
                  { name: 'PO Financing',      bank: 'First Capital',type: 'PO Financing' },
                ].map((p, i) => (
                  <button key={i} className="prog-mini" onClick={() => navigate({ screen: 'program', programId: 'factoring' })}>
                    <div>
                      <div className="prog-mini-name">{p.name}</div>
                      <div className="prog-mini-bank">{p.bank}</div>
                    </div>
                    <span className="program-type-pill">{p.type}</span>
                    <span className="badge badge-active">Active</span>
                    <Icon name="chev-right" size={14} className="chev" />
                  </button>
                ))}
              </div>
            </div>

            <div className="card">
              <div className="card-head"><h3 className="t-card-head">Supplier utilization · top 5</h3></div>
              <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[
                  { name: 'Apex Industrial',   pct: 35, init: 'AI' },
                  { name: 'Pacific Textiles',  pct: 26, init: 'PT' },
                  { name: 'Metro Components',  pct: 18, init: 'MC' },
                  { name: 'Sunrise Packaging', pct: 13, init: 'SP' },
                  { name: 'Global Forge',      pct: 8,  init: 'GF' },
                ].map((s, i) => (
                  <div key={i} className="util-row">
                    <span className="util-avatar">{s.init}</span>
                    <div className="util-row-body">
                      <div className="util-row-top">
                        <span className="util-name">{s.name}</span>
                        <span className="util-pct mono">{s.pct}%</span>
                      </div>
                      <div className="util-bar"><div className="util-bar-fill util-anchor" style={{ width: `${s.pct * 2}%` }} /></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="card">
              <div className="card-head"><h3 className="t-card-head">Repayment schedule</h3></div>
              <div style={{ padding: '4px 0' }}>
                {[
                  { id: 'STK-0014', supplier: 'Sunrise Packaging', amount: '$218K', tone: 'red',   days: '2d' },
                  { id: 'STK-0019', supplier: 'Metro Components',  amount: '$342K', tone: 'amber', days: '15d' },
                  { id: 'STK-0025', supplier: 'Apex Industrial',   amount: '$824K', tone: 'green', days: '28d' },
                ].map((r, i) => (
                  <div key={i} className="repay-row">
                    <span className="strike-id">{r.id}</span>
                    <span className="repay-supplier">{r.supplier}</span>
                    <span className="repay-amount mono">{r.amount}</span>
                    <span className={`days-pill days-${r.tone}`}>{r.days}</span>
                  </div>
                ))}
                <div style={{ borderTop: '1px solid var(--color-border)', padding: '10px 16px', fontSize: 11.5, color: 'var(--color-ink-4)', display: 'flex', justifyContent: 'space-between' }}>
                  <span>Total</span><span className="mono"><strong style={{ color: 'var(--color-ink-1)' }}>$1.38M</strong></span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="onboarding-demo-row">
          <span className="onboarding-demo-label">Onboarding flows (demo):</span>
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => navigate({ screen: 'bank-setup' })}>Bank setup</button>
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => navigate({ screen: 'anchor-kyb' })}>Anchor KYB</button>
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => navigate({ screen: 'supplier-kyb' })}>Supplier KYB</button>
        </div>
      </div>
    </>
  );
}

// ============== SUPPLIER DASHBOARD ==============
function SupplierCashFlow() {
  const w = 600, h = 160, padL = 40, padR = 16, padT = 14, padB = 28;
  const labels = ['May W3','May W4','Jun W1','Jun W2','Jun W3','Jul W1','Jul W2','Jul W3'];
  const inflow = [808000, 0, 340000, 0, 215000, 0, 0, 0];
  const repay  = [0,      0, 0,      824000, 0, 342000, 0, 0];
  const max = 1000000;
  const xFor = i => padL + (i / (labels.length - 1)) * (w - padL - padR);
  const yFor = v => padT + (1 - v / max) * (h - padT - padB);
  const inflowPts = inflow.map((v, i) => [xFor(i), yFor(v)]);
  const repayPts  = repay.map((v, i) => [xFor(i), yFor(v)]);
  const inflowPath = smoothPath(inflowPts);
  const inflowArea = `${inflowPath} L ${xFor(labels.length - 1)} ${yFor(0)} L ${xFor(0)} ${yFor(0)} Z`;
  const repayPath = smoothPath(repayPts);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      {[0, 200000, 400000, 600000, 800000, 1000000].map(v => (
        <g key={v}>
          <line x1={padL} x2={w - padR} y1={yFor(v)} y2={yFor(v)} stroke="var(--color-border)" strokeDasharray={v===0?'':'2 3'} />
          <text x={padL - 4} y={yFor(v) + 3} fontSize="9" fill="var(--color-ink-4)" textAnchor="end">${v >= 1000000 ? '1M' : (v/1000) + 'K'}</text>
        </g>
      ))}
      <path d={inflowArea} fill="var(--color-green)" fillOpacity="0.15" />
      <path d={inflowPath} fill="none" stroke="var(--color-green)" strokeWidth="1.5" />
      <path d={repayPath} fill="none" stroke="var(--color-red)" strokeWidth="1.5" strokeDasharray="3 3" />
      {labels.map((l, i) => (
        <text key={i} x={xFor(i)} y={h - 8} fontSize="9" fill="var(--color-ink-4)" textAnchor="middle">{l}</text>
      ))}
    </svg>
  );
}

function NetProceedsChart() {
  const data = [93.2, 94.0, 93.8, 94.5, 94.1, 94.1];
  const labels = ['STK-0019','STK-0025','STK-0028','STK-0033','STK-0038','STK-0041'];
  const w = 320, h = 80, padL = 28, padR = 8, padT = 8, padB = 18;
  const min = 92, max = 96;
  const xFor = i => padL + (i / (data.length - 1)) * (w - padL - padR);
  const yFor = v => padT + (1 - (v - min) / (max - min)) * (h - padT - padB);
  const pts = data.map((v, i) => [xFor(i), yFor(v)]);
  const d = smoothPath(pts);
  const avg = 94.1;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      {[92, 94, 96].map(v => (
        <text key={v} x={padL - 4} y={yFor(v) + 3} fontSize="9" fill="var(--color-ink-4)" textAnchor="end">{v}%</text>
      ))}
      <line x1={padL} x2={w - padR} y1={yFor(avg)} y2={yFor(avg)} stroke="var(--color-ink-4)" strokeDasharray="2 3" opacity="0.5" />
      <text x={w - padR} y={yFor(avg) - 3} fontSize="9" fill="var(--color-ink-3)" textAnchor="end">Current avg</text>
      <path d={d} fill="none" stroke="var(--color-green)" strokeWidth="1.5" />
      {pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r="2" fill="var(--color-green)" />)}
      {labels.map((l, i) => (
        <text key={i} x={xFor(i)} y={h - 4} fontSize="8" fill="var(--color-ink-4)" textAnchor="middle">{l.replace('STK-','')}</text>
      ))}
    </svg>
  );
}

function ScreenSupplierDashboard({ navigate, portal }) {
  return (
    <>
      <Topbar
        crumbs={[{ label: 'Supplier Portal' }, { label: 'Dashboard' }]}
        actions={<>
          <NotifBell count={2} />
          <button className="btn btn-primary" type="button"><Icon name="plus" size={14} /> New Transaction</button>
        </>}
      />
      <div className="page" data-screen-label="Dashboard · Supplier">
        <div className="page-header">
          <div className="eyebrow">Apex Industrial · Supplier Portal</div>
          <h1 className="t-page-title">Good morning, Rachel</h1>
          <div className="subtitle">2 offers awaiting your decision · May 7, 2026</div>
        </div>

        <div className="hero-card">
          <div className="hero-left">
            <div className="hero-eyebrow">Ready for disbursement</div>
            <div className="hero-amount">$808,493</div>
            <div className="hero-sub">Net proceeds from 2 approved transactions</div>
            <div className="hero-cta">Accept offers to trigger disbursement →</div>
          </div>
          <div className="hero-right">
            <div className="journey">
              {[
                { label: 'Submitted', state: 'done' },
                { label: 'Approved',  state: 'done' },
                { label: 'Signing',   state: 'done' },
                { label: 'Funded',    state: 'current' },
                { label: 'Received',  state: 'todo' },
              ].map((s, i, arr) => (
                <React.Fragment key={i}>
                  <div className={`journey-step state-${s.state}`}>
                    <div className="journey-dot">{s.state === 'done' ? '✓' : ''}</div>
                    <div className="journey-label">{s.label}</div>
                  </div>
                  {i < arr.length - 1 && <div className="journey-line" />}
                </React.Fragment>
              ))}
            </div>
            <div className="hero-trail">STK-0041 · $820K · Ready</div>
          </div>
        </div>

        <div className="kpi-strip-4" style={{ marginTop: 24 }}>
          <div className="kpi-card-spark">
            <div className="kpi-label">Financed YTD</div>
            <div className="kpi-value mono">$4.2M</div>
            <div className="kpi-delta kpi-delta-pos">+12% vs last year</div>
            <Sparkline data={[2.0,2.4,2.8,3.0,3.4,3.7,4.0,4.2]} color="var(--color-green)" fill />
          </div>
          <div className="kpi-card-spark">
            <div className="kpi-label">Active transactions</div>
            <div className="kpi-value mono">3</div>
            <div className="kpi-delta kpi-delta-mut">Across 2 programs</div>
            <Sparkline data={[2,2,3,3,2,3,3,3]} color="var(--color-ink-3)" fill />
          </div>
          <div className="kpi-card-spark">
            <div className="kpi-label">Avg net proceeds</div>
            <div className="kpi-value mono">94.1%</div>
            <div className="kpi-delta kpi-delta-mut">Of invoice value</div>
            <Sparkline data={[93.2,94.0,93.8,94.5,94.1,94.0,94.1,94.1]} color="var(--color-green)" fill />
          </div>
          <div className="kpi-card-spark">
            <div className="kpi-label">Acceptance rate</div>
            <div className="kpi-value mono">87%</div>
            <div className="kpi-delta kpi-delta-mut">Of submitted transactions</div>
            <Sparkline data={[80,82,85,86,88,87,87,87]} color="var(--color-green)" fill />
          </div>
        </div>

        <div className="alert alert-error" style={{ marginTop: 16 }}>
          <Icon name="error" size={16} className="alert-icon" />
          <div className="alert-body">
            <span style={{ fontWeight: 500 }}>2 financing offers waiting · $808,493 available now</span>
            <span style={{ color: 'var(--color-ink-3)' }}> · Accept to receive within 24h</span>
          </div>
        <a className="alert-link" onClick={() => navigate({ screen: 'txn', txnId: 'STK-0041' })}>Review offers →</a></div>

        <div className="grid-2-1" style={{ marginTop: 24 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="card">
              <div className="card-head"><h3 className="t-card-head">Cash flow · inflows vs obligations · next 8 weeks</h3></div>
              <div style={{ padding: 16 }}>
                <SupplierCashFlow />
                <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 11, color: 'var(--color-ink-3)' }}>
                  <span><span className="legend-dot" style={{ background: 'var(--color-green)' }} /> Expected inflows</span>
                  <span><span className="legend-dot" style={{ background: 'var(--color-red)' }} /> Repayment obligations</span>
                </div>
                <div style={{ marginTop: 10, fontSize: 12, fontWeight: 600, color: 'var(--color-green)' }}>Net position: +$397,493 over 8 weeks</div>
              </div>
            </div>

            <div className="card">
              <div className="card-head"><h3 className="t-card-head">Active transactions</h3></div>
              <table className="table">
                <thead>
                  <tr>
                    <th>Transaction ID</th>
                    <th>Program</th>
                    <th className="amount">Amount</th>
                    <th>Stage</th>
                    <th>Last updated</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { id: 'STK-0041', program: 'Factoring', amount: '$820,000', stage: 'Pending review',  kind: 'pending', updated: '2h ago' },
                    { id: 'STK-0038', program: 'Factoring', amount: '$340,000', stage: 'Signing',         kind: 'signing', updated: '1d ago' },
                    { id: 'STK-0031', program: 'Factoring', amount: '$215,000', stage: 'Funded',          kind: 'funded',  updated: '3d ago' },
                  ].map(t => (
                    <tr key={t.id} style={{ cursor: 'pointer' }} onClick={() => navigate({ screen: 'txn', txnId: t.id })}>
                      <td className="strike-id">{t.id}</td>
                      <td style={{ color: 'var(--color-ink-2)' }}>{t.program}</td>
                      <td className="amount">{t.amount}</td>
                      <td><span className={`badge badge-${t.kind}`}>{t.stage}</span></td>
                      <td className="mono" style={{ color: 'var(--color-ink-3)' }}>{t.updated}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="card">
              <div className="card-head"><h3 className="t-card-head">Pending offers</h3><span className="t-label">2 awaiting</span></div>
              <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[
                  { id: 'STK-0041', amount: '$820,000', net: '$808,493', apr: '8.50%', tenor: '60 day', expires: '3 days' },
                  { id: 'STK-0038', amount: '$340,000', net: '$331,840', apr: '8.65%', tenor: '60 day', expires: '5 days' },
                ].map((o, i) => (
                  <div key={i} className="offer-card">
                    <div className="offer-top">
                      <span className="strike-id mono">{o.id}</span>
                      <span className="badge badge-offer">Offer</span>
                    </div>
                    <div className="offer-amount mono">{o.amount}</div>
                    <div className="offer-net">Net proceeds: <strong>{o.net}</strong></div>
                    <div className="offer-terms">{o.apr} APR · {o.tenor} tenor</div>
                    <div className="offer-expires">Expires in {o.expires}</div>
                    <div className="offer-actions">
                      <button className="btn btn-primary" type="button" onClick={() => navigate({ screen: 'txn', txnId: 'STK-0041' })}>Accept — Strike it</button>
                      <button className="btn btn-ghost" type="button">Counter offer</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="card">
              <div className="card-head"><h3 className="t-card-head">Net proceeds trend · last 6</h3></div>
              <div style={{ padding: 16 }}>
                <NetProceedsChart />
              </div>
            </div>

            <div className="card">
              <div className="card-head"><h3 className="t-card-head">My programs</h3></div>
              <div className="prog-mini-list">
                {[
                  { name: 'Factoring',         meta: 'Atlas Bank · Continental Foods', type: 'Factoring' },
                  { name: 'PO Financing',      meta: 'First Capital · Northbridge',    type: 'PO Financing' },
                ].map((p, i) => (
                  <button key={i} className="prog-mini" onClick={() => navigate({ screen: 'program', programId: 'factoring' })}>
                    <div>
                      <div className="prog-mini-name">{p.name}</div>
                      <div className="prog-mini-bank">{p.meta}</div>
                    </div>
                    <span className="program-type-pill">{p.type}</span>
                    <span className="badge badge-active">Active</span>
                    <Icon name="chev-right" size={14} className="chev" />
                  </button>
                ))}
                <div style={{ padding: '10px 16px', borderTop: '1px solid var(--color-border)' }}>
                  <a className="alert-link" style={{ color: 'var(--color-green)', fontSize: 12 }}>+ Request to join program →</a>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="onboarding-demo-row">
          <span className="onboarding-demo-label">Onboarding flows (demo):</span>
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => navigate({ screen: 'bank-setup' })}>Bank setup</button>
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => navigate({ screen: 'anchor-kyb' })}>Anchor KYB</button>
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => navigate({ screen: 'supplier-kyb' })}>Supplier KYB</button>
        </div>
      </div>
    </>
  );
}

// Expose to window so app.jsx can reference
Object.assign(window, { ScreenBankDashboard, ScreenAnchorDashboard, ScreenSupplierDashboard });
