// ═══════════════════════════════════════════════════════════════════════════
// ChangesScreen.jsx — N-way comparison (2 or 3 inspections)
// v0.2.0 — supports up to 3 inspections; renders 3-column grid for 3-way
// ═══════════════════════════════════════════════════════════════════════════
// For 2-way compare, uses the existing diff engine (A vs B) and shows the
// rich side-by-side view with photo pairs and notes diff.
//
// For 3-way compare, builds a wider matrix per item (status across A, B, C)
// and shows status badges in a 3-column grid. Photos show as thumbnails per
// inspection (smaller) since 3 columns at full size won't fit on phone.
//
// In both modes:
//   - "Changed only" filter hides items unchanged across all selected
//   - "Worsened only" filter shows items that got worse from earliest to latest
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react';
import { THEME, INSPECTION_TYPES, STATUS, ROOMS, formatDate } from '../lib/constants.js';
import { getProperty, getInspection } from '../lib/portfolioStore.js';
import {
  diffInspections, changedItemsOnly, worsenedItemsOnly,
  changeTypeMeta, activePhase,
} from '../lib/diff.js';

export default function ChangesScreen({
  portfolio, propertyId, inspectionIds, onBack, onSharePDF, photoStore,
}) {
  const property = getProperty(portfolio, propertyId);
  const inspections = (inspectionIds || [])
    .map(id => getInspection(portfolio, propertyId, id))
    .filter(Boolean);

  const [filter, setFilter] = useState('changed');
  const [pdfBusy, setPdfBusy] = useState(false);
  const isThreeWay = inspections.length === 3;

  // Share PDF handler — delegates to main.jsx for native vs web dispatch.
  // The main.jsx callback receives the inspection objects and the diff/matrix
  // so the PDF builder can render the same data the user is looking at.
  const handleSharePDF = async () => {
    if (!onSharePDF || pdfBusy) return;
    setPdfBusy(true);
    try {
      const diffData = isThreeWay ? threeWayMatrix : twoWayDiff;
      await onSharePDF({ inspections, diff: diffData, property });
    } catch (e) {
      // Error already alerted by main.jsx — just log
      console.error('[ChangesScreen] share PDF failed', e);
    } finally {
      setPdfBusy(false);
    }
  };

  // 2-way: full diff with photos. 3-way: matrix of statuses.
  const twoWayDiff = useMemo(() => {
    if (inspections.length !== 2) return null;
    return diffInspections(inspections[0], inspections[1]);
  }, [inspections]);

  const threeWayMatrix = useMemo(() => {
    if (!isThreeWay) return null;
    return buildThreeWayMatrix(inspections);
  }, [inspections, isThreeWay]);

  const visibleTwoWay = useMemo(() => {
    if (!twoWayDiff) return null;
    if (filter === 'all') return twoWayDiff;
    if (filter === 'worsened') return worsenedItemsOnly(twoWayDiff);
    return changedItemsOnly(twoWayDiff);
  }, [twoWayDiff, filter]);

  const visibleThreeWay = useMemo(() => {
    if (!threeWayMatrix) return null;
    return filterThreeWay(threeWayMatrix, filter);
  }, [threeWayMatrix, filter]);

  if (!property || inspections.length < 2) {
    return (
      <div style={{ padding: 20, color: THEME.ink, background: THEME.bg, minHeight: '100vh' }}>
        <div style={{ marginBottom: 14 }}>
          Comparison not found — at least one of the inspections may have been deleted.
        </div>
        <button onClick={onBack} style={btnSecondary}>← Back</button>
      </div>
    );
  }

  // Phase labels for the inspection cards (only shown in 2-way mode)
  const phaseA = twoWayDiff?.summary.phaseA;
  const phaseB = twoWayDiff?.summary.phaseB;

  return (
    <div style={{
      maxWidth: 800, margin: '0 auto',
      padding: 'calc(env(safe-area-inset-top) + 0px) 0 calc(env(safe-area-inset-bottom) + 32px) 0',
      minHeight: '100vh', background: THEME.bg,
    }}>
      <header style={{
        background: THEME.brand, color: THEME.mint50,
        padding: 'calc(env(safe-area-inset-top) + 14px) 18px 18px 18px',
        borderBottomLeftRadius: 18, borderBottomRightRadius: 18,
        marginBottom: 18,
      }}>
        <button onClick={onBack} style={{
          background: 'rgba(255,255,255,0.1)', color: THEME.mint100,
          border: `1px solid ${THEME.mint400}`, borderRadius: 999,
          padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
          marginBottom: 12, display: 'inline-flex', alignItems: 'center', gap: 6,
        }}>
          <span style={{ fontSize: 14 }}>‹</span> {property.name}
        </button>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>
          Compare {inspections.length} inspections
        </h1>
      </header>

      <div style={{ padding: '0 16px' }}>

        {/* Inspection cards header */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: isThreeWay ? '1fr 1fr 1fr' : '1fr 1fr',
          gap: 8, marginBottom: 16,
        }}>
          {inspections.map((insp, idx) => (
            <InspectionMiniCard
              key={insp.id}
              inspection={insp}
              side={String.fromCharCode(65 + idx)}  // A, B, C
              phase={isThreeWay ? null : (idx === 0 ? phaseA : phaseB)}
            />
          ))}
        </div>

        {/* Filter chips */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
          <FilterChip active={filter === 'changed'}  onClick={() => setFilter('changed')}>Changed</FilterChip>
          <FilterChip active={filter === 'worsened'} onClick={() => setFilter('worsened')}>Worsened</FilterChip>
          <FilterChip active={filter === 'all'}      onClick={() => setFilter('all')}>All</FilterChip>
        </div>

        {/* Body */}
        {!isThreeWay && visibleTwoWay && (
          <TwoWayBody diff={visibleTwoWay} photoStore={photoStore} />
        )}
        {isThreeWay && visibleThreeWay && (
          <ThreeWayBody matrix={visibleThreeWay} photoStore={photoStore} />
        )}

        {onSharePDF && (
          <button
            onClick={handleSharePDF}
            disabled={pdfBusy}
            style={{
              background: pdfBusy ? THEME.muted2 : THEME.brand,
              color: pdfBusy ? THEME.mint100 : THEME.mint300,
              border: `1px solid ${THEME.brand}`,
              borderRadius: 12,
              padding: '14px 18px',
              fontSize: 14, fontWeight: 700,
              cursor: pdfBusy ? 'wait' : 'pointer',
              width: '100%',
              marginTop: 24,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              opacity: pdfBusy ? 0.7 : 1,
              transition: 'all 0.15s',
            }}
          >
            {pdfBusy ? '⏳ Building Report…' : '📤 Share Comparison PDF'}
          </button>
        )}

        <button onClick={onBack} style={{ ...btnSecondary, marginTop: 12 }}>
          ← Return to Property
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 2-way body — re-uses the diff engine output verbatim
// ═══════════════════════════════════════════════════════════════════════════
function TwoWayBody({ diff, photoStore }) {
  if (diff.rooms.length === 0) {
    return <EmptyResult />;
  }

  return (
    <>
      {/* Summary stats */}
      <div style={summaryRow}>
        <Stat label="Items" value={diff.summary.totalItems} />
        <Stat label="Changed" value={diff.summary.changedItems} color={THEME.warning} />
        <Stat label="Worsened" value={diff.summary.worsenedItems} color={THEME.danger} />
        <Stat label="Improved" value={diff.summary.improvedItems} color={THEME.success} />
      </div>

      {diff.rooms.map(roomDiff => (
        <RoomDiffTwoWay key={roomDiff.room.id} roomDiff={roomDiff} photoStore={photoStore} />
      ))}
    </>
  );
}

function RoomDiffTwoWay({ roomDiff, photoStore }) {
  const { room, items, notes, photos, summary } = roomDiff;
  const hasContent = items.length > 0 || notes.changed || photos.a.length > 0 || photos.b.length > 0;
  if (!hasContent) return null;

  return (
    <div style={roomCard}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 20 }}>{room.icon}</span>
        <div style={{ fontSize: 15, fontWeight: 700, color: THEME.ink }}>{room.name}</div>
        {summary.worsened > 0 && <span style={badge(THEME.danger)}>{summary.worsened} worsened</span>}
        {summary.improved > 0 && <span style={badge(THEME.success)}>{summary.improved} improved</span>}
      </div>

      {items.length > 0 && (
        <div>
          {items.map(item => <ItemRowTwoWay key={item.index} item={item} />)}
        </div>
      )}

      {notes.changed && (
        <div style={notesBox}>
          <div style={{ fontSize: 10, color: THEME.muted, textTransform: 'uppercase', fontWeight: 700, marginBottom: 6, letterSpacing: 0.5 }}>Notes</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 12 }}>
            <div>
              <div style={{ fontSize: 9, color: THEME.tenant, marginBottom: 2, fontWeight: 700, letterSpacing: 0.4 }}>A</div>
              <div style={{ color: THEME.ink }}>{notes.a || <em style={{ opacity: 0.5 }}>(none)</em>}</div>
            </div>
            <div>
              <div style={{ fontSize: 9, color: THEME.landlord, marginBottom: 2, fontWeight: 700, letterSpacing: 0.4 }}>B</div>
              <div style={{ color: THEME.ink }}>{notes.b || <em style={{ opacity: 0.5 }}>(none)</em>}</div>
            </div>
          </div>
        </div>
      )}

      {(photos.a.length > 0 || photos.b.length > 0) && (
        <PhotoPairsTwoWay photosA={photos.a} photosB={photos.b} photoStore={photoStore} />
      )}
    </div>
  );
}

