/* global React, ReactDOM */
const { useState, useEffect } = React;

// ============== Icon ==============
const Icon = ({ name, size = 16, className }) => (
  <svg width={size} height={size} className={className} aria-hidden="true">
    <use href={`#i-${name}`} />
  </svg>
);

// ============== Theme ==============
function useTheme() {
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('strike-theme') === 'dark' ? 'dark' : 'light'; } catch { return 'light'; }
  });
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('strike-theme', theme); } catch {}
  }, [theme]);
  return [theme, () => setTheme(t => t === 'dark' ? 'light' : 'dark')];
}

// ============== Data ==============
const PROGRAMS = [
  { id: 'factoring', name: 'Factoring Program',         type: 'Factoring',         status: 'Active', outstanding: '$18.2M', txns: 47, suppliers: 12, utilization: 74 },
  { id: 'reverse',   name: 'Reverse Factoring Program', type: 'Reverse Factoring', status: 'Active', outstanding: '$14.1M', txns: 31, suppliers: 8,  utilization: 82 },
  { id: 'po',        name: 'PO Financing Program',      type: 'PO Financing',      status: 'Active', outstanding: '$9.8M',  txns: 19, suppliers: 6,  utilization: 40 },
  { id: 'open',      name: 'Open Financing Program',    type: 'Open',              status: 'Draft',  outstanding: '$0',     txns: 0,  suppliers: 0,  utilization: 0  },
];

const NETWORKS = [
  { id: 'continental', name: 'Continental Foods',  suppliers: ['AI', 'PT', 'MC'], moreCount: 9, outstanding: '$12.4M', txns: 31, pending: 3 },
  { id: 'northbridge', name: 'Northbridge Retail', suppliers: ['GF', 'SP'],       moreCount: 3, outstanding: '$5.8M',  txns: 16, pending: 0 },
];

const KYB_QUEUE = [
  { applicant: 'Apex Industrial Ltd', type: 'Supplier', submitted: 'May 5', days: '2 days', tier: 'Tier B', tierGood: true },
  { applicant: 'Pacific Coil & Wire', type: 'Supplier', submitted: 'May 4', days: '3 days', tier: 'Tier A', tierGood: true },
  { applicant: 'Global Forge Corp',   type: 'Anchor',   submitted: 'May 2', days: '5 days', tier: 'Tier D', tierGood: false },
];

const SUPPLIERS = [
  { id: 'apex',    name: 'Apex Industrial Ltd',  industry: 'Manufacturing', outstanding: '$820K', txns: 3, status: 'Active',           statusKind: 'active',  activity: '2h ago' },
  { id: 'pacific', name: 'Pacific Textiles Co',  industry: 'Textile',       outstanding: '$340K', txns: 1, status: 'Pending review',   statusKind: 'pending', activity: '5h ago' },
  { id: 'metro',   name: 'Metro Components Inc', industry: 'Industrial',    outstanding: '$215K', txns: 2, status: 'Active',           statusKind: 'active',  activity: '1d ago' },
  { id: 'sunrise', name: 'Sunrise Packaging Ltd',industry: 'Packaging',     outstanding: '$98K',  txns: 1, status: 'Signing required', statusKind: 'signing', activity: '2d ago' },
  { id: 'forge',   name: 'Global Forge Ltd',     industry: 'Steel',         outstanding: '$0',    txns: 0, status: 'Under review',     statusKind: 'draft',   activity: '3d ago' },
];

const ACTIVITY = [
  { dot: 'green',  text: <><span className="strong">STK-0040</span> funded to Marin Textiles · $97,840.00</>, time: '24m ago' },
  { dot: 'blue',   text: <>New transaction <span className="strong">STK-0042</span> submitted by Apex Industrial</>, time: '2h ago' },
  { dot: 'amber',  text: <>Pacific Textiles flagged for KYB re-review</>, time: '5h ago' },
  { dot: 'purple', text: <>Sunrise Packaging signed financing agreement <span className="strong">STK-0033</span></>, time: '1d ago' },
  { dot: 'green',  text: <>Repayment received from Metro Components · $215,000.00</>, time: '1d ago' },
];

const APEX_TXNS = [
  { id: 'STK-0041', type: 'Factoring', amount: '$820,000', date: 'May 5',  status: 'Pending review',   kind: 'pending', cta: { label: 'Review & approve', variant: 'btn-primary' } },
  { id: 'STK-0038', type: 'Factoring', amount: '$340,000', date: 'May 3',  status: 'Signing',          kind: 'signing', cta: { label: 'View',             variant: 'btn-ghost' } },
  { id: 'STK-0031', type: 'Factoring', amount: '$215,000', date: 'Apr 28', status: 'Funded',           kind: 'funded',  cta: { label: 'View',             variant: 'btn-ghost' } },
];

const APEX_REPAY = [
  { id: 'STK-0025', amount: '$824,580', due: 'Jun 4 2026',  days: 28, daysClass: 'days-green' },
  { id: 'STK-0019', amount: '$342,100', due: 'May 22 2026', days: 15, daysClass: 'days-amber' },
  { id: 'STK-0014', amount: '$218,400', due: 'May 9 2026',  days: 2,  daysClass: 'days-red'   },
];

// Anchor's view of suppliers in a program — anchor-scoped fields only
const ANCHOR_SUPPLIERS = [
  { id: 'apex',    name: 'Apex Industrial Ltd',  industry: 'Manufacturing', financed: '$1.84M', pending: 2, status: 'Active',   statusKind: 'active',  activity: '2h ago' },
  { id: 'pacific', name: 'Pacific Textiles Co',  industry: 'Textile',       financed: '$640K',  pending: 0, status: 'Active',   statusKind: 'active',  activity: '5h ago' },
  { id: 'metro',   name: 'Metro Components Inc', industry: 'Industrial',    financed: '$420K',  pending: 1, status: 'Active',   statusKind: 'active',  activity: '1d ago' },
  { id: 'sunrise', name: 'Sunrise Packaging Ltd',industry: 'Packaging',     financed: '$180K',  pending: 0, status: 'Onboarding',statusKind: 'pending', activity: '2d ago' },
];

// Supplier's view of anchor relationships in a program — supplier-scoped fields only
const SUPPLIER_ANCHORS = [
  { id: 'continental', name: 'Continental Foods', industry: 'Food & Beverage', financed: '$1.84M', active: 3, pendingAction: 'Offer to review', status: 'Active', statusKind: 'active' },
  { id: 'northbridge', name: 'Northbridge Retail',industry: 'Retail',          financed: '$420K',  active: 1, pendingAction: null,              status: 'Active', statusKind: 'active' },
];

// Supplier's transactions (no bank-internal fields)
const SUPPLIER_TXNS = [
  { id: 'STK-0042', type: 'Factoring', face: '$120,000', proceeds: '$117,180', date: 'May 6', status: 'Offer received', kind: 'offer' },
  { id: 'STK-0041', type: 'Factoring', face: '$820,000', proceeds: '$799,720', date: 'May 5', status: 'Awaiting bank',  kind: 'pending' },
  { id: 'STK-0038', type: 'Factoring', face: '$340,000', proceeds: '$331,840', date: 'May 3', status: 'Signing',        kind: 'signing' },
];

// Anchor's pending invoice approvals for a supplier
const ANCHOR_PENDING_INVOICES = [
  { id: 'INV-7821', amount: '$120,000', po: 'PO-2841', submitted: 'May 6', due: 'Jun 5' },
  { id: 'INV-7818', amount: '$84,000',  po: 'PO-2839', submitted: 'May 5', due: 'Jun 4' },
];

