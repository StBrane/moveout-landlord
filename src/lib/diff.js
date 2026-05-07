// ═══════════════════════════════════════════════════════════════════════════
// diff.js — inspection comparison engine
// v0.4 — adds multiwayItemMatrix for N≥3 record comparisons
// ═══════════════════════════════════════════════════════════════════════════
// Two public entry points:
//
//   diffInspections(a, b)  — pairwise diff. Each item classified as
//                            unchanged/added/removed/improved/worsened/mixed.
//                            Used by 2-way comparison PDFs.
//
//   multiwayItemMatrix(insps) — N-record table. Each row has N status columns
//                                with no cross-record classification. Highlight
//                                rows where statuses differ. Used by 3+ record
//                                comparison PDFs. Tenancy-agnostic — works
//                                across tenancies.
//
// Helpers also exported:
//   activePhase(inspection)        — auto-detect moveIn vs moveOut
//   changedItemsOnly(diff)          — filter 2-way result to changes only
//   worsenedItemsOnly(diff)         — filter 2-way result to worsening only
//   changeTypeMeta(changeType)      — UI rendering hints
//   statusMeta(statusId)            — STATUS lookup bridge
// ═══════════════════════════════════════════════════════════════════════════

import { ROOMS, STATUS } from './constants.js';

// ───────────────────────────────────────────────────────────────────────────
// Active phase detection
// ───────────────────────────────────────────────────────────────────────────
export function activePhase(inspection) {
  if (!inspection || !inspection.rooms) return null;
  let mi = 0, mo = 0;
  for (const rd of Object.values(inspection.rooms)) {
    mi += countPhaseData(rd.moveIn);
    mo += countPhaseData(rd.moveOut);
  }
  if (mi === 0 && mo === 0) return null;
  return mi >= mo ? 'moveIn' : 'moveOut';
}

function countPhaseData(phase) {
  if (!phase) return 0;
  return (
    (phase.statuses ? Object.keys(phase.statuses).length : 0) +
    (phase.notes ? (phase.notes.trim().length > 0 ? 1 : 0) : 0) +
    (phase.photos ? phase.photos.length : 0)
  );
}

