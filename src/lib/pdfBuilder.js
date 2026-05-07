// ═══════════════════════════════════════════════════════════════════════════
// pdfBuilder.js — generate a printable inspection report PDF
// v0.4 — Variant C photo grid, emoji-stripped, footer URL, last-page cert
// ═══════════════════════════════════════════════════════════════════════════
// Single-inspection report (one phase only — the inspection's defaultSlot)
// rather than the tenant's combined move-in + move-out doc. Landlord
// inspections are typically focused on one phase at a time (a baseline,
// a post-tenant, etc.) so the report renders that one phase.
//
// Cover page includes tenancy context (tenant names, lease span, rent,
// deposit) alongside the property metadata, since landlord reports are
// typically attached to a specific tenancy's records.
//
// Public API:
//   buildInspectionPDF(inspection, property, tenancy, photoStore) → Promise<jsPDF>
//
// PHOTO LAYOUT (Variant C, agreed v0.4):
//   - Page document margin: 18mm
//   - Photo gallery local margin: 14mm
//   - 4-up grid, 2mm gap, ~47mm cells, 64mm max height
//   - Letterbox-fit: aspect always preserved
//   - Caption: single line (date · GPS or just date)
//
// EMOJI / FOOTER / CERT:
//   See comparisonPDF.js — same v0.4 conventions.
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
const FOOTER_LIMIT = 268;   // leave 11mm for footer

// Photo gallery local margin (Variant C)
const PHOTO_MARGIN = 14;
const PHOTO_COL_W = PAGE_W - PHOTO_MARGIN * 2;
const PHOTO_COLS = 4;
const PHOTO_GAP = 2;
const PHOTO_CELL_W = (PHOTO_COL_W - PHOTO_GAP * (PHOTO_COLS - 1)) / PHOTO_COLS;
const PHOTO_MAX_H = 64;
const PHOTO_CAPTION_H = 5;

