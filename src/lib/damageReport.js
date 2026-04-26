// ═══════════════════════════════════════════════════════════════════════════
// damageReport.js — per-tenancy evidence synthesis engine
// ═══════════════════════════════════════════════════════════════════════════
//
// THE PROBLEM
//   Each tenancy may have up to 5 records of the unit's condition:
//
//     1. Landlord Baseline       (start of tenancy, landlord-captured)
//     2. Tenant Move-In          (start of tenancy, imported from .mosinsp)
//     3. Landlord Post-tenant    (end of tenancy, landlord-captured)
//     4. Tenant Move-Out         (end of tenancy, imported from .mosinsp)
//     5. Preceding Turnover      (between previous and current tenancy,
//                                 landlord-captured — establishes
//                                 "this is the condition I gave you")
//
//   For each (room, item) cell, the records collectively tell a story.
//   The synthesis engine reads all five sources and classifies each item
//   into an evidence tier so the landlord knows which deductions are
//   bulletproof and which are circumstantial.
//
// THE TIERS
//
//   BULLETPROOF
//     Both parties agree on the change AND photos from both parties exist.
//     E.g. landlord baseline status=clean + landlord post-tenant status=damaged
//     + tenant move-out status=damaged + photos from both parties showing
//     the damaged item, taken within 72 hours of each other.
//     Strongest possible evidence — court-ready.
//
//   STRONG_CORROBORATED
//     Status records DISAGREE between parties, but photos from both parties
//     exist for the item, taken within 72 hours of each other, showing the
//     same physical thing. The photos resolve the dispute — the photo is the
//     evidence, the status label is just a subjective claim. The party who
//     reported "more severe" damage usually wins because severity is hard to
//     undercount but easy to over-count when nobody's looking.
//
//   STRONG_ONE_PARTY
//     Only one party has records (e.g. landlord baseline + landlord
//     post-tenant, but no tenant records). Internally consistent —
//     same party shows clean→damaged with photos at both ends.
//     Holds up unless tenant produces counter-evidence in dispute.
//
//   STRONG_STATUS_AGREEMENT
//     Both parties' status labels agree on the change but neither (or only
//     one) photographed it. Status agreement alone is solid — two people
//     independently said the same thing — but without a photo, the deduction
//     is contestable in a way that BULLETPROOF isn't.
//
//   TENANT_ONLY_EVIDENCE
//     Landlord didn't inspect this room/item (skipped during walkthrough)
//     but tenant's own move-in vs move-out shows damage. The tenant's own
//     admission via their bundle is high-value evidence — they can't easily
//     repudiate it. Badged separately so the landlord knows what kind of
//     claim they're making.
//
//   DISPUTED
//     Genuine conflict — status records disagree AND photos don't help
//     (one party didn't photograph it, photos taken weeks apart, etc.).
//     Landlord can pursue but tenant has a real argument.
//
//   NO_EVIDENCE_OF_CHANGE
//     Records don't show damage. Either status was unchanged or unrated.
//     Skipped from the report (no actionable claim).
//
// PHOTO TIMELINE WINDOW
//   72 hours is the corroboration window. Move-in/move-out events and
//   landlord baseline/post-tenant are usually same-day or next-day. 72h
//   accommodates landlord doing post-tenant the day after key handover,
//   weekend cleanup, or timezone fuzz on EXIF timestamps.
//
// SEVERITY SCALE
//   For determining "the change" between two records:
//     0 = clean
//     1 = fair, na  (na is treated as 1 because it usually means "not
//                    something I can rate" rather than "perfect" — safer
//                    to treat as middling than to treat as unchanged)
//     2 = damaged
//     -1 = no record (item not rated)
//
//   "Worsening" means severity strictly increased from start to end.
//
// PUBLIC API
//
//   buildDamageReport(property, tenancy, options) →
//     {
//       evidenceMap: { records, tier, missing },
//       items: [
//         { roomId, roomName, itemIndex, itemLabel,
//           tier, change, parties: {...},
//           photos: [...], notes: [...],
//           details: '...' }
//       ],
//       summary: { itemCount, byTier: {...}, evidenceTier },
//     }
//
// ═══════════════════════════════════════════════════════════════════════════

