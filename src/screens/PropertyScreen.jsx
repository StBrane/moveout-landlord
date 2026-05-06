// ═══════════════════════════════════════════════════════════════════════════
// PropertyScreen.jsx — single property view with tenancies and inspections
// v0.3.0 — Photo Document split button, property-level PDF attach, bottom-sheet picker
// v0.3.0+ — Pills button (existing record picker → CaptureScreen), photodoc routing
// ═══════════════════════════════════════════════════════════════════════════
// Layout:
//   Header (forest green, big tap-target back button)
//   Property metadata
//   Top row: + Property Photos (left) | + Import PDF (right)
//   + New Lease button
//   Tenancy sections (most recent first)
//     - Active tenancy: expanded
//     - Past tenancies: collapsible
//     - Each shows tenant info, dates, rent, deposit, then:
//       - + Photo Document split button (main + chevron dropdown)
//       - Pills button — opens record picker for editing per-room item statuses
//       - List of inspections (tap to open, × to delete)
//       - View Tenancy Findings button (if eligible)
//   "Between tenancies" bucket for turnover + property-level Others
//   Bottom anchor row:
//     - Generate Report (PDF) — opens bottom sheet picker
//     - Return to Portfolio
//
// Routing semantics for inspection records:
//   Main "+ Photo Document" tap → creates Other:N record, routes to
//     #/photodoc/<propertyId>/<inspectionId>?cam=1 (PhotoDocGridScreen)
//   Chevron dropdown picks (Baseline / Mid-lease / Post-tenant / Turnover /
//     Other-with-label) → routes to #/capture/<propertyId>/<inspectionId>
//     (CaptureScreen, the per-room items+statuses surface)
//   Pills button picks → routes to #/capture/<propertyId>/<inspectionId>
//     (no autoOpenCamera since user is editing pills, not capturing)
//   Inspection card tap → routes to #/capture/<propertyId>/<inspectionId>
//     (preserves the user's last view of the record)
// ═══════════════════════════════════════════════════════════════════════════

import { useState } from 'react';
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
  attachPdf, detachPdf, listAttachedPdfs, nextOtherCounter,
} from '../lib/portfolioStore.js';
import { buildInspectionPDF } from '../lib/pdfBuilder.js';
import { buildComparisonPDF } from '../lib/comparisonPDF.js';
import { mergePdfs } from '../lib/pdfMerge.js';

const IS_NATIVE = Capacitor.isNativePlatform();

