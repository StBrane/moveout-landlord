// ═══════════════════════════════════════════════════════════════════════════
// diff.js — inspection comparison engine
// ═══════════════════════════════════════════════════════════════════════════
// Given two inspections A and B (in any combination of landlord/tenant,
// move-in/move-out), compute a structured diff that the Changes view can
// render. Handles all four comparison modes from the synopsis:
//
//   1. Landlord baseline vs. tenant move-in
//   2. Landlord baseline vs. landlord post-tenant
//   3. Tenant move-in vs. tenant move-out
//   4. Landlord post-tenant vs. tenant move-out
//
// The engine doesn't care which side is "before" — caller labels them.
// Convention throughout this module: A is the "before" (earlier) inspection,
// B is the "after" (later) inspection.
//
// Each inspection stores data in rooms[roomId].{moveIn|moveOut}. Because
// imported tenant bundles are split by phase at import time, a tenant_move_in
// inspection has its data in the moveIn slot (and moveOut is empty), and a
// tenant_move_out has data in moveOut (moveIn empty). Landlord inspections
// typically use the moveIn slot as the "single phase" for that inspection type.
//
// For compare purposes we resolve each inspection's active phase automatically.
// ═══════════════════════════════════════════════════════════════════════════

import { ROOMS, STATUS } from './constants.js';

// ───────────────────────────────────────────────────────────────────────────
// Decide which phase of the inspection object holds real data.
// Returns 'moveIn' | 'moveOut' | null.
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
// Main diff function.
//
// Returns:
//   {
//     rooms: [
//       {
//         room: { id, name, icon, items },
//         items: [
//           {
//             index, label,
//             a: { status, present },
//             b: { status, present },
//             changeType: 'unchanged' | 'added' | 'removed' | 'improved' | 'worsened' | 'mixed'
//           },
//           ...
//         ],
//         notes: { a, b, changed },
//         photos: { a: [...], b: [...] },  // photo metadata for side-by-side render
//         summary: { total, unchanged, added, removed, improved, worsened }
//       },
//       ...
//     ],
//     summary: { totalItems, changedItems, worsenedItems, improvedItems, photosA, photosB }
//   }
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
// Severity ordering for status transitions. Higher = worse.
// ───────────────────────────────────────────────────────────────────────────
const STATUS_SEVERITY = {
  clean:   0,
  fair:    1,
  na:      1,  // N/A treated as neutral mid-level
  damaged: 2,
};

function classifyChange(a, b) {
  if (a == null && b == null) return 'unchanged';
  if (a == null && b != null) return 'added';      // B rated it, A didn't
  if (a != null && b == null) return 'removed';    // A rated it, B didn't
  if (a === b) return 'unchanged';
  const sevA = STATUS_SEVERITY[a] ?? 0;
  const sevB = STATUS_SEVERITY[b] ?? 0;
  if (sevB > sevA) return 'worsened';
  if (sevB < sevA) return 'improved';
  return 'mixed';  // same severity, different status (e.g. fair ↔ na)
}

// ───────────────────────────────────────────────────────────────────────────
// Filter helpers for rendering — narrow the diff to just changes.
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
// Helpers for UI rendering
// ───────────────────────────────────────────────────────────────────────────
export function changeTypeMeta(changeType) {
  switch (changeType) {
    case 'unchanged': return { label: 'No change',       color: '#64748B', icon: '—' };
    case 'added':     return { label: 'Newly rated',     color: '#3B82F6', icon: '+' };
    case 'removed':   return { label: 'No longer rated', color: '#64748B', icon: '−' };
    case 'improved':  return { label: 'Improved',        color: '#10B981', icon: '↑' };
    case 'worsened':  return { label: 'Worsened',        color: '#EF4444', icon: '↓' };
    case 'mixed':     return { label: 'Changed',         color: '#F59E0B', icon: '≠' };
    default:          return { label: changeType,        color: '#94A3B8', icon: '?' };
  }
}

export function statusMeta(statusId) {
  return STATUS[statusId] || null;
}
