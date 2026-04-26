// ═══════════════════════════════════════════════════════════════════════════
// PropertyScreen.jsx — single property view with tenancies and inspections
// v0.2.0 — major rewrite
// ═══════════════════════════════════════════════════════════════════════════
// Layout:
//   Header (forest green, big tap-target back button)
//   Property metadata
//   Persistent picker / catalog (always visible, doubles as access point)
//     - "+ New Inspection" → expand type list inline
//     - Type buttons: Baseline / Mid-lease / Post-tenant / Turnover / Other
//     - "Tenant's Report" button (manual file picker fallback)
//   Tenancy sections (most recent first)
//     - Active tenancy: expanded
//     - Past tenancies: collapsible
//     - Each shows tenant info, dates, rent, deposit, then inspection cards
//   "Between tenancies" bucket for turnover inspections
//   Bottom anchor row (always visible at end of scroll):
//     - Compare Inspections (multi-select up to 3)
//     - Generate Report (PDF) — disabled in v0.2.0, wired in Patch B
//     - Return to Portfolio
//
// Capture UI is still TODO (Patch B). Tapping a type creates an empty
// inspection record; user sees a placeholder alert.
// ═══════════════════════════════════════════════════════════════════════════

import { useState, useMemo } from 'react';
import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';
import { Filesystem, Directory } from '@capacitor/filesystem';

import {
  THEME, STATE_LAWS, INSPECTION_TYPES, LANDLORD_INSPECTION_TYPES,
  inspectionTypeById, inspectionMetrics, formatDate, formatTenancySpan,
} from '../lib/constants.js';
import {
  getProperty, createInspection, deleteInspection,
  createTenancy, deleteTenancy, updateTenancy, flatInspections,
} from '../lib/portfolioStore.js';
import { buildInspectionPDF } from '../lib/pdfBuilder.js';

const IS_NATIVE = Capacitor.isNativePlatform();