export default function PropertyScreen({
  portfolio, setPortfolio, propertyId,
  onBack, onCompare, onCapture, onTenancyFindings,
  // onImportPdf is the property-level PDF picker trigger from main.jsx.
  // Receives { propertyId } and opens the file input. Replaces the old
  // onImportTenantReport (.mosinsp flow).
  onImportPdf,
  photoStore,
}) {
  const property = getProperty(portfolio, propertyId);

  const [showNewTenancy, setShowNewTenancy] = useState(false);
  const [pendingInspection, setPendingInspection] = useState(null);
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
  const [pdfPickerSheetOpen, setPdfPickerSheetOpen] = useState(false);
  const [attachedPdfsOpen, setAttachedPdfsOpen] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [editingTenancyId, setEditingTenancyId] = useState(null);
  // Pills picker state — when set to a tenancy, the picker modal opens and
  // shows that tenancy's records. User picks one → routes to CaptureScreen.
  const [pillsPickerTenancyId, setPillsPickerTenancyId] = useState(null);

  if (!property) {
    return (
      <div style={{ padding: 20, color: THEME.ink }}>
        <div>Property not found.</div>
        <button onClick={onBack} style={btnSecondary}>← Back to portfolio</button>
      </div>
    );
  }

  const state = property.stateIdx != null ? STATE_LAWS[property.stateIdx] : null;
  const isTenancyActive = (t) => {
    if (!t?.endDate) return true;
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    return new Date(t.endDate).getTime() >= startOfToday.getTime();
  };
  const activeTenancy = property.tenancies.find(isTenancyActive) || null;

  // Property reference photos: a single growing record at the property level
  const propertyReferenceRecord = (property.betweenInspections || [])
    .find(i => i.type === 'other' && i.label === 'Property reference');

  // ─── Inspection creation flow ─────────────────────────────────────────
  // Now accepts an optional `opts` object with a custom `label` to override
  // the type's default label. Used by the Photo Document split button to
  // pass user-typed Other labels and auto-numbered Other:N labels.
  // opts.route forwards to main.jsx's handleCapture: 'photodoc' routes to
  // PhotoDocGridScreen (the new flat-grid surface for Other:N records),
  // anything else routes to CaptureScreen (the per-room items+statuses surface).
  const handleNewInspection = (typeId, tenancyId, opts = {}) => {
    const typeEntry = inspectionTypeById(typeId);
    if (!typeEntry) return;
    doCreateInspection(typeId, typeEntry.tenancyLink === 'between' ? null : tenancyId, opts);
  };

  const handleNewLease = () => setShowNewTenancy(true);

  const doCreateInspection = (typeId, tenancyId, opts = {}) => {
    const typeEntry = inspectionTypeById(typeId);
    const label = opts.label || typeEntry.label;
    const { portfolio: next, inspection } = createInspection(portfolio, propertyId, {
      typeId,
      label,
      tenancyId,
    });
    setPortfolio(next);
    // opts.autoOpenCamera is set by the Photo Document main-tap path so the
    // user lands on the capture screen with the camera already open instead
    // of having to tap a Camera button there.
    // opts.route lets the caller pick which screen to land on:
    //   'photodoc' → PhotoDocGridScreen (new flat-grid surface)
    //   undefined  → CaptureScreen (existing per-room UI, default)
    if (onCapture) {
      onCapture(inspection.id, {
        autoOpenCamera: !!opts.autoOpenCamera,
        route: opts.route,
      });
    }
  };

  // ─── Property Photos (canonical reference gallery) ────────────────────
  // First tap creates a "Property reference" record in betweenInspections
  // (no tenancyId) and routes to capture. Subsequent taps open that same
  // record so the user can add more shots — one canonical gallery, not
  // per-session slices.
  const handleAddPropertyPhotos = () => {
    if (propertyReferenceRecord) {
      if (onCapture) onCapture(propertyReferenceRecord.id);
      return;
    }
    const { portfolio: next, inspection } = createInspection(portfolio, propertyId, {
      typeId: 'other',
      label: 'Property reference',
      tenancyId: null,
    });
    setPortfolio(next);
    if (onCapture) onCapture(inspection.id);
  };

  const handleOpenPropertyPhotos = () => {
    if (propertyReferenceRecord && onCapture) {
      onCapture(propertyReferenceRecord.id);
    }
  };

  // ─── New tenancy creation ─────────────────────────────────────────────
  const handleCreateTenancy = (form) => {
    let workingPortfolio = portfolio;

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

  // ─── Pills picker handler ─────────────────────────────────────────────
  // Tapping the Pills button on a lease card opens a record picker scoped
  // to that lease. User picks one → we route to CaptureScreen for editing
  // (no autoOpenCamera; user is editing pills, not capturing).
  const handleOpenPills = (tenancyId) => setPillsPickerTenancyId(tenancyId);

  const handlePillsRecordPick = (inspectionId) => {
    setPillsPickerTenancyId(null);
    // route: 'capture' explicitly — Pills picks always go to CaptureScreen
    // (per-room items+statuses surface), not the photodoc grid surface.
    if (onCapture) onCapture(inspectionId, { route: 'capture' });
  };

  // ─── PDF generation from bottom sheet ─────────────────────────────────
  // Picks the right builder based on what's selected:
  //   1 inspection, 0 PDFs → buildInspectionPDF
  //   2-3, 0 PDFs → buildComparisonPDF (real diff)
  //   4+, 0 PDFs → buildComparisonPDF (evidence bundle, diff suppressed)
  //   anything + PDFs → above + mergePdfs
  //   0 inspections + 1+ PDFs → cover page + merged PDFs
  const handleGeneratePdf = async ({ inspectionIds, attachedPdfIds }) => {
    setPdfBusy(true);
    setPdfPickerSheetOpen(false);
    try {
      const inspections = inspectionIds.map(id => {
        return property.tenancies
          .flatMap(t => t.inspections)
          .concat(property.betweenInspections || [])
          .find(i => i.id === id);
      }).filter(Boolean);

      const attachedPdfs = listAttachedPdfs(property).filter(p => attachedPdfIds.includes(p.id));

      let blob;
      let baseFileName;

      if (inspections.length === 0 && attachedPdfs.length > 0) {
        // PDFs only — minimal cover page + merged attachments
        const { jsPDF } = await import('jspdf');
        const cover = new jsPDF({ unit: 'mm', format: 'letter' });
        cover.setFillColor(27, 58, 45);
        cover.rect(0, 0, 215.9, 30, 'F');
        cover.setTextColor(240, 253, 244);
        cover.setFontSize(20); cover.setFont('helvetica', 'bold');
        cover.text('MoveOut Shield Landlord', 18, 13);
        cover.setFontSize(10); cover.setFont('helvetica', 'normal');
        cover.text('Attached PDF Bundle', 18, 21);
        cover.text(property.address || '', 18, 27);
        cover.text(new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }), 215.9 - 18, 21, { align: 'right' });
        cover.text(property.name || '', 215.9 - 18, 27, { align: 'right' });
        cover.setTextColor(60, 60, 60);
        cover.setFontSize(11);
        cover.text(`${attachedPdfs.length} attached document${attachedPdfs.length === 1 ? '' : 's'}`, 18, 50);
        attachedPdfs.forEach((pdf, idx) => {
          cover.text(`${idx + 1}. ${pdf.fileName}${pdf.pageCount ? ` (${pdf.pageCount} pages)` : ''}`, 18, 60 + idx * 6);
        });
        blob = await mergePdfs(cover, attachedPdfs, photoStore);
        baseFileName = `${safeFileName(property.name)}-PDFs-${dateStamp()}.pdf`;
      } else if (inspections.length === 1 && attachedPdfs.length === 0) {
        const insp = inspections[0];
        const tenancy = property.tenancies.find(t => t.id === insp.tenancyId) || null;
        const doc = await buildInspectionPDF(insp, property, tenancy, photoStore);
        blob = doc.output('blob');
        baseFileName = `${safeFileName(property.name)}-${safeFileName(insp.label)}-${dateStamp()}.pdf`;
      } else if (inspections.length >= 2) {
        const diff = inspections.length <= 3 ? await buildDiff(inspections) : null;
        const doc = await buildComparisonPDF(inspections, diff, property, photoStore);
        blob = await mergePdfs(doc, attachedPdfs, photoStore);
        const labelHint = inspections.length <= 3 ? 'Comparison' : 'Bundle';
        baseFileName = `${safeFileName(property.name)}-${labelHint}-${inspections.length}way-${dateStamp()}.pdf`;
      } else {
        // 1 inspection + N attached PDFs
        const insp = inspections[0];
        const tenancy = property.tenancies.find(t => t.id === insp.tenancyId) || null;
        const doc = await buildInspectionPDF(insp, property, tenancy, photoStore);
        blob = await mergePdfs(doc, attachedPdfs, photoStore);
        baseFileName = `${safeFileName(property.name)}-${safeFileName(insp.label)}-Bundle-${dateStamp()}.pdf`;
      }

      // Deliver: native uses Filesystem + Share; web triggers download
      if (IS_NATIVE) {
        const arrayBuffer = await blob.arrayBuffer();
        const base64 = arrayBufferToBase64(arrayBuffer);
        await Filesystem.writeFile({
          path: baseFileName, data: base64,
          directory: Directory.Cache, recursive: true,
        });
        const { uri } = await Filesystem.getUri({
          path: baseFileName, directory: Directory.Cache,
        });
        try {
          await Share.share({
            title: `Report — ${property.name}`,
            text: property.name,
            url: uri,
            dialogTitle: 'Share Report',
          });
        } catch (e) {
          const msg = String(e?.message || '');
          if (!msg.includes('cancel') && !msg.includes('abort') && !msg.includes('dismiss')) throw e;
        }
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = baseFileName;
        document.body.appendChild(a); a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    } catch (e) {
      console.error('PDF generation failed:', e);
      alert('PDF generation failed: ' + (e?.message || 'unknown error'));
    } finally {
      setPdfBusy(false);
    }
  };

  // Handler for "Generate Report (PDF)" — always opens the picker sheet so
  // the user has a consistent surface for selecting records and bundling
  // PDFs. v0.3.0 used to auto-skip when there was a single inspection, but
  // that broke the mental model: predictable beats clever. The user can
  // still tap Generate immediately if they only want the one record.
  const handleGenerateButtonTap = () => {
    setPdfPickerSheetOpen(true);
  };

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

  const inspectionCount =
    property.tenancies.reduce((s, t) => s + t.inspections.length, 0) +
    (property.betweenInspections?.length || 0);
  const hasInspections = inspectionCount > 0;
  const hasAttachedPdfs = listAttachedPdfs(property).length > 0;

  return (
    <div style={{
      maxWidth: 720, margin: '0 auto',
      padding: 'calc(env(safe-area-inset-top) + 0px) 0 calc(env(safe-area-inset-bottom) + 32px) 0',
      minHeight: '100vh', background: THEME.bg,
    }}>
      {/* ─── Forest header (condensed two-column layout) ───────────────── */}
      <header style={{
        background: THEME.brand, color: THEME.mint50,
        padding: 'calc(env(safe-area-inset-top) + 14px) 18px 16px 18px',
        borderBottomLeftRadius: 18, borderBottomRightRadius: 18,
        marginBottom: 18,
      }}>
        <button onClick={onBack} style={{
          background: 'rgba(255,255,255,0.1)', color: THEME.mint100,
          border: `1px solid ${THEME.mint400}`, borderRadius: 999,
          padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
          marginBottom: 10, display: 'inline-flex', alignItems: 'center', gap: 6,
        }}>
          <span style={{ fontSize: 14 }}>‹</span> Portfolio
        </button>

        {/* Two-column: name + address on left, state info pinned right */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 style={{
              margin: 0, fontSize: 21, fontWeight: 700, color: THEME.mint50,
              letterSpacing: '-0.2px', lineHeight: 1.15,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {property.name}
            </h1>
            {property.address && (
              <div style={{
                fontSize: 12, color: THEME.mint200, marginTop: 3, opacity: 0.95,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {property.address}
              </div>
            )}
          </div>

          {state && (
            <div style={{
              flexShrink: 0, textAlign: 'right',
              fontSize: 10, color: THEME.mint200, opacity: 0.85,
              lineHeight: 1.4,
              maxWidth: 110,
            }}>
              <div style={{ fontWeight: 700, color: THEME.mint100 }}>
                {state[1]}
              </div>
              <div>{state[2]} day return</div>
              <div>{state[3]}</div>
            </div>
          )}
        </div>
      </header>

      <div style={{ padding: '0 16px' }}>

        {/* ─── Top row: Property Photos + Import PDF ─────────────────────── */}
        <PropertyTopRow
          property={property}
          propertyReferenceRecord={propertyReferenceRecord}
          onAddPropertyPhotos={handleAddPropertyPhotos}
          onOpenPropertyPhotos={handleOpenPropertyPhotos}
          onImportPdf={() => onImportPdf && onImportPdf({ propertyId })}
          attachedCount={listAttachedPdfs(property).length}
          onOpenAttachedPdfs={() => setAttachedPdfsOpen(true)}
        />

        {/* ─── Generate PDF (moved from bottom anchor — primary action) ──── */}
        <div style={{ marginBottom: 12 }}>
          <button
            onClick={handleGenerateButtonTap}
            disabled={(!hasInspections && !hasAttachedPdfs) || pdfBusy}
            style={{
              ...btnPdfReport,
              cursor: ((hasInspections || hasAttachedPdfs) && !pdfBusy) ? 'pointer' : 'not-allowed',
              opacity: ((hasInspections || hasAttachedPdfs) && !pdfBusy) ? 1 : 0.5,
            }}
          >
            {pdfBusy
              ? 'Building PDF…'
              : (hasInspections || hasAttachedPdfs)
                ? '📄 Generate Report (PDF)'
                : 'Generate Report (PDF) — nothing to export yet'}
          </button>
        </div>

        {/* ─── + New Lease ───────────────────────────────────────────────*/}
        <div style={{ marginBottom: 16 }}>
          <button onClick={handleNewLease} style={btnNewLease}>
            + New Lease
          </button>
        </div>

        {/* ─── Empty state ────────────────────────────────────────────────*/}
        {property.tenancies.length === 0 && (property.betweenInspections || []).length === 0 && (
          <div style={emptyState}>
            <div style={{ fontSize: 32, marginBottom: 6 }}>🔑</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: THEME.ink, marginBottom: 4 }}>
              No leases yet
            </div>
            <div>
              Tap <strong style={{ color: THEME.brand }}>+ New Lease</strong> above to start your first one,
              or capture <strong style={{ color: THEME.brand }}>+ Property Photos</strong> to set a canonical reference state.
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
              onCreateInspection={(typeId, opts) => handleNewInspection(typeId, tenancy.id, opts)}
              onTenancyFindings={onTenancyFindings ? () => onTenancyFindings(tenancy.id) : null}
              onOpenPills={() => handleOpenPills(tenancy.id)}
            />
          );
        })}

        {(property.betweenInspections?.length || 0) > 0 && (
          <BetweenSection
            inspections={property.betweenInspections}
            onDeleteInspection={handleDeleteInspection}
            onOpenInspection={onCapture}
          />
        )}

        {/* ─── Bottom anchor row ─────────────────────────────────────────── */}
        {/* Generate PDF moved to top of screen for primary-action surfacing.
            Bottom anchor keeps just the back-to-portfolio escape. */}
        <div style={{
          marginTop: 24, display: 'flex', flexDirection: 'column', gap: 10,
        }}>
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

      {pdfPickerSheetOpen && (
        <PdfPickerSheet
          property={property}
          onGenerate={handleGeneratePdf}
          onClose={() => setPdfPickerSheetOpen(false)}
          busy={pdfBusy}
        />
      )}

      {attachedPdfsOpen && (
        <AttachedPdfsList
          property={property}
          onClose={() => setAttachedPdfsOpen(false)}
          onDelete={async (pdfId) => {
            const pdf = listAttachedPdfs(property).find(p => p.id === pdfId);
            if (!pdf) return;
            if (!confirm(`Remove "${pdf.fileName}"? The file will be deleted.`)) return;
            if (IS_NATIVE && pdf.path) {
              try { await Filesystem.deleteFile({ path: pdf.path, directory: Directory.Data }); } catch {}
            }
            setPortfolio(detachPdf(portfolio, propertyId, pdfId));
          }}
          onAddMore={() => {
            setAttachedPdfsOpen(false);
            if (onImportPdf) onImportPdf({ propertyId });
          }}
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

      {pillsPickerTenancyId && (
        <PillsRecordPicker
          tenancy={property.tenancies.find(t => t.id === pillsPickerTenancyId)}
          onPick={handlePillsRecordPick}
          onClose={() => setPillsPickerTenancyId(null)}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Lazy diff helper — pulls diff.js dynamically so it's not in the initial
// render path. Returns the pairwise diff for 2-record selections, null for
// anything else. comparisonPDF.js handles null by routing through its
// "evidence bundle" path: cover + summary + photo galleries, no diff body.
// 3-way matrix support was never implemented and is intentionally deferred —
// the 2-record path is what the dispute-grade comparison case actually needs
// (Baseline vs Post-tenant, Move-In vs Move-Out, etc.).
// ═══════════════════════════════════════════════════════════════════════════
async function buildDiff(inspections) {
  if (inspections.length === 2) {
    const { diffInspections } = await import('../lib/diff.js');
    return diffInspections(inspections[0], inspections[1]);
  }
  return null;
}

function safeFileName(s) {
  return (s || 'Report').replace(/\s+/g, '-').replace(/[^A-Za-z0-9-_]/g, '');
}
function dateStamp() {
  return new Date().toISOString().slice(0, 10);
}
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

// ═══════════════════════════════════════════════════════════════════════════
// PropertyTopRow — Property Photos + Import PDF, side by side
// ═══════════════════════════════════════════════════════════════════════════
function PropertyTopRow({
  property,
  propertyReferenceRecord,
  onAddPropertyPhotos,
  onOpenPropertyPhotos,
  onImportPdf,
  attachedCount,
  onOpenAttachedPdfs,
}) {
  const photoCount = propertyReferenceRecord?.rooms
    ? Object.values(propertyReferenceRecord.rooms).reduce(
        (s, rd) => s + (rd.moveIn?.photos?.length || 0) + (rd.moveOut?.photos?.length || 0),
        0
      )
    : 0;

  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8,
      marginBottom: 14,
    }}>
      <button
        onClick={propertyReferenceRecord ? onOpenPropertyPhotos : onAddPropertyPhotos}
        style={topRowBtnLeft}
      >
        {propertyReferenceRecord ? (
          <>
            <span style={{ fontSize: 18 }}>🖼️</span>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', minWidth: 0 }}>
              <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>View Property Photos</span>
              <span style={{ fontSize: 10, color: THEME.muted, fontWeight: 500 }}>
                {photoCount} {photoCount === 1 ? 'photo' : 'photos'}
              </span>
            </div>
          </>
        ) : (
          <>
            <span style={{ fontSize: 18 }}>📷</span>
            <span>+ Property Photos</span>
          </>
        )}
      </button>

      <button
        onClick={attachedCount > 0 ? onOpenAttachedPdfs : onImportPdf}
        style={topRowBtnRight}
      >
        {attachedCount > 0 ? (
          <>
            <span style={{ fontSize: 18 }}>📎</span>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', minWidth: 0 }}>
              <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Attached PDFs</span>
              <span style={{ fontSize: 10, color: THEME.muted, fontWeight: 500 }}>
                {attachedCount} {attachedCount === 1 ? 'file' : 'files'}
              </span>
            </div>
          </>
        ) : (
          <>
            <span style={{ fontSize: 18 }}>📄</span>
            <span>+ Import PDF</span>
          </>
        )}
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TenancySection — renders one tenancy with its Photo Document button + records
// ═══════════════════════════════════════════════════════════════════════════
function TenancySection({
  tenancy, property, isActive, isCollapsed,
  onToggleCollapsed, onDeleteTenancy, onEditTenancy,
  onDeleteInspection, onOpenInspection, onCreateInspection, onTenancyFindings,
  onOpenPills,
}) {
  const tenantNames = tenancy.tenants?.length > 0 ? tenancy.tenants.join(', ') : '(unnamed tenant)';

  // Sort inspections by lifecycle order
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
              {tenancy.inspections.length} {tenancy.inspections.length === 1 ? 'record' : 'records'}
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

          {/* Photo Document button — single button, opens unified type picker */}
          {onCreateInspection && (
            <PhotoDocumentButton
              tenancy={tenancy}
              property={property}
              onCreate={onCreateInspection}
              onOpenExisting={onOpenInspection}
            />
          )}

          {/* Pills button — opens record picker for editing per-room item statuses.
              Only shown when there's at least one record in this lease — nothing
              to edit pills on otherwise. Routes to CaptureScreen for the picked
              record (the per-room items+statuses surface). */}
          {onOpenPills && tenancy.inspections.length > 0 && (
            <button onClick={onOpenPills} style={btnPills}>
              <span style={{ fontSize: 16 }}>🪄</span>
              <span>Pills · pick a record to edit</span>
            </button>
          )}

          {sortedInspections.length === 0 ? (
            <div style={{
              fontSize: 12, color: THEME.muted2, padding: '12px 0',
              textAlign: 'center', fontStyle: 'italic',
            }}>
              No records in this lease yet.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {sortedInspections.map(insp => (
                <InspectionCard
                  key={insp.id}
                  inspection={insp}
                  onOpen={onOpenInspection ? () => onOpenInspection(insp.id) : null}
                  onDelete={() => onDeleteInspection(insp.id, insp.label)}
                />
              ))}
            </div>
          )}

          {(() => {
            // Show Tenancy Findings button only when the lease has enough records
            // to find changes between. Need at least 2 canonical records.
            if (!onTenancyFindings) return null;
            const canonicalKinds = new Set(['baseline', 'tenant_move_in', 'post_tenant', 'tenant_move_out']);
            const canonicalCount = (tenancy.inspections || [])
              .filter(i => canonicalKinds.has(i.type)).length;
            if (canonicalCount < 2) return null;
            return (
              <button
                onClick={onTenancyFindings}
                style={{
                  background: THEME.brand, color: THEME.mint300,
                  border: `1px solid ${THEME.brand}`, borderRadius: 12,
                  padding: '12px 16px', fontSize: 13, fontWeight: 700,
                  cursor: 'pointer', width: '100%',
                  marginTop: 12,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                }}
              >
                <span style={{ fontSize: 15 }}>📊</span>
                <span>View Tenancy Findings</span>
              </button>
            );
          })()}

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
// PhotoDocumentButton — single button, opens unified type picker on every tap
// ═══════════════════════════════════════════════════════════════════════════
// v0.3.0+ unification: the chevron-vs-main split was confusing — main hid
// types behind a sub-action and silently picked Other:N. Now every tap of
// + Photo Document opens a picker showing all type options prominently:
//
//   📋 Baseline           (capped — shows ✓ exists if already used)
//   📋 Mid-lease          (capped — shows ✓ exists if already used)
//   📋 Post-tenant        (capped — shows ✓ exists if already used)
//   🔄 Turnover           (uncapped, amber accent — between-tenancy)
//   📝 Other (Other: N)   (uncapped — quick-tap auto-numbered Other)
//   📝 Other (custom)     (uncapped — opens label prompt)
//
// All picks route to PhotoDocGridScreen with the camera auto-opened.
// CaptureScreen is reached only via the Pills button.
function PhotoDocumentButton({ tenancy, property, onCreate, onOpenExisting }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [otherPromptOpen, setOtherPromptOpen] = useState(false);
  const [otherLabel, setOtherLabel] = useState('');

  // Per-tenancy cap lookup for lifecycle types (Baseline/Mid-lease/Post-tenant)
  // Other and Turnover are intentionally uncapped — they can stack
  const existingByType = {
    baseline:    tenancy.inspections.find(i => i.type === 'baseline')    || null,
    mid_lease:   tenancy.inspections.find(i => i.type === 'mid_lease')   || null,
    post_tenant: tenancy.inspections.find(i => i.type === 'post_tenant') || null,
  };

  const handleTypePick = (typeId) => {
    setPickerOpen(false);
    if (typeId === 'other-custom') {
      setOtherPromptOpen(true);
      return;
    }
    if (typeId === 'other-numbered') {
      const n = nextOtherCounter(property);
      // Auto-numbered Other → photodoc with camera auto-open
      onCreate('other', { label: `Other: ${n}`, autoOpenCamera: true });
      return;
    }
    if (typeId === 'turnover') {
      onCreate('turnover', { autoOpenCamera: true });
      return;
    }
    // Capped types: open existing if present, otherwise create
    const existing = existingByType[typeId];
    if (existing) {
      if (onOpenExisting) onOpenExisting(existing.id);
      return;
    }
    onCreate(typeId, { autoOpenCamera: true });
  };

  const submitOtherLabel = () => {
    const trimmed = otherLabel.trim();
    if (trimmed) {
      onCreate('other', { label: trimmed, autoOpenCamera: true });
    } else {
      const n = nextOtherCounter(property);
      onCreate('other', { label: `Other: ${n}`, autoOpenCamera: true });
    }
    setOtherLabel('');
    setOtherPromptOpen(false);
  };

  return (
    <>
      <div style={{
        marginBottom: 12, paddingTop: 8,
        borderTop: `1px dashed ${THEME.edge}`,
      }}>
        <button onClick={() => setPickerOpen(true)} style={photoDocBtn}>
          + Photo Document
        </button>
      </div>

      {pickerOpen && (
        <TypePicker
          existingByType={existingByType}
          onPick={handleTypePick}
          onClose={() => setPickerOpen(false)}
        />
      )}

      {otherPromptOpen && (
        <OtherLabelPrompt
          value={otherLabel}
          onChange={setOtherLabel}
          onSubmit={submitOtherLabel}
          onCancel={() => { setOtherLabel(''); setOtherPromptOpen(false); }}
        />
      )}
    </>
  );
}

// ─── TypePicker — unified type picker with all options visible ───────────
// All inspection types surface as prominent rows. Capped types show their
// existing record's label when one already exists — tapping opens that
// record (no duplicate creation). Uncapped types (Turnover, Other) always
// create new records. Two Other variants: quick-numbered (Other: N+1) and
// custom-labeled (opens prompt for user-typed label).
function TypePicker({ existingByType, onPick, onClose }) {
  const tenancyTypes = LANDLORD_INSPECTION_TYPES
    .filter(t => t.tenancyLink === 'tenancy' && t.id !== 'other');

  return (
    <div style={modalBackdrop} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{
        background: THEME.paper, borderRadius: 16, padding: 18,
        maxWidth: 380, width: '100%',
        border: `2px solid ${THEME.brand}`,
        boxShadow: '0 20px 50px rgba(0,0,0,0.3)',
        maxHeight: '85vh', overflowY: 'auto',
      }}>
        <div style={{
          fontSize: 13, color: THEME.muted, fontWeight: 600,
          marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5,
          textAlign: 'center',
        }}>
          Photo Document
        </div>
        <div style={{
          fontSize: 16, fontWeight: 700, color: THEME.ink,
          marginBottom: 16, textAlign: 'center',
        }}>
          Pick a type
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* Lifecycle types — Baseline / Mid-lease / Post-tenant */}
          {tenancyTypes.map(type => {
            const existing = existingByType[type.id];
            const used = !!existing;
            return (
              <button
                key={type.id}
                onClick={() => onPick(type.id)}
                style={used ? typeOptionUsed : typeOption}
              >
                <span style={{ fontSize: 22, lineHeight: 1, opacity: used ? 0.6 : 1 }}>{type.icon}</span>
                <div style={{ flex: 1, textAlign: 'left' }}>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>{type.label}</div>
                  <div style={{ fontSize: 10.5, color: used ? THEME.muted2 : THEME.muted, marginTop: 2 }}>
                    {used ? `Existing: ${existing.label}` : type.hint || ''}
                  </div>
                </div>
                {used && (
                  <span style={{ fontSize: 11, opacity: 0.7, fontWeight: 700, color: THEME.brand2 }}>
                    ✓ open
                  </span>
                )}
              </button>
            );
          })}

          {/* Turnover — between-tenancy, amber accent */}
          <button
            onClick={() => onPick('turnover')}
            style={{
              ...typeOption,
              background: '#FEF3C7', borderColor: '#FDE68A', color: '#92400E',
            }}
          >
            <span style={{ fontSize: 22, lineHeight: 1 }}>🔄</span>
            <div style={{ flex: 1, textAlign: 'left' }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>Turnover</div>
              <div style={{ fontSize: 10.5, color: '#78350F', marginTop: 2 }}>
                After cleaning &amp; repairs — sets the next tenant's baseline
              </div>
            </div>
          </button>

          {/* Other (auto-numbered) — quick-tap path, no prompt */}
          <button
            onClick={() => onPick('other-numbered')}
            style={typeOption}
          >
            <span style={{ fontSize: 22, lineHeight: 1 }}>📝</span>
            <div style={{ flex: 1, textAlign: 'left' }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>Other</div>
              <div style={{ fontSize: 10.5, color: THEME.muted, marginTop: 2 }}>
                Auto-numbered as "Other: N"
              </div>
            </div>
          </button>

          {/* Other (custom label) — opens prompt for user-typed label */}
          <button
            onClick={() => onPick('other-custom')}
            style={typeOption}
          >
            <span style={{ fontSize: 22, lineHeight: 1 }}>📝</span>
            <div style={{ flex: 1, textAlign: 'left' }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>Other (custom label)</div>
              <div style={{ fontSize: 10.5, color: THEME.muted, marginTop: 2 }}>
                e.g. "fridge replacement", "noise complaint"
              </div>
            </div>
          </button>
        </div>

        <button onClick={onClose} style={{
          ...btnSecondary, marginTop: 14, width: '100%',
        }}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─── Inline prompt for the "Other" custom label ───────────────────────────
function OtherLabelPrompt({ value, onChange, onSubmit, onCancel }) {
  return (
    <div style={modalBackdrop} onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div style={{
        background: THEME.paper, borderRadius: 16, padding: 22,
        maxWidth: 380, width: '100%',
        border: `2px solid ${THEME.brand}`,
        boxShadow: '0 20px 50px rgba(0,0,0,0.3)',
      }}>
        <div style={{ fontSize: 13, color: THEME.muted, fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Photo Document
        </div>
        <div style={{ fontSize: 16, fontWeight: 700, color: THEME.ink, marginBottom: 14 }}>
          What's this for?
        </div>

        <input
          type="text"
          autoFocus
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onSubmit(); if (e.key === 'Escape') onCancel(); }}
          placeholder="new appliance, proof of fix, complaint about noise..."
          style={{
            width: '100%', background: THEME.bg, color: THEME.ink,
            border: `1px solid ${THEME.edge}`, borderRadius: 8,
            padding: '10px 12px', fontSize: 14, boxSizing: 'border-box', outline: 'none',
            marginBottom: 12,
          }}
        />

        <div style={{ fontSize: 11, color: THEME.muted2, marginBottom: 18, lineHeight: 1.5 }}>
          Tap OK without typing to use the next "Other: N" number.
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onCancel} style={{ ...btnSecondary, flex: 1 }}>Cancel</button>
          <button onClick={onSubmit} style={{ ...btnPrimary, flex: 1, marginTop: 0 }}>OK</button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PillsRecordPicker — modal listing records in a tenancy for pill editing
// ═══════════════════════════════════════════════════════════════════════════
// Shown when the user taps the Pills button on a lease card. Surfaces every
// record in that lease as a tappable row. Tapping a record routes to
// CaptureScreen (per-room items+statuses surface) so the user can edit
// pills, add notes, or capture more photos for that record. The record's
// type is unchanged — Pills is a re-entry point to existing CaptureScreen
// behavior, not a type-changing operation.
function PillsRecordPicker({ tenancy, onPick, onClose }) {
  if (!tenancy) return null;

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

  const tenantNames = tenancy.tenants?.length > 0 ? tenancy.tenants.join(', ') : '(unnamed tenant)';

  return (
    <div style={modalBackdrop} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{
        background: THEME.paper, borderRadius: 16, padding: 22,
        maxWidth: 460, width: '100%',
        border: `2px solid ${THEME.brand}`,
        boxShadow: '0 20px 50px rgba(0,0,0,0.3)',
        maxHeight: '85vh', display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ fontSize: 13, color: THEME.muted, fontWeight: 600, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          🪄 Pills
        </div>
        <div style={{ fontSize: 17, fontWeight: 700, color: THEME.ink, marginBottom: 4 }}>
          Pick a record to edit
        </div>
        <div style={{ fontSize: 11, color: THEME.muted, marginBottom: 14, lineHeight: 1.5 }}>
          {tenantNames} · Tap a record to open its per-room items and statuses.
          You can edit pills, add notes, or capture more photos there.
        </div>

        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
          {sortedInspections.length === 0 ? (
            <div style={{
              padding: 24, textAlign: 'center', color: THEME.muted2,
              fontSize: 13, fontStyle: 'italic',
              background: THEME.bg, borderRadius: 10,
              border: `1px dashed ${THEME.edge}`,
            }}>
              No records in this lease yet.<br />
              Tap <strong style={{ color: THEME.brand }}>+ Photo Document</strong> first.
            </div>
          ) : (
            sortedInspections.map(insp => {
              const typeEntry = inspectionTypeById(insp.type) || {};
              const metrics = inspectionMetrics(insp);
              const ratedPct = metrics.possible > 0
                ? Math.round((metrics.rated / metrics.possible) * 100)
                : 0;
              return (
                <button
                  key={insp.id}
                  onClick={() => onPick(insp.id)}
                  disabled={!insp.editable}
                  style={{
                    background: insp.editable ? THEME.mint50 : THEME.surface,
                    border: `2px solid ${insp.editable ? THEME.mint300 : THEME.edge}`,
                    borderRadius: 10, padding: '10px 12px',
                    cursor: insp.editable ? 'pointer' : 'not-allowed',
                    display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left',
                    width: '100%', opacity: insp.editable ? 1 : 0.55,
                  }}
                >
                  <span style={{ fontSize: 18 }}>{typeEntry.icon || '📋'}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 13, fontWeight: 600, color: THEME.ink,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      display: 'flex', alignItems: 'center', gap: 6,
                    }}>
                      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {insp.label}
                      </span>
                      {!insp.editable && (
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
                      {typeEntry.label} · {formatDate(insp.createdAt)} · 📸 {metrics.photos}
                    </div>
                  </div>
                  {metrics.possible > 0 && (
                    <div style={{
                      fontSize: 10, color: THEME.brand, background: '#fff',
                      padding: '3px 9px', borderRadius: 999, fontWeight: 700,
                      border: `1.5px solid ${THEME.brand2}`,
                      flexShrink: 0,
                    }}>
                      {ratedPct}%
                    </div>
                  )}
                </button>
              );
            })
          )}
        </div>

        <button onClick={onClose} style={btnSecondary}>Cancel</button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// BetweenSection — turnover + property reference + property-level Others
// ═══════════════════════════════════════════════════════════════════════════
function BetweenSection({ inspections, onDeleteInspection, onOpenInspection }) {
  const sorted = [...inspections].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return (
    <div style={{
      marginBottom: 14, background: THEME.paper, borderRadius: 14,
      border: `1px solid ${THEME.edge}`,
      borderLeftWidth: 4, borderLeftColor: '#D97706',
      padding: 14,
    }}>
      <div style={{
        fontSize: 10, fontWeight: 700, color: '#D97706',
        textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8,
      }}>
        Property-level records
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {sorted.map(insp => (
          <InspectionCard
            key={insp.id}
            inspection={insp}
            onOpen={onOpenInspection ? () => onOpenInspection(insp.id) : null}
            onDelete={() => onDeleteInspection(insp.id, insp.label)}
          />
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// InspectionCard — single inspection row, tap to open
// ═══════════════════════════════════════════════════════════════════════════
function InspectionCard({ inspection, onOpen, onDelete }) {
  const typeEntry = inspectionTypeById(inspection.type) || {};
  const sourceColor = inspection.source === 'tenant' ? THEME.tenant : THEME.landlord;
  const metrics = inspectionMetrics(inspection);

  return (
    <div
      onClick={onOpen}
      style={{
        background: THEME.mint50,
        borderRadius: 10, padding: 10,
        border: `2px solid ${THEME.mint300}`,
        cursor: onOpen ? 'pointer' : 'default',
        display: 'flex', alignItems: 'center', gap: 10,
        transition: 'all 0.1s',
      }}
    >
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
// PdfPickerSheet — bottom sheet (85% height) for PDF generation
// ═══════════════════════════════════════════════════════════════════════════
// Sticky header + Generate button at top. Scrollable list below with two
// sections: Photo Documents (multi-select) and Attached PDFs (multi-select).
// Generate button label adapts to selection. Active when ≥1 selected.
// Device back button or backdrop tap dismisses.
function PdfPickerSheet({ property, onGenerate, onClose, busy }) {
  const [selectedInspections, setSelectedInspections] = useState(new Set());
  const [selectedPdfs, setSelectedPdfs] = useState(new Set());

  const inspectionItems = [];
  for (const tenancy of property.tenancies) {
    const tenantLabel = tenancy.tenants?.length > 0 ? tenancy.tenants.join(', ') : '(unnamed)';
    for (const insp of tenancy.inspections) {
      inspectionItems.push({ inspection: insp, tenancyLabel: tenantLabel });
    }
  }
  for (const insp of (property.betweenInspections || [])) {
    const isPropRef = insp.type === 'other' && insp.label === 'Property reference';
    inspectionItems.push({
      inspection: insp,
      tenancyLabel: isPropRef ? 'Property reference' : 'Property-level',
    });
  }
  inspectionItems.sort((a, b) => new Date(b.inspection.createdAt) - new Date(a.inspection.createdAt));

  const attachedPdfs = listAttachedPdfs(property);

  const toggleInspection = (id) => {
    const next = new Set(selectedInspections);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedInspections(next);
  };
  const togglePdf = (id) => {
    const next = new Set(selectedPdfs);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedPdfs(next);
  };

  const totalSelected = selectedInspections.size + selectedPdfs.size;
  const canGenerate = totalSelected > 0 && !busy;

  // Adaptive button label
  let buttonLabel = 'Pick at least one';
  if (selectedInspections.size === 1 && selectedPdfs.size === 0) {
    const insp = inspectionItems.find(it => selectedInspections.has(it.inspection.id))?.inspection;
    const photos = insp ? inspectionMetrics(insp).photos : 0;
    buttonLabel = `Generate PDF — ${insp?.label || ''} (${photos} photos)`;
  } else if (selectedInspections.size >= 2 && selectedInspections.size <= 3 && selectedPdfs.size === 0) {
    buttonLabel = `Generate PDF — Comparison (${selectedInspections.size} records)`;
  } else if (selectedInspections.size > 3 && selectedPdfs.size === 0) {
    buttonLabel = `Generate PDF — Evidence Bundle (${selectedInspections.size} records)`;
  } else if (selectedInspections.size === 0 && selectedPdfs.size > 0) {
    buttonLabel = `Bundle ${selectedPdfs.size} attached PDF${selectedPdfs.size === 1 ? '' : 's'}`;
  } else if (selectedInspections.size > 0 && selectedPdfs.size > 0) {
    buttonLabel = `Generate Bundle — ${selectedInspections.size} record${selectedInspections.size === 1 ? '' : 's'} + ${selectedPdfs.size} PDF${selectedPdfs.size === 1 ? '' : 's'}`;
  }

  if (busy) buttonLabel = 'Building PDF…';

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(28, 25, 23, 0.6)',
        zIndex: 1000, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: THEME.paper,
        borderTopLeftRadius: 18, borderTopRightRadius: 18,
        height: '85vh', maxHeight: '85vh',
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 -10px 40px rgba(0,0,0,0.3)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}>
        {/* Sticky header */}
        <div style={{
          padding: '14px 18px 10px 18px',
          borderBottom: `1px solid ${THEME.edge}`,
          background: THEME.paper,
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <div style={{ fontSize: 13, color: THEME.muted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Generate Report
            </div>
            <div style={{ fontSize: 11, color: THEME.muted2 }}>
              {totalSelected} selected
            </div>
          </div>

          <button
            disabled={!canGenerate}
            onClick={() => onGenerate({
              inspectionIds: [...selectedInspections],
              attachedPdfIds: [...selectedPdfs],
            })}
            style={{
              ...btnPrimary, width: '100%', marginTop: 6,
              background: canGenerate ? THEME.brand : THEME.surface,
              color: canGenerate ? THEME.mint50 : THEME.muted,
              cursor: canGenerate ? 'pointer' : 'not-allowed',
            }}
          >
            {buttonLabel}
          </button>
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px 24px 16px' }}>
          {inspectionItems.length > 0 && (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, color: THEME.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8, marginTop: 4 }}>
                Photo Documents
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 18 }}>
                {inspectionItems.map(({ inspection, tenancyLabel }) => {
                  const typeEntry = inspectionTypeById(inspection.type) || {};
                  const metrics = inspectionMetrics(inspection);
                  const isSelected = selectedInspections.has(inspection.id);
                  return (
                    <button
                      key={inspection.id}
                      onClick={() => toggleInspection(inspection.id)}
                      style={{
                        background: isSelected ? THEME.mint100 : THEME.bg,
                        border: `2px solid ${isSelected ? THEME.brand2 : THEME.edge}`,
                        borderRadius: 10, padding: '10px 12px', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left',
                        width: '100%',
                      }}
                    >
                      <div style={{
                        width: 20, height: 20, borderRadius: 6,
                        border: `2px solid ${isSelected ? THEME.brand2 : THEME.edgeStrong}`,
                        background: isSelected ? THEME.brand2 : '#fff',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: '#fff', fontSize: 13, fontWeight: 900, flexShrink: 0,
                      }}>
                        {isSelected ? '✓' : ''}
                      </div>
                      <span style={{ fontSize: 18 }}>{typeEntry.icon || '📋'}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: THEME.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {inspection.label}
                        </div>
                        <div style={{ fontSize: 11, color: THEME.muted, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {tenancyLabel} · {formatDate(inspection.createdAt)} · 📸 {metrics.photos}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {attachedPdfs.length > 0 && (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, color: THEME.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8, marginTop: 4 }}>
                Attached PDFs
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {attachedPdfs.map(pdf => {
                  const isSelected = selectedPdfs.has(pdf.id);
                  return (
                    <button
                      key={pdf.id}
                      onClick={() => togglePdf(pdf.id)}
                      style={{
                        background: isSelected ? THEME.mint100 : THEME.bg,
                        border: `2px solid ${isSelected ? THEME.brand2 : THEME.edge}`,
                        borderRadius: 10, padding: '10px 12px', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left',
                        width: '100%',
                      }}
                    >
                      <div style={{
                        width: 20, height: 20, borderRadius: 6,
                        border: `2px solid ${isSelected ? THEME.brand2 : THEME.edgeStrong}`,
                        background: isSelected ? THEME.brand2 : '#fff',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: '#fff', fontSize: 13, fontWeight: 900, flexShrink: 0,
                      }}>
                        {isSelected ? '✓' : ''}
                      </div>
                      <span style={{ fontSize: 18 }}>📄</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: THEME.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {pdf.fileName}
                        </div>
                        <div style={{ fontSize: 11, color: THEME.muted, marginTop: 2 }}>
                          attached {formatDate(pdf.importedAt)}
                          {pdf.pageCount ? ` · ${pdf.pageCount} pages` : ''}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {inspectionItems.length === 0 && attachedPdfs.length === 0 && (
            <div style={{
              padding: 32, textAlign: 'center', color: THEME.muted, fontSize: 13,
              background: THEME.bg, borderRadius: 10, border: `1px dashed ${THEME.edge}`,
            }}>
              No Photo Documents or attached PDFs yet.<br/>
              Capture a Photo Document or import a PDF to start.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// AttachedPdfsList — modal listing attached PDFs with delete + add buttons
// ═══════════════════════════════════════════════════════════════════════════
function AttachedPdfsList({ property, onClose, onDelete, onAddMore }) {
  const pdfs = listAttachedPdfs(property);
  return (
    <div style={modalBackdrop} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{
        background: THEME.paper, borderRadius: 16, padding: 22,
        maxWidth: 460, width: '100%',
        border: `2px solid ${THEME.brand}`,
        boxShadow: '0 20px 50px rgba(0,0,0,0.3)',
        maxHeight: '85vh', display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ fontSize: 13, color: THEME.muted, fontWeight: 600, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Attached PDFs
        </div>
        <div style={{ fontSize: 17, fontWeight: 700, color: THEME.ink, marginBottom: 12 }}>
          {pdfs.length} attached
        </div>

        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
          {pdfs.map(pdf => (
            <div key={pdf.id} style={{
              background: THEME.bg, border: `1px solid ${THEME.edge}`, borderRadius: 10,
              padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <span style={{ fontSize: 18 }}>📄</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: THEME.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {pdf.fileName}
                </div>
                <div style={{ fontSize: 11, color: THEME.muted, marginTop: 2 }}>
                  {formatDate(pdf.importedAt)}{pdf.pageCount ? ` · ${pdf.pageCount} pages` : ''}
                </div>
              </div>
              <button
                onClick={() => onDelete(pdf.id)}
                style={{
                  background: 'transparent', color: THEME.muted2, border: 'none',
                  fontSize: 18, cursor: 'pointer', padding: 4, opacity: 0.5, lineHeight: 1,
                }}
                aria-label="Delete attachment"
              >×</button>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} style={{ ...btnSecondary, flex: 1 }}>Done</button>
          <button onClick={onAddMore} style={{ ...btnPrimary, flex: 1, marginTop: 0 }}>+ Add More</button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// NewTenancyModal + EditTenancyModal — unchanged from v0.2
// ═══════════════════════════════════════════════════════════════════════════

function clampDate(value) {
  if (!value) return '';
  const m = value.match(/^(\d+)-(\d{2})-(\d{2})$/);
  if (!m) return value;
  const year = m[1].length > 4 ? m[1].slice(0, 4) : m[1];
  return `${year}-${m[2]}-${m[3]}`;
}

function sanitizeMoney(value) {
  if (!value) return '';
  let cleaned = value.replace(/[^\d.]/g, '');
  const firstDot = cleaned.indexOf('.');
  if (firstDot !== -1) {
    cleaned = cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '');
  }
  const dotIdx = cleaned.indexOf('.');
  if (dotIdx !== -1 && cleaned.length - dotIdx - 1 > 2) {
    cleaned = cleaned.slice(0, dotIdx + 3);
  }
  if (parseFloat(cleaned) > 999999.99) {
    cleaned = '999999.99';
  }
  return cleaned;
}

function NewTenancyModal({ property, activeTenancy, onCreate, onCancel, pendingTypeLabel }) {
  // Default the end date to one year from the start date. The user can still
  // clear it (blank = active lease) or pick a different date. Recomputed
  // whenever startDate changes, but only if the user hasn't manually edited
  // endDate (tracked via endDateTouched).
  const today = new Date().toISOString().slice(0, 10);
  const oneYearFromToday = (() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() + 1);
    return d.toISOString().slice(0, 10);
  })();
  const [form, setForm] = useState({
    tenants: '', rent: '', deposit: '',
    startDate: today,
    endDate: oneYearFromToday,
    copyFromTurnover: false,
    endActiveLeaseToday: !!activeTenancy,
  });
  const [endDateTouched, setEndDateTouched] = useState(false);

  const hasPriorTurnover = (property.betweenInspections || []).some(i => i.type === 'turnover');
  const activeLeaseTenants = activeTenancy?.tenants?.length > 0
    ? activeTenancy.tenants.join(', ')
    : '(unnamed tenant)';

  const handleSubmit = () => {
    // Tenant name is optional — if blank, the lease is created with no
    // named tenant and can be edited later. Dates were defaulted to today
    // and today+1yr in initial form state.
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

        <Label>Tenant name(s) <span style={{ color: THEME.muted2, fontWeight: 400 }}>(optional)</span></Label>
        <input style={input}
          placeholder="Jane Doe, John Doe"
          value={form.tenants}
          onChange={e => setForm({ ...form, tenants: e.target.value })} />
        <Hint>Separate multiple tenants with commas. Leave blank to create an unnamed lease — you can add tenants later.</Hint>

        <Label>Move-in date</Label>
        <input style={input} type="date"
          value={form.startDate}
          onChange={e => {
            const newStart = clampDate(e.target.value);
            setForm(f => {
              // Auto-shift end date to start+1yr if user hasn't edited it
              if (!endDateTouched && newStart) {
                const d = new Date(newStart);
                d.setFullYear(d.getFullYear() + 1);
                return { ...f, startDate: newStart, endDate: d.toISOString().slice(0, 10) };
              }
              return { ...f, startDate: newStart };
            });
          }} />

        <Label>Move-out date <span style={{ color: THEME.muted2, fontWeight: 400 }}>(defaults to 1 year — clear if active)</span></Label>
        <input style={input} type="date"
          value={form.endDate}
          onChange={e => {
            setEndDateTouched(true);
            setForm({ ...form, endDate: clampDate(e.target.value) });
          }} />

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

const btnNewLease = {
  background: THEME.brand, color: THEME.mint50, border: 'none', borderRadius: 12,
  padding: '14px 12px', fontSize: 14, fontWeight: 700, cursor: 'pointer',
  width: '100%',
};

// ─── Top row: Property Photos (left) + Import PDF (right) ─────────────────
const topRowBtnLeft = {
  background: THEME.mint50, color: THEME.brand,
  border: `2px solid ${THEME.mint300}`, borderRadius: 12,
  padding: '14px 12px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
  display: 'flex', alignItems: 'center', gap: 10,
};

const topRowBtnRight = {
  background: THEME.paper, color: THEME.ink,
  border: `2px solid ${THEME.edgeStrong}`, borderRadius: 12,
  padding: '14px 12px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
  display: 'flex', alignItems: 'center', gap: 10,
};

// ─── Photo Document button (per lease card) ──────────────────────────────
// Single full-width button. Opens unified type picker on every tap.
const photoDocBtn = {
  width: '100%',
  background: THEME.brand, color: THEME.mint50,
  border: 'none', borderRadius: 12,
  padding: '14px 12px', fontSize: 14, fontWeight: 700, cursor: 'pointer',
  marginTop: 8,
};

// ─── Type picker options (unified, roomier rows) ──────────────────────────
const typeOption = {
  background: THEME.mint50, color: THEME.brand,
  border: `2px solid ${THEME.mint300}`, borderRadius: 12,
  padding: '12px 14px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
  display: 'flex', alignItems: 'center', gap: 12,
  minHeight: 56,
};

const typeOptionUsed = {
  background: 'rgba(0, 0, 0, 0.04)', color: THEME.muted2,
  border: `1.5px dashed ${THEME.edge}`, borderRadius: 12,
  padding: '12px 14px', fontSize: 14, fontWeight: 500, cursor: 'pointer',
  display: 'flex', alignItems: 'center', gap: 12,
  minHeight: 56,
  opacity: 0.85,
};

// ─── Pills button (lease card) ────────────────────────────────────────────
// Sits between Photo Document split button and the Tenancy Findings button.
// Mint-tinted to read as a "scoped re-entry" action — distinct from the
// brand-green primary actions (Photo Document, Findings).
const btnPills = {
  background: THEME.mint50, color: THEME.brand,
  border: `2px solid ${THEME.mint300}`, borderRadius: 12,
  padding: '12px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
  width: '100%',
  marginBottom: 10,
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
};

// ─── (typeOption / typeOptionUsed defined above with the photoDocBtn) ────

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
