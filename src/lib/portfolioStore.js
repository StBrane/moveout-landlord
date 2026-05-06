// ═══════════════════════════════════════════════════════════════════════════
// portfolioStore.js — local persistence for properties, tenancies, inspections
// ═══════════════════════════════════════════════════════════════════════════
// v0.3 schema: properties hold tenancies, tenancies hold most inspections.
// Turnover, Property reference photos, and ad-hoc property-level Others
// live on the property itself (between tenancies, no tenancy assignment).
// Properties also hold attachedPdfs[] — external PDFs (receipts, invoices,
// tenant-side reports) brought in via the file picker for bundling at PDF
// generation time.
//
// On-disk shape (STORAGE_KEY_PORTFOLIO):
//   {
//     version: 2,
//     properties: [
//       {
//         id, name, address, stateIdx, createdAt,
//         tenancies: [
//           { id, tenants[], rent, deposit, startDate, endDate, inspections[] },
//           ...
//         ],
//         betweenInspections: [ /* turnover + property reference + property-level Others */ ],
//         attachedPdfs: [ /* { id, fileName, path, importedAt, label?, pageCount? } */ ]
//       }
//     ]
//   }
//
// inspection shape (unchanged from v0.2):
//   {
//     id, propertyId, tenancyId?, type, label, source, editable,
//     createdAt, importedAt?, sourceBundleId?, sourceBundleHash?,
//     tenantAppVersion?, stateIdx,
//     rooms: { [roomId]: { moveIn: phase, moveOut: phase } }
//   }
// ═══════════════════════════════════════════════════════════════════════════

import {
  STORAGE_KEY_PORTFOLIO, PORTFOLIO_SCHEMA_VERSION,
  uid, blankRooms, INSPECTION_TYPES, inspectionTypeById,
  inspectionMetrics, formatTenancySpan,
} from './constants.js';

// ───────────────────────────────────────────────────────────────────────────
// Load / save
// ───────────────────────────────────────────────────────────────────────────
export function loadPortfolio() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PORTFOLIO);
    if (!raw) return emptyPortfolio();
    const parsed = JSON.parse(raw);
    if (parsed.version !== PORTFOLIO_SCHEMA_VERSION) {
      console.warn(`Portfolio schema mismatch (stored=${parsed.version}, app=${PORTFOLIO_SCHEMA_VERSION}). Starting fresh.`);
      return emptyPortfolio();
    }
    return parsed;
  } catch (e) {
    console.error('Failed to load portfolio:', e);
    return emptyPortfolio();
  }
}

export function savePortfolio(portfolio) {
  try {
    const payload = { ...portfolio, version: PORTFOLIO_SCHEMA_VERSION };
    localStorage.setItem(STORAGE_KEY_PORTFOLIO, JSON.stringify(payload));
    return true;
  } catch (e) {
    console.error('Failed to save portfolio:', e);
    return false;
  }
}

export function emptyPortfolio() {
  return { version: PORTFOLIO_SCHEMA_VERSION, properties: [] };
}

// ───────────────────────────────────────────────────────────────────────────
// Property CRUD
// ───────────────────────────────────────────────────────────────────────────
export function createProperty(portfolio, { name, address, stateIdx }) {
  const property = {
    id: uid(),
    name: name?.trim() || 'Untitled Property',
    address: address?.trim() || '',
    stateIdx: stateIdx === '' || stateIdx == null ? null : Number(stateIdx),
    createdAt: new Date().toISOString(),
    tenancies: [],
    betweenInspections: [],
    // FUTURE: property reference photos (canonical "this is what the unit
    // looks like move-in ready") currently live in betweenInspections with
    // type='other' and a 'Property reference' label so they're trivially
    // distinguishable without a schema bump. If properties ever change
    // ownership, or if the canonical-state concept needs to outlive specific
    // lease lifecycles, migrate those records into a dedicated
    // `propertyPhotos: []` array here. Migration: filter betweenInspections
    // by label === 'Property reference', move into the new array.
    attachedPdfs: [],
  };
  return { portfolio: { ...portfolio, properties: [property, ...portfolio.properties] }, property };
}

export function updateProperty(portfolio, propertyId, patch) {
  return {
    ...portfolio,
    properties: portfolio.properties.map(p =>
      p.id === propertyId ? { ...p, ...patch } : p
    ),
  };
}