export default function PropertyScreen({
  portfolio, setPortfolio, propertyId,
  onBack, onCompare, onCapture, onImportTenantReport,
  photoStore,
}) {
  const property = getProperty(portfolio, propertyId);

  const [showNewTenancy, setShowNewTenancy] = useState(false);
  const [pendingInspection, setPendingInspection] = useState(null);
  // Past tenancies (endDate strictly before today) start collapsed; active
  // (no endDate, or endDate today/future) starts expanded. Initialized via
  // lazy state to avoid recomputing on every render.
  const [collapsedTenancies, setCollapsedTenancies] = useState(() => {
    const set = new Set();
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    for (const t of property?.tenancies || []) {
      if (t.endDate && new Date(t.endDate).getTime() < startOfToday.getTime()) {
        set.add(t.id);
      }
    }
    return set;
  });
  const [selected, setSelected] = useState([]);
  const [showPdfPicker, setShowPdfPicker] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [editingTenancyId, setEditingTenancyId] = useState(null);

  if (!property) {
    return (
      <div style={{ padding: 20, color: THEME.ink }}>
        <div>Property not found.</div>
        <button onClick={onBack} style={btnSecondary}>← Back to portfolio</button>
      </div>
    );
  }

  const state = property.stateIdx != null ? STATE_LAWS[property.stateIdx] : null;
  // A tenancy is "active" if it has no endDate, OR its endDate is today
  // or in the future. End-of-lease day itself counts as still-active so the
  // landlord can capture inspections on the day of move-out. The tenancy
  // becomes "past" the day AFTER endDate (when local clock is past midnight).
  const isTenancyActive = (t) => {
    if (!t?.endDate) return true;
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    return new Date(t.endDate).getTime() >= startOfToday.getTime();
  };
  const activeTenancy = property.tenancies.find(isTenancyActive) || null;
  const allInspections = flatInspections(property);

  // ─── Inspection creation flow ─────────────────────────────────────────
  // The picker is now per-tenancy (or per-between-tenancies for turnover),
  // so callers always know what tenancy they're targeting. No fallback to
  // activeTenancy needed.
  //
  //   tenancyId: string for tenancy-linked types
  //   tenancyId: null for turnover (lives on property.betweenInspections)
  const handleNewInspection = (typeId, tenancyId) => {
    const typeEntry = inspectionTypeById(typeId);
    if (!typeEntry) return;
    doCreateInspection(typeId, typeEntry.tenancyLink === 'between' ? null : tenancyId);
  };

  // ─── Top "+ New Lease" button handler ──────────────────────────────────
  // Always opens the new-tenancy modal. If there's an active tenancy, the
  // modal will offer to end it today as part of the new-lease creation flow.
  const handleNewLease = () => {
    setShowNewTenancy(true);
  };

  const doCreateInspection = (typeId, tenancyId) => {
    const typeEntry = inspectionTypeById(typeId);
    // Use the type's default label directly. The prompt was friction without
    // payoff — landlords don't need a custom label per inspection. If we ever
    // need uniqueness, the date stamp on the card already disambiguates.
    const { portfolio: next, inspection } = createInspection(portfolio, propertyId, {
      typeId,
      label: typeEntry.label,
      tenancyId,
    });
    setPortfolio(next);

    // Navigate to the capture screen so the landlord can immediately walk
    // through the rooms. The inspection record is already persisted, so
    // backing out at any point preserves what they've entered (auto-save
    // continues to fire from CaptureScreen).
    if (onCapture) onCapture(inspection.id);
  };

  // ─── New tenancy creation ─────────────────────────────────────────────
  // Two flows hit this:
  //   1. User tapped "+ New Lease" with no pending inspection — just create
  //      the tenancy and stay on the property screen.
  //   2. User tapped a type (Baseline etc.) with no active tenancy — pending
  //      inspection was queued. Create tenancy AND inspection in one mutation
  //      chain to avoid stale-state bug, then navigate to capture.
  //
  // If form.endActiveLeaseToday is true (modal offered this when an active
  // tenancy existed), we set the active tenancy's endDate to today before
  // creating the new tenancy. Both mutations happen in one chain so a single
  // setPortfolio commits the result.
  const handleCreateTenancy = (form) => {
    let workingPortfolio = portfolio;

    // Optionally auto-end the currently-active tenancy
    if (form.endActiveLeaseToday && activeTenancy) {
      const today = new Date().toISOString().slice(0, 10);
      workingPortfolio = updateTenancy(workingPortfolio, propertyId, activeTenancy.id, {
        endDate: today,
      });
    }

    const tenancyResult = createTenancy(workingPortfolio, propertyId, {
      tenants: form.tenants.split(',').map(s => s.trim()).filter(Boolean),
      rent: form.rent,
      deposit: form.deposit,
      startDate: form.startDate || null,
      endDate: form.endDate || null,
      copyFromTurnover: form.copyFromTurnover,
    });

    setShowNewTenancy(false);

    if (pendingInspection) {
      // Create the inspection against the freshly-mutated portfolio (NOT
      // the stale `portfolio` from closure). Then commit both at once.
      const { typeId } = pendingInspection;
      setPendingInspection(null);

      const typeEntry = inspectionTypeById(typeId);
      const inspResult = createInspection(tenancyResult.portfolio, propertyId, {
        typeId,
        label: typeEntry.label,
        tenancyId: tenancyResult.tenancy.id,
      });
      setPortfolio(inspResult.portfolio);
      if (onCapture) onCapture(inspResult.inspection.id);
    } else {
      setPortfolio(tenancyResult.portfolio);
    }
  };

  const handleDeleteInspection = async (inspId, label) => {
    if (!confirm(`Delete "${label}"? This cannot be undone.`)) return;
    setPortfolio(deleteInspection(portfolio, propertyId, inspId));
    if (photoStore) await photoStore.removeInspection(inspId);
    setSelected(selected.filter(id => id !== inspId));
  };

  const handleDeleteTenancy = (tenancyId, tenants) => {
    if (!confirm(`Delete lease "${tenants.join(', ') || '(unnamed)'}" and all its inspections? This cannot be undone.`)) return;
    setPortfolio(deleteTenancy(portfolio, propertyId, tenancyId));
  };

  const toggleTenancyCollapsed = (tenancyId) => {
    const next = new Set(collapsedTenancies);
    if (next.has(tenancyId)) next.delete(tenancyId);
    else next.add(tenancyId);
    setCollapsedTenancies(next);
  };

  // ─── Compare selection (up to 3) ──────────────────────────────────────
  const toggleSelect = (inspId) => {
    if (selected.includes(inspId)) {
      setSelected(selected.filter(id => id !== inspId));
    } else if (selected.length < 3) {
      setSelected([...selected, inspId]);
    } else {
      // Drop oldest, add new
      setSelected([selected[1], selected[2], inspId]);
    }
  };

  // ─── PDF export ────────────────────────────────────────────────────────
  // Builds the inspection report PDF and routes it through the right
  // delivery mechanism for the platform:
  //   - native: write to Directory.Cache, then Share.share() with the URI
  //   - web: doc.save() triggers browser download
  const handleExportPDF = async (inspId) => {
    const inspection = property.tenancies
      .flatMap(t => t.inspections)
      .concat(property.betweenInspections || [])
      .find(i => i.id === inspId);
    if (!inspection) {
      alert('Inspection not found.');
      return;
    }
    const tenancy = property.tenancies.find(t => t.id === inspection.tenancyId) || null;

    setPdfBusy(true);
    setShowPdfPicker(false);
    try {
      const doc = await buildInspectionPDF(inspection, property, tenancy, photoStore);
      const safeName = (property.name || 'Property').replace(/\s+/g, '-').replace(/[^A-Za-z0-9-_]/g, '');
      const safeLabel = (inspection.label || 'inspection').replace(/\s+/g, '-').replace(/[^A-Za-z0-9-_]/g, '');
      const date = new Date().toISOString().slice(0, 10);
      const fileName = `${safeName}-${safeLabel}-${date}.pdf`;

      if (IS_NATIVE) {
        // jsPDF returns base64 via output('datauristring'); strip the prefix
        const dataUri = doc.output('datauristring');
        const base64 = dataUri.split(',')[1];
        await Filesystem.writeFile({
          path: fileName,
          data: base64,
          directory: Directory.Cache,
          recursive: true,
        });
        const { uri } = await Filesystem.getUri({
          path: fileName,
          directory: Directory.Cache,
        });
        try {
          await Share.share({
            title: `Inspection — ${inspection.label}`,
            text: `${property.name}\n${inspection.label}`,
            url: uri,
            dialogTitle: 'Share Inspection Report',
          });
        } catch (e) {
          // User cancelled — swallow
          const msg = String(e?.message || '');
          if (!msg.includes('cancel') && !msg.includes('abort') && !msg.includes('dismiss')) throw e;
        }
      } else {
        doc.save(fileName);
      }
    } catch (e) {
      console.error('PDF export failed:', e);
      alert('PDF export failed: ' + (e?.message || 'unknown error'));
    } finally {
      setPdfBusy(false);
    }
  };

  const canCompare = selected.length >= 2;

  // Sort tenancies: active first, then by start date descending
  const sortedTenancies = [...property.tenancies].sort((a, b) => {
    const aActive = isTenancyActive(a);
    const bActive = isTenancyActive(b);
    if (aActive && !bActive) return -1;
    if (!aActive && bActive) return 1;
    const aStart = new Date(a.startDate || 0).getTime();
    const bStart = new Date(b.startDate || 0).getTime();
    return bStart - aStart;
  });

  return (
    <div style={{
      maxWidth: 720, margin: '0 auto',
      padding: 'calc(env(safe-area-inset-top) + 0px) 0 calc(env(safe-area-inset-bottom) + 32px) 0',
      minHeight: '100vh', background: THEME.bg,
    }}>
      {/* ─── Forest header ──────────────────────────────────────────────── */}
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
          <span style={{ fontSize: 14 }}>‹</span> Portfolio
        </button>

        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: THEME.mint50 }}>
          {property.name}
        </h1>
        {property.address && (
          <div style={{ fontSize: 13, color: THEME.mint200, marginTop: 4, opacity: 0.95 }}>
            {property.address}
          </div>
        )}
        {state && (
          <div style={{
            fontSize: 11, color: THEME.mint200, marginTop: 8, opacity: 0.85,
            display: 'flex', gap: 10, flexWrap: 'wrap',
          }}>
            <span>{state[0]} ({state[1]})</span>
            <span>·</span>
            <span>{state[2]} day return</span>
            <span>·</span>
            <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {state[4]}
            </span>
          </div>
        )}
      </header>

      <div style={{ padding: '0 16px' }}>

        {/* ─── Top action: + New Lease ───────────────────────────────────
            Single property-level action. Import Tenant's Report now lives
            inside each lease's picker (since landlord knows which lease
            they want to import to — the bundle's date confirms or overrides).
        ──────────────────────────────────────────────────────────────────*/}
        <div style={{ marginBottom: 16 }}>
          <button onClick={handleNewLease} style={btnNewLease}>
            + New Lease
          </button>
        </div>

        {/* ─── Empty state ────────────────────────────────────────────────
            Only shows when the property has NO tenancies. "Between Tenancies"
            isn't relevant here — that section only appears when a turnover
            inspection exists, and you can't make turnovers before having
            any tenancy at all (well, you can, but the empty state assumes
            normal flow).
        ──────────────────────────────────────────────────────────────────*/}
        {property.tenancies.length === 0 && property.betweenInspections.length === 0 && (
          <div style={emptyState}>
            <div style={{ fontSize: 32, marginBottom: 6 }}>🔑</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: THEME.ink, marginBottom: 4 }}>
              No leases yet
            </div>
            <div>
              Tap <strong style={{ color: THEME.brand }}>+ New Lease</strong> above to start your first one.
              You'll be prompted for tenant names, rent, and deposit, then can
              immediately walk through and capture a baseline inspection.
            </div>
          </div>
        )}

        {sortedTenancies.map(tenancy => {
          const isCollapsed = collapsedTenancies.has(tenancy.id);
          const isActive = isTenancyActive(tenancy);
          return (
            <TenancySection
              key={tenancy.id}
              tenancy={tenancy}
              property={property}
              isActive={isActive}
              isCollapsed={isCollapsed}
              onToggleCollapsed={() => toggleTenancyCollapsed(tenancy.id)}
              onDeleteTenancy={() => handleDeleteTenancy(tenancy.id, tenancy.tenants)}
              onEditTenancy={() => setEditingTenancyId(tenancy.id)}
              onDeleteInspection={handleDeleteInspection}
              onOpenInspection={onCapture}
              onCreateInspection={(typeId) => handleNewInspection(typeId, tenancy.id)}
              onImportTenantReport={() => onImportTenantReport({ tenancyId: tenancy.id, propertyId })}
              selected={selected}
              onToggleSelect={toggleSelect}
            />
          );
        })}

        {(property.betweenInspections?.length || 0) > 0 && (
          <BetweenSection
            inspections={property.betweenInspections}
            onDeleteInspection={handleDeleteInspection}
            onOpenInspection={onCapture}
            selected={selected}
            onToggleSelect={toggleSelect}
          />
        )}

        {/* ─── Bottom anchor row ─────────────────────────────────────────── */}
        <div style={{
          marginTop: 24, display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          {(() => {
            // Build smart compare button label based on which tenancies the selected
            // inspections belong to. Helps the landlord understand what they're about
            // to do — within a tenancy ("did this tenant cause damage?") vs across
            // tenancies ("is this damage chronic?").
            let label;
            if (selected.length === 0) {
              label = 'Compare Inspections — pick 2 or 3';
            } else if (selected.length === 1) {
              label = '1 selected — pick 1 or 2 more';
            } else {
              // Find which tenancy each selected inspection belongs to.
              // Returns null for between-tenancies (turnover) inspections.
              const tenancyIds = selected.map(inspId => {
                for (const t of property.tenancies) {
                  if (t.inspections.some(i => i.id === inspId)) return t.id;
                }
                return null;  // belongs to betweenInspections
              });
              const distinctTenancies = new Set(tenancyIds);

              if (selected.length === 3) {
                label = 'Compare 3 inspections →';
              } else if (distinctTenancies.size === 1 && tenancyIds[0] !== null) {
                // Both within the same tenancy
                const tenancy = property.tenancies.find(t => t.id === tenancyIds[0]);
                const tenantNames = tenancy?.tenants?.length > 0
                  ? tenancy.tenants[0].split(' ')[0]   // first name only — keep label short
                  : 'tenancy';
                label = `Compare within ${tenantNames}'s tenancy →`;
              } else {
                // Spans multiple tenancies, or includes a turnover
                label = 'Compare across records →';
              }
            }

            return (
              <button
                disabled={!canCompare}
                onClick={() => canCompare && onCompare(selected)}
                style={{
                  ...btnPrimary,
                  background: canCompare ? THEME.brand : THEME.surface,
                  color: canCompare ? THEME.mint50 : THEME.muted,
                  cursor: canCompare ? 'pointer' : 'not-allowed',
                }}
              >
                {label}
              </button>
            );
          })()}

          {(() => {
            const inspectionCount =
              property.tenancies.reduce((s, t) => s + t.inspections.length, 0) +
              (property.betweenInspections?.length || 0);
            const hasInspections = inspectionCount > 0;
            return (
              <button
                onClick={() => setShowPdfPicker(true)}
                disabled={!hasInspections || pdfBusy}
                style={{
                  ...btnPdfReport,
                  cursor: hasInspections && !pdfBusy ? 'pointer' : 'not-allowed',
                  opacity: hasInspections && !pdfBusy ? 1 : 0.5,
                }}
              >
                {pdfBusy
                  ? 'Building PDF…'
                  : hasInspections
                    ? '📄 Generate Report (PDF)'
                    : 'Generate Report (PDF) — no inspections yet'}
              </button>
            );
          })()}

          <button onClick={onBack} style={btnReturn}>
            ← Return to Portfolio
          </button>
        </div>
      </div>

      {showNewTenancy && (
        <NewTenancyModal
          property={property}
          activeTenancy={activeTenancy}
          onCreate={handleCreateTenancy}
          onCancel={() => { setShowNewTenancy(false); setPendingInspection(null); }}
          pendingTypeLabel={pendingInspection ? inspectionTypeById(pendingInspection.typeId)?.label : null}
        />
      )}

      {showPdfPicker && (
        <PdfPickerModal
          property={property}
          onPick={handleExportPDF}
          onCancel={() => setShowPdfPicker(false)}
        />
      )}

      {editingTenancyId && (
        <EditTenancyModal
          tenancy={property.tenancies.find(t => t.id === editingTenancyId)}
          onSave={(patch) => {
            setPortfolio(updateTenancy(portfolio, propertyId, editingTenancyId, patch));
            setEditingTenancyId(null);
          }}
          onCancel={() => setEditingTenancyId(null)}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TenancySection — renders one tenancy with its inspections
// ═══════════════════════════════════════════════════════════════════════════
function TenancySection({
  tenancy, property, isActive, isCollapsed,
  onToggleCollapsed, onDeleteTenancy, onEditTenancy,
  onDeleteInspection, onOpenInspection, onCreateInspection, onImportTenantReport,
  selected, onToggleSelect,
}) {
  const tenantNames = tenancy.tenants?.length > 0 ? tenancy.tenants.join(', ') : '(unnamed tenant)';

  // Per-type "is there already one of these?" lookup. Used by the picker
  // grid below — buttons turn dark-beige + show a "used" affordance once
  // the corresponding inspection exists. Multi-instance per type is not
  // allowed at the UI level for the four lifecycle types (one Baseline per
  // lease, etc.) and tenant report (one bundle per lease).
  //
  // Turnover is INTENTIONALLY EXEMPT from the per-type cap because turnovers
  // live between leases at the property level — there can legitimately be
  // multiple turnovers across the lifetime of a property (one between each
  // pair of leases). So `turnover` is always null here, meaning the picker
  // button stays in the fresh/amber state forever. User can always add
  // another turnover.
  //
  //   existingByType.baseline    → Inspection | null
  //   existingByType.mid_lease   → Inspection | null
  //   existingByType.post_tenant → Inspection | null
  //   existingByType.other       → Inspection | null
  //   existingByType.turnover    → ALWAYS null (multiple turnovers permitted)
  //   existingByType.tenant_report → tenant move_in OR move_out within this tenancy, or null
  const existingByType = {
    baseline:    tenancy.inspections.find(i => i.type === 'baseline')    || null,
    mid_lease:   tenancy.inspections.find(i => i.type === 'mid_lease')   || null,
    post_tenant: tenancy.inspections.find(i => i.type === 'post_tenant') || null,
    other:       tenancy.inspections.find(i => i.type === 'other')       || null,
    turnover:    null,
    tenant_report: tenancy.inspections.find(
      i => i.type === 'tenant_move_in' || i.type === 'tenant_move_out'
    ) || null,
  };

  // Sort inspections by lifecycle order — Baseline first (start of tenancy),
  // Mid-lease in the middle, Post-tenant near the end, Other catch-all,
  // imported tenant records last (they're external evidence, not landlord work).
  // Within types, fall back to creation date so multiple Mid-lease checks stay
  // chronologically grouped.
  const TYPE_ORDER = {
    baseline: 0,
    mid_lease: 1,
    post_tenant: 2,
    other: 3,
    tenant_move_in: 4,
    tenant_move_out: 5,
  };
  const sortedInspections = [...tenancy.inspections].sort((a, b) => {
    const aOrder = TYPE_ORDER[a.type] ?? 99;
    const bOrder = TYPE_ORDER[b.type] ?? 99;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return new Date(a.createdAt) - new Date(b.createdAt);
  });

  return (
    <div style={{
      marginBottom: 14, background: THEME.paper, borderRadius: 14,
      border: `1px solid ${isActive ? THEME.brand2 : THEME.edge}`,
      borderLeftWidth: 4, borderLeftColor: isActive ? THEME.brand2 : THEME.edgeStrong,
      overflow: 'hidden',
    }}>
      <button
        onClick={onToggleCollapsed}
        style={{
          // Active leases get a whispered mint wash on the header — enough
          // visual signal to spot the active one at a glance, low enough
          // opacity that it doesn't compete with content. Past leases keep
          // a transparent header so they fully recede.
          background: isActive ? 'rgba(209, 250, 229, 0.35)' : 'transparent',
          border: 'none', cursor: 'pointer',
          width: '100%', padding: 14, textAlign: 'left',
          display: 'flex', alignItems: 'center', gap: 10,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{
              fontSize: 10, fontWeight: 700, color: isActive ? THEME.brand2 : THEME.muted2,
              textTransform: 'uppercase', letterSpacing: 0.6,
            }}>
              {isActive ? 'Active lease' : 'Past lease'}
            </span>
            <span style={{ fontSize: 11, color: THEME.muted }}>
              {formatTenancySpan(tenancy)}
            </span>
          </div>
          <div style={{ fontSize: 15, fontWeight: 600, color: THEME.ink, marginTop: 4 }}>
            {tenantNames}
          </div>
          {(tenancy.rent != null || tenancy.deposit != null) && (
            <div style={{ fontSize: 11, color: THEME.muted, marginTop: 2 }}>
              {tenancy.rent != null && `Rent $${tenancy.rent}/mo`}
              {tenancy.rent != null && tenancy.deposit != null && ' · '}
              {tenancy.deposit != null && `Deposit $${tenancy.deposit}`}
            </div>
          )}
          <div style={{ fontSize: 11, color: THEME.muted2, marginTop: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>
              {tenancy.inspections.length} {tenancy.inspections.length === 1 ? 'inspection' : 'inspections'}
            </span>
            {onEditTenancy && (
              <span
                onClick={(e) => { e.stopPropagation(); onEditTenancy(); }}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  fontSize: 10, color: THEME.brand2, fontWeight: 600,
                  padding: '3px 8px', borderRadius: 999,
                  background: 'rgba(255, 255, 255, 0.6)',
                  border: `1px solid ${THEME.mint300}`,
                  cursor: 'pointer',
                }}
              >
                <span style={{ fontSize: 11 }}>✏️</span>
                <span>Edit lease</span>
              </span>
            )}
          </div>
        </div>
        <span style={{
          fontSize: 11, color: THEME.muted, transition: 'transform 0.2s',
          transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)', display: 'inline-block',
        }}>▼</span>
      </button>

      {!isCollapsed && (
        <div style={{ padding: '0 14px 14px 14px' }}>

          {/* ─── Per-tenancy picker ──────────────────────────────────────
              Six buttons in a uniform 2-column grid:
                Baseline       | Mid-lease
                Post-tenant    | Other
                Turnover       | Tenant report

              All same size. Turnover is amber-styled (between-leases
              action — different in nature from the four lifecycle types).
              Tenant report is mint-styled (read-only external evidence).
              Lifecycle types stay default mint.

              Turnover routes to property.betweenInspections via
              handleNewInspection's tenancyLink check. Tenant report opens
              the file picker with this tenancy as the routing-from context;
              the confirm dialog flags any auto-route mismatch.
          ─────────────────────────────────────────────────────────────── */}
          {onCreateInspection && (
            <div style={{
              marginBottom: 12, paddingTop: 6,
              borderTop: `1px dashed ${THEME.edge}`,
            }}>
              <div style={{
                fontSize: 10, fontWeight: 700, color: THEME.muted,
                textTransform: 'uppercase', letterSpacing: 0.5,
                marginTop: 8, marginBottom: 6,
              }}>
                Add to this lease:
              </div>
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6,
              }}>
                {LANDLORD_INSPECTION_TYPES
                  .filter(t => t.tenancyLink === 'tenancy')
                  .map(type => {
                    const existing = existingByType[type.id];
                    const used = !!existing;
                    return (
                      <button
                        key={type.id}
                        onClick={() => {
                          if (used && onOpenInspection) onOpenInspection(existing.id);
                          else onCreateInspection(type.id);
                        }}
                        style={used ? tenancyPickerBtnUsed : tenancyPickerBtn}
                        title={used ? `Open existing ${type.label.toLowerCase()}` : `Add ${type.label.toLowerCase()}`}
                      >
                        <span style={{ fontSize: 16, lineHeight: 1, opacity: used ? 0.6 : 1 }}>
                          {type.icon}
                        </span>
                        <span style={{ flex: 1, textAlign: 'left' }}>{type.label}</span>
                        {used && (
                          <span style={{ fontSize: 10, opacity: 0.7, fontWeight: 700 }}>✓</span>
                        )}
                      </button>
                    );
                  })
                }

                {/* Turnover — amber when fresh, dark-beige when one exists.
                    Note "used" here means a turnover exists ANYWHERE in the
                    property's betweenInspections (since turnover is property-
                    level). Tapping the used state opens the most-recent. */}
                {(() => {
                  const existing = existingByType.turnover;
                  const used = !!existing;
                  return (
                    <button
                      onClick={() => {
                        if (used && onOpenInspection) onOpenInspection(existing.id);
                        else onCreateInspection('turnover');
                      }}
                      style={used ? tenancyPickerBtnUsed : {
                        ...tenancyPickerBtn,
                        background: '#FEF3C7', borderColor: '#FDE68A', color: '#92400E',
                      }}
                      title={used ? 'Open existing turnover' : 'Add turnover'}
                    >
                      <span style={{ fontSize: 16, lineHeight: 1, opacity: used ? 0.6 : 1 }}>🔄</span>
                      <span style={{ flex: 1, textAlign: 'left' }}>Turnover</span>
                      {used && <span style={{ fontSize: 10, opacity: 0.7, fontWeight: 700 }}>✓</span>}
                    </button>
                  );
                })()}

                {/* Tenant report — mint-tinted when fresh, dark-beige when one
                    exists in this tenancy (either move-in OR move-out). Tapping
                    used state opens the existing imported inspection. */}
                {(() => {
                  const existing = existingByType.tenant_report;
                  const used = !!existing;
                  return (
                    <button
                      onClick={() => {
                        if (used && onOpenInspection) onOpenInspection(existing.id);
                        else if (onImportTenantReport) onImportTenantReport();
                      }}
                      style={used ? tenancyPickerBtnUsed : {
                        ...tenancyPickerBtn,
                        background: THEME.mint100, borderColor: THEME.mint300, color: THEME.brand,
                      }}
                      title={used ? 'Open imported tenant report' : 'Import a tenant report'}
                    >
                      <span style={{ fontSize: 16, lineHeight: 1, opacity: used ? 0.6 : 1 }}>📥</span>
                      <span style={{ flex: 1, textAlign: 'left' }}>Import Tenant Report</span>
                      {used && <span style={{ fontSize: 10, opacity: 0.7, fontWeight: 700 }}>✓</span>}
                    </button>
                  );
                })()}
              </div>
            </div>
          )}

          {sortedInspections.length === 0 ? (
            <div style={{
              fontSize: 12, color: THEME.muted2, padding: '12px 0',
              textAlign: 'center', fontStyle: 'italic',
            }}>
              No inspections in this lease yet.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {sortedInspections.map(insp => (
                <InspectionCard
                  key={insp.id}
                  inspection={insp}
                  selected={selected.includes(insp.id)}
                  onToggleSelect={() => onToggleSelect(insp.id)}
                  onOpen={onOpenInspection ? () => onOpenInspection(insp.id) : null}
                  onDelete={() => onDeleteInspection(insp.id, insp.label)}
                />
              ))}
            </div>
          )}

          <button onClick={onDeleteTenancy} style={{
            background: 'transparent', color: THEME.danger,
            border: 'none', fontSize: 11, fontWeight: 600,
            padding: '8px 0 0 0', cursor: 'pointer', textAlign: 'left',
            opacity: 0.6,
          }}>
            Delete lease
          </button>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// BetweenSection — turnover inspections that don't belong to a tenancy
// ═══════════════════════════════════════════════════════════════════════════
function BetweenSection({ inspections, onDeleteInspection, onOpenInspection, selected, onToggleSelect }) {
  const sorted = [...inspections].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return (
    <div style={{
      marginBottom: 14, background: THEME.paper, borderRadius: 14,
      border: `1px solid ${THEME.edge}`,
      borderLeftWidth: 4, borderLeftColor: '#D97706',  // amber for between
      padding: 14,
    }}>
      <div style={{
        fontSize: 10, fontWeight: 700, color: '#D97706',
        textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8,
      }}>
        Between tenancies
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {sorted.map(insp => (
          <InspectionCard
            key={insp.id}
            inspection={insp}
            selected={selected.includes(insp.id)}
            onToggleSelect={() => onToggleSelect(insp.id)}
            onOpen={onOpenInspection ? () => onOpenInspection(insp.id) : null}
            onDelete={() => onDeleteInspection(insp.id, insp.label)}
          />
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// InspectionCard — single inspection row with metric chips
// ═══════════════════════════════════════════════════════════════════════════
function InspectionCard({ inspection, selected, onToggleSelect, onOpen, onDelete }) {
  const typeEntry = inspectionTypeById(inspection.type) || {};
  const sourceColor = inspection.source === 'tenant' ? THEME.tenant : THEME.landlord;
  const metrics = inspectionMetrics(inspection);

  return (
    <div
      onClick={onToggleSelect}
      style={{
        // Every inspection card is mint-tinted by default — the visual link
        // promised by the picker button (which goes dark-beige once an
        // inspection of this type exists). When selected for compare the
        // tint deepens slightly and the border thickens to brand-2.
        background: selected ? THEME.mint100 : THEME.mint50,
        borderRadius: 10, padding: 10,
        border: `2px solid ${selected ? THEME.brand2 : THEME.mint300}`,
        cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10,
        transition: 'all 0.1s',
      }}
    >
      {/* Visible checkbox affordance — tapping the card body still toggles
          selection, but the checkbox makes the "tap to select for compare"
          interaction discoverable. */}
      <div
        aria-hidden
        style={{
          width: 20, height: 20, borderRadius: 6,
          border: `2px solid ${selected ? THEME.brand2 : THEME.edgeStrong}`,
          background: selected ? THEME.brand2 : '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff', fontSize: 13, fontWeight: 900, lineHeight: 1,
          flexShrink: 0, transition: 'all 0.1s',
        }}
      >
        {selected ? '✓' : ''}
      </div>

      <div style={{
        width: 4, alignSelf: 'stretch', borderRadius: 2, background: sourceColor,
      }} />

      <div style={{ fontSize: 18, lineHeight: 1 }}>{typeEntry.icon || '📋'}</div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13, fontWeight: 600, color: THEME.ink,
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {inspection.label}
          </span>
          {!inspection.editable && (
            <span style={{
              fontSize: 9, color: '#fff', background: THEME.tenant,
              padding: '2px 5px', borderRadius: 4, fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: 0.4, flexShrink: 0,
            }}>
              R/O
            </span>
          )}
        </div>
        <div style={{ fontSize: 11, color: THEME.muted, marginTop: 2 }}>
          {typeEntry.label} · {formatDate(inspection.createdAt)}
        </div>
      </div>

      {/* Metric chips — percentage of items rated within rooms touched, plus photo count */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
        {metrics.possible > 0 && (
          <div style={{
            fontSize: 10, color: THEME.brand, background: '#fff',
            padding: '2px 7px', borderRadius: 999, fontWeight: 700,
            border: `1.5px solid ${THEME.brand2}`, lineHeight: 1.4,
          }}>
            {Math.round((metrics.rated / metrics.possible) * 100)}%
          </div>
        )}
        {metrics.photos > 0 && (
          <div style={{
            fontSize: 10, color: THEME.muted, background: '#fff',
            padding: '2px 7px', borderRadius: 999, fontWeight: 600,
            border: `1px solid ${THEME.edge}`, lineHeight: 1.4,
          }}>
            📸 {metrics.photos}
          </div>
        )}
      </div>

      {/* Open button — re-enter capture or view (read-only for tenant imports) */}
      {onOpen && (
        <button
          onClick={(e) => { e.stopPropagation(); onOpen(); }}
          style={{
            background: THEME.brand, color: THEME.mint50, border: 'none',
            borderRadius: 8, padding: '6px 10px', fontSize: 11, fontWeight: 600,
            cursor: 'pointer', whiteSpace: 'nowrap',
          }}
          aria-label={inspection.editable ? 'Open inspection' : 'View inspection'}
        >
          {inspection.editable ? 'Open' : 'View'}
        </button>
      )}

      <button
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        style={{
          background: 'transparent', color: THEME.muted2, border: 'none',
          fontSize: 18, cursor: 'pointer', padding: 4, opacity: 0.5, lineHeight: 1,
        }}
        aria-label="Delete inspection"
      >×</button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PdfPickerModal — picks an inspection to export as PDF
// ═══════════════════════════════════════════════════════════════════════════
function PdfPickerModal({ property, onPick, onCancel }) {
  // Build a flat sorted list with tenancy context labels
  const items = [];
  for (const tenancy of property.tenancies) {
    const tenantLabel = tenancy.tenants?.length > 0 ? tenancy.tenants.join(', ') : '(unnamed)';
    for (const insp of tenancy.inspections) {
      items.push({
        inspection: insp,
        tenancyLabel: tenantLabel,
      });
    }
  }
  for (const insp of (property.betweenInspections || [])) {
    items.push({ inspection: insp, tenancyLabel: 'Between tenancies' });
  }
  items.sort((a, b) => new Date(b.inspection.createdAt) - new Date(a.inspection.createdAt));

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(28, 25, 23, 0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000, padding: 24,
    }}>
      <div style={{
        background: THEME.paper, borderRadius: 16, padding: 22,
        maxWidth: 460, width: '100%',
        border: `2px solid ${THEME.brand}`,
        boxShadow: '0 20px 50px rgba(0,0,0,0.3)',
        maxHeight: '85vh', display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ fontSize: 13, color: THEME.muted, fontWeight: 600, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Generate PDF Report
        </div>
        <div style={{ fontSize: 18, fontWeight: 700, color: THEME.ink, marginBottom: 4 }}>
          Pick an inspection
        </div>
        <div style={{ fontSize: 12, color: THEME.muted, marginBottom: 16, lineHeight: 1.5 }}>
          The report covers a single inspection — its rated items, photos, and notes,
          with the tenancy and property context on the cover.
        </div>

        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
          {items.length === 0 && (
            <div style={{
              padding: 24, textAlign: 'center', color: THEME.muted, fontSize: 12,
              background: THEME.bg, borderRadius: 10, border: `1px dashed ${THEME.edge}`,
            }}>
              No inspections to export yet.
            </div>
          )}
          {items.map(({ inspection, tenancyLabel }) => {
            const typeEntry = inspectionTypeById(inspection.type) || {};
            const metrics = inspectionMetrics(inspection);
            return (
              <button
                key={inspection.id}
                onClick={() => onPick(inspection.id)}
                style={{
                  background: THEME.bg, color: THEME.ink,
                  border: `1px solid ${THEME.edge}`, borderRadius: 10,
                  padding: '11px 12px', fontSize: 13, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left',
                  width: '100%',
                }}
              >
                <span style={{ fontSize: 18 }}>{typeEntry.icon || '📋'}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, color: THEME.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {inspection.label}
                  </div>
                  <div style={{ fontSize: 11, color: THEME.muted, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {tenancyLabel} · {formatDate(inspection.createdAt)}
                  </div>
                </div>
                <div style={{ fontSize: 10, color: THEME.brand2, fontWeight: 700, whiteSpace: 'nowrap' }}>
                  {metrics.possible > 0 ? `${Math.round((metrics.rated / metrics.possible) * 100)}%` : '—'} · 📸 {metrics.photos}
                </div>
              </button>
            );
          })}
        </div>

        <button onClick={onCancel} style={{
          background: THEME.surface, color: THEME.ink,
          border: `1px solid ${THEME.edge}`, borderRadius: 10,
          padding: '12px 16px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
          width: '100%',
        }}>Cancel</button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// NewTenancyModal — collects tenant info before creating a tenancy
// ═══════════════════════════════════════════════════════════════════════════

// Truncate excess year digits in a YYYY-MM-DD value. Caps year at 4 digits
// without snapping to any min/max — that pattern caused the v0.3.6 "1990 trap"
// where intermediate values like "0226-08-15" got clamped to 1990. Now we
// just slice off anything past the 4th year digit. Backspace still works,
// so the user can delete and retype freely.
//
// Examples:
//   "2026-08-15"   → "2026-08-15"   (4-digit year, untouched)
//   "20266-08-15"  → "2026-08-15"   (5+ digits truncated to first 4)
//   "0226-08-15"   → "0226-08-15"   (intermediate typing, passes through)
//   ""             → ""             (empty, passes through)
function clampDate(value) {
  if (!value) return '';
  const m = value.match(/^(\d+)-(\d{2})-(\d{2})$/);
  if (!m) return value;
  const year = m[1].length > 4 ? m[1].slice(0, 4) : m[1];
  return `${year}-${m[2]}-${m[3]}`;
}

// Strip any non-numeric characters from a money input, allowing one optional
// decimal point with up to 2 fractional digits. Empty string passes through
// (lets the user clear the field). Used by rent/deposit text inputs.
function sanitizeMoney(value) {
  if (!value) return '';
  // Strip everything except digits and dots
  let cleaned = value.replace(/[^\d.]/g, '');
  // Keep only the first dot
  const firstDot = cleaned.indexOf('.');
  if (firstDot !== -1) {
    cleaned = cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '');
  }
  // Cap to 2 decimal places
  const dotIdx = cleaned.indexOf('.');
  if (dotIdx !== -1 && cleaned.length - dotIdx - 1 > 2) {
    cleaned = cleaned.slice(0, dotIdx + 3);
  }
  // Cap at $999,999.99 — sanity guard
  if (parseFloat(cleaned) > 999999.99) {
    cleaned = '999999.99';
  }
  return cleaned;
}

function NewTenancyModal({ property, activeTenancy, onCreate, onCancel, pendingTypeLabel }) {
  const [form, setForm] = useState({
    tenants: '', rent: '', deposit: '',
    startDate: new Date().toISOString().slice(0, 10),
    endDate: '',
    copyFromTurnover: false,
    // Default to true when an active tenancy exists — most natural case is
    // "previous tenant moved out, new one moving in." User can uncheck for
    // sublease / overlap edge cases.
    endActiveLeaseToday: !!activeTenancy,
  });

  const hasPriorTurnover = (property.betweenInspections || []).some(i => i.type === 'turnover');
  const activeLeaseTenants = activeTenancy?.tenants?.length > 0
    ? activeTenancy.tenants.join(', ')
    : '(unnamed tenant)';

  const handleSubmit = () => {
    if (!form.tenants.trim()) {
      alert('At least one tenant name is required');
      return;
    }
    onCreate(form);
  };

  return (
    <div style={modalBackdrop}>
      <div style={{
        background: THEME.paper, borderRadius: 16, padding: 22,
        maxWidth: 460, width: '100%',
        border: `2px solid ${THEME.brand}`,
        boxShadow: '0 20px 50px rgba(0,0,0,0.3)',
        maxHeight: '90vh', overflowY: 'auto',
      }}>
        <div style={{ fontSize: 13, color: THEME.muted, fontWeight: 600, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          New Lease
        </div>
        <div style={{ fontSize: 18, fontWeight: 700, color: THEME.ink, marginBottom: 4 }}>
          {property.name}
        </div>
        {pendingTypeLabel && (
          <div style={{ fontSize: 12, color: THEME.brand2, marginBottom: 14 }}>
            You'll create a <strong>{pendingTypeLabel}</strong> inspection right after.
          </div>
        )}

        <Label>Tenant name(s) *</Label>
        <input style={input}
          placeholder="Jane Doe, John Doe"
          value={form.tenants}
          onChange={e => setForm({ ...form, tenants: e.target.value })} />
        <Hint>Separate multiple tenants with commas.</Hint>

        <Label>Move-in date</Label>
        <input style={input} type="date"
          value={form.startDate}
          onChange={e => setForm({ ...form, startDate: clampDate(e.target.value) })} />

        <Label>Move-out date <span style={{ color: THEME.muted2, fontWeight: 400 }}>(leave blank if active)</span></Label>
        <input style={input} type="date"
          value={form.endDate}
          onChange={e => setForm({ ...form, endDate: clampDate(e.target.value) })} />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <Label>Rent ($/mo)</Label>
            <input style={input} type="text" inputMode="decimal"
              placeholder="1500"
              value={form.rent}
              onChange={e => setForm({ ...form, rent: sanitizeMoney(e.target.value) })} />
          </div>
          <div>
            <Label>Deposit ($)</Label>
            <input style={input} type="text" inputMode="decimal"
              placeholder="1500"
              value={form.deposit}
              onChange={e => setForm({ ...form, deposit: sanitizeMoney(e.target.value) })} />
          </div>
        </div>

        {activeTenancy && (
          <label style={{
            display: 'flex', alignItems: 'flex-start', gap: 10,
            marginTop: 16, padding: 12, background: '#FEF3C7',
            borderRadius: 10, border: `1px solid #FDE68A`,
            cursor: 'pointer',
          }}>
            <input
              type="checkbox"
              checked={form.endActiveLeaseToday}
              onChange={e => setForm({ ...form, endActiveLeaseToday: e.target.checked })}
              style={{ marginTop: 2 }}
            />
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#92400E' }}>
                End {activeLeaseTenants}'s lease today
              </div>
              <div style={{ fontSize: 11, color: '#78350F', marginTop: 2 }}>
                Their move-out date will be set to today. Uncheck only if this is a
                sublease or overlap — you can't have two active leases at once.
              </div>
            </div>
          </label>
        )}

        {hasPriorTurnover && (
          <label style={{
            display: 'flex', alignItems: 'flex-start', gap: 10,
            marginTop: 16, padding: 12, background: THEME.mint50,
            borderRadius: 10, border: `1px solid ${THEME.mint300}`,
            cursor: 'pointer',
          }}>
            <input
              type="checkbox"
              checked={form.copyFromTurnover}
              onChange={e => setForm({ ...form, copyFromTurnover: e.target.checked })}
              style={{ marginTop: 2 }}
            />
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: THEME.brand }}>
                Copy last turnover as baseline
              </div>
              <div style={{ fontSize: 11, color: THEME.muted, marginTop: 2 }}>
                Carry over the most recent turnover inspection's photos and ratings as
                this tenancy's baseline. Saves re-walking the unit.
              </div>
            </div>
          </label>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button onClick={onCancel} style={{ ...btnSecondary, flex: 1 }}>Cancel</button>
          <button onClick={handleSubmit} style={{ ...btnPrimary, flex: 1, marginTop: 0 }}>
            Create Lease
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// EditTenancyModal — modify an existing lease's parent record
// ═══════════════════════════════════════════════════════════════════════════
// Use case: tenant resigns for another year. Bump endDate forward, save.
// All inspections within the tenancy stay attached. No effect on data
// downstream — only the lease metadata changes.
//
// Fields editable: tenant names, rent, deposit, startDate, endDate.
// (Type/source/inspections are immutable — those would be data-shape changes.)
function EditTenancyModal({ tenancy, onSave, onCancel }) {
  const [form, setForm] = useState({
    tenants: (tenancy.tenants || []).join(', '),
    rent: tenancy.rent != null ? String(tenancy.rent) : '',
    deposit: tenancy.deposit != null ? String(tenancy.deposit) : '',
    startDate: tenancy.startDate || '',
    endDate: tenancy.endDate || '',
  });

  const handleSubmit = () => {
    if (!form.tenants.trim()) {
      alert('At least one tenant name is required');
      return;
    }
    onSave({
      tenants: form.tenants.split(',').map(s => s.trim()).filter(Boolean),
      rent: form.rent === '' ? null : parseFloat(form.rent),
      deposit: form.deposit === '' ? null : parseFloat(form.deposit),
      startDate: form.startDate || null,
      endDate: form.endDate || null,
    });
  };

  return (
    <div style={modalBackdrop}>
      <div style={{
        background: THEME.paper, borderRadius: 16, padding: 24,
        maxWidth: 460, width: '100%',
        border: `2px solid ${THEME.brand}`,
        boxShadow: '0 20px 50px rgba(0,0,0,0.3)',
        maxHeight: '90vh', overflowY: 'auto',
      }}>
        <div style={{ fontSize: 13, color: THEME.muted, fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Edit lease
        </div>
        <div style={{ fontSize: 18, fontWeight: 700, color: THEME.ink, marginBottom: 4 }}>
          Update lease details
        </div>
        <div style={{ fontSize: 11, color: THEME.muted, marginBottom: 16, lineHeight: 1.5 }}>
          All inspections within this lease stay attached. Use this when a tenant
          renews (just push out the end date), or to fix a typo in tenant info.
        </div>

        <Label>Tenant names <span style={{ color: THEME.muted2, fontWeight: 400 }}>(comma-separated)</span></Label>
        <input style={input}
          placeholder="Jane Doe, John Doe"
          value={form.tenants}
          onChange={e => setForm({ ...form, tenants: e.target.value })} />

        <Label>Move-in date</Label>
        <input style={input} type="date"
          value={form.startDate}
          onChange={e => setForm({ ...form, startDate: clampDate(e.target.value) })} />

        <Label>Move-out date <span style={{ color: THEME.muted2, fontWeight: 400 }}>(leave blank if active)</span></Label>
        <input style={input} type="date"
          value={form.endDate}
          onChange={e => setForm({ ...form, endDate: clampDate(e.target.value) })} />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <Label>Rent ($/mo)</Label>
            <input style={input} type="text" inputMode="decimal"
              placeholder="1500"
              value={form.rent}
              onChange={e => setForm({ ...form, rent: sanitizeMoney(e.target.value) })} />
          </div>
          <div>
            <Label>Deposit ($)</Label>
            <input style={input} type="text" inputMode="decimal"
              placeholder="1500"
              value={form.deposit}
              onChange={e => setForm({ ...form, deposit: sanitizeMoney(e.target.value) })} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button onClick={onCancel} style={{ ...btnSecondary, flex: 1 }}>Cancel</button>
          <button onClick={handleSubmit} style={{ ...btnPrimary, flex: 1, marginTop: 0 }}>
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Shared styles
// ═══════════════════════════════════════════════════════════════════════════
function Label({ children }) {
  return (
    <label style={{
      display: 'block', fontSize: 12, color: THEME.muted,
      marginTop: 12, marginBottom: 4, fontWeight: 500,
    }}>{children}</label>
  );
}

function Hint({ children }) {
  return <div style={{ fontSize: 11, color: THEME.muted2, marginTop: 4 }}>{children}</div>;
}

const input = {
  width: '100%', background: THEME.bg, color: THEME.ink,
  border: `1px solid ${THEME.edge}`, borderRadius: 8,
  padding: '10px 12px', fontSize: 14, boxSizing: 'border-box', outline: 'none',
};

// ─── Top-row action buttons ────────────────────────────────────────────────
// "+ New Lease" and "Import Tenant's Report" — visually distinct from the
// per-tenancy pickers below. Both forest-themed so they read as primary
// property-level actions.
const btnNewLease = {
  background: THEME.brand, color: THEME.mint50, border: 'none', borderRadius: 12,
  padding: '14px 12px', fontSize: 14, fontWeight: 700, cursor: 'pointer',
  width: '100%',
};

const btnImportTenant = {
  background: THEME.mint50, color: THEME.brand,
  border: `2px solid ${THEME.mint300}`, borderRadius: 12,
  padding: '12px 12px', fontSize: 14, fontWeight: 700, cursor: 'pointer',
  width: '100%',
};

// ─── Per-tenancy picker buttons ───────────────────────────────────────────
// Smaller than the top-row buttons since they're nested inside a card.
// Mint-tinted to signal "tenancy-scoped action" vs the brand-forest of the
// global property-level actions.
const tenancyPickerBtn = {
  background: THEME.mint50, color: THEME.brand,
  border: `1px solid ${THEME.mint300}`, borderRadius: 10,
  padding: '10px 11px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
  display: 'flex', alignItems: 'center', gap: 8,
};

// "Used" state for picker buttons — once an inspection of this type exists
// for this lease, the button transitions to dark-beige with muted text.
// Tap behavior changes from create→open. Same dimensions as the fresh state
// so the grid stays uniform; only color shifts.
// "Used" state for picker buttons — translucent ghost of the original.
// Once an inspection of this type exists, the button recedes into the
// background, signaling "you can't make another, but you can tap to open
// the existing one." Dashed border + low opacity keeps it visible as a
// tappable target without competing with the still-actionable buttons.
const tenancyPickerBtnUsed = {
  background: 'rgba(0, 0, 0, 0.04)',
  color: THEME.muted2,
  border: `1px dashed ${THEME.edge}`,
  borderRadius: 10,
  padding: '10px 11px', fontSize: 12.5, fontWeight: 500, cursor: 'pointer',
  display: 'flex', alignItems: 'center', gap: 8,
  opacity: 0.7,
};

const btnPrimary = {
  background: THEME.brand, color: THEME.mint50, border: 'none', borderRadius: 12,
  padding: '14px 18px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
  width: '100%',
};

const btnSecondary = {
  background: THEME.surface, color: THEME.ink,
  border: `1px solid ${THEME.edge}`, borderRadius: 12,
  padding: '14px 18px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
  width: '100%',
};

// Bottom-anchor row buttons — visually distinct from the beige cards
// surrounding them. Brand-colored so the user can find them at a glance.
const btnPdfReport = {
  background: THEME.brand2, color: THEME.mint50, border: 'none', borderRadius: 12,
  padding: '14px 18px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
  width: '100%',
};

const btnReturn = {
  background: THEME.mint100, color: THEME.brand,
  border: `2px solid ${THEME.brand}`, borderRadius: 12,
  padding: '12px 18px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
  width: '100%',
};

const emptyState = {
  textAlign: 'center', padding: 32,
  color: THEME.muted, fontSize: 13, lineHeight: 1.6,
  border: `1px dashed ${THEME.edgeStrong}`, borderRadius: 12,
  background: THEME.paper, marginBottom: 14,
};

const modalBackdrop = {
  position: 'fixed', inset: 0, background: 'rgba(28, 25, 23, 0.6)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  zIndex: 1000, padding: 24,
};