const SITE_URL = 'moveoutshield.app';

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
  // checkY is PURE: takes current y, returns possibly-new y after page break.
  // Callers must reassign: `y = checkY(y, n)`. See comparisonPDF.js for the
  // closure-capture bug this pattern fixes.
  const checkY = (currentY, n = 10) => {
    if (currentY + n > FOOTER_LIMIT) {
      doc.addPage();
      return 20;
    }
    return currentY;
  };

  // ─── Header band ─────────────────────────────────────────────────────────
  doc.setFillColor(...BRAND_RGB);
  doc.rect(0, 0, PAGE_W, 30, 'F');
  doc.setTextColor(240, 253, 244);
  doc.setFontSize(20); doc.setFont('helvetica', 'bold');
  doc.text('MoveOut Shield Landlord', MARGIN, 13);
  doc.setFontSize(10); doc.setFont('helvetica', 'normal');
  // Hyphen for em-dash compatibility (jsPDF helvetica)
  doc.text(`${typeEntry?.label || 'Inspection'} - ${phaseLabel}`, MARGIN, 21);
  doc.text(property?.address || '', MARGIN, 27);
  const reportDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  doc.text(reportDate, PAGE_W - MARGIN, 21, { align: 'right' });
  doc.text(property?.name || '', PAGE_W - MARGIN, 27, { align: 'right' });
  y = 38;

  // ─── Tenancy context block (if attached to a tenancy) ───────────────────
  if (tenancy) {
    y = checkY(y, 28);
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
    ].filter(Boolean).join(' \u00B7 ');
    if (moneyLine) doc.text(moneyLine, PAGE_W - MARGIN - 4, y + 17, { align: 'right' });
    y += 28;
  }

  // ─── State law block ────────────────────────────────────────────────────
  if (inspection.stateIdx != null && STATE_LAWS[inspection.stateIdx]) {
    const sl = STATE_LAWS[inspection.stateIdx];
    y = checkY(y, 26);
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
    { label: 'Items\nRated', value: `${totalRated}/${totalPossible || '-'}`, bg: [209, 250, 229], fg: [6, 95, 70] },
    { label: 'Photos\nCaptured', value: String(totalPhotos), bg: [254, 249, 195], fg: [146, 64, 14] },
    { label: 'Damaged\nItems', value: String(damagedCount),
      bg: damagedCount > 0 ? [254, 226, 226] : [209, 250, 229],
      fg: damagedCount > 0 ? [153, 27, 27] : [6, 95, 70] },
    { label: 'Inspected\nOn', value: formatDate(inspection.createdAt), bg: [219, 234, 254], fg: [30, 64, 175] },
  ];
  y = checkY(y, 24);
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

    // Room header band — emoji-stripped (rm.name only)
    y = checkY(y, 20);
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
        y = checkY(y, 6);
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
      y = checkY(y, 8);
      doc.setFillColor(254, 249, 195);
      doc.rect(MARGIN, y, COL_W, 6, 'F');
      doc.setTextColor(146, 64, 14);
      doc.setFontSize(7.5); doc.setFont('helvetica', 'bold');
      doc.text('NOTES', MARGIN + 3, y + 4.5);
      y += 8;
      const nl = doc.splitTextToSize(phaseData.notes, COL_W - 4);
      doc.setTextColor(80, 60, 0); doc.setFontSize(8); doc.setFont('helvetica', 'normal');
      y = checkY(y, nl.length * 4.5);
      doc.text(nl, MARGIN + 2, y);
      y += nl.length * 4.5 + 2;
    }

    // Photos (Variant C 4-up letterbox grid)
    if (hasPhotos) {
      y = checkY(y, 10);
      doc.setTextColor(...BRAND_RGB); doc.setFontSize(8); doc.setFont('helvetica', 'bold');
      doc.text(`${phaseData.photos.length} photo(s)`, MARGIN + 2, y);
      y += 6;

      y = renderPhotoGrid(doc, y, checkY, phaseData.photos, photoDataMap);
    }

    y += 6;
  }

  // ─── Certification footer (rendered on last page bottom margin) ─────────
  const lastPage = doc.internal.getNumberOfPages();
  doc.setPage(lastPage);
  doc.setTextColor(120, 120, 120);
  doc.setFontSize(7.5); doc.setFont('helvetica', 'italic');
  const certLine = `I certify this report accurately reflects the condition of the unit at the time of inspection. - ${property?.name || ''}, ${reportDate}`;
  const certLines = doc.splitTextToSize(certLine, COL_W);
  const certY = PAGE_H - 12 - certLines.length * 3.5;
  doc.text(certLines, MARGIN, certY);

  // ─── Footer on every page (URL left, page-num right) ────────────────────
  const pageCount = doc.internal.getNumberOfPages();
  for (let pn = 1; pn <= pageCount; pn++) {
    doc.setPage(pn);
    doc.setTextColor(160, 155, 150);
    doc.setFontSize(7); doc.setFont('helvetica', 'normal');
    doc.text(SITE_URL, MARGIN, PAGE_H - 8);
    doc.text(`Page ${pn} of ${pageCount}`, PAGE_W - MARGIN, PAGE_H - 8, { align: 'right' });
  }

  return doc;
}