import { ROOMS, STATUS } from './constants.js';

// ─── Constants ─────────────────────────────────────────────────────────────
const PHOTO_CORROBORATION_WINDOW_MS = 72 * 60 * 60 * 1000;  // 72 hours

// Map status keys to severity. Higher = worse.
const SEVERITY = { clean: 0, fair: 1, na: 1, damaged: 2 };
const sev = (s) => (s == null ? -1 : (SEVERITY[s] ?? -1));

// Tier labels — exported so the UI can render them consistently
export const TIERS = {
  BULLETPROOF:             'BULLETPROOF',
  STRONG_CORROBORATED:     'STRONG_CORROBORATED',
  STRONG_ONE_PARTY:        'STRONG_ONE_PARTY',
  STRONG_STATUS_AGREEMENT: 'STRONG_STATUS_AGREEMENT',
  TENANT_ONLY_EVIDENCE:    'TENANT_ONLY_EVIDENCE',
  DISPUTED:                'DISPUTED',
  NO_EVIDENCE_OF_CHANGE:   'NO_EVIDENCE_OF_CHANGE',
};

// Tier metadata for UI rendering
export const TIER_META = {
  BULLETPROOF:             { label: 'Bulletproof',          rank: 0, color: '#065F46', desc: 'Both parties + photos, court-ready' },
  STRONG_CORROBORATED:     { label: 'Strong (corroborated)',rank: 1, color: '#2D6A4F', desc: 'Photos from both parties resolve any status conflict' },
  STRONG_ONE_PARTY:        { label: 'Strong (one party)',   rank: 2, color: '#2D6A4F', desc: 'Internally consistent records from one party' },
  STRONG_STATUS_AGREEMENT: { label: 'Strong (agreement)',   rank: 3, color: '#1B3A2D', desc: 'Both parties said the same thing, no photo' },
  TENANT_ONLY_EVIDENCE:    { label: 'Tenant-only evidence', rank: 4, color: '#7C3AED', desc: 'Tenant\'s own records show the change — landlord didn\'t inspect' },
  DISPUTED:                { label: 'Disputed',             rank: 5, color: '#D97706', desc: 'Status conflict with no photo timeline help' },
  NO_EVIDENCE_OF_CHANGE:   { label: 'No change',            rank: 6, color: '#A8A29E', desc: 'Records don\'t show damage' },
};

// Evidence tier (for the report as a whole — separate from per-item tier)
// Tells the landlord at a glance how complete their evidence picture is.
export const EVIDENCE_TIERS = {
  4: { stars: '★★★★', label: 'Complete (all 4 records present)' },
  3: { stars: '★★★☆', label: 'Strong (3 of 4 records present)' },
  2: { stars: '★★☆☆', label: 'Limited (2 of 4 records present)' },
  1: { stars: '★☆☆☆', label: 'Minimal (1 of 4 records present)' },
  0: { stars: '☆☆☆☆', label: 'No records available' },
};

