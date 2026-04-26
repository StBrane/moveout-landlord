// ═══════════════════════════════════════════════════════════════════════════
// pdfBuilder.js — generate a printable inspection report PDF
// ═══════════════════════════════════════════════════════════════════════════
// Ported from tenant `mainnewest.jsx` buildPDFDoc with two structural changes:
//
//   1. Generates a SINGLE-INSPECTION report (one phase only — the inspection's
//      defaultSlot) rather than the tenant's combined move-in + move-out doc.
//      Landlord inspections are typically focused on one phase at a time
//      (a baseline, a post-tenant, etc.) so the report renders that one phase.
//
//   2. Cover page includes tenancy context (tenant names, lease span, rent,
//      deposit) alongside the property metadata, since landlord reports are
//      typically attached to a specific tenancy's records.
//
// Public API:
//   buildInspectionPDF(inspection, property, tenancy, photoStore) → Promise<jsPDF>
//
// Usage in PropertyScreen:
//   const doc = await buildInspectionPDF(insp, property, tenancy, photoStore);
//   doc.save(`${property.name}-${insp.label}.pdf`);
//
// On native, save via Filesystem.writeFile + Share.share (same pattern as
// tenant). buildInspectionPDF returns a jsPDF instance — the caller decides
// the output method.
// ═══════════════════════════════════════════════════════════════════════════

import { jsPDF } from 'jspdf';
import {
  ROOMS, STATUS, STATE_LAWS,
  inspectionTypeById, formatDate, formatTenancySpan,
} from './constants.js';

// ───────────────────────────────────────────────────────────────────────────
// Render constants — letter size in millimeters, forest-green header
// ───────────────────────────────────────────────────────────────────────────
const PAGE_W = 215.9;
const PAGE_H = 279.4;
const MARGIN = 18;
const COL_W = PAGE_W - MARGIN * 2;
const FOOTER_LIMIT = 272;   // leave room for footer

// Forest green RGB matching THEME.brand
const BRAND_RGB = [27, 58, 45];      // #1B3A2D
const BRAND2_RGB = [43, 106, 79];    // #2D6A4F

// Status text colors for the per-item rows
const STATUS_RGB = {
  clean:   [30, 64, 175],
  fair:    [6, 95, 70],
  damaged: [153, 27, 27],
  na:      [80, 80, 80],
};