// ───────────────────────────────────────────────────────────────────────────
// 2-way diff
// ───────────────────────────────────────────────────────────────────────────
export function diffInspections(a, b, opts = {}) {
  const phaseA = opts.phaseA || activePhase(a);
  const phaseB = opts.phaseB || activePhase(b);

  const roomResults = [];
  let total = 0, changed = 0, worsened = 0, improved = 0;
  let photosA = 0, photosB = 0;

  for (const roomDef of ROOMS) {
    const rA = a?.rooms?.[roomDef.id];
    const rB = b?.rooms?.[roomDef.id];
    const phA = phaseA && rA ? rA[phaseA] : null;
    const phB = phaseB && rB ? rB[phaseB] : null;

    const itemResults = [];
    let rUnchanged = 0, rAdded = 0, rRemoved = 0, rImproved = 0, rWorsened = 0;

    for (let i = 0; i < roomDef.items.length; i++) {
      const sA = phA?.statuses?.[i] ?? null;
      const sB = phB?.statuses?.[i] ?? null;
      const changeType = classifyChange(sA, sB);

      itemResults.push({
        index: i,
        label: roomDef.items[i],
        a: { status: sA, present: sA != null },
        b: { status: sB, present: sB != null },
        changeType,
      });

      total++;
      if (changeType === 'unchanged') rUnchanged++;
      else {
        changed++;
        if (changeType === 'added') rAdded++;
        else if (changeType === 'removed') rRemoved++;
        else if (changeType === 'improved') { rImproved++; improved++; }
        else if (changeType === 'worsened') { rWorsened++; worsened++; }
      }
    }

    const notesA = phA?.notes || '';
    const notesB = phB?.notes || '';
    const notesChanged = notesA.trim() !== notesB.trim();

    const photoListA = phA?.photos || [];
    const photoListB = phB?.photos || [];
    photosA += photoListA.length;
    photosB += photoListB.length;

    roomResults.push({
      room: roomDef,
      items: itemResults,
      notes: { a: notesA, b: notesB, changed: notesChanged },
      photos: { a: photoListA, b: photoListB },
      summary: {
        total: roomDef.items.length,
        unchanged: rUnchanged,
        added: rAdded,
        removed: rRemoved,
        improved: rImproved,
        worsened: rWorsened,
      },
    });
  }

  return {
    rooms: roomResults,
    summary: {
      totalItems: total,
      changedItems: changed,
      worsenedItems: worsened,
      improvedItems: improved,
      photosA,
      photosB,
      phaseA,
      phaseB,
    },
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Severity ordering — higher = worse
// ───────────────────────────────────────────────────────────────────────────
const STATUS_SEVERITY = {
  clean:   0,
  fair:    1,
  na:      1,  // N/A treated as neutral mid-level
  damaged: 2,
};

function classifyChange(a, b) {
  if (a == null && b == null) return 'unchanged';
  if (a == null && b != null) return 'added';
  if (a != null && b == null) return 'removed';
  if (a === b) return 'unchanged';
  const sevA = STATUS_SEVERITY[a] ?? 0;
  const sevB = STATUS_SEVERITY[b] ?? 0;
  if (sevB > sevA) return 'worsened';
  if (sevB < sevA) return 'improved';
  return 'mixed';
}

// ───────────────────────────────────────────────────────────────────────────
// N-record matrix — for 3+ comparisons
// ───────────────────────────────────────────────────────────────────────────
// Returns a per-room, per-item table with one status column per inspection.
// No cross-record classification — caller decides how to render. Each item
// row carries:
//   - statuses: array of N status values (null if unrated in that record)
//   - anyDiffer: true if any two non-null values disagree (e.g. clean vs damaged)
//   - anyDamaged: true if any value === 'damaged'
//   - allUnrated: true if every value is null (item skipped from output)
//   - hasAnyContent: true if any value is non-null
//
// Used by comparisonPDF.js for N=3-7 records. N=8+ falls through to the
// bundle-only path (per-item matrix gets unreadable past ~7 columns).
//
// Tenancy-agnostic: reads each inspection independently. Cross-tenancy
// comparisons work the same as same-tenancy.
// ───────────────────────────────────────────────────────────────────────────
export function multiwayItemMatrix(inspections, opts = {}) {
  if (!Array.isArray(inspections) || inspections.length < 2) {
    return { rooms: [], inspections: [], summary: { totalItems: 0, anyDifferCount: 0, anyDamagedCount: 0 } };
  }

  const phases = inspections.map((insp, i) => opts.phases?.[i] || activePhase(insp));
  const inspMeta = inspections.map((insp, i) => ({
    label: insp.label || `Inspection ${i + 1}`,
    sideLabel: String.fromCharCode(65 + i),  // A, B, C, ...
    source: insp.source || 'landlord',
    phase: phases[i],
  }));

  const roomResults = [];
  let totalItems = 0, anyDifferCount = 0, anyDamagedCount = 0;

  for (const roomDef of ROOMS) {
    const itemResults = [];
    let roomHasContent = false;

    for (let i = 0; i < roomDef.items.length; i++) {
      const statuses = inspections.map((insp, idx) => {
        const phase = phases[idx];
        if (!phase) return null;
        return insp?.rooms?.[roomDef.id]?.[phase]?.statuses?.[i] ?? null;
      });

      const nonNull = statuses.filter(s => s != null);
      const allUnrated = nonNull.length === 0;
      if (allUnrated) continue;  // skip items nobody rated

      // anyDiffer: are there at least two non-null values that disagree?
      let anyDiffer = false;
      if (nonNull.length >= 2) {
        const first = nonNull[0];
        anyDiffer = nonNull.some(s => s !== first);
      }
      const anyDamaged = nonNull.includes('damaged');

      itemResults.push({
        index: i,
        label: roomDef.items[i],
        statuses,
        anyDiffer,
        anyDamaged,
        allUnrated: false,
        hasAnyContent: true,
      });

      totalItems++;
      if (anyDiffer) anyDifferCount++;
      if (anyDamaged) anyDamagedCount++;
      roomHasContent = true;
    }

    // Notes per inspection for this room
    const notes = inspections.map((insp, idx) => {
      const phase = phases[idx];
      if (!phase) return '';
      return (insp?.rooms?.[roomDef.id]?.[phase]?.notes || '').trim();
    });
    const anyNotes = notes.some(n => n.length > 0);

    roomResults.push({
      room: roomDef,
      items: itemResults,
      notes,
      anyNotes,
      hasAnyContent: roomHasContent || anyNotes,
    });
  }

  return {
    rooms: roomResults,
    inspections: inspMeta,
    summary: { totalItems, anyDifferCount, anyDamagedCount },
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Filter helpers for 2-way diff
// ───────────────────────────────────────────────────────────────────────────
export function changedItemsOnly(diff) {
  return {
    ...diff,
    rooms: diff.rooms
      .map(r => ({
        ...r,
        items: r.items.filter(i => i.changeType !== 'unchanged'),
      }))
      .filter(r => r.items.length > 0 || r.notes.changed || r.photos.a.length > 0 || r.photos.b.length > 0),
  };
}

export function worsenedItemsOnly(diff) {
  return {
    ...diff,
    rooms: diff.rooms
      .map(r => ({
        ...r,
        items: r.items.filter(i => i.changeType === 'worsened' || i.changeType === 'added'),
      }))
      .filter(r => r.items.length > 0),
  };
}

// ───────────────────────────────────────────────────────────────────────────
// UI rendering helpers
// ───────────────────────────────────────────────────────────────────────────
export function changeTypeMeta(changeType) {
  switch (changeType) {
    case 'unchanged': return { label: 'No change',       color: '#64748B', icon: '-' };
    case 'added':     return { label: 'Newly rated',     color: '#3B82F6', icon: '+' };
    case 'removed':   return { label: 'No longer rated', color: '#64748B', icon: '-' };
    case 'improved':  return { label: 'Improved',        color: '#10B981', icon: 'up' };
    case 'worsened':  return { label: 'Worsened',        color: '#EF4444', icon: 'dn' };
    case 'mixed':     return { label: 'Changed',         color: '#F59E0B', icon: '!' };
    default:          return { label: changeType,        color: '#94A3B8', icon: '?' };
  }
}

export function statusMeta(statusId) {
  return STATUS[statusId] || null;
}
