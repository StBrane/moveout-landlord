// ═══════════════════════════════════════════════════════════════════════════
// PortfolioScreen.jsx — property list with status chips and add-property flow
// ═══════════════════════════════════════════════════════════════════════════

import { useState } from 'react';
import {
  THEME, STATE_LAWS, APP_VERSION,
} from '../lib/constants';
import {
  createProperty, deleteProperty, propertyStatus, STATUS_CHIPS,
} from '../lib/portfolioStore';

export default function PortfolioScreen({ portfolio, setPortfolio, onOpenProperty }) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', address: '', stateIdx: '' });

  const handleAdd = () => {
    if (!form.name.trim()) {
      alert('Property name is required');
      return;
    }
    const { portfolio: next, property } = createProperty(portfolio, form);
    setPortfolio(next);
    setAdding(false);
    setForm({ name: '', address: '', stateIdx: '' });
    onOpenProperty(property.id);
  };

  const handleDelete = (id, name) => {
    if (!confirm(`Delete "${name}" and all its inspections? This cannot be undone.`)) return;
    setPortfolio(deleteProperty(portfolio, id));
  };

  return (
    <div style={{
      maxWidth: 640, margin: '0 auto',
      padding: 'calc(env(safe-area-inset-top) + 16px) 16px calc(env(safe-area-inset-bottom) + 16px)',
    }}>
      <header style={{ marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: THEME.text }}>
          MoveOut Shield <span style={{ color: THEME.accent }}>Landlord</span>
        </h1>
        <div style={{ fontSize: 12, color: THEME.textDim, marginTop: 4 }}>
          Portfolio — {portfolio.properties.length} {portfolio.properties.length === 1 ? 'property' : 'properties'}
        </div>
      </header>

      {!adding && (
        <button
          onClick={() => setAdding(true)}
          style={{
            background: THEME.accent, color: '#fff', border: 'none', borderRadius: 12,
            padding: '14px 18px', fontSize: 15, fontWeight: 600, cursor: 'pointer',
            width: '100%', marginBottom: 20,
          }}
        >+ Add Property</button>
      )}

      {adding && (
        <div style={{
          background: THEME.bgCard, borderRadius: 12, padding: 16, marginBottom: 20,
          border: `1px solid ${THEME.border}`,
        }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>New Property</div>

          <label style={labelStyle}>Name *</label>
          <input
            style={inputStyle}
            placeholder="e.g. Oak Street Apartment"
            value={form.name}
            onChange={e => setForm({ ...form, name: e.target.value })}
          />

          <label style={labelStyle}>Address</label>
          <input
            style={inputStyle}
            placeholder="e.g. 123 Oak St, Muncie IN"
            value={form.address}
            onChange={e => setForm({ ...form, address: e.target.value })}
          />

          <label style={labelStyle}>State</label>
          <select
            style={inputStyle}
            value={form.stateIdx}
            onChange={e => setForm({ ...form, stateIdx: e.target.value })}
          >
            <option value="">— Select state —</option>
            {STATE_LAWS.map((s, i) => (
              <option key={i} value={i}>{s[0]} ({s[1]}) — {s[2]} day return</option>
            ))}
          </select>

          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button
              onClick={() => { setAdding(false); setForm({ name: '', address: '', stateIdx: '' }); }}
              style={{ ...btnSecondary, flex: 1 }}
            >Cancel</button>
            <button onClick={handleAdd} style={{ ...btnPrimary, flex: 1 }}>Create</button>
          </div>
        </div>
      )}

      {portfolio.properties.length === 0 && !adding && (
        <div style={{
          textAlign: 'center', padding: 40, color: THEME.textDim, fontSize: 14,
          border: `1px dashed ${THEME.border}`, borderRadius: 12,
        }}>
          No properties yet.<br />
          Add your first property above, or have a tenant share a .mosinsp inspection
          from the MoveOut Shield app — it will open here.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {portfolio.properties.map(p => {
          const status = propertyStatus(p);
          const chip = STATUS_CHIPS[status];
          const state = p.stateIdx != null ? STATE_LAWS[p.stateIdx] : null;
          return (
            <div
              key={p.id}
              onClick={() => onOpenProperty(p.id)}
              style={{
                background: THEME.bgCard, borderRadius: 12, padding: 14,
                border: `1px solid ${THEME.border}`, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 12,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: THEME.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {p.name}
                </div>
                <div style={{ fontSize: 12, color: THEME.textDim, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {p.address || '(no address)'}
                  {state ? ` · ${state[1]}` : ''}
                </div>
                <div style={{ fontSize: 11, color: THEME.textDim, marginTop: 4 }}>
                  {p.inspections.length} inspection{p.inspections.length === 1 ? '' : 's'}
                </div>
              </div>

              <div style={{
                background: chip.color, color: '#fff', fontSize: 11, fontWeight: 600,
                padding: '4px 10px', borderRadius: 999, whiteSpace: 'nowrap',
              }}>{chip.label}</div>

              <button
                onClick={(e) => { e.stopPropagation(); handleDelete(p.id, p.name); }}
                style={{
                  background: 'transparent', color: THEME.textDim, border: 'none',
                  fontSize: 20, cursor: 'pointer', padding: 4, opacity: 0.5,
                }}
                aria-label="Delete property"
              >×</button>
            </div>
          );
        })}
      </div>

      <div style={{ textAlign: 'center', fontSize: 10, color: THEME.textDim, marginTop: 40 }}>
        v{APP_VERSION} · local data only, no cloud
      </div>
    </div>
  );
}

const labelStyle = {
  display: 'block', fontSize: 12, color: THEME.textDim,
  marginTop: 10, marginBottom: 4, fontWeight: 500,
};

const inputStyle = {
  width: '100%', background: THEME.bg, color: THEME.text,
  border: `1px solid ${THEME.border}`, borderRadius: 8,
  padding: '10px 12px', fontSize: 14, boxSizing: 'border-box',
};

const btnPrimary = {
  background: THEME.accent, color: '#fff', border: 'none', borderRadius: 10,
  padding: '12px 16px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
};

const btnSecondary = {
  background: 'transparent', color: THEME.textDim,
  border: `1px solid ${THEME.border}`, borderRadius: 10,
  padding: '12px 16px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
};
