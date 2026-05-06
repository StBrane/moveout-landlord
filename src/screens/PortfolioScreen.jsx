// ═══════════════════════════════════════════════════════════════════════════
// PortfolioScreen.jsx — property list with status chips and add-property flow
// v0.2.0 — cream/forest theme, status chip semantics adjusted for tenancy model
// ═══════════════════════════════════════════════════════════════════════════

import { useState, useMemo } from 'react';
import {
  THEME, STATE_LAWS, APP_VERSION,
} from '../lib/constants.js';
import {
  createProperty, deleteProperty, propertyStatus, STATUS_CHIPS,
} from '../lib/portfolioStore.js';

export default function PortfolioScreen({ portfolio, setPortfolio, onOpenProperty }) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ address: '', stateIdx: '' });
  const [searchQuery, setSearchQuery] = useState('');

  // Filter properties by name or address. Search bar appears below the
  // "Add Property" button only when the user has more than 4 properties —
  // before that, scanning the list is faster than typing.
  const filteredProperties = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return portfolio.properties;
    return portfolio.properties.filter(p =>
      (p.name || '').toLowerCase().includes(q) ||
      (p.address || '').toLowerCase().includes(q)
    );
  }, [portfolio.properties, searchQuery]);

  const handleAdd = () => {
    // Property name is no longer collected from the user — the address is
    // what identifies a property. portfolioStore.createProperty will fall
    // back to "Untitled Property" if name is empty, but we pass the address
    // as the name so the property card displays something meaningful.
    const trimmedAddress = form.address.trim();
    if (!trimmedAddress) {
      alert('Address is required');
      return;
    }
    const { portfolio: next, property } = createProperty(portfolio, {
      name: trimmedAddress,           // use address as the display name
      address: trimmedAddress,
      stateIdx: form.stateIdx,
    });
    setPortfolio(next);
    setAdding(false);
    setForm({ address: '', stateIdx: '' });
    onOpenProperty(property.id);
  };

  const handleDelete = (id, name) => {
    if (!confirm(`Delete "${name}" and all its tenancies and inspections? This cannot be undone.`)) return;
    setPortfolio(deleteProperty(portfolio, id));
  };

  return (
    <div style={{
      maxWidth: 640, margin: '0 auto',
      padding: 'calc(env(safe-area-inset-top) + 16px) 16px calc(env(safe-area-inset-bottom) + 32px)',
      minHeight: '100vh', background: THEME.bg,
    }}>
      <header style={{
        marginBottom: 22,
        background: THEME.brand, color: THEME.mint50,
        margin: '-16px -16px 22px -16px',
        padding: 'calc(env(safe-area-inset-top) + 18px) 18px 18px 18px',
        borderBottomLeftRadius: 18, borderBottomRightRadius: 18,
      }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: -0.3 }}>
          MoveOut Shield <span style={{ color: THEME.mint300, fontWeight: 600 }}>Landlord</span>
        </h1>
        <div style={{ fontSize: 12, color: THEME.mint200, marginTop: 4, opacity: 0.9 }}>
          Portfolio · {portfolio.properties.length} {portfolio.properties.length === 1 ? 'property' : 'properties'}
        </div>
      </header>

      {!adding && (
        <button onClick={() => setAdding(true)} style={btnPrimary}>
          + Add Property
        </button>
      )}

      {/* Search bar — only shown once portfolio has more than 4 properties.
          Below that threshold, the full list is fast enough to scan. */}
      {!adding && portfolio.properties.length > 4 && (
        <div style={{ marginTop: 12, position: 'relative' }}>
          <input
            type="search"
            placeholder="Search by name or address…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{
              ...input,
              paddingLeft: 36,
              background: THEME.paper,
            }}
          />
          <span style={{
            position: 'absolute', left: 12, top: '50%',
            transform: 'translateY(-50%)', color: THEME.muted2,
            fontSize: 14, pointerEvents: 'none',
          }}>🔍</span>
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              style={{
                position: 'absolute', right: 8, top: '50%',
                transform: 'translateY(-50%)',
                background: 'transparent', border: 'none',
                color: THEME.muted2, fontSize: 18, cursor: 'pointer',
                padding: 4, lineHeight: 1,
              }}
              aria-label="Clear search"
            >×</button>
          )}
        </div>
      )}

      {adding && (
        <div style={card}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: THEME.brand }}>
            New Property
          </div>

          <Label>Address *</Label>
          <input style={input}
            placeholder="e.g. 123 Oak St, Muncie IN"
            value={form.address}
            onChange={e => setForm({ ...form, address: e.target.value })}
            autoFocus />

          <Label>State</Label>
          <select style={input}
            value={form.stateIdx}
            onChange={e => setForm({ ...form, stateIdx: e.target.value })}>
            <option value="">— Select state —</option>
            {STATE_LAWS.map((s, i) => (
              <option key={i} value={i}>{s[0]} ({s[1]}) — {s[2]} day return</option>
            ))}
          </select>

          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <button
              onClick={() => { setAdding(false); setForm({ address: '', stateIdx: '' }); }}
              style={{ ...btnSecondary, flex: 1 }}
            >Cancel</button>
            <button onClick={handleAdd} style={{ ...btnPrimary, flex: 1, marginTop: 0 }}>Create</button>
          </div>
        </div>
      )}

      {portfolio.properties.length === 0 && !adding && (
        <div style={{
          textAlign: 'center', padding: 32, marginTop: 12,
          color: THEME.muted, fontSize: 13, lineHeight: 1.6,
          border: `1px dashed ${THEME.edgeStrong}`, borderRadius: 12,
          background: THEME.paper,
        }}>
          No properties yet.<br />
          Add your first property above, or have a tenant share a .mosinsp inspection
          file — it will open here automatically.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 18 }}>
        {searchQuery && filteredProperties.length === 0 && portfolio.properties.length > 0 && (
          <div style={{
            textAlign: 'center', padding: 24,
            color: THEME.muted, fontSize: 13,
            border: `1px dashed ${THEME.edge}`, borderRadius: 12,
            background: THEME.paper,
          }}>
            No properties match "{searchQuery}".
          </div>
        )}
        {filteredProperties.map(p => {
          const status = propertyStatus(p);
          const chip = STATUS_CHIPS[status];
          const state = p.stateIdx != null ? STATE_LAWS[p.stateIdx] : null;
          const inspectionCount =
            p.tenancies.reduce((s, t) => s + t.inspections.length, 0) +
            (p.betweenInspections?.length || 0);
          return (
            <div
              key={p.id}
              onClick={() => onOpenProperty(p.id)}
              style={{
                background: THEME.paper, borderRadius: 12, padding: 14,
                border: `1px solid ${THEME.edge}`, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 12,
                transition: 'border-color 0.15s, transform 0.05s',
              }}
              onMouseDown={(e) => { e.currentTarget.style.transform = 'scale(0.99)'; }}
              onMouseUp={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: THEME.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {p.name}
                </div>
                <div style={{ fontSize: 12, color: THEME.muted, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {p.address || '(no address)'}
                  {state ? ` · ${state[1]}` : ''}
                </div>
                <div style={{ fontSize: 11, color: THEME.muted2, marginTop: 4 }}>
                  {p.tenancies.length} {p.tenancies.length === 1 ? 'tenancy' : 'tenancies'}
                  {' · '}
                  {inspectionCount} {inspectionCount === 1 ? 'inspection' : 'inspections'}
                </div>
              </div>

              <div style={{
                background: chip.color, color: '#fff', fontSize: 10, fontWeight: 700,
                padding: '4px 10px', borderRadius: 999, whiteSpace: 'nowrap',
                textTransform: 'uppercase', letterSpacing: 0.4,
              }}>{chip.label}</div>

              <button
                onClick={(e) => { e.stopPropagation(); handleDelete(p.id, p.name); }}
                style={{
                  background: 'transparent', color: THEME.muted2, border: 'none',
                  fontSize: 22, cursor: 'pointer', padding: 4, opacity: 0.5, lineHeight: 1,
                }}
                aria-label="Delete property"
              >×</button>
            </div>
          );
        })}
      </div>

      <div style={{ textAlign: 'center', fontSize: 10, color: THEME.muted2, marginTop: 36 }}>
        v{APP_VERSION} · local data only, no cloud
      </div>
    </div>
  );
}

// ─── Shared styles (scoped to this file) ─────────────────────────────────
function Label({ children }) {
  return (
    <label style={{
      display: 'block', fontSize: 12, color: THEME.muted,
      marginTop: 12, marginBottom: 4, fontWeight: 500,
    }}>{children}</label>
  );
}

const input = {
  width: '100%', background: THEME.bg, color: THEME.ink,
  border: `1px solid ${THEME.edge}`, borderRadius: 8,
  padding: '10px 12px', fontSize: 14, boxSizing: 'border-box',
  outline: 'none',
};

const card = {
  background: THEME.paper, borderRadius: 12, padding: 16, marginBottom: 12,
  border: `1px solid ${THEME.edge}`,
};

const btnPrimary = {
  background: THEME.brand, color: THEME.mint50, border: 'none', borderRadius: 12,
  padding: '14px 18px', fontSize: 15, fontWeight: 600, cursor: 'pointer',
  width: '100%', marginTop: 0,
};

const btnSecondary = {
  background: THEME.surface, color: THEME.ink,
  border: `1px solid ${THEME.edge}`, borderRadius: 10,
  padding: '12px 16px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
};