// ─── Variant C photo grid (4-up letterbox) ──────────────────────────────────
// Shared layout used for per-room photos in this single-inspection report.
function renderPhotoGrid(doc, y, checkY, photos, photoDataMap) {
  let col = 0;
  let rowMaxH = 0;
  let rowStartY = y;

  for (const p of photos) {
    if (col === 0) {
      y = checkY(y, PHOTO_MAX_H + PHOTO_CAPTION_H + 4);
      rowStartY = y;
      rowMaxH = 0;
    }

    const cx = PHOTO_MARGIN + col * (PHOTO_CELL_W + PHOTO_GAP);
    const cy = rowStartY;

    // Letterbox-fit dimensions
    const ratio = (typeof p.ratio === 'number' && p.ratio > 0) ? p.ratio : 0.75;
    let drawW, drawH;
    const naturalH = PHOTO_CELL_W * ratio;
    if (naturalH <= PHOTO_MAX_H) {
      drawW = PHOTO_CELL_W;
      drawH = naturalH;
    } else {
      drawH = PHOTO_MAX_H;
      drawW = drawH / ratio;
    }
    const drawX = cx + (PHOTO_CELL_W - drawW) / 2;
    const drawY = cy + (PHOTO_MAX_H - drawH) / 2;
    rowMaxH = Math.max(rowMaxH, PHOTO_MAX_H);

    // Cell background
    doc.setFillColor(248, 245, 240);
    doc.rect(cx, cy, PHOTO_CELL_W, PHOTO_MAX_H, 'F');

    const imgData = photoDataMap.get(p.path || p.url || '');
    if (imgData) {
      try {
        doc.addImage(imgData, 'JPEG', drawX, drawY, drawW, drawH);
      } catch {
        // image data invalid — placeholder bg already drawn
      }
    } else {
      doc.setTextColor(160, 155, 150);
      doc.setFontSize(7); doc.setFont('helvetica', 'italic');
      doc.text('photo unavailable', cx + PHOTO_CELL_W / 2, cy + PHOTO_MAX_H / 2, { align: 'center' });
    }

    // Damaged-flag treatment — red border + FLAGGED badge top-right.
    // Mirrors the app UI behavior for photos tagged via Tag Damages.
    if (p.damaged) {
      doc.setDrawColor(153, 27, 27);
      doc.setLineWidth(0.8);
      doc.rect(cx, cy, PHOTO_CELL_W, PHOTO_MAX_H, 'S');
      doc.setLineWidth(0.2);

      const badgeText = 'FLAGGED';
      doc.setFontSize(6); doc.setFont('helvetica', 'bold');
      const badgeW = doc.getTextWidth(badgeText) + 3;
      const badgeX = cx + PHOTO_CELL_W - badgeW - 1.5;
      const badgeY = cy + 1.5;
      doc.setFillColor(153, 27, 27);
      doc.roundedRect(badgeX, badgeY, badgeW, 4, 1, 1, 'F');
      doc.setTextColor(255, 255, 255);
      doc.text(badgeText, badgeX + badgeW / 2, badgeY + 2.8, { align: 'center' });
    }

    // Single-line caption
    const captionY = cy + PHOTO_MAX_H + 3;
    doc.setTextColor(80, 80, 80);
    doc.setFontSize(7); doc.setFont('helvetica', 'normal');
    const caption = buildCaption(p);
    doc.text(caption, cx, captionY, { maxWidth: PHOTO_CELL_W });

    col++;
    if (col === PHOTO_COLS) {
      col = 0;
      y = rowStartY + PHOTO_MAX_H + PHOTO_CAPTION_H + 4;
    }
  }
  if (col !== 0) {
    y = rowStartY + PHOTO_MAX_H + PHOTO_CAPTION_H + 4;
  }
  return y;
}

// Single-line caption: "May 6 · 39.7,-89.3" or "May 6"
function buildCaption(photo) {
  const parts = [];
  if (photo.ts) parts.push(formatDateForCaption(photo.ts));
  if (photo.lat && photo.lng) {
    const lat = typeof photo.lat === 'number' ? photo.lat.toFixed(2) : String(photo.lat).slice(0, 6);
    const lng = typeof photo.lng === 'number' ? photo.lng.toFixed(2) : String(photo.lng).slice(0, 6);
    parts.push(`${lat},${lng}`);
  }
  return parts.join(' \u00B7 ');
}

function formatDateForCaption(ts) {
  if (!ts) return '';
  // Strategy: try Date.parse first (handles ISO format and "May 6, 09:16 PM"
  // display format). If valid, format as "May 6". If parsing fails, the
  // timestamp may be a free-form display string — fall back to taking just
  // the leading "Mon D" segment (everything before the first comma) so the
  // caption stays single-line.
  const parsed = Date.parse(ts);
  if (!isNaN(parsed)) {
    const d = new Date(parsed);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  const commaIdx = ts.indexOf(',');
  if (commaIdx > 0) return ts.slice(0, commaIdx);
  return ts;
}