// ============== Sidebar ==============
const PORTAL_NAVS = {
  bank: {
    label: 'BANK PORTAL',
    items: [
      { key: 'dashboard',  label: 'Dashboard',   icon: 'dashboard' },
      { key: 'myprograms', label: 'My Programs', icon: 'programs', badge: '4' },
      { key: 'reporting',  label: 'Reporting',   icon: 'reports' },
    ],
    activeKey: 'dashboard',
    showJoin: false,
  },
  anchor: {
    label: 'ANCHOR PORTAL',
    items: [
      { key: 'dashboard',  label: 'Dashboard',   icon: 'dashboard' },
      { key: 'myprograms', label: 'My Programs', icon: 'programs' },
      { key: 'reporting',  label: 'Reporting',   icon: 'reports' },
    ],
    activeKey: 'dashboard',
    showJoin: true,
  },
  supplier: {
    label: 'SUPPLIER PORTAL',
    items: [
      { key: 'dashboard',  label: 'Dashboard',   icon: 'dashboard' },
      { key: 'myprograms', label: 'My Programs', icon: 'programs' },
      { key: 'reporting',  label: 'Reporting',   icon: 'reports' },
    ],
    activeKey: 'dashboard',
    showJoin: true,
  },
};

function Sidebar({ portal, setPortal, theme, toggleTheme, navigate, currentScreen }) {
  const nav = PORTAL_NAVS[portal];
  const userInitial = { bank: 'RM', anchor: 'CF', supplier: 'AI' }[portal];
  const userName    = { bank: 'Rita Marcellin', anchor: 'Carla Fenn', supplier: 'Aiden Park' }[portal];
  const userRole    = { bank: 'Credit Officer', anchor: 'Treasury Lead', supplier: 'Finance Manager' }[portal];

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <div className="logo-mark">S</div>
        <div className="logo-text">
          <span className="logo-name">Strike SCF</span>
          <span className="logo-portal">{nav.label}</span>
        </div>
      </div>

      <div className="portal-switcher" role="tablist" aria-label="Portal">
        {['bank', 'anchor', 'supplier'].map(p => (
          <button
            key={p}
            type="button"
            role="tab"
            aria-selected={portal === p}
            className={`portal-tab ${portal === p ? 'active' : ''}`}
            onClick={() => setPortal(p)}
          >
            {p[0].toUpperCase() + p.slice(1)}
          </button>
        ))}
      </div>

      <nav className="nav-section" style={{ marginTop: 4 }}>
        <div className="nav-label">Workspace</div>
        {nav.items.map(item => {
          const active = item.key === (currentScreen || nav.activeKey);
          return (
            <button key={item.key} type="button" className={`nav-item ${active ? 'active' : ''}`}
              onClick={() => {
                if (item.key === 'dashboard') navigate && navigate({ screen: 'dashboard' });
                else if (item.key === 'myprograms') navigate && navigate({ screen: 'myprograms' });
                else if (item.key === 'reporting') navigate && navigate({ screen: 'reporting' });
              }}>
              <Icon name={item.icon} className="nav-icon" />
              <span>{item.label}</span>
              {item.badge && <span className="nav-badge">{item.badge}</span>}
            </button>
          );
        })}
        {nav.showJoin && (
          <button type="button" className="sidebar-action" style={{ marginTop: 8 }}>
            <Icon name="plus" size={12} />
            Request to join program
          </button>
        )}
      </nav>

      <div className="nav-bottom">
        <button type="button" className="nav-item">
          <Icon name="settings" className="nav-icon" />
          <span>Settings</span>
        </button>
      </div>

      <div className="sidebar-footer">
        <div className="avatar">{userInitial}</div>
        <div className="user-meta">
          <span className="user-name">{userName}</span>
          <span className="user-role">{userRole}</span>
        </div>
        <button className="theme-btn" type="button" onClick={toggleTheme} aria-label="Toggle theme">
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={14} />
        </button>
      </div>
    </aside>
  );
}

// ============== Topbar ==============
function Topbar({ crumbs, actions, onBack }) {
  return (
    <header className="topbar">
      {onBack && (
        <button type="button" className="back-btn" onClick={onBack}>
          <Icon name="back" size={12} />
          Back
        </button>
      )}
      <div className="breadcrumb">
        {crumbs.map((c, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span className="crumb-sep">›</span>}
            {c.onClick ? (
              <a onClick={c.onClick} className={i === 0 ? 'crumb-portal' : ''} style={{ cursor: 'pointer' }}>{c.label}</a>
            ) : (
              <span className={i === crumbs.length - 1 ? 'crumb-current' : (i === 0 ? 'crumb-portal' : '')}>{c.label}</span>
            )}
          </React.Fragment>
        ))}
      </div>
      <div className="topbar-spacer" />
      <div className="topbar-right">{actions}</div>
    </header>
  );
}

const NotifBell = ({ count = 3 }) => (
  <button className="icon-btn" type="button" aria-label="Notifications">
    <Icon name="bell" size={16} />
    {count > 0 && <span className="dot">{count}</span>}
  </button>
);

const InviteCounterpartyBtn = ({ portal = 'bank', navigate }) => {
  const label = portal === 'bank' ? 'Invite Counterparty'
              : portal === 'anchor' ? 'Invite Supplier'
              : 'New Transaction';
  const onClick = portal === 'supplier' && navigate ? () => navigate({ screen: 'submission-step3' }) : undefined;
  return (
  <button className="btn btn-primary" type="button" onClick={onClick}>
    <Icon name="plus" size={14} /> {label}
  </button>
);
};

// ============== Screen 1: My Programs ==============
function ScreenMyPrograms({ navigate, portal }) {
  const portalLabel = portal === 'bank' ? 'Bank Portal' : portal === 'anchor' ? 'Anchor Portal' : 'Supplier Portal';
  return (
    <>
      <Topbar
        crumbs={[{ label: portalLabel }, { label: 'My Programs' }]}
        actions={<>
          <NotifBell count={3} />
          {portal === 'bank' && (
            <button className="btn btn-primary" type="button" onClick={() => navigate({ screen: 'new-program' })}>
              <Icon name="plus" size={14} /> New Program
            </button>
          )}
        </>}
      />

      <div className="page" data-screen-label="01 My Programs">
        <div className="page-header">
          <h1 className="t-page-title">My Programs</h1>
          <div className="subtitle">4 active programs · $46.6M total exposure</div>
        </div>

        <div className="program-grid">
          {PROGRAMS.map(p => (
            <ProgramCard key={p.id} program={p} onClick={() => navigate({ screen: 'program', programId: p.id })} />
          ))}
        </div>
      </div>
    </>
  );
}

function ProgramCard({ program, onClick }) {
  const utilClass = program.utilization >= 90 ? 'util-high'
                  : program.utilization >= 70 ? 'util-mid'
                  : 'util-low';
  return (
    <div className="program-card" onClick={onClick}>
      <div className="program-card-inner">
        <div className="program-top">
          <span className="program-name">{program.name}</span>
          <span className={`badge ${program.status === 'Active' ? 'badge-active' : 'badge-draft'}`}>{program.status}</span>
        </div>
        <span className="program-type-pill">{program.type}</span>
        <div className="program-divider" />
        <div className="program-stats">
          <div>
            <div className="program-stat-label">Outstanding</div>
            <div className="program-stat-value">{program.outstanding}</div>
          </div>
          <div>
            <div className="program-stat-label">Active Deals</div>
            <div className="program-stat-value plain">{program.txns}</div>
          </div>
          <div>
            <div className="program-stat-label">Suppliers</div>
            <div className="program-stat-value plain">{program.suppliers}</div>
          </div>
        </div>
      </div>
      <div className="utilization-bar">
        <div className={`utilization-fill ${utilClass}`} style={{ width: `${program.utilization}%` }} />
      </div>
    </div>
  );
}

