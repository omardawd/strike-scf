/* global React */
const { useState: useStateNP } = React;

const FIN_TYPES = [
  { id: 'factoring',  icon: 'invoice',  label: 'Factoring',         desc: 'Supplier sells receivables early' },
  { id: 'reverse',    icon: 'refresh',  label: 'Reverse Factoring', desc: 'Bank pays supplier, anchor repays' },
  { id: 'po',         icon: 'box',      label: 'PO Financing',      desc: 'Pre-shipment capital' },
  { id: 'open',       icon: 'message',  label: 'Open',              desc: 'Flexible — bank proposes terms' },
];

function fmtMoney(n) {
  if (!n) return '$0';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 1) + 'M';
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(n % 1e3 === 0 ? 0 : 0) + 'K';
  return '$' + n.toLocaleString();
}

function ScreenNewProgram({ navigate, portal }) {
  const [name, setName] = useStateNP('');
  const [finType, setFinType] = useStateNP('factoring');
  const [limitMode, setLimitMode] = useStateNP('fixed');
  const [programLimit, setProgramLimit] = useStateNP(25000000);
  const [supplierSub, setSupplierSub]   = useStateNP(2500000);
  const [minDeal, setMinDeal]           = useStateNP(50000);
  const [maxDeal, setMaxDeal]           = useStateNP(2000000);
  const [maxAge, setMaxAge]             = useStateNP(90);
  const [tenor, setTenor]               = useStateNP(60);
  const [maxFulfill, setMaxFulfill]     = useStateNP(120);

  const overflow = limitMode === 'fixed' && maxDeal > programLimit;
  const finLabel = (FIN_TYPES.find(f => f.id === finType) || {}).label || '—';

  return (
    <>
      <Topbar
        crumbs={[
          { label: 'Bank Portal' },
          { label: 'My Programs', onClick: () => navigate({ screen: 'myprograms' }) },
          { label: 'New Program' },
        ]}
        actions={<>
          <button className="btn btn-ghost" type="button">Save as draft</button>
          <NotifBell count={3} />
        </>}
      />
      <div className="page" data-screen-label="New Program">
        <div className="page-header">
          <h1 className="t-page-title" style={{ fontSize: 20 }}>Create program</h1>
          <div className="subtitle">Set up a new SCF program and invite counterparties</div>
        </div>

        <div className="form-split">
          <div className="card form-card">
            <div className="form-card-body">
              <div className="form-field">
                <label className="form-label">Program name</label>
                <input
                  className="form-input"
                  placeholder="e.g. Factoring Program — Q3 2026"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <div className="form-field">
                <label className="form-label">Financing type</label>
                <div className="fin-type-grid">
                  {FIN_TYPES.map(t => (
                    <button
                      key={t.id}
                      type="button"
                      className={`fin-type-card ${finType === t.id ? 'selected' : ''}`}
                      onClick={() => setFinType(t.id)}
                    >
                      <Icon name={t.icon} size={20} className="fin-type-icon" />
                      <div className="fin-type-label">{t.label}</div>
                      <div className="fin-type-desc">{t.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="form-field">
                <label className="form-label">Limit structure</label>
                <div className="radio-cards">
                  <button
                    type="button"
                    className={`radio-card lg ${limitMode === 'fixed' ? 'selected' : ''}`}
                    onClick={() => setLimitMode('fixed')}
                  >
                    <div className="radio-card-radio" />
                    <div>
                      <div className="radio-card-title">Fixed limit</div>
                      <div className="radio-card-desc">Set a maximum program exposure</div>
                    </div>
                  </button>
                  <button
                    type="button"
                    className={`radio-card lg ${limitMode === 'open' ? 'selected' : ''}`}
                    onClick={() => setLimitMode('open')}
                  >
                    <div className="radio-card-radio" />
                    <div>
                      <div className="radio-card-title">Open account</div>
                      <div className="radio-card-desc">Approve each deal at discretion</div>
                    </div>
                  </button>
                </div>
              </div>

              {limitMode === 'fixed' && (
                <>
                  <div className="form-field">
                    <label className="form-label">Program limit</label>
                    <div className="currency-input-wrap">
                      <input
                        className="currency-input"
                        value={'$' + programLimit.toLocaleString()}
                        onChange={(e) => setProgramLimit(Number(e.target.value.replace(/[^0-9]/g, '')) || 0)}
                      />
                    </div>
                  </div>

                  <div className="form-row-2">
                    <div className="form-field">
                      <label className="form-label">Per-supplier sublimit</label>
                      <input className="form-input mono" value={'$' + supplierSub.toLocaleString()} onChange={(e) => setSupplierSub(Number(e.target.value.replace(/[^0-9]/g, '')) || 0)} />
                    </div>
                    <div className="form-field">
                      <label className="form-label">Min deal size</label>
                      <input className="form-input mono" value={'$' + minDeal.toLocaleString()} onChange={(e) => setMinDeal(Number(e.target.value.replace(/[^0-9]/g, '')) || 0)} />
                    </div>
                  </div>

                  <div className="form-row-2">
                    <div className="form-field">
                      <label className="form-label">Max deal size</label>
                      <input className="form-input mono" value={'$' + maxDeal.toLocaleString()} onChange={(e) => setMaxDeal(Number(e.target.value.replace(/[^0-9]/g, '')) || 0)} />
                    </div>
                    <div className="form-field">
                      <label className="form-label">Max invoice age (days)</label>
                      <input className="form-input mono" value={maxAge} onChange={(e) => setMaxAge(Number(e.target.value.replace(/[^0-9]/g, '')) || 0)} />
                    </div>
                  </div>

                  <div className="form-row-2">
                    <div className="form-field">
                      <label className="form-label">Standard tenor (days)</label>
                      <input className="form-input mono" value={tenor} onChange={(e) => setTenor(Number(e.target.value.replace(/[^0-9]/g, '')) || 0)} />
                    </div>
                    {finType === 'po' && (
                      <div className="form-field">
                        <label className="form-label">Max PO fulfillment (days)</label>
                        <input className="form-input mono" value={maxFulfill} onChange={(e) => setMaxFulfill(Number(e.target.value.replace(/[^0-9]/g, '')) || 0)} />
                      </div>
                    )}
                  </div>
                </>
              )}

              <div className="info-box" style={{ margin: '16px 0 0', fontStyle: 'italic' }}>
                <Icon name="info" size={14} className="info-box-icon" />
                <span>Program limits are internal only — counterparties never see these figures.</span>
              </div>
            </div>
          </div>

          <div className="card form-summary">
            <div className="card-head"><h3 className="t-card-head">Program summary</h3></div>
            <div className="kv-list">
              <div className="kv-row"><span className="k">Program name</span><span className="v plain">{name || '—'}</span></div>
              <div className="kv-row"><span className="k">Type</span><span className="v plain">{finLabel}</span></div>
              <div className="kv-row"><span className="k">Limit structure</span><span className="v plain">{limitMode === 'fixed' ? `Fixed · ${fmtMoney(programLimit)}` : 'Open account'}</span></div>
              {limitMode === 'fixed' && <>
                <div className="kv-row"><span className="k">Per-supplier cap</span><span className="v mono">{fmtMoney(supplierSub)}</span></div>
                <div className="kv-row"><span className="k">Deal range</span><span className="v mono">{fmtMoney(minDeal)} – {fmtMoney(maxDeal)}</span></div>
                <div className="kv-row"><span className="k">Tenor</span><span className="v plain">{tenor} days</span></div>
                <div className="kv-row"><span className="k">Invoice age max</span><span className="v plain">{maxAge} days</span></div>
              </>}
              <div className="kv-row"><span className="k">Status</span><span className="v"><span className="badge badge-pending">Draft</span></span></div>
            </div>
            {overflow && (
              <div className="warn-box">
                <Icon name="alert" size={14} />
                <span>Max deal size exceeds program limit</span>
              </div>
            )}
            <div style={{ padding: '12px 16px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button className="btn btn-primary btn-block" type="button" disabled={overflow || !name} style={{ height: 40 }}>Activate program</button>
              <button className="btn btn-ghost btn-block" type="button">Save as draft</button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

Object.assign(window, { ScreenNewProgram });