// ─── Record extraction ─────────────────────────────────────────────────────
//
// Pulls the four canonical records out of a tenancy + property. Each record
// is normalized to:
//
//   { kind, source, inspection, slot }
//
// where slot is 'moveIn' or 'moveOut' — the slot in `inspection.rooms[id]`
// that holds this record's data. Returns null for absent records.
// ────────────────────────────────────────────────────────────────────────────
function extractRecords(property, tenancy) {
  const records = {
    landlordBaseline:   null,   // L_BASELINE — landlord's start record
    tenantMoveIn:       null,   // T_MOVEIN   — tenant's start record
    landlordPostTenant: null,   // L_POST     — landlord's end record
    tenantMoveOut:      null,   // T_MOVEOUT  — tenant's end record
    precedingTurnover:  null,   // T_PRIOR    — landlord's "this is what I gave you" record
  };

  if (!tenancy) return records;

  for (const insp of tenancy.inspections || []) {
    if (insp.type === 'baseline' && !records.landlordBaseline) {
      records.landlordBaseline = { kind: 'landlordBaseline', inspection: insp, slot: 'moveIn' };
    } else if (insp.type === 'tenant_move_in' && !records.tenantMoveIn) {
      records.tenantMoveIn = { kind: 'tenantMoveIn', inspection: insp, slot: 'moveIn' };
    } else if (insp.type === 'post_tenant' && !records.landlordPostTenant) {
      records.landlordPostTenant = { kind: 'landlordPostTenant', inspection: insp, slot: 'moveOut' };
    } else if (insp.type === 'tenant_move_out' && !records.tenantMoveOut) {
      records.tenantMoveOut = { kind: 'tenantMoveOut', inspection: insp, slot: 'moveOut' };
    }
  }

  // Find preceding turnover — most recent turnover whose date is before
  // the tenancy's start date. Strong "this is the condition I handed over"
  // record. Optional context, used when present.
  if (property?.betweenInspections?.length && tenancy.startDate) {
    const tenancyStartMs = new Date(tenancy.startDate).getTime();
    const turnovers = property.betweenInspections
      .filter(i => i.type === 'turnover')
      .filter(i => new Date(i.createdAt).getTime() < tenancyStartMs)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));   // newest first
    if (turnovers[0]) {
      records.precedingTurnover = {
        kind: 'precedingTurnover', inspection: turnovers[0], slot: 'moveOut'
      };
    }
  }

  return records;
}

// Returns count of the 4 canonical records (turnover not counted — it's bonus)
function countCanonical(records) {
  let n = 0;
  if (records.landlordBaseline)   n++;
  if (records.tenantMoveIn)       n++;
  if (records.landlordPostTenant) n++;
  if (records.tenantMoveOut)      n++;
  return n;
}

// ─── Per-item synthesis ─────────────────────────────────────────────────────
//
// For one (room, itemIndex) cell across all 5 records: read each party's
// status, collect each party's photos (filtered to the relevant room/slot
// combination — photos are room-level, not per-item, so all of them count
// as evidence for any item in that room), pull notes for context.
//
// Returns a normalized "parties" object that the tier classifier reads.
// ────────────────────────────────────────────────────────────────────────────
function readPartyData(record, roomId, itemIndex) {
  if (!record) return null;
  const phaseData = record.inspection.rooms?.[roomId]?.[record.slot];
  if (!phaseData) return null;

  const status = phaseData.statuses?.[itemIndex] ?? null;
  const photos = (phaseData.photos || []).map(p => ({
    ...p,
    sourceKind: record.kind,
    sourceInspectionId: record.inspection.id,
    // Normalize timestamp — photos may have ts in two formats:
    //   ISO string (fresh capture)
    //   Display-formatted ("Jan 5, 12:30 PM") — needs parsing
    tsMs: parsePhotoTimestamp(p.ts, record.inspection.createdAt),
  }));
  const notes = (phaseData.notes || '').trim();

  return { status, photos, notes };
}

// Parse a photo timestamp string into ms. Falls back to inspection createdAt.
function parsePhotoTimestamp(tsString, fallbackIso) {
  if (!tsString) return new Date(fallbackIso || 0).getTime();
  // ISO-ish (contains hyphens and "T")
  if (/^\d{4}-\d{2}-\d{2}T/.test(tsString)) {
    return new Date(tsString).getTime();
  }
  // Display format like "Jan 5, 12:30 PM" — assume current year for parsing
  const parsed = Date.parse(tsString);
  if (!isNaN(parsed)) return parsed;
  // Couldn't parse — fall back to inspection date
  return new Date(fallbackIso || 0).getTime();
}

