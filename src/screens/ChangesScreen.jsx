// ═══════════════════════════════════════════════════════════════════════════
// ChangesScreen.jsx — side-by-side comparison of two inspections
// ═══════════════════════════════════════════════════════════════════════════
// Renders the output of diffInspections(). Supports filter views:
//   - All items (show everything)
//   - Changed only (default — hide unchanged items)
//   - Worsened only (for landlord's deductions analysis)
//
// Per-room layout: status change highlight + side-by-side notes + photos.
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react';
import { THEME, INSPECTION_TYPES, STATUS } from '../lib/constants';
import { getProperty, getInspection } from '../lib/portfolioStore';
import {
  diffInspections, changedItemsOnly, worsenedItemsOnly,
  changeTypeMeta, activePhase,
} from '../lib/diff';

export default function ChangesScreen({ portfolio, propertyId, aId, bId, onBack, photoStore }) {
  const property = getProperty(portfolio, propertyId);
  const a = getInspection(portfolio, propertyId, aId);
  const b = getInspection(portfolio, propertyId, bId);

  const [filter, setFilter] = useState('changed');  // 'all' | 'changed' | 'worsened'

  // Hooks MUST be called unconditionally and in the same order on every render —
  // they go above any early-return path. Defensive null guards inside the memo
  // callbacks handle the case where the inspections aren't found.
  const diff = useMemo(() => {
    if (!a || !b) return null;
    return diffInspections(a, b);
  }, [a, b]);

  const visibleDiff = useMemo(() => {
    if (!diff) return null;
    if (filter === 'all') return diff;
    if (filter === 'worsened') return worsenedItemsOnly(diff);
    return changedItemsOnly(diff);
  }, [diff, filter]);

  if (!property || !a || !b || !diff || !visibleDiff) {
    return (
      <div style={{ padding: 20, color: THEME.text }}>
        <div>Comparison not found — one of the inspections may have been deleted.</div>
        <button onClick={onBack} style={backBtnStyle}>← Back</button>
      </div>
    );
  }

  return (
    <div style={{
      maxWidth: 800, margin: '0 auto',
      padding: 'calc(env(safe-area-inset-top) + 12px) 16px calc(env(safe-area-inset-bottom) + 32px)',
    }}>
      <button onClick={onBack} style={backBtnStyle}>← {property.name}</button>

      <header style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: THEME.text }}>Changes</h1>
      </header>

      {/* ─── A vs B header ─── */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 8,
        marginBottom: 16, alignItems: 'stretch',
      }}>
        <InspectionCard inspection={a} side="A" phase={diff.summary.phaseA} />
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: THEME.textDim, fontSize: 20,
        }}>→</div>
        <InspectionCard inspection={b} side="B" phase={diff.summary.phaseB} />
      </div>

      {/* ─── Summary stats ─── */}
      <div style={{
        background: THEME.bgCard, borderRadius: 12, padding: 12, marginBottom: 16,
        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, fontSize: 11,
      }}>
        <Stat label="Items" value={diff.summary.totalItems} />
        <Stat label="Changed" value={diff.summary.changedItems} color={THEME.warning} />
        <Stat label="Worsened" value={diff.summary.worsenedItems} color={THEME.danger} />
        <Stat label="Improved" value={diff.summary.improvedItems} color={THEME.success} />
      </div>

      {/* ─── Filter chips ─── */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        <FilterChip active={filter === 'changed'} onClick={() => setFilter('changed')}>Changed only</FilterChip>
        <FilterChip active={filter === 'worsened'} onClick={() => setFilter('worsened')}>Worsened only</FilterChip>
        <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>Show all</FilterChip>
      </div>

      {/* ─── Rooms ─── */}
      {visibleDiff.rooms.length === 0 && (
        <div style={{
          padding: 30, textAlign: 'center', color: THEME.textDim, fontSize: 13,
          border: `1px dashed ${THEME.border}`, borderRadius: 12,
        }}>
          {filter === 'worsened' ? 'No worsened items between these inspections.' : 'No differences found.'}
        </div>
      )}

      {visibleDiff.rooms.map(roomDiff => (
        <RoomDiff key={roomDiff.room.id} roomDiff={roomDiff} photoStore={photoStore} />
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
function InspectionCard({ inspection, side, phase }) {
  const typeEntry = Object.values(INSPECTION_TYPES).find(t => t.id === inspection.type) || {};
  const sourceColor = inspection.source === 'tenant' ? THEME.tenant : THEME.landlord;
  return (
    <div style={{
      background: THEME.bgCard, borderRadius: 10, padding: 10,
      borderLeft: `4px solid ${sourceColor}`, minWidth: 0,
    }}>
      <div style={{ fontSize: 10, color: THEME.textDim, textTransform: 'uppercase', fontWeight: 600 }}>
        {side} · {inspection.source === 'tenant' ? 'Tenant' : 'Landlord'}
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, color: THEME.text, marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {typeEntry.icon} {inspection.label}
      </div>
      <div style={{ fontSize: 10, color: THEME.textDim, marginTop: 2 }}>
        {new Date(inspection.createdAt).toLocaleDateString()}
        {phase ? ` · ${phase === 'moveIn' ? 'Move-in' : 'Move-out'} data` : ''}
      </div>
    </div>
  );
}

function Stat({ label, value, color }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 18, fontWeight: 700, color: color || THEME.text }}>{value}</div>
      <div style={{ fontSize: 10, color: THEME.textDim, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
    </div>
  );
}

function FilterChip({ active, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      background: active ? THEME.accent : 'transparent',
      color: active ? '#fff' : THEME.textDim,
      border: `1px solid ${active ? THEME.accent : THEME.border}`,
      borderRadius: 999, padding: '6px 12px', fontSize: 12, fontWeight: 500,
      cursor: 'pointer',
    }}>{children}</button>
  );
}

// ─────────────────────────────────────────────────────────────────────────
function RoomDiff({ roomDiff, photoStore }) {
  const { room, items, notes, photos, summary } = roomDiff;
  const hasContent = items.length > 0 || notes.changed || photos.a.length > 0 || photos.b.length > 0;
  if (!hasContent) return null;

  return (
    <div style={{
      background: THEME.bgCard, borderRadius: 12, padding: 14, marginBottom: 12,
      border: `1px solid ${THEME.border}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 20 }}>{room.icon}</span>
        <div style={{ fontSize: 15, fontWeight: 600, color: THEME.text }}>{room.name}</div>
        {summary.worsened > 0 && (
          <span style={chipStyle(THEME.danger)}>{summary.worsened} worsened</span>
        )}
        {summary.improved > 0 && (
          <span style={chipStyle(THEME.success)}>{summary.improved} improved</span>
        )}
      </div>

      {items.length > 0 && (
        <div style={{ marginBottom: notes.changed || photos.a.length + photos.b.length > 0 ? 12 : 0 }}>
          {items.map(item => (
            <ItemRow key={item.index} item={item} />
          ))}
        </div>
      )}

      {notes.changed && (
        <div style={{
          background: THEME.bg, borderRadius: 8, padding: 10, marginTop: 8,
          border: `1px solid ${THEME.border}`,
        }}>
          <div style={{ fontSize: 10, color: THEME.textDim, textTransform: 'uppercase', fontWeight: 600, marginBottom: 6 }}>Notes</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12 }}>
            <div style={{ color: THEME.textDim }}>
              <div style={{ fontSize: 10, color: THEME.tenant, marginBottom: 2 }}>A</div>
              {notes.a || <em style={{ opacity: 0.5 }}>(none)</em>}
            </div>
            <div style={{ color: THEME.text }}>
              <div style={{ fontSize: 10, color: THEME.landlord, marginBottom: 2 }}>B</div>
              {notes.b || <em style={{ opacity: 0.5 }}>(none)</em>}
            </div>
          </div>
        </div>
      )}

      {(photos.a.length > 0 || photos.b.length > 0) && (
        <PhotoPairs photosA={photos.a} photosB={photos.b} photoStore={photoStore} />
      )}
    </div>
  );
}

function ItemRow({ item }) {
  const meta = changeTypeMeta(item.changeType);
  const isUnchanged = item.changeType === 'unchanged';
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '1fr 70px 30px 70px',
      alignItems: 'center', padding: '8px 0', gap: 8,
      borderBottom: `1px solid ${THEME.border}`, opacity: isUnchanged ? 0.5 : 1,
    }}>
      <div style={{ fontSize: 13, color: THEME.text, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {item.label}
      </div>
      <StatusBadge status={item.a.status} />
      <div style={{ textAlign: 'center', fontSize: 14, color: meta.color, fontWeight: 700 }} title={meta.label}>
        {meta.icon}
      </div>
      <StatusBadge status={item.b.status} />
    </div>
  );
}

function StatusBadge({ status }) {
  if (!status) {
    return <div style={{
      fontSize: 10, color: THEME.textDim, textAlign: 'center',
      padding: '2px 6px', opacity: 0.5,
    }}>—</div>;
  }
  const meta = STATUS[status];
  if (!meta) return <div style={{ fontSize: 10 }}>{status}</div>;
  return (
    <div style={{
      background: meta.bg, color: meta.fg, fontSize: 10, fontWeight: 600,
      padding: '3px 6px', borderRadius: 6, textAlign: 'center',
    }}>{meta.short}</div>
  );
}

// Photo side-by-side rendering with lazy loading via photoStore.toWebUrl
function PhotoPairs({ photosA, photosB, photoStore }) {
  const maxLen = Math.max(photosA.length, photosB.length);
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 10, color: THEME.textDim, textTransform: 'uppercase', fontWeight: 600, marginBottom: 6 }}>
        Photos · {photosA.length} + {photosB.length}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {Array.from({ length: maxLen }).map((_, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <PhotoTile photo={photosA[i]} photoStore={photoStore} />
            <PhotoTile photo={photosB[i]} photoStore={photoStore} />
          </div>
        ))}
      </div>
    </div>
  );
}

function PhotoTile({ photo, photoStore }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    if (!photo || !photoStore || !photo.path) return;
    let cancelled = false;
    photoStore.toWebUrl(photo.path).then(url => { if (!cancelled) setSrc(url); });
    return () => { cancelled = true; };
  }, [photo, photoStore]);

  if (!photo) {
    return <div style={{
      background: THEME.bg, borderRadius: 6, aspectRatio: '4/3',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 10, color: THEME.textDim, opacity: 0.4,
    }}>(no photo)</div>;
  }

  return (
    <div style={{
      background: THEME.bg, borderRadius: 6, aspectRatio: '4/3', overflow: 'hidden',
      position: 'relative',
    }}>
      {src ? (
        <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%',
          fontSize: 10, color: THEME.textDim,
        }}>loading…</div>
      )}
      {photo.ts && (
        <div style={{
          position: 'absolute', bottom: 4, left: 4,
          background: 'rgba(0,0,0,0.7)', color: '#fff', fontSize: 9,
          padding: '2px 6px', borderRadius: 4,
        }}>
          {new Date(photo.ts).toLocaleDateString()}
        </div>
      )}
    </div>
  );
}

const backBtnStyle = {
  background: 'transparent', color: THEME.textDim, border: 'none',
  padding: '8px 0', fontSize: 13, cursor: 'pointer', marginBottom: 8,
};

const chipStyle = (color) => ({
  background: color, color: '#fff', fontSize: 10, fontWeight: 600,
  padding: '2px 8px', borderRadius: 999,
});