// ============== Screen 2: Inside a Program ==============
function ScreenProgram({ navigate, portal }) {
  const portalLabel = portal === 'bank' ? 'Bank Portal' : portal === 'anchor' ? 'Anchor Portal' : 'Supplier Portal';
  return (
    <>
      <Topbar
        onBack={() => navigate({ screen: 'myprograms' })}
        crumbs={[
          { label: portalLabel },
          { label: 'My Programs', onClick: () => navigate({ screen: 'myprograms' }) },
          { label: 'Factoring Program' },
        ]}
        actions={<>
          <NotifBell count={3} />
          <InviteCounterpartyBtn portal={portal} navigate={navigate} />
        </>}
      />

      <div className="page" data-screen-label="02 Factoring Program">
        <div className="page-header">
          <h1 className="t-page-title">Factoring Program</h1>
          <div className="subtitle">Continental Foods · Atlas Bank · Active since Jan 2025</div>
          <div className="stats-row">
            <span className="strong">$18.2M outstanding</span>
            <span className="sep">·</span>
            <span className="strong">47 active transactions</span>
            <span className="sep">·</span>
            <span className="strong">12 suppliers</span>
          </div>
        </div>

        <div className="alert alert-warn" style={{ marginBottom: 24 }}>
          <Icon name="warn" size={16} className="alert-icon" />
          <div className="alert-body">
            <span style={{ fontWeight: 500 }}>3 transactions pending your review</span>
            <span style={{ color: 'var(--color-ink-3)' }}> · Oldest waiting 2.4 days</span>
          </div>
          <a className="alert-link">View queue →</a>
        </div>

        <div className="section">
          <div className="section-title">Anchor networks</div>
          {NETWORKS.map(n => (
            <NetworkCard
              key={n.id}
              network={n}
              onClick={() => n.id === 'continental' ? navigate({ screen: 'network', networkId: n.id }) : null}
            />
          ))}
        </div>

        <div className="section" style={{ marginTop: 32 }}>
          <div className="section-title">Credit review queue</div>
          <div className="card">
            <table className="table">
              <thead>
                <tr>
                  <th>Applicant</th>
                  <th>Type</th>
                  <th>Submitted</th>
                  <th>Days waiting</th>
                  <th>Risk tier</th>
                  <th className="row-actions">Action</th>
                </tr>
              </thead>
              <tbody>
                {KYB_QUEUE.map((r, i) => (
                  <tr key={i}>
                    <td>{r.applicant}</td>
                    <td style={{ color: 'var(--color-ink-2)' }}>{r.type}</td>
                    <td className="mono">{r.submitted}</td>
                    <td className="mono">{r.days}</td>
                    <td><span className={`badge ${r.tierGood ? 'badge-tier-good' : 'badge-tier-bad'}`}>{r.tier}</span></td>
                    <td className="row-actions"><button className="btn btn-secondary btn-sm" type="button" onClick={() => navigate({ screen: 'credit-review' })}>Review</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}

function NetworkCard({ network, onClick }) {
  return (
    <div className="network-card" onClick={onClick}>
      <div>
        <div className="network-name">{network.name}</div>
        <div className="network-meta">
          <span>Anchor</span>
          <span style={{ color: 'var(--color-ink-4)' }}>·</span>
          <span className="verified-dot" /> Verified
        </div>
      </div>
      <div className="supplier-stack">
        {network.suppliers.map((s, i) => <span key={i} className="savatar">{s}</span>)}
        {network.moreCount > 0 && <span className="more">+{network.moreCount} more</span>}
      </div>
      <div className="network-stats">
        <div>
          <div className="network-stat-label">Outstanding</div>
          <div className="network-stat-value">{network.outstanding}</div>
        </div>
        <div>
          <div className="network-stat-label">Active Deals</div>
          <div className="network-stat-value plain">{network.txns}</div>
        </div>
        <div>
          <div className="network-stat-label">Pending review</div>
          <div className={`network-stat-value plain ${network.pending > 0 ? 'warn' : ''}`}>{network.pending}</div>
        </div>
      </div>
      <Icon name="chev-right" size={16} className="chev" />
    </div>
  );
}

// ============== Screen 3: Inside a Network ==============
function ScreenNetwork({ navigate, portal }) {
  const portalLabel = portal === 'bank' ? 'Bank Portal' : portal === 'anchor' ? 'Anchor Portal' : 'Supplier Portal';
  return (
    <>
      <Topbar
        onBack={() => navigate({ screen: 'program', programId: 'factoring' })}
        crumbs={[
          { label: portalLabel },
          { label: 'My Programs', onClick: () => navigate({ screen: 'myprograms' }) },
          { label: 'Factoring Program', onClick: () => navigate({ screen: 'program', programId: 'factoring' }) },
          { label: 'Continental Foods' },
        ]}
        actions={<>
          <NotifBell count={3} />
          <InviteCounterpartyBtn portal={portal} navigate={navigate} />
        </>}
      />

      <div className="page" data-screen-label="03 Continental Foods">
        <div className="page-header">
          <h1 className="t-page-title">Continental Foods</h1>
          <div className="subtitle">Anchor · Factoring Program · 12 suppliers · $12.4M outstanding</div>
        </div>

        <div className="supplier-list">
          {SUPPLIERS.map(s => (
            <SupplierRow
              key={s.id}
              supplier={s}
              onClick={() => s.id === 'apex' ? navigate({ screen: 'supplier', supplierId: s.id }) : null}
            />
          ))}
        </div>

        <div className="section" style={{ marginTop: 32 }}>
          <div className="section-title">Recent activity</div>
          <div className="card">
            <div className="activity-feed">
              {ACTIVITY.map((a, i) => (
                <div key={i} className="activity-row">
                  <span className={`activity-dot ${a.dot}`} />
                  <span className="activity-text">{a.text}</span>
                  <span className="activity-time">{a.time}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function SupplierRow({ supplier, onClick }) {
  return (
    <div className="supplier-row" onClick={onClick}>
      <div>
        <div className="supplier-name">{supplier.name}</div>
        <div className="supplier-industry">{supplier.industry}</div>
      </div>
      <div>
        <div className="col-label">Outstanding</div>
        <div className="col-val mono">{supplier.outstanding}</div>
      </div>
      <div>
        <div className="col-label">Active Deals</div>
        <div className={`col-val ${supplier.txns > 0 ? 'accent' : ''}`}>{supplier.txns}</div>
      </div>
      <div>
        <div className="col-label">Status</div>
        <div style={{ marginTop: 4 }}><span className={`badge badge-${supplier.statusKind}`}>{supplier.status}</span></div>
      </div>
      <div>
        <div className="col-label">Last activity</div>
        <div className="col-time">{supplier.activity}</div>
      </div>
      <Icon name="chev-right" size={16} className="chev" />
    </div>
  );
}

// ============== Screen 4: Supplier Operations ==============
function ScreenSupplier({ navigate, portal }) {
  const portalLabel = portal === 'bank' ? 'Bank Portal' : portal === 'anchor' ? 'Anchor Portal' : 'Supplier Portal';
  return (
    <>
      <Topbar
        onBack={() => navigate({ screen: 'network', networkId: 'continental' })}
        crumbs={[
          { label: portalLabel },
          { label: 'My Programs', onClick: () => navigate({ screen: 'myprograms' }) },
          { label: 'Factoring Program', onClick: () => navigate({ screen: 'program', programId: 'factoring' }) },
          { label: 'Continental Foods', onClick: () => navigate({ screen: 'network', networkId: 'continental' }) },
          { label: 'Apex Industrial' },
        ]}
        actions={<>
          <NotifBell count={3} />
          <InviteCounterpartyBtn portal={portal} navigate={navigate} />
        </>}
      />

      <div className="page" data-screen-label="04 Apex Industrial">
        <div className="page-header">
          <h1 className="t-page-title">Apex Industrial Ltd</h1>
          <div className="subtitle" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
            <span>Supplier · Manufacturing</span>
            <span style={{ color: 'var(--color-ink-4)' }}>·</span>
            <span className="badge badge-active">Tier B</span>
            <span style={{ color: 'var(--color-ink-4)' }}>·</span>
            <span className="mono" style={{ color: 'var(--color-ink-3)' }}>Score 72</span>
          </div>
          <div className="stats-row">
            <span className="strong">$820K outstanding</span>
            <span className="sep">·</span>
            <span className="strong">3 active transactions</span>
            <span className="sep">·</span>
            <span>Member since Feb 2025</span>
          </div>
        </div>

        <div className="split-65">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="card">
              <div className="card-head">
                <h3 className="t-card-head">Active Transactions</h3>
                <a className="inline-link">View all →</a>
              </div>
              <table className="table">
                <thead>
                  <tr>
                    <th>Transaction ID</th>
                    <th>Type</th>
                    <th className="amount">Amount</th>
                    <th>Submitted</th>
                    <th>Status</th>
                    <th className="row-actions">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {APEX_TXNS.map(t => (
                    <tr key={t.id} style={{ cursor: 'pointer' }} onClick={() => navigate({ screen: 'txn', txnId: t.id })}>
                      <td className="strike-id">{t.id}</td>
                      <td style={{ color: 'var(--color-ink-2)' }}>{t.type}</td>
                      <td className="amount">{t.amount}</td>
                      <td className="mono">{t.date}</td>
                      <td><span className={`badge badge-${t.kind}`}>{t.status}</span></td>
                      <td className="row-actions">
                        <button
                          className={`btn ${t.cta.variant} btn-sm`}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (t.cta.label === 'Review & approve') {
                              navigate({ screen: 'approval', txnId: t.id });
                            } else {
                              navigate({ screen: 'txn', txnId: t.id });
                            }
                          }}
                        >{t.cta.label}</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="card">
              <div className="card-head"><h3 className="t-card-head">Repayments</h3></div>
              <table className="table">
                <thead>
                  <tr>
                    <th>Transaction ID</th>
                    <th className="amount">Amount due</th>
                    <th>Due date</th>
                    <th>Days until due</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {APEX_REPAY.map(r => (
                    <tr key={r.id}>
                      <td className="strike-id">{r.id}</td>
                      <td className="amount">{r.amount}</td>
                      <td className="mono">{r.due}</td>
                      <td className="mono">{r.days} days</td>
                      <td><span className={`days-pill ${r.daysClass}`}>{r.days}d</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, position: 'sticky', top: 62, alignSelf: 'flex-start' }}>
            <div className="card">
              <div className="card-head"><h3 className="t-card-head">Supplier overview</h3></div>
              <div className="score-block">
                <div className="score-num">72</div>
                <div className="score-tier">Tier B · Acceptable risk</div>
                <div className="score-bar"><div className="score-bar-fill" style={{ width: '72%' }} /></div>
              </div>
              <div className="kv-list" style={{ borderTop: '1px solid var(--color-border)' }}>
                <div className="kv-row"><span className="k">EIN</span><span className="v">••-•••1234</span></div>
                <div className="kv-row"><span className="k">Member since</span><span className="v plain">Feb 12, 2025</span></div>
                <div className="kv-row"><span className="k">Industry</span><span className="v plain">Manufacturing</span></div>
                <div className="kv-row"><span className="k">Revenue range</span><span className="v plain">$25M–$100M</span></div>
                <div className="kv-row"><span className="k">KYB status</span><span className="v green">Verified ✓</span></div>
              </div>
              <div style={{ padding: '12px 16px 6px' }}>
                <div className="col-label">Collateral on file</div>
              </div>
              <div className="collateral-row" style={{ borderTop: 0, paddingTop: 0 }}>
                <span className="cdot" />
                <span style={{ color: 'var(--color-ink-1)' }}>Post-dated cheque · $500K · Accepted</span>
              </div>
            </div>

            <div className="card">
              <div className="card-head"><h3 className="t-card-head">Documents</h3></div>
              <div>
                {[
                  { name: 'Financing Agreement (signed)', date: 'May 1 2025' },
                  { name: 'KYB Package',                  date: 'Feb 12 2025' },
                  { name: 'Collateral — PDC Scan',        date: 'Feb 14 2025' },
                ].map((d, i) => (
                  <div key={i} className="doc-row">
                    <Icon name="doc" size={14} className="doc-icon" />
                    <span className="doc-name">{d.name}</span>
                    <span className="doc-date">{d.date}</span>
                    <a className="doc-link">Download</a>
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

// ============== Screen 2A: Anchor's Program view ==============
function ScreenAnchorProgram({ navigate, portal }) {
  return (
    <>
      <Topbar
        onBack={() => navigate({ screen: 'myprograms' })}
        crumbs={[
          { label: 'Anchor Portal' },
          { label: 'My Programs', onClick: () => navigate({ screen: 'myprograms' }) },
          { label: 'Factoring Program' },
        ]}
        actions={<>
          <NotifBell count={3} />
          <InviteCounterpartyBtn portal={portal} navigate={navigate} />
        </>}
      />

      <div className="page" data-screen-label="02 Anchor · Factoring Program">
        <div className="page-header">
          <h1 className="t-page-title">Factoring Program</h1>
          <div className="subtitle">Atlas Bank · Factoring · Active since Jan 2025</div>
          <div className="stats-row">
            <span className="strong">$3.08M total financed</span>
            <span className="sep">·</span>
            <span className="strong">7 active transactions</span>
            <span className="sep">·</span>
            <span className="strong">4 suppliers</span>
          </div>
        </div>

        <div className="alert alert-warn" style={{ marginBottom: 24 }}>
          <Icon name="warn" size={16} className="alert-icon" />
          <div className="alert-body">
            <span style={{ fontWeight: 500 }}>3 invoices awaiting your approval in this program</span>
            <span style={{ color: 'var(--color-ink-3)' }}> · Oldest waiting 2.4 days</span>
          </div>
          <a className="alert-link">Review →</a>
        </div>

        <div className="section">
          <div className="section-title">Your suppliers</div>
          <div className="supplier-list">
            {ANCHOR_SUPPLIERS.map(s => (
              <AnchorSupplierRow
                key={s.id}
                supplier={s}
                onClick={() => s.id === 'apex' ? navigate({ screen: 'anchor-supplier', supplierId: s.id }) : null}
              />
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

function AnchorSupplierRow({ supplier, onClick }) {
  return (
    <div className="supplier-row" onClick={onClick}>
      <div>
        <div className="supplier-name">{supplier.name}</div>
        <div className="supplier-industry">{supplier.industry}</div>
      </div>
      <div>
        <div className="col-label">Financed together</div>
        <div className="col-val mono">{supplier.financed}</div>
      </div>
      <div>
        <div className="col-label">Pending approval</div>
        <div className={`col-val ${supplier.pending > 0 ? 'warn' : ''}`}>{supplier.pending}</div>
      </div>
      <div>
        <div className="col-label">Status</div>
        <div style={{ marginTop: 4 }}><span className={`badge badge-${supplier.statusKind}`}>{supplier.status}</span></div>
      </div>
      <div>
        <div className="col-label">Last activity</div>
        <div className="col-time">{supplier.activity}</div>
      </div>
      <Icon name="chev-right" size={16} className="chev" />
    </div>
  );
}

// ============== Screen 4A: Anchor's Supplier Operations ==============
function ScreenAnchorSupplier({ navigate, portal }) {
  return (
    <>
      <Topbar
        onBack={() => navigate({ screen: 'program', programId: 'factoring' })}
        crumbs={[
          { label: 'Anchor Portal' },
          { label: 'My Programs', onClick: () => navigate({ screen: 'myprograms' }) },
          { label: 'Factoring Program', onClick: () => navigate({ screen: 'program', programId: 'factoring' }) },
          { label: 'Apex Industrial' },
        ]}
        actions={<>
          <NotifBell count={3} />
          <InviteCounterpartyBtn portal={portal} navigate={navigate} />
        </>}
      />

      <div className="page" data-screen-label="04 Anchor · Apex Industrial">
        <div className="page-header">
          <h1 className="t-page-title">Apex Industrial Ltd</h1>
          <div className="subtitle" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
            <span>Supplier · Manufacturing</span>
            <span style={{ color: 'var(--color-ink-4)' }}>·</span>
            <span className="badge badge-active">Active</span>
          </div>
          <div className="stats-row">
            <span className="strong">$1.84M financed together</span>
            <span className="sep">·</span>
            <span className="strong">3 active transactions</span>
            <span className="sep">·</span>
            <span>Trading since Feb 2025</span>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          <div className="card">
            <div className="card-head">
              <h3 className="t-card-head">Pending invoice approvals</h3>
              <span className="badge badge-pending">{ANCHOR_PENDING_INVOICES.length} awaiting</span>
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>Invoice ID</th>
                  <th>PO</th>
                  <th className="amount">Amount</th>
                  <th>Submitted</th>
                  <th>Due</th>
                  <th className="row-actions">Action</th>
                </tr>
              </thead>
              <tbody>
                {ANCHOR_PENDING_INVOICES.map(inv => (
                  <tr key={inv.id}>
                    <td className="strike-id">{inv.id}</td>
                    <td className="mono">{inv.po}</td>
                    <td className="amount">{inv.amount}</td>
                    <td className="mono">{inv.submitted}</td>
                    <td className="mono">{inv.due}</td>
                    <td className="row-actions">
                      <button className="btn btn-primary btn-sm" type="button">Approve</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card">
            <div className="card-head">
              <h3 className="t-card-head">PO confirmation queue</h3>
              <span className="t-label">1 awaiting</span>
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>PO ID</th>
                  <th className="amount">Amount</th>
                  <th>Issued</th>
                  <th>Goods</th>
                  <th className="row-actions">Action</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="strike-id">PO-2843</td>
                  <td className="amount">$215,000</td>
                  <td className="mono">May 6</td>
                  <td style={{ color: 'var(--color-ink-2)' }}>Steel sheet · 40 tonnes</td>
                  <td className="row-actions">
                    <button className="btn btn-primary btn-sm" type="button">Confirm</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="card">
            <div className="card-head">
              <h3 className="t-card-head">Active transactions together</h3>
              <a className="inline-link">View all →</a>
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>Transaction ID</th>
                  <th>Type</th>
                  <th className="amount">Amount</th>
                  <th>Submitted</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {APEX_TXNS.map(t => (
                  <tr key={t.id} style={{ cursor: 'pointer' }} onClick={() => navigate({ screen: 'txn', txnId: t.id })}>
                    <td className="strike-id">{t.id}</td>
                    <td style={{ color: 'var(--color-ink-2)' }}>{t.type}</td>
                    <td className="amount">{t.amount}</td>
                    <td className="mono">{t.date}</td>
                    <td><span className={`badge badge-${t.kind}`}>{t.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card">
            <div className="card-head"><h3 className="t-card-head">Initiate a transaction</h3></div>
            <div style={{ padding: 16, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
              <button className="txn-option" type="button">
                <div className="txn-option-title">Reverse Factoring</div>
                <div className="txn-option-sub">Pay supplier early on an approved invoice. Bank funds, you pay later.</div>
              </button>
              <button className="txn-option" type="button">
                <div className="txn-option-title">Factoring on behalf</div>
                <div className="txn-option-sub">Sponsor a factoring transaction for this supplier on an approved invoice.</div>
              </button>
              <button className="txn-option" type="button">
                <div className="txn-option-title">PO Financing</div>
                <div className="txn-option-sub">Pre-fund production against a confirmed PO with this supplier.</div>
              </button>
            </div>
          </div>

          <div className="card">
            <div className="card-head"><h3 className="t-card-head">Signed documents</h3></div>
            <div>
              {[
                { name: 'Trade Agreement (signed)', date: 'Feb 12 2025' },
                { name: 'Net-60 Terms Addendum',    date: 'Feb 12 2025' },
              ].map((d, i) => (
                <div key={i} className="doc-row">
                  <Icon name="doc" size={14} className="doc-icon" />
                  <span className="doc-name">{d.name}</span>
                  <span className="doc-date">{d.date}</span>
                  <a className="doc-link">Download</a>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>
    </>
  );
}

// ============== Screen 2B: Supplier's Program view ==============
function ScreenSupplierProgram({ navigate, portal }) {
  return (
    <>
      <Topbar
        onBack={() => navigate({ screen: 'myprograms' })}
        crumbs={[
          { label: 'Supplier Portal' },
          { label: 'My Programs', onClick: () => navigate({ screen: 'myprograms' }) },
          { label: 'Factoring Program' },
        ]}
        actions={<>
          <NotifBell count={3} />
          <InviteCounterpartyBtn portal={portal} navigate={navigate} />
        </>}
      />

      <div className="page" data-screen-label="02 Supplier · Factoring Program">
        <div className="page-header">
          <h1 className="t-page-title">Factoring Program</h1>
          <div className="subtitle">Atlas Bank · with Continental Foods, Northbridge Retail · Factoring</div>
          <div className="stats-row">
            <span className="strong">$2.26M total financed</span>
            <span className="sep">·</span>
            <span className="strong">4 transactions</span>
            <span className="sep">·</span>
            <span className="strong">97.5% avg net proceeds</span>
          </div>
        </div>

        <div className="alert alert-error" style={{ marginBottom: 24 }}>
          <Icon name="error" size={16} className="alert-icon" />
          <div className="alert-body">
            <span style={{ fontWeight: 500 }}>1 financing offer awaiting your response</span>
            <span style={{ color: 'var(--color-ink-3)' }}> · Expires in 18 hours</span>
          </div>
          <a className="alert-link" onClick={() => navigate({ screen: 'anchor-invoice' })}>Review →</a>
        </div>

        <div className="section">
          <div className="section-title">Your anchor relationships</div>
          <div className="supplier-list">
            {SUPPLIER_ANCHORS.map(a => (
              <SupplierAnchorRow
                key={a.id}
                anchor={a}
                onClick={() => a.id === 'continental' ? navigate({ screen: 'supplier-anchor', anchorId: a.id }) : null}
              />
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

function SupplierAnchorRow({ anchor, onClick }) {
  return (
    <div className="supplier-row" onClick={onClick}>
      <div>
        <div className="supplier-name">{anchor.name}</div>
        <div className="supplier-industry">{anchor.industry}</div>
      </div>
      <div>
        <div className="col-label">Financed together</div>
        <div className="col-val mono">{anchor.financed}</div>
      </div>
      <div>
        <div className="col-label">Active transactions</div>
        <div className={`col-val ${anchor.active > 0 ? 'accent' : ''}`}>{anchor.active}</div>
      </div>
      <div>
        <div className="col-label">Pending action</div>
        <div className="col-val" style={{ color: anchor.pendingAction ? 'var(--color-red)' : 'var(--color-ink-4)' }}>
          {anchor.pendingAction || '—'}
        </div>
      </div>
      <div>
        <div className="col-label">Status</div>
        <div style={{ marginTop: 4 }}><span className={`badge badge-${anchor.statusKind}`}>{anchor.status}</span></div>
      </div>
      <Icon name="chev-right" size={16} className="chev" />
    </div>
  );
}

// ============== Screen 4B: Supplier's Anchor Operations ==============
function ScreenSupplierAnchor({ navigate, portal }) {
  return (
    <>
      <Topbar
        onBack={() => navigate({ screen: 'program', programId: 'factoring' })}
        crumbs={[
          { label: 'Supplier Portal' },
          { label: 'My Programs', onClick: () => navigate({ screen: 'myprograms' }) },
          { label: 'Factoring Program', onClick: () => navigate({ screen: 'program', programId: 'factoring' }) },
          { label: 'Continental Foods' },
        ]}
        actions={<>
          <NotifBell count={3} />
          <InviteCounterpartyBtn portal={portal} navigate={navigate} />
        </>}
      />

      <div className="page" data-screen-label="04 Supplier · Continental Foods">
        <div className="page-header">
          <h1 className="t-page-title">Continental Foods</h1>
          <div className="subtitle" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
            <span>Anchor · Food &amp; Beverage</span>
            <span style={{ color: 'var(--color-ink-4)' }}>·</span>
            <span className="badge badge-active">Active</span>
          </div>
          <div className="stats-row">
            <span className="strong">$1.84M financed together</span>
            <span className="sep">·</span>
            <span className="strong">3 active transactions</span>
            <span className="sep">·</span>
            <span>Trading since Feb 2025</span>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          <div className="alert alert-error">
            <Icon name="error" size={16} className="alert-icon" />
            <div className="alert-body">
              <span style={{ fontWeight: 500 }}>Offer received on STK-0042</span>
              <span style={{ color: 'var(--color-ink-3)' }}> · $117,180 net at 2.35% · expires in 18h</span>
            </div>
            <button className="btn btn-primary btn-sm" type="button" onClick={() => navigate({ screen: 'anchor-invoice' })}>Review offer</button>
          </div>

          <div className="card">
            <div className="card-head">
              <h3 className="t-card-head">My transactions with Continental Foods</h3>
              <a className="inline-link">View all →</a>
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>Transaction ID</th>
                  <th>Type</th>
                  <th className="amount">Face value</th>
                  <th className="amount">Net proceeds</th>
                  <th>Submitted</th>
                  <th>Stage</th>
                </tr>
              </thead>
              <tbody>
                {SUPPLIER_TXNS.map(t => (
                  <tr key={t.id} style={{ cursor: 'pointer' }} onClick={() => navigate({ screen: 'txn', txnId: t.id })}>
                    <td className="strike-id">{t.id}</td>
                    <td style={{ color: 'var(--color-ink-2)' }}>{t.type}</td>
                    <td className="amount">{t.face}</td>
                    <td className="amount">{t.proceeds}</td>
                    <td className="mono">{t.date}</td>
                    <td><span className={`badge badge-${t.kind}`}>{t.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card">
            <div className="card-head"><h3 className="t-card-head">Submit a new transaction</h3></div>
            <div style={{ padding: 16, display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
              <button className="txn-option" type="button" onClick={() => navigate({ screen: 'submission-step3' })}><div className="txn-option-title">Factoring</div><div className="txn-option-sub">Sell an approved invoice to the bank now. Get net proceeds within 24h.</div>
              </button>
              <button className="txn-option" type="button" onClick={() => navigate({ screen: 'submission-step3' })}><div className="txn-option-title">Reverse Factoring</div><div className="txn-option-sub">Anchor-sponsored early payment on an approved invoice.</div>
              </button>
              <button className="txn-option" type="button" onClick={() => navigate({ screen: 'submit-po' })}><div className="txn-option-title">PO Financing</div><div className="txn-option-sub">Get funded against a confirmed purchase order before delivery.</div>
              </button>
              <button className="txn-option" type="button" onClick={() => navigate({ screen: 'submission-step3' })}><div className="txn-option-title">Open Request</div>
                <div className="txn-option-sub">Submit a custom financing request for review by Atlas Bank.</div>
              </button>
            </div>
          </div>

          <div className="card">
            <div className="card-head"><h3 className="t-card-head">Documents</h3></div>
            <div>
              {[
                { name: 'Trade Agreement (signed)', date: 'Feb 12 2025' },
                { name: 'Net-60 Terms Addendum',    date: 'Feb 12 2025' },
                { name: 'Bank Account Mandate',     date: 'Feb 14 2025' },
              ].map((d, i) => (
                <div key={i} className="doc-row">
                  <Icon name="doc" size={14} className="doc-icon" />
                  <span className="doc-name">{d.name}</span>
                  <span className="doc-date">{d.date}</span>
                  <a className="doc-link">Download</a>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>
    </>
  );
}

// ============== Screen 5: Bank Financing Approval ==============
function ScreenApproval({ navigate, portal }) {
  const portalLabel = 'Bank Portal';
  // Decision panel state
  const [apr, setApr] = useState('8.50');
  const [tenor, setTenor] = useState('60');
  const [showReject, setShowReject] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  // Live calc
  const aprNum   = parseFloat(apr) || 0;
  const tenorNum = parseInt(tenor, 10) || 0;
  const principal = 820000;
  const fee = principal * (aprNum / 100) * (tenorNum / 365);
  const net = principal - fee;
  const fmt = (n) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  const dimensions = [
    { name: 'Business longevity',     score: 70, bar: 'bar-green' },
    { name: 'Revenue scale',          score: 75, bar: 'bar-green' },
    { name: 'Document completeness',  score: 85, bar: 'bar-green' },
    { name: 'Financial health',       score: 50, bar: 'bar-amber' },
    { name: 'Program fit',            score: 80, bar: 'bar-green' },
  ];

  return (
    <>
      <Topbar
        onBack={() => navigate({ screen: 'supplier', supplierId: 'apex' })}
        crumbs={[
          { label: portalLabel },
          { label: 'Factoring Program',  onClick: () => navigate({ screen: 'program',  programId: 'factoring' }) },
          { label: 'Continental Foods',  onClick: () => navigate({ screen: 'network',  networkId: 'continental' }) },
          { label: 'Apex Industrial',    onClick: () => navigate({ screen: 'supplier', supplierId: 'apex' }) },
          { label: 'STK-0041' },
        ]}
        actions={<NotifBell count={3} />}
      />

      <div className="page" data-screen-label="05 Approval STK-0041">
        <div className="page-header">
          <h1 className="page-id-title">
            <span className="id-text">STK-0041</span>
            <span className="badge badge-pending">Pending review</span>
            <span className="badge badge-active">Factoring</span>
          </h1>
          <div className="subtitle" style={{ marginTop: 6 }}>
            Apex Industrial → Continental Foods · Submitted May 5, 2026 · Waiting 2 days
          </div>
        </div>

        <div className="split-60">
          {/* LEFT */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            <div className="card">
              <div className="card-head"><h3 className="t-card-head">Transaction details</h3></div>
              <div className="kv-rows">
                <div className="kv-row"><span className="k">Invoice number</span><span className="v">INV-2026-0842</span></div>
                <div className="kv-row"><span className="k">Invoice date</span><span className="v plain">Apr 28, 2026</span></div>
                <div className="kv-row"><span className="k">Invoice due date</span><span className="v plain">Jun 27, 2026</span></div>
                <div className="kv-row"><span className="k">Invoice amount</span><span className="v amount">$820,000.00</span></div>
                <div className="kv-row"><span className="k">Financing requested</span><span className="v amount">$820,000.00</span></div>
                <div className="kv-row" style={{ alignItems: 'flex-start' }}>
                  <span className="k" style={{ paddingTop: 2 }}>Description</span>
                  <span className="v plain" style={{ maxWidth: '60%', textAlign: 'right' }}>Industrial steel components — Q2 delivery batch</span>
                </div>
                <div className="confirmed-row">
                  <span className="gdot" />
                  <span><span style={{ color: 'var(--color-ink-3)' }}>Anchor confirmed:</span> May 5, 2026 14:32 · James Mitchell</span>
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-head"><h3 className="t-card-head">Supplier credit summary</h3></div>
              <div className="score-head">
                <div className="num">72</div>
                <div className="col">
                  <span className="badge" style={{ background: 'var(--color-amber-bg)', color: 'var(--color-amber)' }}>Tier B · Acceptable</span>
                  <div className="progress"><div className="bar-amber" style={{ width: '72%' }} /></div>
                </div>
              </div>
              <div className="dim-list">
                {dimensions.map(d => (
                  <div key={d.name} className="dim-row">
                    <span className="dim-name">{d.name}</span>
                    <span className="dim-score">{d.score}</span>
                    <div className="dim-bar"><div className={d.bar} style={{ width: `${d.score}%` }} /></div>
                  </div>
                ))}
              </div>
              <div className="dim-note">Financial health score assigned manually by credit officer</div>
            </div>

            <div className="card">
              <div className="card-head"><h3 className="t-card-head">Documents</h3></div>
              <div>
                {[
                  { name: 'Invoice PDF · INV-2026-0842',     date: 'May 5, 2026' },
                  { name: 'Steel delivery contract · Q2-2026', date: 'May 5, 2026' },
                  { name: 'Anchor confirmation · signed',     date: 'May 5, 2026' },
                ].map((d, i) => (
                  <div key={i} className="doc-row">
                    <Icon name="doc" size={14} className="doc-icon" />
                    <span className="doc-name">{d.name}</span>
                    <span className="doc-date">{d.date}</span>
                    <a className="doc-link">View</a>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* RIGHT — Sticky decision panel */}
          <div style={{ position: 'sticky', top: 62, alignSelf: 'flex-start' }}>
            <div className="card">
              <div className="card-head"><h3 className="t-card-head">Set terms &amp; decide</h3></div>
              <div className="decision-panel">
                <div>
                  <label className="field-label" htmlFor="apr">Annual rate (APR)</label>
                  <div className="input-group">
                    <input id="apr" className="input" type="text" value={apr} onChange={e => setApr(e.target.value)} />
                    <span className="input-suffix">%</span>
                  </div>
                </div>
                <div>
                  <label className="field-label" htmlFor="tenor">Tenor (days)</label>
                  <input id="tenor" className="input" type="text" value={tenor} onChange={e => setTenor(e.target.value)} />
                </div>

                <div className="calc-panel">
                  <div className="calc-row"><span className="k">Financing amount</span><span className="v">$820,000</span></div>
                  <div className="calc-row"><span className="k">Fee ({aprNum.toFixed(2)}% · {tenorNum}d)</span><span className="v amber">−{fmt(fee)}</span></div>
                  <div className="calc-divider" />
                  <div className="calc-row bold"><span className="k">Net proceeds to supplier</span><span className="v green">{fmt(net)}</span></div>
                  <div className="calc-row"><span className="k">Repayment due</span><span className="v" style={{ color: 'var(--color-ink-2)' }}>Jul 4, 2026</span></div>
                  <div className="calc-bar-row">
                    <span className="k">Program utilization after approval</span>
                    <div className="b"><div className="bar-amber" style={{ width: '82%' }} /></div>
                  </div>
                </div>

                <div className="decision-divider" />

                <div className="decision-actions">
                  <button className="btn btn-primary btn-full" type="button">Approve &amp; generate agreement</button>
                  <button className="btn btn-secondary btn-full" type="button">Request more info</button>
                  <button className="btn btn-danger btn-full" type="button" onClick={() => setShowReject(s => !s)}>Reject</button>

                  {showReject && (
                    <div className="reject-block">
                      <label className="field-label" htmlFor="rej">Rejection reason (required, min 20 chars)</label>
                      <textarea
                        id="rej"
                        className="input"
                        rows={3}
                        value={rejectReason}
                        onChange={e => setRejectReason(e.target.value)}
                        placeholder="Explain the reason for rejection…"
                      />
                      <button className="btn btn-danger btn-sm" type="button" disabled={rejectReason.trim().length < 20}>Confirm rejection</button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ============== Screen 6: Shared Transaction Detail ==============
function ScreenTransaction({ navigate, portal }) {
  const portalLabel = portal === 'bank' ? 'Bank Portal' : portal === 'anchor' ? 'Anchor Portal' : 'Supplier Portal';

  // Breadcrumb varies per portal
  const crumbs = portal === 'bank'
    ? [
        { label: portalLabel },
        { label: 'Factoring Program',  onClick: () => navigate({ screen: 'program', programId: 'factoring' }) },
        { label: 'Continental Foods',  onClick: () => navigate({ screen: 'network', networkId: 'continental' }) },
        { label: 'Apex Industrial',    onClick: () => navigate({ screen: 'supplier', supplierId: 'apex' }) },
        { label: 'STK-0041' },
      ]
    : portal === 'anchor'
    ? [
        { label: portalLabel },
        { label: 'Factoring Program',  onClick: () => navigate({ screen: 'program', programId: 'factoring' }) },
        { label: 'STK-0041' },
      ]
    : [
        { label: portalLabel },
        { label: 'Factoring Program',  onClick: () => navigate({ screen: 'program', programId: 'factoring' }) },
        { label: 'STK-0041' },
      ];

  const back = portal === 'bank'
    ? () => navigate({ screen: 'supplier', supplierId: 'apex' })
    : () => navigate({ screen: 'program',  programId: 'factoring' });

  const events = [
    { actor: 'bank',     who: 'Sarah Chen',     action: 'APR set at 8.50% · tenor 60 days',          time: 'May 5, 14:45', dot: 'blue' },
    { actor: 'anchor',   who: 'James Mitchell', action: 'Invoice approved and forwarded to bank',    time: 'May 5, 14:32', dot: 'green' },
    { actor: 'supplier', who: 'Rachel Lin',     action: 'Transaction submitted for approval',        time: 'May 5, 09:14', dot: 'blue' },
  ];

  const steps = [
    { name: 'Submitted',        state: 'done',    time: 'May 5, 09:14' },
    { name: 'Anchor approval',  state: 'done',    time: 'May 5, 14:32' },
    { name: 'Bank review',      state: 'current', time: 'In progress' },
    { name: 'Agreement signing',state: 'todo' },
    { name: 'Funded',           state: 'todo' },
    { name: 'Repayment',        state: 'todo' },
    { name: 'Completed',        state: 'todo' },
  ];

  return (
    <>
      <Topbar
        onBack={back}
        crumbs={crumbs}
        actions={<NotifBell count={3} />}
      />

      <div className="page" data-screen-label={`06 Transaction STK-0041 (${portal})`}>
        <div className="page-header">
          <h1 className="page-id-title">
            <span className="id-text">STK-0041</span>
            <span className="badge badge-pending">Pending review</span>
            <span className="badge badge-active">Factoring</span>
          </h1>
          <div className="subtitle" style={{ marginTop: 6 }}>
            Apex Industrial → Continental Foods · Factoring Program · Atlas Bank
          </div>
        </div>

        <div className="split-65">
          {/* LEFT */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            <div className="card">
              <div className="card-head"><h3 className="t-card-head">Financial summary</h3></div>
              <div className="fs-grid">
                <div className="fs-cell"><span className="fs-label">Invoice amount</span><span className="fs-value">$820,000</span></div>
                <div className="fs-cell"><span className="fs-label">Financing amount</span><span className="fs-value">$820,000</span></div>
                <div className="fs-cell"><span className="fs-label">Fee</span><span className="fs-value">$11,507</span></div>
                <div className="fs-cell"><span className="fs-label">Net proceeds</span><span className="fs-value green">$808,493</span></div>
              </div>
              <div className="fs-extra-row"><span className="k">APR</span><span className="v">8.50%</span></div>
              <div className="fs-extra-row"><span className="k">Repayment due</span><span className="v">Jul 4, 2026 · $820,000</span></div>
            </div>

            <div className="card">
              <div className="card-head"><h3 className="t-card-head">Parties</h3></div>
              <div className="kv-rows">
                <div className="kv-row"><span className="k">Supplier</span><span className="v plain">Apex Industrial Ltd</span></div>
                <div className="kv-row"><span className="k">Anchor</span><span className="v plain">Continental Foods</span></div>
                <div className="kv-row"><span className="k">Bank</span><span className="v plain">Atlas Bank</span></div>
                <div className="kv-row"><span className="k">Program</span><span className="v plain">Factoring Program</span></div>
              </div>
            </div>

            <div className="card">
              <div className="card-head"><h3 className="t-card-head">Documents</h3></div>
              <div>
                {[
                  { name: 'Financing Agreement (signed)',     date: 'May 5, 2026' },
                  { name: 'Invoice PDF · INV-2026-0842',      date: 'May 5, 2026' },
                  { name: 'Anchor confirmation · signed',     date: 'May 5, 2026' },
                ].map((d, i) => (
                  <div key={i} className="doc-row">
                    <Icon name="doc" size={14} className="doc-icon" />
                    <span className="doc-name">{d.name}</span>
                    <span className="doc-date">{d.date}</span>
                    <a className="doc-link">View</a>
                  </div>
                ))}
              </div>
            </div>

            <div className="card">
              <div className="card-head"><h3 className="t-card-head">History</h3></div>
              <div className="timeline">
                {events.map((e, i) => (
                  <div key={i} className="tl-item">
                    <span className={`tl-dot ${e.dot}`} />
                    <span className="tl-line" />
                    <div className="tl-body">
                      <div className="tl-actor-row">
                        <span className={`tl-actor-pill ${e.actor}`}>{e.actor[0].toUpperCase() + e.actor.slice(1)}</span>
                        <span className="tl-actor-name">{e.who}</span>
                      </div>
                      <span className="tl-action">{e.action}</span>
                    </div>
                    <span className="tl-time">{e.time}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* RIGHT — Status tracker + role-aware action */}
          <div style={{ position: 'sticky', top: 62, alignSelf: 'flex-start' }}>
            <div className="card">
              <div className="card-head"><h3 className="t-card-head">Status tracker</h3></div>
              <div className="stepper">
                {steps.map((s, i) => (
                  <div key={i} className={`step ${s.state}`}>
                    <span className={`step-circle ${s.state}`}>
                      {s.state === 'done' ? <Icon name="check" size={11} /> : (i + 1)}
                    </span>
                    <span className={`step-line ${s.state === 'done' ? 'done' : ''}`} />
                    <div className="step-body">
                      <span className="step-name">{s.name}</span>
                      {s.time && <span className="step-time">{s.time}</span>}
                    </div>
                  </div>
                ))}
              </div>

              {portal === 'bank' && (
                <div className="action-block">
                  <button className="btn btn-primary btn-full" type="button">Approve &amp; generate agreement</button>
                  <button className="btn btn-secondary btn-full" type="button">Request more info</button>
                  <button className="btn btn-danger btn-full" type="button">Reject</button>
                </div>
              )}
              {portal === 'anchor' && (
                <div className="action-passive green">
                  <Icon name="check" size={14} />
                  Transaction approved by you on May 5
                </div>
              )}
              {portal === 'supplier' && (
                <div className="action-passive muted">Awaiting bank review</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ============== App root ==============
function App() {
  const [theme, toggleTheme] = useTheme();
  const [portal, setPortalState] = useState('bank');
  const [route, setRoute] = useState({ screen: 'dashboard' });

  const setPortal = (p) => {
    setPortalState(p);
    setRoute({ screen: 'dashboard' });
  };

  useEffect(() => {
    document.body.setAttribute('data-portal', portal);
  }, [portal]);

  const navigate = (r) => setRoute(r);

  // For anchor/supplier, drilldowns 3 (network) and 4 (supplier) and approval (5) aren't relevant.
  // Only bank gets the 4-screen drilldown. Anchor/Supplier go from program → transaction directly.
  let screen;
  const s = route.screen;

  if (s === 'dashboard') {
    if (portal === 'bank') screen = <ScreenBankDashboard navigate={navigate} portal={portal} />;
    else if (portal === 'anchor') screen = <ScreenAnchorDashboard navigate={navigate} portal={portal} />;
    else screen = <ScreenSupplierDashboard navigate={navigate} portal={portal} />;
  } else if (s === 'myprograms') {
    screen = <ScreenMyPrograms navigate={navigate} portal={portal} />;
  } else if (s === 'program') {
    if (portal === 'anchor') {
      screen = <ScreenAnchorProgram navigate={navigate} portal={portal} />;
    } else if (portal === 'supplier') {
      screen = <ScreenSupplierProgram navigate={navigate} portal={portal} />;
    } else {
      screen = <ScreenProgram navigate={navigate} portal={portal} />;
    }
  } else if (s === 'network') {
    screen = <ScreenNetwork navigate={navigate} portal={portal} />;
  } else if (s === 'supplier') {
    screen = <ScreenSupplier navigate={navigate} portal={portal} />;
  } else if (s === 'anchor-supplier') {
    screen = <ScreenAnchorSupplier navigate={navigate} portal={portal} />;
  } else if (s === 'supplier-anchor') {
    screen = <ScreenSupplierAnchor navigate={navigate} portal={portal} />;
  } else if (s === 'approval') {
    screen = <ScreenApproval navigate={navigate} portal={portal} />;
  } else if (s === 'txn') {
    screen = <ScreenTransaction navigate={navigate} portal={portal} />;
  } else if (s === 'submission-step3' || s === 'submit' || s === 'submit-po') {
    screen = <ScreenSubmissionStep3 navigate={navigate} portal={portal} />;
  } else if (s === 'submission-review') {
    screen = <ScreenSubmissionReview navigate={navigate} portal={portal} />;
  } else if (s === 'submission-success') {
    screen = <ScreenSubmissionSuccess navigate={navigate} portal={portal} />;
  } else if (s === 'anchor-invoice') {
    screen = <ScreenAnchorInvoice navigate={navigate} portal={portal} />;
  } else if (s === 'supplier-kyb') {
    return <ScreenSupplierKYB navigate={navigate} portal={portal} />;
  } else if (s === 'bank-setup') {
    return <ScreenBankSetup navigate={navigate} portal={portal} />;
  } else if (s === 'new-program') {
    screen = <ScreenNewProgram navigate={navigate} portal={portal} />;
  } else if (s === 'credit-review') {
    screen = <ScreenCreditReview navigate={navigate} portal={portal} />;
  } else if (s === 'anchor-kyb') {
    return <ScreenAnchorKYB navigate={navigate} portal={portal} />;
  } else if (s === 'reporting') {
    if (portal === 'bank') screen = <ScreenBankReporting navigate={navigate} portal={portal} />;
    else if (portal === 'anchor') screen = <ScreenAnchorReporting navigate={navigate} portal={portal} />;
    else screen = <ScreenSupplierReporting navigate={navigate} portal={portal} />;
  } else {
    screen = <ScreenMyPrograms navigate={navigate} portal={portal} />;
  }

  return (
    <div className="app-shell">
      <Sidebar portal={portal} setPortal={setPortal} theme={theme} toggleTheme={toggleTheme} navigate={navigate} currentScreen={s} />
      <main className="main">
        {screen}
        {/* Floating "View transaction detail" demo link from supplier screen — easier discoverability */}
      </main>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