function ItemRowTwoWay({ item }) {
  const meta = changeTypeMeta(item.changeType);
  const isUnchanged = item.changeType === 'unchanged';
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '1fr 70px 30px 70px',
      alignItems: 'center', padding: '8px 0', gap: 8,
      borderBottom: `1px solid ${THEME.edge}`, opacity: isUnchanged ? 0.5 : 1,
    }}>
      <div style={{ fontSize: 13, color: THEME.ink, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
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

function PhotoPairsTwoWay({ photosA, photosB, photoStore }) {
  const maxLen = Math.max(photosA.length, photosB.length);
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 10, color: THEME.muted, textTransform: 'uppercase', fontWeight: 700, marginBottom: 6, letterSpacing: 0.5 }}>
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

// ═══════════════════════════════════════════════════════════════════════════
// 3-way matrix builder
// ═══════════════════════════════════════════════════════════════════════════
function buildThreeWayMatrix(inspections) {
  const phases = inspections.map(i => activePhase(i));
  const rooms = [];

  for (const room of ROOMS) {
    const items = [];
    let anyChanged = false;
    let worsenedCount = 0;

    for (let i = 0; i < room.items.length; i++) {
      const statuses = inspections.map((insp, idx) => {
        const ph = phases[idx];
        return ph ? (insp.rooms?.[room.id]?.[ph]?.statuses?.[i] ?? null) : null;
      });
      const distinct = new Set(statuses.filter(s => s != null));
      const changed = distinct.size > 1;
      if (changed) anyChanged = true;

      // Severity progression check (earliest → latest)
      const sev = statuses.map(s => s == null ? -1 : (s === 'damaged' ? 2 : (s === 'fair' || s === 'na' ? 1 : 0)));
      const isWorsening = sev.length === 3 &&
        sev[0] !== -1 && sev[1] !== -1 && sev[2] !== -1 &&
        sev[2] > sev[0];
      if (isWorsening) worsenedCount++;

      items.push({ index: i, label: room.items[i], statuses, changed, isWorsening });
    }

    // Notes per inspection
    const notes = inspections.map((insp, idx) => {
      const ph = phases[idx];
      return ph ? (insp.rooms?.[room.id]?.[ph]?.notes || '') : '';
    });
    const anyNotes = notes.some(n => n.trim().length > 0);

    // Photos per inspection
    const photos = inspections.map((insp, idx) => {
      const ph = phases[idx];
      return ph ? (insp.rooms?.[room.id]?.[ph]?.photos || []) : [];
    });
    const anyPhotos = photos.some(p => p.length > 0);

    rooms.push({
      room, items, notes, photos,
      summary: { changed: anyChanged, worsened: worsenedCount, hasContent: anyChanged || anyNotes || anyPhotos },
    });
  }

  const totals = rooms.reduce((acc, r) => ({
    items: acc.items + r.items.length,
    changed: acc.changed + r.items.filter(i => i.changed).length,
    worsened: acc.worsened + r.summary.worsened,
  }), { items: 0, changed: 0, worsened: 0 });

  return { rooms, totals, phases };
}

function filterThreeWay(matrix, filter) {
  if (filter === 'all') return matrix;
  return {
    ...matrix,
    rooms: matrix.rooms.map(r => ({
      ...r,
      items: r.items.filter(i =>
        filter === 'worsened' ? i.isWorsening : i.changed
      ),
    })).filter(r => r.items.length > 0 || r.summary.hasContent),
  };
}

function ThreeWayBody({ matrix, photoStore }) {
  if (matrix.rooms.length === 0) return <EmptyResult />;

  return (
    <>
      <div style={summaryRow}>
        <Stat label="Items"    value={matrix.totals.items} />
        <Stat label="Changed"  value={matrix.totals.changed}  color={THEME.warning} />
        <Stat label="Worsening" value={matrix.totals.worsened} color={THEME.danger} />
      </div>

      {matrix.rooms.map(roomMatrix => (
        <RoomDiffThreeWay key={roomMatrix.room.id} roomMatrix={roomMatrix} photoStore={photoStore} />
      ))}
    </>
  );
}

function RoomDiffThreeWay({ roomMatrix, photoStore }) {
  const { room, items, notes, photos, summary } = roomMatrix;
  if (items.length === 0 && !notes.some(n => n.trim()) && !photos.some(p => p.length > 0)) return null;

  return (
    <div style={roomCard}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 20 }}>{room.icon}</span>
        <div style={{ fontSize: 15, fontWeight: 700, color: THEME.ink }}>{room.name}</div>
        {summary.worsened > 0 && <span style={badge(THEME.danger)}>{summary.worsened} worsening</span>}
      </div>

      {items.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 50px 50px 50px',
            gap: 6, padding: '4px 0', fontSize: 9,
            color: THEME.muted, textTransform: 'uppercase', fontWeight: 700,
            borderBottom: `1px solid ${THEME.edge}`, marginBottom: 4, letterSpacing: 0.4,
          }}>
            <div>Item</div>
            <div style={{ textAlign: 'center' }}>A</div>
            <div style={{ textAlign: 'center' }}>B</div>
            <div style={{ textAlign: 'center' }}>C</div>
          </div>
          {items.map(item => (
            <div key={item.index} style={{
              display: 'grid', gridTemplateColumns: '1fr 50px 50px 50px',
              alignItems: 'center', padding: '6px 0', gap: 6,
              borderBottom: `1px solid ${THEME.edge}`,
              opacity: item.changed ? 1 : 0.5,
            }}>
              <div style={{ fontSize: 12, color: THEME.ink, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {item.label}
              </div>
              {item.statuses.map((s, idx) => (
                <div key={idx} style={{ display: 'flex', justifyContent: 'center' }}>
                  <StatusBadgeMini status={s} />
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {notes.some(n => n.trim()) && (
        <div style={notesBox}>
          <div style={{ fontSize: 10, color: THEME.muted, textTransform: 'uppercase', fontWeight: 700, marginBottom: 6, letterSpacing: 0.5 }}>Notes</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, fontSize: 11 }}>
            {notes.map((n, idx) => (
              <div key={idx}>
                <div style={{ fontSize: 9, color: THEME.muted, marginBottom: 2, fontWeight: 700, letterSpacing: 0.4 }}>
                  {String.fromCharCode(65 + idx)}
                </div>
                <div style={{ color: THEME.ink }}>{n.trim() || <em style={{ opacity: 0.5 }}>(none)</em>}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {photos.some(p => p.length > 0) && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 10, color: THEME.muted, textTransform: 'uppercase', fontWeight: 700, marginBottom: 6, letterSpacing: 0.5 }}>
            Photos · {photos.map(p => p.length).join(' / ')}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4 }}>
            {photos.map((row, idx) => (
              <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {row.length === 0 ? (
                  <div style={{
                    aspectRatio: '4/3', background: THEME.surface, borderRadius: 4,
                    fontSize: 9, color: THEME.muted2, opacity: 0.5,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>—</div>
                ) : row.slice(0, 3).map((photo, i) => (
                  <PhotoTile key={i} photo={photo} photoStore={photoStore} />
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Shared UI components
// ═══════════════════════════════════════════════════════════════════════════
function InspectionMiniCard({ inspection, side, phase }) {
  const typeEntry = Object.values(INSPECTION_TYPES).find(t => t.id === inspection.type) || {};
  const sourceColor = inspection.source === 'tenant' ? THEME.tenant : THEME.landlord;
  return (
    <div style={{
      background: THEME.paper, borderRadius: 10, padding: 9,
      borderLeft: `4px solid ${sourceColor}`,
      border: `1px solid ${THEME.edge}`,
      borderLeftWidth: 4, borderLeftColor: sourceColor,
      minWidth: 0,
    }}>
      <div style={{ fontSize: 10, color: THEME.muted, textTransform: 'uppercase', fontWeight: 700, letterSpacing: 0.4 }}>
        {side} · {inspection.source === 'tenant' ? 'Tenant' : 'Landlord'}
      </div>
      <div style={{
        fontSize: 12, fontWeight: 700, color: THEME.ink, marginTop: 3,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>
        {typeEntry.icon} {inspection.label}
      </div>
      <div style={{ fontSize: 10, color: THEME.muted, marginTop: 2 }}>
        {formatDate(inspection.createdAt)}
      </div>
    </div>
  );
}

function Stat({ label, value, color }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 18, fontWeight: 700, color: color || THEME.ink }}>{value}</div>
      <div style={{ fontSize: 10, color: THEME.muted, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>{label}</div>
    </div>
  );
}

function FilterChip({ active, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      background: active ? THEME.brand : 'transparent',
      color: active ? THEME.mint50 : THEME.muted,
      border: `1px solid ${active ? THEME.brand : THEME.edge}`,
      borderRadius: 999, padding: '7px 14px', fontSize: 12, fontWeight: 600,
      cursor: 'pointer',
    }}>{children}</button>
  );
}

function StatusBadge({ status }) {
  if (!status) {
    return <div style={{ fontSize: 10, color: THEME.muted2, textAlign: 'center', opacity: 0.5 }}>—</div>;
  }
  const meta = STATUS[status];
  if (!meta) return <div style={{ fontSize: 10 }}>{status}</div>;
  return (
    <div style={{
      background: meta.bg, color: meta.fg, fontSize: 10, fontWeight: 700,
      padding: '3px 6px', borderRadius: 6, textAlign: 'center',
    }}>{meta.short}</div>
  );
}

function StatusBadgeMini({ status }) {
  if (!status) {
    return <div style={{ fontSize: 9, color: THEME.muted2, opacity: 0.4 }}>—</div>;
  }
  const meta = STATUS[status];
  if (!meta) return null;
  return (
    <div style={{
      background: meta.bg, color: meta.fg, fontSize: 9, fontWeight: 700,
      padding: '2px 4px', borderRadius: 4, textAlign: 'center',
      letterSpacing: 0.2,
    }}>{meta.short}</div>
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
      background: THEME.surface, borderRadius: 6, aspectRatio: '4/3',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 10, color: THEME.muted2, opacity: 0.4,
    }}>—</div>;
  }
  return (
    <div style={{
      background: THEME.surface, borderRadius: 6, aspectRatio: '4/3',
      overflow: 'hidden', position: 'relative',
    }}>
      {src ? (
        <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%',
          fontSize: 10, color: THEME.muted2,
        }}>loading…</div>
      )}
      {photo.ts && (
        <div style={{
          position: 'absolute', bottom: 3, left: 3,
          background: 'rgba(0,0,0,0.7)', color: '#fff', fontSize: 9,
          padding: '1px 5px', borderRadius: 3,
        }}>
          {new Date(photo.ts).toLocaleDateString()}
        </div>
      )}
    </div>
  );
}

function EmptyResult() {
  return (
    <div style={{
      padding: 30, textAlign: 'center', color: THEME.muted, fontSize: 13,
      border: `1px dashed ${THEME.edgeStrong}`, borderRadius: 12,
      background: THEME.paper,
    }}>
      No differences found with this filter.
    </div>
  );
}

// ─── Shared styles ────────────────────────────────────────────────────────
const summaryRow = {
  background: THEME.paper, borderRadius: 12, padding: 12, marginBottom: 14,
  display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(60px, 1fr))', gap: 8,
  border: `1px solid ${THEME.edge}`,
};

const roomCard = {
  background: THEME.paper, borderRadius: 12, padding: 14, marginBottom: 12,
  border: `1px solid ${THEME.edge}`,
};

const notesBox = {
  background: THEME.bg, borderRadius: 8, padding: 10, marginTop: 10,
  border: `1px solid ${THEME.edge}`,
};

const badge = (color) => ({
  background: color, color: '#fff', fontSize: 10, fontWeight: 700,
  padding: '2px 8px', borderRadius: 999, letterSpacing: 0.3,
});

const btnSecondary = {
  background: THEME.surface, color: THEME.ink,
  border: `1px solid ${THEME.edge}`, borderRadius: 12,
  padding: '14px 18px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
  width: '100%',
};