export function deleteProperty(portfolio, propertyId) {
  return {
    ...portfolio,
    properties: portfolio.properties.filter(p => p.id !== propertyId),
  };
}

export function getProperty(portfolio, propertyId) {
  return portfolio.properties.find(p => p.id === propertyId) || null;
}

// ───────────────────────────────────────────────────────────────────────────
// Tenancy CRUD
// ───────────────────────────────────────────────────────────────────────────
export function createTenancy(portfolio, propertyId, { tenants, rent, deposit, startDate, endDate, copyFromTurnover }) {
  const tenancy = {
    id: uid(),
    tenants: Array.isArray(tenants) ? tenants.filter(t => t.trim()) : [tenants].filter(Boolean),
    rent: rent === '' || rent == null ? null : Number(rent),
    deposit: deposit === '' || deposit == null ? null : Number(deposit),
    startDate: startDate || null,
    endDate: endDate || null,
    inspections: [],
  };

  let next = {
    ...portfolio,
    properties: portfolio.properties.map(p =>
      p.id === propertyId
        ? { ...p, tenancies: [tenancy, ...p.tenancies] }
        : p
    ),
  };

  // If "copy from previous turnover" was selected, find the most recent
  // turnover for this property and clone it as the new tenancy's baseline.
  if (copyFromTurnover) {
    const property = getProperty(portfolio, propertyId);
    const lastTurnover = (property?.betweenInspections || [])
      .filter(i => i.type === 'turnover')
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];

    if (lastTurnover) {
      const baseline = cloneInspectionAs(lastTurnover, {
        type: 'baseline',
        label: 'Baseline (from last turnover)',
        tenancyId: tenancy.id,
      });
      next = addInspectionToTenancy(next, propertyId, tenancy.id, baseline);
    }
  }

  return { portfolio: next, tenancy };
}

export function updateTenancy(portfolio, propertyId, tenancyId, patch) {
  return {
    ...portfolio,
    properties: portfolio.properties.map(p => {
      if (p.id !== propertyId) return p;
      return {
        ...p,
        tenancies: p.tenancies.map(t =>
          t.id === tenancyId ? { ...t, ...patch } : t
        ),
      };
    }),
  };
}

export function deleteTenancy(portfolio, propertyId, tenancyId) {
  return {
    ...portfolio,
    properties: portfolio.properties.map(p =>
      p.id === propertyId
        ? { ...p, tenancies: p.tenancies.filter(t => t.id !== tenancyId) }
        : p
    ),
  };
}

export function getTenancy(portfolio, propertyId, tenancyId) {
  const property = getProperty(portfolio, propertyId);
  if (!property) return null;
  return property.tenancies.find(t => t.id === tenancyId) || null;
}

// ───────────────────────────────────────────────────────────────────────────
// Inspection CRUD
// ───────────────────────────────────────────────────────────────────────────

// Create a landlord-authored inspection. Routes into the right place based
// on the type's tenancyLink and the caller's tenancyId:
//   - 'between' types (turnover) always land in property.betweenInspections
//   - 'tenancy' types with a tenancyId attach to that tenancy
//   - 'tenancy' types with NO tenancyId (property-level Photo Documents like
//     Property reference, ad-hoc property-level Others) ALSO land in
//     betweenInspections — distinguished by label, not by type
//   - 'imported' types should NOT be created here
export function createInspection(portfolio, propertyId, { typeId, label, tenancyId }) {
  const typeEntry = inspectionTypeById(typeId);
  if (!typeEntry) throw new Error(`Unknown inspection type: ${typeId}`);
  if (typeEntry.source !== 'landlord') {
    throw new Error(`Inspection type "${typeId}" can only be created by import.`);
  }

  const property = getProperty(portfolio, propertyId);
  const inspection = {
    id: uid(),
    propertyId,
    tenancyId: typeEntry.tenancyLink === 'between' ? null : (tenancyId || null),
    type: typeId,
    label: label?.trim() || typeEntry.label,
    source: 'landlord',
    editable: true,
    createdAt: new Date().toISOString(),
    stateIdx: property?.stateIdx ?? null,
    rooms: blankRooms(),
  };

  let next;
  if (typeEntry.tenancyLink === 'between') {
    next = addInspectionToBetween(portfolio, propertyId, inspection);
  } else if (!tenancyId) {
    // Property-level capture (no tenancy parent). Lands in betweenInspections
    // alongside turnovers — distinguished by label rather than type.
    next = addInspectionToBetween(portfolio, propertyId, inspection);
  } else {
    next = addInspectionToTenancy(portfolio, propertyId, tenancyId, inspection);
  }

  return { portfolio: next, inspection };
}