// ─── Tier classification ────────────────────────────────────────────────────
//
// The heart of the engine. Given a per-item snapshot across all parties,
// decide what tier this item lands in. Returns { tier, change, details }.
// ────────────────────────────────────────────────────────────────────────────
function classifyItem(parties, options = {}) {
  const window = options.windowMs ?? PHOTO_CORROBORATION_WINDOW_MS;

  // Quick handles
  const lBase  = parties.landlordBaseline;
  const tIn    = parties.tenantMoveIn;
  const lPost  = parties.landlordPostTenant;
  const tOut   = parties.tenantMoveOut;
  const turnover = parties.precedingTurnover;

  // ── Determine the "starting condition" and "ending condition" ─────────
  // Starting: prefer landlord baseline; fall back to tenant move-in;
  //           fall back to preceding turnover (still "this is what tenant got")
  // Ending:   prefer landlord post-tenant; fall back to tenant move-out
  const startStatus = lBase?.status ?? tIn?.status ?? turnover?.status ?? null;
  const endStatus   = lPost?.status ?? tOut?.status ?? null;
  const startSev = sev(startStatus);
  const endSev   = sev(endStatus);

  // ── Did anything actually change? ─────────────────────────────────────
  // If both ends are unrated, no actionable claim.
  if (startSev === -1 && endSev === -1) {
    return { tier: TIERS.NO_EVIDENCE_OF_CHANGE, change: null, details: 'No records.' };
  }

  // If we have an end status but no start, treat as unrated start.
  // We still need to know whether to flag — only flag if end is "damaged".
  if (startSev === -1) {
    if (endSev < 2) return { tier: TIERS.NO_EVIDENCE_OF_CHANGE, change: null, details: 'No starting record; not damaged at end.' };
    // End is damaged but no start — without a starting record, we can't
    // claim the tenant caused it. Could be pre-existing.
    return {
      tier: TIERS.DISPUTED,
      change: { from: null, to: endStatus },
      details: 'Damaged at end but no starting condition recorded — landlord cannot prove pre-existing vs caused.',
    };
  }

  if (endSev === -1) {
    return { tier: TIERS.NO_EVIDENCE_OF_CHANGE, change: null, details: 'No ending record.' };
  }

  // Severity didn't increase — no damage to claim
  if (endSev <= startSev) {
    return { tier: TIERS.NO_EVIDENCE_OF_CHANGE, change: null, details: 'No worsening.' };
  }

  const change = { from: startStatus, to: endStatus };

  // ── There IS worsening. Now classify by evidence quality. ──────────────

  // What records are available with status data?
  const haveLBase = lBase?.status != null;
  const haveTIn   = tIn?.status   != null;
  const haveLPost = lPost?.status != null;
  const haveTOut  = tOut?.status  != null;

  // What landlord records have photos for this room/item?
  const lPhotos = [
    ...(lBase?.photos  || []),
    ...(lPost?.photos  || []),
  ];
  const tPhotos = [
    ...(tIn?.photos   || []),
    ...(tOut?.photos  || []),
  ];
  const haveLPhotos = lPhotos.length > 0;
  const haveTPhotos = tPhotos.length > 0;

  // Do landlord and tenant photos overlap within the corroboration window?
  // Used by STRONG_CORROBORATED tier — even if status labels disagree,
  // photos within 72h are treated as the same physical observation.
  const photosOverlap = haveLPhotos && haveTPhotos && photosOverlapWindow(lPhotos, tPhotos, window);

  // ── TENANT-ONLY-EVIDENCE: landlord didn't inspect, tenant did ─────────
  // The landlord skipped this item entirely (no baseline, no post-tenant
  // status). Tenant's own move-in vs move-out shows damage.
  const landlordSkipped = !haveLBase && !haveLPost;
  const tenantInternallyShows =
    haveTIn && haveTOut && sev(tOut.status) > sev(tIn.status);
  if (landlordSkipped && tenantInternallyShows) {
    return {
      tier: TIERS.TENANT_ONLY_EVIDENCE,
      change,
      details: 'Landlord did not inspect this item; tenant\'s own records (move-in vs move-out) show the change.',
    };
  }

  // ── BULLETPROOF: full agreement + photos from both parties + corroborated ──
  // Both parties have status records that agree on the worsening direction,
  // both parties have photos, and photos fall within the corroboration window.
  const startAgrees = (haveLBase && haveTIn) ? sev(lBase.status) === sev(tIn.status) : true;
  const endAgrees = (haveLPost && haveTOut) ? sev(lPost.status) === sev(tOut.status) : true;
  const bothEndsHaveBothParties = haveLBase && haveTIn && haveLPost && haveTOut;
  if (bothEndsHaveBothParties && startAgrees && endAgrees && haveLPhotos && haveTPhotos && photosOverlap) {
    return {
      tier: TIERS.BULLETPROOF,
      change,
      details: 'Both parties agree at start and end. Photos from both within 72h.',
    };
  }

  // ── STRONG_CORROBORATED: status disagrees but photos overlap ──────────
  // The photos are the actual evidence. Even if labels disagree, two photos
  // taken within 72h of each other showing the same physical thing settle it.
  const statusDisagrees = (!startAgrees) || (!endAgrees);
  if (statusDisagrees && haveLPhotos && haveTPhotos && photosOverlap) {
    return {
      tier: TIERS.STRONG_CORROBORATED,
      change,
      details: 'Status labels differ between parties, but photos from both within 72h corroborate the condition.',
    };
  }

  // ── STRONG_STATUS_AGREEMENT: both agree on labels, photos missing/incomplete ──
  // E.g. both parties have status records with matching ends, but photos
  // are missing or only one side photographed it.
  if (bothEndsHaveBothParties && startAgrees && endAgrees) {
    return {
      tier: TIERS.STRONG_STATUS_AGREEMENT,
      change,
      details: 'Both parties\' status records agree, but photo backing is incomplete.',
    };
  }

  // ── STRONG_ONE_PARTY: only one party has records, internally consistent ──
  // Most often: landlord baseline + landlord post-tenant only. No tenant
  // records to corroborate or contradict.
  const onlyLandlordRecords = (haveLBase || haveLPost) && !haveTIn && !haveTOut;
  const onlyTenantRecords   = !haveLBase && !haveLPost && (haveTIn || haveTOut);
  if (onlyLandlordRecords) {
    if (haveLPhotos) {
      return {
        tier: TIERS.STRONG_ONE_PARTY,
        change,
        details: 'Only landlord records (no tenant evidence). Photographed.',
      };
    }
    return {
      tier: TIERS.STRONG_ONE_PARTY,
      change,
      details: 'Only landlord records (no tenant evidence). No photo backing.',
    };
  }
  if (onlyTenantRecords) {
    return {
      tier: TIERS.TENANT_ONLY_EVIDENCE,
      change,
      details: 'Only tenant records (landlord did not inspect this item).',
    };
  }

  // ── DISPUTED: genuine conflict ─────────────────────────────────────────
  // Status records exist on both sides but disagree, AND photos don't
  // resolve it (no overlap window, or one side missing photos).
  return {
    tier: TIERS.DISPUTED,
    change,
    details: 'Parties\' status records conflict and photo timeline doesn\'t corroborate.',
  };
}

