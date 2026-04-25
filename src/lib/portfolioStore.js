// ═══════════════════════════════════════════════════════════════════════════
// portfolioStore.js — local persistence for properties and inspections
// ═══════════════════════════════════════════════════════════════════════════
// Offline-first. No cloud, no accounts. Uses localStorage for portfolio
// metadata; photos live on the filesystem at PHOTO_ROOT/<inspectionId>/
// managed separately via PhotoStore (copied over from tenant app).
//
// Shape on disk (STORAGE_KEY_PORTFOLIO):
//   {
//     version: 1,
//     properties: [
//       {
//         id, name, address, stateIdx, createdAt,
//         inspections: [ inspection, inspection, ... ]
//       }
//     ]
//   }
//
// An inspection shape:
//   {
//     id, propertyId, type (see INSPECTION_TYPES.id), label,
//     source: 'landlord' | 'tenant',
//     editable: boolean,
//     createdAt, importedAt?, sourceBundleId?, sourceBundleHash?,
//     tenantAppVersion?, stateIdx,
//     rooms: { [roomId]: { moveIn: phase, moveOut: phase } }
//   }
// ═══════════════════════════════════════════════════════════════════════════

import { STORAGE_KEY_PORTFOLIO, uid, blankRooms, INSPECTION_TYPES } from './constants.js';

const SCHEMA_VERSION = 1;

// ───────────────────────────────────────────────────────────────────────────
// Load from disk. Returns an empty portfolio if nothing exists or if the
// stored version is too old to read.
// ───────────────────────────────────────────────────────────────────────────
export function loadPortfolio() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PORTFOLIO);
    if (!raw) return emptyPortfolio();
    const parsed = JSON.parse(raw);
    if (parsed.version !== SCHEMA_VERSION) {
      console.warn(`Portfolio schema version mismatch (stored=${parsed.version}, app=${SCHEMA_VERSION}). Starting fresh.`);
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
    const payload = { ...portfolio, version: SCHEMA_VERSION };
    localStorage.setItem(STORAGE_KEY_PORTFOLIO, JSON.stringify(payload));
    return true;
  } catch (e) {
    console.error('Failed to save portfolio:', e);
    return false;
  }
}

export function emptyPortfolio() {
  return { version: SCHEMA_VERSION, properties: [] };
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
    inspections: [],
  };
  const next = { ...portfolio, properties: [property, ...portfolio.properties] };
  return { portfolio: next, property };
}

export function updateProperty(portfolio, propertyId, patch) {
  const next = {
    ...portfolio,
    properties: portfolio.properties.map(p =>
      p.id === propertyId ? { ...p, ...patch } : p
    ),
  };
  return next;
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
// Inspection CRUD
// ───────────────────────────────────────────────────────────────────────────
export function createInspection(portfolio, propertyId, { typeId, label }) {
  const typeEntry = Object.values(INSPECTION_TYPES).find(t => t.id === typeId);
  if (!typeEntry) throw new Error(`Unknown inspection type: ${typeId}`);
  if (typeEntry.source !== 'landlord') {
    throw new Error(`Inspection type "${typeId}" can only be created by importing a tenant bundle.`);
  }

  const inspection = {
    id: uid(),
    propertyId,
    type: typeId,
    label: label?.trim() || typeEntry.label,
    source: 'landlord',
    editable: true,
    createdAt: new Date().toISOString(),
    stateIdx: getProperty(portfolio, propertyId)?.stateIdx ?? null,
    rooms: blankRooms(),
  };

  const next = addInspectionToProperty(portfolio, propertyId, inspection);
  return { portfolio: next, inspection };
}

// Used by the import pipeline — adds a tenant-sourced (read-only) inspection
export function addImportedInspection(portfolio, propertyId, inspection) {
  return addInspectionToProperty(portfolio, propertyId, {
    ...inspection,
    propertyId,
    source: 'tenant',
    editable: false,
  });
}

function addInspectionToProperty(portfolio, propertyId, inspection) {
  return {
    ...portfolio,
    properties: portfolio.properties.map(p =>
      p.id === propertyId
        ? { ...p, inspections: [inspection, ...p.inspections] }
        : p
    ),
  };
}

export function updateInspection(portfolio, propertyId, inspectionId, patch) {
  return {
    ...portfolio,
    properties: portfolio.properties.map(p => {
      if (p.id !== propertyId) return p;
      return {
        ...p,
        inspections: p.inspections.map(insp => {
          if (insp.id !== inspectionId) return insp;
          if (!insp.editable) {
            console.warn(`Refusing to edit read-only inspection ${inspectionId}`);
            return insp;
          }
          return { ...insp, ...patch };
        }),
      };
    }),
  };
}

export function deleteInspection(portfolio, propertyId, inspectionId) {
  return {
    ...portfolio,
    properties: portfolio.properties.map(p =>
      p.id === propertyId
        ? { ...p, inspections: p.inspections.filter(i => i.id !== inspectionId) }
        : p
    ),
  };
}

export function getInspection(portfolio, propertyId, inspectionId) {
  const property = getProperty(portfolio, propertyId);
  if (!property) return null;
  return property.inspections.find(i => i.id === inspectionId) || null;
}

// ───────────────────────────────────────────────────────────────────────────
// Derived queries
// ───────────────────────────────────────────────────────────────────────────
export function propertyStatus(property) {
  // Returns one of: "empty" | "baseline-only" | "tenant-active" | "turnover" | "dispute-ready"
  // Used to show a status chip on the portfolio list.
  const insps = property.inspections || [];
  if (insps.length === 0) return 'empty';

  const hasLandlord = insps.some(i => i.source === 'landlord');
  const hasTenantMoveIn = insps.some(i => i.type === 'tenant_move_in');
  const hasTenantMoveOut = insps.some(i => i.type === 'tenant_move_out');

  if (hasTenantMoveOut && hasLandlord) return 'dispute-ready';
  if (hasTenantMoveOut) return 'turnover';
  if (hasTenantMoveIn) return 'tenant-active';
  if (hasLandlord) return 'baseline-only';
  return 'empty';
}

export const STATUS_CHIPS = {
  'empty':          { label: 'Empty',           color: '#64748B' },
  'baseline-only':  { label: 'Baseline only',   color: '#3B82F6' },
  'tenant-active':  { label: 'Tenant active',   color: '#10B981' },
  'turnover':       { label: 'Turnover ready',  color: '#F59E0B' },
  'dispute-ready':  { label: 'Ready to compare',color: '#7C3AED' },
};
