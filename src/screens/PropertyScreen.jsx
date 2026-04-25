// ═══════════════════════════════════════════════════════════════════════════
// PropertyScreen.jsx — single property view with inspection list
// ═══════════════════════════════════════════════════════════════════════════
// Shows all inspections for a property. Landlord can:
//   - Create a new inspection (picks a type: baseline/turnover/etc.)
//   - Pick any two inspections to compare via the Changes view
//   - Delete inspections (with confirmation)
//
// v1 SKELETON NOTE: The "capture" UI (actual room-by-room inspection screen)
// is where the ~900 lines of tenant app inspection UI get dropped in. For
// the skeleton, "New Inspection" creates an empty inspection record — the
// capture UI itself is a v1 TODO that reuses tenant app code.
// ═══════════════════════════════════════════════════════════════════════════

import { useState } from 'react';
import {
  THEME, STATE_LAWS, INSPECTION_TYPES, LANDLORD_INSPECTION_TYPES,
} from '../lib/constants';
import {
  getProperty, createInspection, deleteInspection,
} from '../lib/portfolioStore';

export default function PropertyScreen({ portfolio, setPortfolio, propertyId, onBack, onCompare, photoStore }) {
  const property = getProperty(portfolio, propertyId);
  const [newInspType, setNewInspType] = useState(null);
  const [selected, setSelected] = useState([]);  // for compare — up to 2

  if (!property) {
    return (
      <div style={{ padding: 20 }}>
        <div>Property not found.</div>
        <button onClick={onBack} style={backBtnStyle}>← Back to portfolio</button>
      </div>
    );
  }

  const state = property.stateIdx != null ? STATE_LAWS[property.stateIdx] : null;

  const handleNewInspection = (typeId) => {
    const typeEntry = Object.values(INSPECTION_TYPES).find(t => t.id === typeId);
    const label = prompt(
      `Label this ${typeEntry.label.toLowerCase()} inspection (optional):`,
      typeEntry.label
    );
    if (label === null) return;  // cancelled

    const { portfolio: next, inspection } = createInspection(portfolio, propertyId, {
      typeId,
      label: label.trim() || typeEntry.label,
    });
    setPortfolio(next);
    setNewInspType(null);

    // v1 TODO: navigate to the capture screen for this inspection
    // For now, the inspection just appears in the list as empty.
    alert(
      `Created "${inspection.label}".\n\n` +
      `Capture UI is not yet implemented — inspection is empty. ` +
      `Drop tenant app's inspection UI here to complete v1.`
    );
  };

  const handleDelete = async (inspId, label) => {
    if (!confirm(`Delete "${label}"? This cannot be undone.`)) return;
    setPortfolio(deleteInspection(portfolio, propertyId, inspId));
    if (photoStore) {
      await photoStore.removeInspection(inspId);
    }
    setSelected(selected.filter(id => id !== inspId));
  };

  const toggleSelect = (inspId) => {
    if (selected.includes(inspId)) {
      setSelected(selected.filter(id => id !== inspId));
    } else if (selected.length < 2) {
      setSelected([...selected, inspId]);
    } else {
      // Replace the first selection, keep the second
      setSelected([selected[1], inspId]);
    }
  };

  const canCompare = selected.length === 2;

  return (
    <div style={{
      maxWidth: 640, margin: '0 auto',
      padding: 'calc(env(safe-area-inset-top) + 16px) 16px calc(env(safe-area-inset-bottom) + 120px)',
    }}>
      <button onClick={onBack} style={backBtnStyle}>← Portfolio</button>

      <header style={{ marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: THEME.text }}>{property.name}</h1>
        {property.address && (
          <div style={{ fontSize: 13, color: THEME.textDim, marginTop: 4 }}>{property.address}</div>
        )}
        {state && (
          <div style={{ fontSize: 11, color: THEME.textDim, marginTop: 6 }}>
            {state[0]} ({state[1]}) · deposit return window: {state[2]} days · {state[4]}
          </div>
        )}
      </header>

      {/* ─── New inspection picker ─── */}
      {!newInspType && (
        <button
          onClick={() => setNewInspType('picker')}
          style={{
            background: THEME.accent, color: '#fff', border: 'none', borderRadius: 12,
            padding: '14px 18px', fontSize: 15, fontWeight: 600, cursor: 'pointer',
            width: '100%', marginBottom: 12,
          }}
        >+ New Inspection</button>
      )}

      {newInspType === 'picker' && (
        <div style={{
          background: THEME.bgCard, borderRadius: 12, padding: 12, marginBottom: 16,
          border: `1px solid ${THEME.border}`,
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: THEME.text }}>
            Inspection type:
          </div>
          {LANDLORD_INSPECTION_TYPES.map(type => (
            <button
              key={type.id}
              onClick={() => handleNewInspection(type.id)}
              style={{
                background: THEME.bg, color: THEME.text,
                border: `1px solid ${THEME.border}`, borderRadius: 8,
                padding: '10px 12px', fontSize: 13, cursor: 'pointer',
                width: '100%', marginBottom: 6, textAlign: 'left',
                display: 'flex', alignItems: 'center', gap: 10,
              }}
            >
              <span style={{ fontSize: 18 }}>{type.icon}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>{type.label}</div>
                <div style={{ fontSize: 11, color: THEME.textDim, marginTop: 2 }}>{type.hint}</div>
              </div>
            </button>
          ))}
          <button onClick={() => setNewInspType(null)} style={{ ...btnSecondary, width: '100%', marginTop: 4 }}>
            Cancel
          </button>
        </div>
      )}

      {/* ─── Inspection list ─── */}
      <div style={{ fontSize: 12, color: THEME.textDim, marginBottom: 8, marginTop: 16 }}>
        Inspections — tap 2 to compare
      </div>

      {property.inspections.length === 0 && (
        <div style={{
          textAlign: 'center', padding: 30, color: THEME.textDim, fontSize: 13,
          border: `1px dashed ${THEME.border}`, borderRadius: 12,
        }}>
          No inspections yet.<br />
          Create a baseline inspection above, or receive one from a tenant via share sheet.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {property.inspections.map(insp => {
          const typeEntry = Object.values(INSPECTION_TYPES).find(t => t.id === insp.type) || {};
          const isSelected = selected.includes(insp.id);
          const sourceColor = insp.source === 'tenant' ? THEME.tenant : THEME.landlord;
          return (
            <div
              key={insp.id}
              onClick={() => toggleSelect(insp.id)}
              style={{
                background: THEME.bgCard, borderRadius: 12, padding: 12,
                border: `2px solid ${isSelected ? THEME.accent : THEME.border}`,
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12,
              }}
            >
              <div style={{ fontSize: 22 }}>{typeEntry.icon || '📋'}</div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: THEME.text }}>
                  {insp.label}
                  {!insp.editable && (
                    <span style={{ fontSize: 10, color: THEME.tenant, marginLeft: 8, fontWeight: 500 }}>
                      READ-ONLY
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: THEME.textDim, marginTop: 2 }}>
                  {typeEntry.label || insp.type}
                  {' · '}
                  {new Date(insp.createdAt).toLocaleDateString()}
                </div>
              </div>

              <div style={{
                width: 6, height: 40, borderRadius: 3, background: sourceColor,
              }} title={insp.source === 'tenant' ? 'From tenant bundle' : 'Landlord inspection'} />

              <button
                onClick={(e) => { e.stopPropagation(); handleDelete(insp.id, insp.label); }}
                style={{
                  background: 'transparent', color: THEME.textDim, border: 'none',
                  fontSize: 20, cursor: 'pointer', padding: 4, opacity: 0.5,
                }}
                aria-label="Delete inspection"
              >×</button>
            </div>
          );
        })}
      </div>

      {/* ─── Compare bar (floating bottom) ─── */}
      {selected.length > 0 && (
        <div style={{
          position: 'fixed', left: 0, right: 0,
          bottom: 'calc(env(safe-area-inset-bottom) + 12px)',
          padding: '0 16px', display: 'flex', justifyContent: 'center', pointerEvents: 'none',
        }}>
          <div style={{
            background: THEME.bgElev, borderRadius: 14, padding: 12,
            maxWidth: 600, width: '100%', pointerEvents: 'auto',
            boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <div style={{ flex: 1, fontSize: 12, color: THEME.text }}>
              {selected.length === 1
                ? 'Pick a second inspection to compare'
                : '2 selected — ready to compare'}
            </div>
            <button onClick={() => setSelected([])} style={{
              background: 'transparent', color: THEME.textDim, border: `1px solid ${THEME.border}`,
              borderRadius: 8, padding: '8px 12px', fontSize: 12, cursor: 'pointer',
            }}>Clear</button>
            <button
              disabled={!canCompare}
              onClick={() => canCompare && onCompare(selected[0], selected[1])}
              style={{
                background: canCompare ? THEME.accent : THEME.border,
                color: '#fff', border: 'none', borderRadius: 8,
                padding: '8px 16px', fontSize: 12, fontWeight: 600,
                cursor: canCompare ? 'pointer' : 'not-allowed',
              }}
            >Compare →</button>
          </div>
        </div>
      )}
    </div>
  );
}

const backBtnStyle = {
  background: 'transparent', color: THEME.textDim, border: 'none',
  padding: '8px 0', fontSize: 13, cursor: 'pointer', marginBottom: 8,
};

const btnSecondary = {
  background: 'transparent', color: THEME.textDim,
  border: `1px solid ${THEME.border}`, borderRadius: 8,
  padding: '10px 12px', fontSize: 13, fontWeight: 500, cursor: 'pointer',
};