// Used by the (now-dead) import pipeline. Kept for shape compatibility with
// any v0.2 records still in localStorage that have source='tenant'.
export function addImportedInspection(portfolio, propertyId, tenancyId, inspection) {
  const enriched = {
    ...inspection,
    propertyId,
    tenancyId: tenancyId || null,
    source: 'tenant',
    editable: false,
  };
  if (tenancyId) {
    return addInspectionToTenancy(portfolio, propertyId, tenancyId, enriched);
  }
  return addInspectionToBetween(portfolio, propertyId, enriched);
}

function addInspectionToTenancy(portfolio, propertyId, tenancyId, inspection) {
  return {
    ...portfolio,
    properties: portfolio.properties.map(p => {
      if (p.id !== propertyId) return p;
      return {
        ...p,
        tenancies: p.tenancies.map(t =>
          t.id === tenancyId
            ? { ...t, inspections: [inspection, ...t.inspections] }
            : t
        ),
      };
    }),
  };
}

function addInspectionToBetween(portfolio, propertyId, inspection) {
  return {
    ...portfolio,
    properties: portfolio.properties.map(p =>
      p.id === propertyId
        ? { ...p, betweenInspections: [inspection, ...(p.betweenInspections || [])] }
        : p
    ),
  };
}

export function updateInspection(portfolio, propertyId, inspectionId, patch) {
  return mapInspections(portfolio, propertyId, (insp) => {
    if (insp.id !== inspectionId) return insp;
    if (!insp.editable) {
      console.warn(`Refusing to edit read-only inspection ${inspectionId}`);
      return insp;
    }
    return { ...insp, ...patch };
  });
}

export function deleteInspection(portfolio, propertyId, inspectionId) {
  return {
    ...portfolio,
    properties: portfolio.properties.map(p => {
      if (p.id !== propertyId) return p;
      return {
        ...p,
        tenancies: p.tenancies.map(t => ({
          ...t,
          inspections: t.inspections.filter(i => i.id !== inspectionId),
        })),
        betweenInspections: (p.betweenInspections || []).filter(i => i.id !== inspectionId),
      };
    }),
  };
}

// Returns inspection regardless of where it lives (any tenancy or between)
export function getInspection(portfolio, propertyId, inspectionId) {
  const property = getProperty(portfolio, propertyId);
  if (!property) return null;
  for (const tenancy of property.tenancies) {
    const found = tenancy.inspections.find(i => i.id === inspectionId);
    if (found) return found;
  }
  return (property.betweenInspections || []).find(i => i.id === inspectionId) || null;
}

// Helper: walk every inspection in a property and apply transform fn
function mapInspections(portfolio, propertyId, fn) {
  return {
    ...portfolio,
    properties: portfolio.properties.map(p => {
      if (p.id !== propertyId) return p;
      return {
        ...p,
        tenancies: p.tenancies.map(t => ({
          ...t,
          inspections: t.inspections.map(fn),
        })),
        betweenInspections: (p.betweenInspections || []).map(fn),
      };
    }),
  };
}