// ───────────────────────────────────────────────────────────────────────────
// Public: build the inspection report
// ───────────────────────────────────────────────────────────────────────────
export async function buildInspectionPDF(inspection, property, tenancy, photoStore) {
  if (!inspection) throw new Error('buildInspectionPDF: inspection required');

  const typeEntry = inspectionTypeById(inspection.type);
  const slot = typeEntry?.defaultSlot || 'moveIn';
  const phaseLabel = slot === 'moveIn' ? 'Move-In Condition' : 'Move-Out Condition';

  // Pre-resolve all photo data URLs (PDF embedding needs base64)
  const photoDataMap = new Map();
  for (const rm of ROOMS) {
    const phaseData = inspection.rooms?.[rm.id]?.[slot];
    if (!phaseData?.photos) continue;
    for (const p of phaseData.photos) {
      const key = p.path || p.url || '';
      if (!key || photoDataMap.has(key)) continue;
      if (p.url) {
        photoDataMap.set(key, p.url);
      } else if (p.path && photoStore) {
        try {
          const dataUrl = await photoStore.readAsDataUrl(p.path);
          if (dataUrl) photoDataMap.set(key, dataUrl);
        } catch {
          // skip — broken photo path, will render as a gap
        }
      }
    }
  }

  const doc = new jsPDF({ unit: 'mm', format: 'letter' });
  let y = 20;
  const checkY = (n = 10) => { if (y + n > FOOTER_LIMIT) { doc.addPage(); y = 20; } };

  // ─── Header band ─────────────────────────────────────────────────────────
  doc.setFillColor(...BRAND_RGB);
  doc.rect(0, 0, PAGE_W, 30, 'F');
  doc.setTextColor(240, 253, 244);
  doc.setFontSize(20); doc.setFont('helvetica', 'bold');
  doc.text('MoveOut Shield Landlord', MARGIN, 13);
  doc.setFontSize(10); doc.setFont('helvetica', 'normal');
  doc.text(`${typeEntry?.label || 'Inspection'} — ${phaseLabel}`, MARGIN, 21);
  doc.text(property?.address || '', MARGIN, 27);
  const reportDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  doc.text(reportDate, PAGE_W - MARGIN, 21, { align: 'right' });
  doc.text(property?.name || '', PAGE_W - MARGIN, 27, { align: 'right' });
  y = 38;

  // ─── Tenancy context block (if attached to a tenancy) ───────────────────
  if (tenancy) {
    checkY(28);
    doc.setFillColor(248, 245, 240); doc.setDrawColor(196, 181, 165);
    doc.roundedRect(MARGIN, y, COL_W, 22, 3, 3, 'FD');
    doc.setTextColor(...BRAND_RGB);
    doc.setFontSize(9); doc.setFont('helvetica', 'bold');
    doc.text('Tenancy', MARGIN + 4, y + 6);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(40, 40, 40);
    const tenants = tenancy.tenants?.length ? tenancy.tenants.join(', ') : '(unnamed)';
    const span = formatTenancySpan(tenancy);
    doc.text(`Tenants: ${tenants}`, MARGIN + 4, y + 12);
    doc.text(`Lease: ${span}`, MARGIN + 4, y + 17);
    const moneyLine = [
      tenancy.rent != null ? `Rent $${tenancy.rent}/mo` : null,
      tenancy.deposit != null ? `Deposit $${tenancy.deposit}` : null,
    ].filter(Boolean).join(' · ');
    if (moneyLine) doc.text(moneyLine, PAGE_W - MARGIN - 4, y + 17, { align: 'right' });
    y += 28;
  }

  // ─── State law block ────────────────────────────────────────────────────
  if (inspection.stateIdx != null && STATE_LAWS[inspection.stateIdx]) {
    const sl = STATE_LAWS[inspection.stateIdx];
    checkY(26);
    doc.setFillColor(239, 246, 255); doc.setDrawColor(147, 197, 253);
    doc.roundedRect(MARGIN, y, COL_W, 22, 3, 3, 'FD');
    doc.setTextColor(30, 64, 175);
    doc.setFontSize(9); doc.setFont('helvetica', 'bold');
    doc.text(`${sl[0]} Deposit Law`, MARGIN + 4, y + 7);
    doc.setFont('helvetica', 'normal');
    doc.text(`Return deadline: ${sl[2]} days after move-out`, MARGIN + 4, y + 13);
    const penLine = doc.splitTextToSize(`Penalty: ${sl[3]}  |  ${sl[4]}`, COL_W - 8);
    doc.text(penLine, MARGIN + 4, y + 19);
    y += 28;
  }

  // ─── Inspection summary boxes ────────────────────────────────────────────
  let totalRated = 0;
  let totalPossible = 0;
  let totalPhotos = 0;
  let damagedCount = 0;
  for (const rm of ROOMS) {
    const phaseData = inspection.rooms?.[rm.id]?.[slot];
    if (!phaseData) continue;
    const ratedHere = phaseData.statuses ? Object.keys(phaseData.statuses).length : 0;
    const photosHere = phaseData.photos?.length || 0;
    if (ratedHere > 0 || photosHere > 0 || (phaseData.notes || '').trim()) {
      totalPossible += rm.items.length;
      totalRated += ratedHere;
      totalPhotos += photosHere;
      for (const status of Object.values(phaseData.statuses || {})) {
        if (status === 'damaged') damagedCount++;
      }
    }
  }

  const boxes = [
    { label: 'Items\nRated', value: `${totalRated}/${totalPossible || '—'}`, bg: [209, 250, 229], fg: [6, 95, 70] },
    { label: 'Photos\nCaptured', value: String(totalPhotos), bg: [254, 249, 195], fg: [146, 64, 14] },
    { label: 'Damaged\nItems', value: String(damagedCount),
      bg: damagedCount > 0 ? [254, 226, 226] : [209, 250, 229],
      fg: damagedCount > 0 ? [153, 27, 27] : [6, 95, 70] },
    { label: 'Inspected\nOn', value: formatDate(inspection.createdAt), bg: [219, 234, 254], fg: [30, 64, 175] },
  ];
  checkY(24);
  const bW = (COL_W - 9) / 4;
  boxes.forEach((b, i) => {
    const bx = MARGIN + i * (bW + 3);
    doc.setFillColor(...b.bg);
    doc.roundedRect(bx, y, bW, 20, 2, 2, 'F');
    doc.setTextColor(...b.fg);
    doc.setFontSize(13); doc.setFont('helvetica', 'bold');
    doc.text(b.value, bx + bW / 2, y + 9, { align: 'center' });
    doc.setFontSize(6); doc.setFont('helvetica', 'normal');
    b.label.split('\n').forEach((ll, li) => {
      doc.text(ll, bx + bW / 2, y + 14 + li * 3.5, { align: 'center' });
    });
  });
  y += 28;

  // ─── Per-room sections ──────────────────────────────────────────────────
  for (const rm of ROOMS) {
    const phaseData = inspection.rooms?.[rm.id]?.[slot];
    if (!phaseData) continue;
    const statusKeys = Object.keys(phaseData.statuses || {});
    const hasNotes = (phaseData.notes || '').trim().length > 0;
    const hasPhotos = (phaseData.photos?.length || 0) > 0;

    // Skip rooms with no engagement
    if (!statusKeys.length && !hasNotes && !hasPhotos) continue;

    // Room header band
    checkY(20);
    doc.setFillColor(...BRAND2_RGB);
    doc.roundedRect(MARGIN, y, COL_W, 10, 2, 2, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(10); doc.setFont('helvetica', 'bold');
    doc.text(rm.name, MARGIN + 4, y + 7);
    y += 14;

    // Item ratings
    if (statusKeys.length > 0) {
      rm.items.forEach((item, i) => {
        const st = phaseData.statuses[i];
        if (!st) return;
        checkY(6);
        const clr = STATUS_RGB[st] || [80, 80, 80];
        doc.setTextColor(...clr);
        doc.setFontSize(8); doc.setFont('helvetica', 'bold');
        const shortLabel = STATUS[st]?.short || st.toUpperCase();
        doc.text(`[${shortLabel}]`, MARGIN + 2, y);
        doc.setTextColor(40, 40, 40); doc.setFont('helvetica', 'normal');
        const lines = doc.splitTextToSize(item, COL_W - 26);
        doc.text(lines, MARGIN + 22, y);
        y += lines.length * 4.5;
      });
      y += 2;
    }

    // Notes
    if (hasNotes) {
      checkY(8);
      doc.setFillColor(254, 249, 195);
      doc.rect(MARGIN, y, COL_W, 6, 'F');
      doc.setTextColor(146, 64, 14);
      doc.setFontSize(7.5); doc.setFont('helvetica', 'bold');
      doc.text('NOTES', MARGIN + 3, y + 4.5);
      y += 8;
      const nl = doc.splitTextToSize(phaseData.notes, COL_W - 4);
      doc.setTextColor(80, 60, 0); doc.setFontSize(8); doc.setFont('helvetica', 'normal');
      checkY(nl.length * 4.5);
      doc.text(nl, MARGIN + 2, y);
      y += nl.length * 4.5 + 2;
    }

    // Photos
    if (hasPhotos) {
      checkY(10);
      doc.setTextColor(...BRAND_RGB); doc.setFontSize(8); doc.setFont('helvetica', 'bold');
      doc.text(`${phaseData.photos.length} photo(s)`, MARGIN + 2, y);
      y += 6;

      const tW = 34, perRow = 3, maxTH = 46, captionH = 14;
      let tx = MARGIN + 2;
      let rowMaxH = 0;
      phaseData.photos.forEach((p, pi) => {
        const tH = Math.min(Math.round(tW * (p.ratio || 0.75)), maxTH);
        if (pi > 0 && pi % perRow === 0) {
          y += rowMaxH + captionH;
          tx = MARGIN + 2;
          rowMaxH = 0;
        }
        checkY(tH + captionH);
        rowMaxH = Math.max(rowMaxH, tH);

        try {
          const imgData = photoDataMap.get(p.path || p.url || '');
          if (imgData) doc.addImage(imgData, 'JPEG', tx, y, tW, tH);
        } catch {
          // skip — image data invalid
        }
        doc.setTextColor(80, 80, 80); doc.setFontSize(5.5); doc.setFont('helvetica', 'normal');
        if (p.ts) doc.text(formatDateForCaption(p.ts), tx, y + tH + 3.5, { maxWidth: tW });
        if (p.lat) doc.text(`GPS: ${p.lat},${p.lng}`, tx, y + tH + 7, { maxWidth: tW });
        tx += tW + 3;
      });
      y += rowMaxH + captionH + 2;
    }

    y += 6;
  }

  // ─── Certification footer ────────────────────────────────────────────────
  if (y + 16 > FOOTER_LIMIT) { doc.addPage(); y = 20; }
  y += 4;
  doc.setTextColor(120, 120, 120); doc.setFontSize(7.5); doc.setFont('helvetica', 'italic');
  const certLine = `I certify this report accurately reflects the condition of the unit at the time of inspection. — ${property?.name || ''}, ${reportDate}`;
  doc.text(certLine, MARGIN, y, { maxWidth: COL_W });

  // Page numbers
  const pageCount = doc.internal.getNumberOfPages();
  for (let pn = 1; pn <= pageCount; pn++) {
    doc.setPage(pn);
    doc.setTextColor(160, 155, 150); doc.setFontSize(7); doc.setFont('helvetica', 'normal');
    doc.text(`Page ${pn} of ${pageCount}`, PAGE_W - MARGIN, PAGE_H - 8, { align: 'right' });
  }

  return doc;
}

// ─── Format ISO timestamp into a short caption ──────────────────────────────
function formatDateForCaption(ts) {
  if (!ts) return '';
  // Handle both ISO and pre-formatted strings
  if (/^\d{4}-\d{2}-\d{2}T/.test(ts)) {
    const d = new Date(ts);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  return ts;
}