// ─── Photo overlap check ────────────────────────────────────────────────────
// Returns true if any landlord photo and any tenant photo were taken within
// `windowMs` of each other. We just need ONE pair within window — that's
// enough for "yes, both parties photographed this in the same time period."
// ────────────────────────────────────────────────────────────────────────────
function photosOverlapWindow(lPhotos, tPhotos, windowMs) {
  for (const lp of lPhotos) {
    if (!lp.tsMs) continue;
    for (const tp of tPhotos) {
      if (!tp.tsMs) continue;
      if (Math.abs(lp.tsMs - tp.tsMs) <= windowMs) return true;
    }
  }
  return false;
}

// ─── Public: build a damage report for a tenancy ────────────────────────────
export function buildDamageReport(property, tenancy, options = {}) {
  const records = extractRecords(property, tenancy);
  const evidenceCount = countCanonical(records);
  const evidenceTier = EVIDENCE_TIERS[evidenceCount] || EVIDENCE_TIERS[0];

  // For each room/item, read each party's data and classify
  const items = [];
  for (const room of ROOMS) {
    for (let itemIndex = 0; itemIndex < room.items.length; itemIndex++) {
      const parties = {
        landlordBaseline:   readPartyData(records.landlordBaseline,   room.id, itemIndex),
        tenantMoveIn:       readPartyData(records.tenantMoveIn,       room.id, itemIndex),
        landlordPostTenant: readPartyData(records.landlordPostTenant, room.id, itemIndex),
        tenantMoveOut:      readPartyData(records.tenantMoveOut,      room.id, itemIndex),
        precedingTurnover:  readPartyData(records.precedingTurnover,  room.id, itemIndex),
      };

      const classification = classifyItem(parties, options);

      // Only include items that surface a claim — skip NO_EVIDENCE_OF_CHANGE
      if (classification.tier === TIERS.NO_EVIDENCE_OF_CHANGE) continue;

      // Collect all photos for this item (room-level, all parties)
      const photos = [
        ...(parties.landlordBaseline?.photos   || []),
        ...(parties.tenantMoveIn?.photos       || []),
        ...(parties.landlordPostTenant?.photos || []),
        ...(parties.tenantMoveOut?.photos      || []),
        ...(parties.precedingTurnover?.photos  || []),
      ];

      // Collect all notes for this item (notes are room-level, attribute by source)
      const notes = [];
      for (const partyKey of ['landlordBaseline', 'tenantMoveIn', 'landlordPostTenant', 'tenantMoveOut', 'precedingTurnover']) {
        const p = parties[partyKey];
        if (p?.notes) notes.push({ source: partyKey, text: p.notes });
      }

      items.push({
        roomId: room.id,
        roomName: room.name,
        roomIcon: room.icon,
        itemIndex,
        itemLabel: room.items[itemIndex],
        tier: classification.tier,
        change: classification.change,
        details: classification.details,
        parties,
        photos,
        notes,
      });
    }
  }

  // Sort items by tier rank then room order
  items.sort((a, b) => {
    const aRank = TIER_META[a.tier]?.rank ?? 99;
    const bRank = TIER_META[b.tier]?.rank ?? 99;
    if (aRank !== bRank) return aRank - bRank;
    // Within tier, by room then item index
    const aRoom = ROOMS.findIndex(r => r.id === a.roomId);
    const bRoom = ROOMS.findIndex(r => r.id === b.roomId);
    if (aRoom !== bRoom) return aRoom - bRoom;
    return a.itemIndex - b.itemIndex;
  });

  // Per-tier counts for the summary
  const byTier = {};
  for (const tierKey of Object.values(TIERS)) byTier[tierKey] = 0;
  for (const item of items) byTier[item.tier]++;

  return {
    records,
    evidenceCount,
    evidenceTier,
    items,
    summary: {
      itemCount: items.length,
      byTier,
      hasTurnover: !!records.precedingTurnover,
    },
  };
}

// ─── Public: filter a report's items by tier ────────────────────────────────
export function filterReportByTier(report, tierKeys) {
  const allowed = new Set(tierKeys);
  return {
    ...report,
    items: report.items.filter(i => allowed.has(i.tier)),
  };
}

// ─── Public: get only the actionable (non-disputed) tiers ───────────────────
export const ACTIONABLE_TIERS = [
  TIERS.BULLETPROOF,
  TIERS.STRONG_CORROBORATED,
  TIERS.STRONG_ONE_PARTY,
  TIERS.STRONG_STATUS_AGREEMENT,
  TIERS.TENANT_ONLY_EVIDENCE,
];

export const REVIEW_TIERS = [
  TIERS.DISPUTED,
];