// Clone an inspection with new id and changed type/label/tenancyId.
// Used by the "copy from previous turnover" feature.
function cloneInspectionAs(inspection, overrides) {
  return {
    ...inspection,
    id: uid(),
    createdAt: new Date().toISOString(),
    importedAt: undefined,
    sourceBundleId: undefined,
    sourceBundleHash: undefined,
    source: 'landlord',
    editable: true,
    ...overrides,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Returns ALL inspections for a property in date order, with their tenancy
// context attached. Used by ChangesScreen's compare picker.
// ───────────────────────────────────────────────────────────────────────────
export function flatInspections(property) {
  if (!property) return [];
  const all = [];
  for (const tenancy of property.tenancies) {
    for (const insp of tenancy.inspections) {
      all.push({ inspection: insp, tenancy });
    }
  }
  for (const insp of (property.betweenInspections || [])) {
    all.push({ inspection: insp, tenancy: null });
  }
  return all.sort((a, b) =>
    new Date(b.inspection.createdAt) - new Date(a.inspection.createdAt)
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Status chip for portfolio property cards
// ───────────────────────────────────────────────────────────────────────────
export function propertyStatus(property) {
  const tenancies = property.tenancies || [];
  const between = property.betweenInspections || [];

  const totalInspections = tenancies.reduce((s, t) => s + t.inspections.length, 0) + between.length;
  if (totalInspections === 0) return 'empty';

  const activeTenancy = tenancies.find(t => !t.endDate);
  if (activeTenancy) {
    const hasTenantMoveOut = activeTenancy.inspections.some(i => i.type === 'tenant_move_out');
    const hasLandlordPostTenant = activeTenancy.inspections.some(i => i.type === 'post_tenant');
    if (hasTenantMoveOut && hasLandlordPostTenant) return 'dispute-ready';
    if (hasTenantMoveOut) return 'turnover';
    return 'tenant-active';
  }

  if (between.length > 0) return 'turnover';
  if (tenancies.length > 0) return 'baseline-only';
  return 'empty';
}

export const STATUS_CHIPS = {
  'empty':          { label: 'Empty',           color: '#78716C' },
  'baseline-only':  { label: 'Has history',     color: '#1E40AF' },
  'tenant-active':  { label: 'Tenant active',   color: '#059669' },
  'turnover':       { label: 'Turnover',        color: '#D97706' },
  'dispute-ready':  { label: 'Compare ready',   color: '#2D6A4F' },
};

// ───────────────────────────────────────────────────────────────────────────
// Find the tenancy whose date range contains the given date.
// Kept for the diff engine's record-routing logic.
// ───────────────────────────────────────────────────────────────────────────
export function findTenancyForDate(property, isoDate) {
  if (!property || !isoDate) return null;
  const target = new Date(isoDate).getTime();
  for (const tenancy of property.tenancies) {
    if (!tenancy.startDate) continue;
    const start = new Date(tenancy.startDate).getTime();
    const end = tenancy.endDate ? new Date(tenancy.endDate).getTime() : Infinity;
    if (target >= start && target <= end) return tenancy;
  }
  return null;
}

// ───────────────────────────────────────────────────────────────────────────
// Attached PDFs — external PDFs imported at the property level (receipts,
// repair invoices, contractor reports, tenant-side reports). These live as
// files on disk under PHOTO_ROOT/<propertyId>/pdfs/ and the portfolio holds
// only metadata. Selected at PDF generation time and merged via pdf-lib.
// ───────────────────────────────────────────────────────────────────────────

export function attachPdf(portfolio, propertyId, pdfRecord) {
  // pdfRecord shape: { id, fileName, path, importedAt, label?, pageCount? }
  return {
    ...portfolio,
    properties: portfolio.properties.map(p =>
      p.id === propertyId
        ? { ...p, attachedPdfs: [pdfRecord, ...(p.attachedPdfs || [])] }
        : p
    ),
  };
}

export function detachPdf(portfolio, propertyId, pdfId) {
  return {
    ...portfolio,
    properties: portfolio.properties.map(p =>
      p.id === propertyId
        ? { ...p, attachedPdfs: (p.attachedPdfs || []).filter(pdf => pdf.id !== pdfId) }
        : p
    ),
  };
}

export function listAttachedPdfs(property) {
  return property?.attachedPdfs || [];
}

// ───────────────────────────────────────────────────────────────────────────
// Auto-number the next "Other: N" record at this property.
//
// Custom-named Others (e.g. "Fridge install", "HVAC repair") are SKIPPED by
// the regex — only records whose label matches /^Other:\s*\d+$/ count toward
// the counter. So a property with [Fridge install, Other: 1, HVAC repair]
// returns 2 next, not 4.
//
// Walks every inspection at the property (all tenancies + betweenInspections)
// and finds the highest existing number, returns max+1, or 1 if none.
// ───────────────────────────────────────────────────────────────────────────
export function nextOtherCounter(property) {
  if (!property) return 1;
  const re = /^Other:\s*(\d+)$/;
  let max = 0;
  const allInspections = [
    ...(property.tenancies || []).flatMap(t => t.inspections || []),
    ...(property.betweenInspections || []),
  ];
  for (const insp of allInspections) {
    if (insp.type !== 'other') continue;
    const m = (insp.label || '').match(re);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > max) max = n;
    }
  }
  return max + 1;
}
