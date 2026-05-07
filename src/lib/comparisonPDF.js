// ═══════════════════════════════════════════════════════════════════════════
// comparisonPDF.js — generate a side-by-side comparison PDF or evidence bundle
// v0.4 — Variant C photo grid, emoji-stripped, footer URL, last-page cert
// ═══════════════════════════════════════════════════════════════════════════
// Builds the dispute-grade evidence package:
//
//   1. Cover page  — property + N inspection cards + summary boxes
//   2. Per-room diff — only for 2-way comparisons. 3-way matrix not yet
//      implemented (delayed); 3+ falls through to bundle mode.
//   3. Photo galleries at the bottom — one section per inspection
//
// Public API:
//   buildComparisonPDF(inspections, diff, property, photoStore) → Promise<jsPDF>
//
// `diff` is the output of diffInspections() from diff.js for 2-way. For
// 3+ records (evidence bundles) callers pass null — the function detects
// the count and skips the diff body accordingly.
//
// PHOTO LAYOUT (Variant C, agreed v0.4):
//   - Page document margin (header/text/summary): 18mm
//   - Photo gallery local margin: 14mm  (wider photo grid, +11% cell width)
//   - 4-up grid, 2mm gap, ~47mm cells, 64mm max height
//   - Letterbox-fit: aspect always preserved, photo centered in cell
//   - Caption: single line "May 6 · 39.7,-89.3" or just date (5mm)
//   - Result: ~12 photos per page
//
// EMOJI / GLYPH HANDLING:
//   jsPDF default helvetica cannot render emoji codepoints (renders as
//   "Ø=Þª" mojibake). All PDF text is ASCII-safe:
//     - Room labels use rm.name only (no rm.icon)
//     - Em-dash → hyphen, arrow → "->"
//     - Section headers stay text-only
//
// FOOTER:
//   Every page gets:
//     - "moveoutshield.app" left-aligned at PAGE_H - 8
//     - "Page N of M" right-aligned at PAGE_H - 8
//
// CERTIFICATION FOOTER:
//   Rendered into the bottom margin of the LAST page via doc.setPage(pageCount).
//   Old behavior appended to y cursor and triggered a fresh blank page when
//   y was already near FOOTER_LIMIT.
// ═══════════════════════════════════════════════════════════════════════════

import { jsPDF } from 'jspdf';
import {
  ROOMS, STATUS,
  inspectionTypeById, formatDate,
} from './constants.js';

// Render constants — letter size in millimeters
const PAGE_W = 215.9;
const PAGE_H = 279.4;
const MARGIN = 18;
const COL_W = PAGE_W - MARGIN * 2;
const FOOTER_LIMIT = 268;   // leave 11mm for moveoutshield.app + page-num footer

// Photo gallery uses a tighter local margin for wider cells
const PHOTO_MARGIN = 14;
const PHOTO_COL_W = PAGE_W - PHOTO_MARGIN * 2;
const PHOTO_COLS = 4;
const PHOTO_GAP = 2;
const PHOTO_CELL_W = (PHOTO_COL_W - PHOTO_GAP * (PHOTO_COLS - 1)) / PHOTO_COLS;
const PHOTO_MAX_H = 64;
const PHOTO_CAPTION_H = 5;

const SITE_URL = 'moveoutshield.app';

// Brand colors
const BRAND_RGB = [27, 58, 45];
const BRAND2_RGB = [43, 106, 79];
const TENANT_RGB = [30, 64, 175];
const LANDLORD_RGB = [6, 95, 70];

// Status visual treatment (matches STATUS map in constants.js)
const STATUS_RGB = {
  clean:   [30, 64, 175],
  fair:    [6, 95, 70],
  damaged: [153, 27, 27],
  na:      [80, 80, 80],
};
const STATUS_BG_RGB = {
  clean:   [219, 234, 254],
  fair:    [209, 250, 229],
  damaged: [254, 226, 226],
  na:      [229, 231, 235],
};

// Change-type colors for highlighting rows
const CHANGE_RGB = {
  worsened: [254, 226, 226],
  improved: [220, 252, 231],
  added:    [254, 249, 195],
  removed:  [243, 232, 255],
  mixed:    [254, 249, 195],
};

// ───────────────────────────────────────────────────────────────────────────
// Public: build the comparison report
// ───────────────────────────────────────────────────────────────────────────
export async function buildComparisonPDF(inspections, diff, property, photoStore) {
  if (!inspections || inspections.length < 2) {
    throw new Error('buildComparisonPDF: at least 2 inspections required');
  }
  const isTwoWay = inspections.length === 2 && !!diff;

  // Pre-resolve all photo data URLs across ALL inspections.
  const photoDataMap = new Map();
  for (const insp of inspections) {
    for (const rd of Object.values(insp.rooms || {})) {
      for (const phaseKey of ['moveIn', 'moveOut']) {
        const phase = rd[phaseKey];
        if (!phase?.photos) continue;
        for (const p of phase.photos) {
          const key = p.path || p.url || '';
          if (!key || photoDataMap.has(key)) continue;
          if (p.url) {
            photoDataMap.set(key, p.url);
          } else if (p.path && photoStore?.readAsDataUrl) {
            try {
              const dataUrl = await photoStore.readAsDataUrl(p.path);
              if (dataUrl) photoDataMap.set(key, dataUrl);
            } catch { /* skip broken photo paths */ }
          }
        }
      }
    }
  }

  const doc = new jsPDF({ unit: 'mm', format: 'letter' });
  let y = 20;
  // checkY is now PURE: takes current y, returns possibly-new y after page break.
  // Callers must reassign: `y = checkY(y, n)`. This avoids the closure-capture
  // bug where a local `y` parameter inside a helper would diverge from the
  // outer `y` after addPage(), causing content to render off the page.
  const checkY = (currentY, n = 10) => {
    if (currentY + n > FOOTER_LIMIT) {
      doc.addPage();
      return 20;
    }
    return currentY;
  };

  // ─── Header band ────────────────────────────────────────────────────────
  doc.setFillColor(...BRAND_RGB);
  doc.rect(0, 0, PAGE_W, 30, 'F');
  doc.setTextColor(240, 253, 244);
  doc.setFontSize(20); doc.setFont('helvetica', 'bold');
  doc.text('MoveOut Shield Landlord', MARGIN, 13);
  doc.setFontSize(10); doc.setFont('helvetica', 'normal');
  // Title shifts framing when N>2: "comparison" implies contrasting two
  // states; "evidence bundle" reads as combining records into one
  // dispute-grade artifact, which is what the user is doing at that scale.
  // Em-dash replaced with hyphen for jsPDF font compatibility.
  const title = isTwoWay
    ? `Comparison Report - ${inspections.length} inspections`
    : `Evidence Bundle - ${inspections.length} records`;
  doc.text(title, MARGIN, 21);
  doc.text(property?.address || '', MARGIN, 27);
  const reportDate = new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
  doc.text(reportDate, PAGE_W - MARGIN, 21, { align: 'right' });
  doc.text(property?.name || '', PAGE_W - MARGIN, 27, { align: 'right' });
  y = 38;

  // ─── Inspection cards ──────────────────────────────────────────────────
  // 2-3 across in one row. 4+ wraps into rows of 3 to keep card width
  // readable. Card height stays fixed; grid expands vertically.
  const cardCount = inspections.length;
  const perRow = cardCount <= 3 ? cardCount : 3;
  const gap = 4;
  const cardW = (COL_W - gap * (perRow - 1)) / perRow;
  const cardH = 26;
  const rowCount = Math.ceil(cardCount / perRow);
  y = checkY(y, rowCount * (cardH + 4) + 4);

  inspections.forEach((insp, idx) => {
    const row = Math.floor(idx / perRow);
    const col = idx % perRow;
    const cx = MARGIN + col * (cardW + gap);
    const cy = y + row * (cardH + 4);
    const sourceColor = insp.source === 'tenant' ? TENANT_RGB : LANDLORD_RGB;
    const sideLabel = String.fromCharCode(65 + idx); // A, B, C, D, ...
    const typeEntry = inspectionTypeById(insp.type) || {};

    // Card body
    doc.setFillColor(249, 247, 244);
    doc.setDrawColor(231, 227, 220);
    doc.roundedRect(cx, cy, cardW, cardH, 2, 2, 'FD');
    // Left accent stripe (source color)
    doc.setFillColor(...sourceColor);
    doc.rect(cx, cy, 1.5, cardH, 'F');

    // Side + source label
    doc.setTextColor(120, 113, 108);
    doc.setFontSize(7); doc.setFont('helvetica', 'bold');
    const headerLine = `${sideLabel} | ${insp.source === 'tenant' ? 'TENANT' : 'LANDLORD'}`;
    doc.text(headerLine, cx + 4, cy + 5);

    // Inspection type label
    doc.setTextColor(28, 25, 23);
    doc.setFontSize(9); doc.setFont('helvetica', 'bold');
    const labelLines = doc.splitTextToSize(insp.label || typeEntry.label || '(unnamed)', cardW - 6);
    doc.text(labelLines.slice(0, 2), cx + 4, cy + 11);

    // Date
    doc.setTextColor(120, 113, 108);
    doc.setFontSize(7); doc.setFont('helvetica', 'normal');
    doc.text(formatDate(insp.createdAt), cx + 4, cy + cardH - 4);
  });
  y += rowCount * (cardH + 4) + 6;

  // ─── Summary boxes ─────────────────────────────────────────────────────
  const summary = computeSummary(inspections, diff, isTwoWay);
  const boxes = [
    { label: 'Total\nItems',    value: String(summary.total),    bg: [243, 240, 235], fg: [60, 60, 60] },
    { label: 'Changed',         value: String(summary.changed),  bg: [254, 249, 195], fg: [146, 64, 14] },
    { label: 'Worsened',        value: String(summary.worsened), bg: summary.worsened > 0 ? [254, 226, 226] : [220, 252, 231], fg: summary.worsened > 0 ? [153, 27, 27] : [6, 95, 70] },
    { label: 'Improved',        value: String(summary.improved), bg: [220, 252, 231], fg: [6, 95, 70] },
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

  // ─── Per-room diff sections ────────────────────────────────────────────
  // 2-way diff renders the comparison body. N>2 (evidence bundles) skip the
  // diff and rely on photo galleries at the end — the user is bundling
  // records, not contrasting them.
  if (isTwoWay) {
    y = renderTwoWayBody(doc, y, checkY, diff);
  } else {
    y = checkY(y, 14);
    doc.setFillColor(248, 245, 240);
    doc.setDrawColor(196, 181, 165);
    doc.roundedRect(MARGIN, y, COL_W, 11, 2, 2, 'FD');
    doc.setTextColor(60, 60, 60);
    doc.setFontSize(8); doc.setFont('helvetica', 'italic');
    doc.text(
      `${inspections.length} records bundled. See Photo Evidence section for per-record galleries.`,
      MARGIN + 4, y + 7
    );
    y += 16;
  }

  // ─── Photo galleries at the bottom ─────────────────────────────────────
  if (totalGalleryPhotoCount(inspections) > 0) {
    doc.addPage();
    y = 20;

    doc.setFillColor(...BRAND_RGB);
    doc.rect(0, 0, PAGE_W, 18, 'F');
    doc.setTextColor(240, 253, 244);
    doc.setFontSize(15); doc.setFont('helvetica', 'bold');
    doc.text('Photo Evidence', MARGIN, 12);
    y = 26;

    inspections.forEach((insp, idx) => {
      y = renderInspectionGallery(doc, y, checkY, insp, idx, photoDataMap);
    });
  }

  // ─── Certification footer (rendered on last page bottom margin) ────────
  // Avoids spawning a near-blank "cert page" when the body finished close
  // to FOOTER_LIMIT. Sits just above the moveoutshield.app/page-num footer.
  const lastPage = doc.internal.getNumberOfPages();
  doc.setPage(lastPage);
  doc.setTextColor(120, 120, 120);
  doc.setFontSize(7.5); doc.setFont('helvetica', 'italic');
  const certLine =
    `Report generated by MoveOut Shield Landlord on ${reportDate}. ` +
    `Photos retain their original EXIF metadata including capture timestamp and GPS coordinates where available.`;
  const certLines = doc.splitTextToSize(certLine, COL_W);
  // Position above the footer (PAGE_H - 8). Cert can be 1-3 lines (~3.5mm each)
  const certY = PAGE_H - 12 - certLines.length * 3.5;
  doc.text(certLines, MARGIN, certY);

  // ─── Footer on every page (URL left, page-num right) ───────────────────
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

// ═══════════════════════════════════════════════════════════════════════════
// Summary computation — handles 2-way (real diff) and bundle (no diff)
// ═══════════════════════════════════════════════════════════════════════════
function computeSummary(inspections, diff, isTwoWay) {
  if (isTwoWay && diff?.summary) {
    return {
      total:    diff.summary.totalItems,
      changed:  diff.summary.changedItems,
      worsened: diff.summary.worsenedItems,
      improved: diff.summary.improvedItems,
    };
  }
  // Bundle mode (or no diff) — count engagement across all inspections
  let total = 0, changed = 0, worsened = 0, improved = 0;
  for (const insp of inspections) {
    for (const rm of ROOMS) {
      const rd = insp.rooms?.[rm.id];
      if (!rd) continue;
      for (const phase of [rd.moveIn, rd.moveOut]) {
        if (!phase?.statuses) continue;
        const ratedKeys = Object.keys(phase.statuses);
        total += ratedKeys.length;
      }
    }
  }
  return { total, changed, worsened, improved };
}

// ═══════════════════════════════════════════════════════════════════════════
// 2-way body — mirrors RoomDiffTwoWay structure
// ═══════════════════════════════════════════════════════════════════════════
function renderTwoWayBody(doc, y, checkY, diff) {
  const visibleRooms = (diff?.rooms || []).filter(rd => {
    const hasItemChanges = rd.items.some(it => it.changeType !== 'unchanged');
    const hasNoteChange = rd.notes?.changed;
    return hasItemChanges || hasNoteChange;
  });

  if (visibleRooms.length === 0) {
    y = checkY(y, 20);
    doc.setFillColor(220, 252, 231);
    doc.setDrawColor(167, 243, 208);
    doc.roundedRect(MARGIN, y, COL_W, 16, 2, 2, 'FD');
    doc.setTextColor(6, 95, 70);
    doc.setFontSize(11); doc.setFont('helvetica', 'bold');
    doc.text('No changes detected.', MARGIN + 4, y + 7);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text('All rated items match between the two inspections.', MARGIN + 4, y + 12);
    y += 22;
    return y;
  }

  for (const rd of visibleRooms) {
    y = renderTwoWayRoom(doc, y, checkY, rd);
  }
  return y;
}

function renderTwoWayRoom(doc, y, checkY, rd) {
  const changedItems = rd.items.filter(it => it.changeType !== 'unchanged');

  y = checkY(y, 20);
  doc.setFillColor(...BRAND2_RGB);
  doc.roundedRect(MARGIN, y, COL_W, 9, 2, 2, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(10); doc.setFont('helvetica', 'bold');
  // Emoji-stripped: room name only, no rm.icon (jsPDF can't render emoji)
  doc.text(rd.room.name, MARGIN + 4, y + 6);

  const summaryParts = [];
  if (rd.summary.worsened > 0) summaryParts.push(`${rd.summary.worsened} worsened`);
  if (rd.summary.improved > 0) summaryParts.push(`${rd.summary.improved} improved`);
  if (rd.summary.added > 0) summaryParts.push(`${rd.summary.added} added`);
  if (rd.summary.removed > 0) summaryParts.push(`${rd.summary.removed} removed`);
  if (summaryParts.length) {
    doc.setFontSize(7); doc.setFont('helvetica', 'normal');
    doc.text(summaryParts.join(' | '), PAGE_W - MARGIN - 4, y + 6, { align: 'right' });
  }
  y += 12;

  if (changedItems.length > 0) {
    doc.setTextColor(120, 113, 108);
    doc.setFontSize(7); doc.setFont('helvetica', 'bold');
    doc.text('ITEM', MARGIN + 2, y + 3.5);
    doc.text('A', MARGIN + COL_W - 38, y + 3.5, { align: 'center' });
    doc.text('B', MARGIN + COL_W - 16, y + 3.5, { align: 'center' });
    y += 6;

    for (const item of changedItems) {
      y = checkY(y, 7);
      const wash = CHANGE_RGB[item.changeType];
      if (wash) {
        const lines = doc.splitTextToSize(item.label, COL_W - 50);
        const rowH = Math.max(5, lines.length * 4) + 1;
        doc.setFillColor(...wash);
        doc.rect(MARGIN, y - 0.5, COL_W, rowH, 'F');
      }

      doc.setTextColor(28, 25, 23);
      doc.setFontSize(8); doc.setFont('helvetica', 'normal');
      const lines = doc.splitTextToSize(item.label, COL_W - 50);
      doc.text(lines, MARGIN + 2, y + 3);

      drawStatusBadge(doc, item.a.status, MARGIN + COL_W - 44, y, 12);
      drawStatusBadge(doc, item.b.status, MARGIN + COL_W - 22, y, 12);

      if (item.changeType !== 'unchanged') {
        doc.setTextColor(180, 100, 30);
        doc.setFontSize(7); doc.setFont('helvetica', 'bold');
        // ASCII arrow — jsPDF helvetica can't render U+2192
        doc.text('->', MARGIN + COL_W - 32, y + 3, { align: 'center' });
      }

      y += Math.max(5, lines.length * 4) + 1;
    }
    y += 2;
  }

  if (rd.notes?.changed) {
    y = checkY(y, 8);
    doc.setFillColor(254, 249, 195);
    doc.rect(MARGIN, y, COL_W, 5, 'F');
    doc.setTextColor(146, 64, 14);
    doc.setFontSize(7); doc.setFont('helvetica', 'bold');
    doc.text('NOTES CHANGED', MARGIN + 3, y + 3.5);
    y += 7;

    if (rd.notes.a) {
      const aLines = doc.splitTextToSize(rd.notes.a, COL_W - 4);
      y = checkY(y, aLines.length * 4 + 4);
      doc.setTextColor(...TENANT_RGB);
      doc.setFontSize(7); doc.setFont('helvetica', 'bold');
      doc.text('A:', MARGIN + 2, y + 3);
      doc.setTextColor(60, 60, 60);
      doc.setFont('helvetica', 'italic');
      doc.text(aLines, MARGIN + 7, y + 3);
      y += aLines.length * 4 + 1;
    }
    if (rd.notes.b) {
      const bLines = doc.splitTextToSize(rd.notes.b, COL_W - 4);
      y = checkY(y, bLines.length * 4 + 4);
      doc.setTextColor(...LANDLORD_RGB);
      doc.setFontSize(7); doc.setFont('helvetica', 'bold');
      doc.text('B:', MARGIN + 2, y + 3);
      doc.setTextColor(60, 60, 60);
      doc.setFont('helvetica', 'italic');
      doc.text(bLines, MARGIN + 7, y + 3);
      y += bLines.length * 4 + 1;
    }
    y += 2;
  }

  y += 4;
  return y;
}

// ═══════════════════════════════════════════════════════════════════════════
// Status badge — small colored pill matching STATUS visual
// ═══════════════════════════════════════════════════════════════════════════
function drawStatusBadge(doc, status, x, y, w) {
  if (!status) {
    doc.setTextColor(180, 175, 170);
    doc.setFontSize(8); doc.setFont('helvetica', 'normal');
    doc.text('-', x, y + 3, { align: 'center' });
    return;
  }
  const meta = STATUS[status];
  if (!meta) return;
  const bgRgb = STATUS_BG_RGB[status] || [240, 240, 240];
  const fgRgb = STATUS_RGB[status] || [60, 60, 60];

  doc.setFillColor(...bgRgb);
  doc.roundedRect(x - w / 2, y, w, 4.5, 1.5, 1.5, 'F');
  doc.setTextColor(...fgRgb);
  doc.setFontSize(6); doc.setFont('helvetica', 'bold');
  doc.text(meta.short, x, y + 3.2, { align: 'center' });
}

// ═══════════════════════════════════════════════════════════════════════════
// Photo gallery — Variant C: 4-up, 47mm cells, 64mm max H, letterbox-fit
// ═══════════════════════════════════════════════════════════════════════════
function renderInspectionGallery(doc, y, checkY, inspection, idx, photoDataMap) {
  const photos = [];
  for (const rm of ROOMS) {
    const rd = inspection.rooms?.[rm.id];
    if (!rd) continue;
    for (const phaseKey of ['moveIn', 'moveOut']) {
      const phase = rd[phaseKey];
      if (!phase?.photos) continue;
      for (const p of phase.photos) {
        photos.push({ ...p, room: rm.name, phase: phaseKey });
      }
    }
  }

  // Section header
  y = checkY(y, 14);
  const sideLabel = String.fromCharCode(65 + idx);
  const sourceColor = inspection.source === 'tenant' ? TENANT_RGB : LANDLORD_RGB;
  doc.setFillColor(...sourceColor);
  doc.rect(MARGIN, y, 1.5, 8, 'F');
  doc.setTextColor(28, 25, 23);
  doc.setFontSize(11); doc.setFont('helvetica', 'bold');
  // Hyphen for em-dash compatibility
  doc.text(`${sideLabel} - ${inspection.label}`, MARGIN + 4, y + 5);
  doc.setTextColor(120, 113, 108);
  doc.setFontSize(8); doc.setFont('helvetica', 'normal');
  doc.text(`${photos.length} photo${photos.length === 1 ? '' : 's'}`,
           PAGE_W - MARGIN, y + 5, { align: 'right' });
  y += 10;

  if (photos.length === 0) {
    doc.setTextColor(160, 155, 150);
    doc.setFontSize(8); doc.setFont('helvetica', 'italic');
    doc.text('(no photos in this inspection)', MARGIN + 4, y + 3);
    y += 10;
    return y;
  }

  // ─── 4-up letterbox grid ─────────────────────────────────────────────
  let col = 0;
  let rowMaxH = 0;
  let rowStartY = y;

  for (const p of photos) {
    if (col === 0) {
      // Starting a new row — check page space for the worst-case cell + caption
      y = checkY(y, PHOTO_MAX_H + PHOTO_CAPTION_H + 4);
      rowStartY = y;
      rowMaxH = 0;
    }

    const cx = PHOTO_MARGIN + col * (PHOTO_CELL_W + PHOTO_GAP);
    const cy = rowStartY;

    // Letterbox-fit dimensions — preserve aspect, center within cell
    const ratio = (typeof p.ratio === 'number' && p.ratio > 0) ? p.ratio : 0.75;
    let drawW, drawH;
    // ratio = h / w. If ratio >= 1 the photo is portrait.
    const naturalH = PHOTO_CELL_W * ratio;
    if (naturalH <= PHOTO_MAX_H) {
      // Fits at full width
      drawW = PHOTO_CELL_W;
      drawH = naturalH;
    } else {
      // Portrait too tall — letterbox to maxH, shrink width
      drawH = PHOTO_MAX_H;
      drawW = drawH / ratio;
    }
    const drawX = cx + (PHOTO_CELL_W - drawW) / 2;
    const drawY = cy + (PHOTO_MAX_H - drawH) / 2;
    rowMaxH = Math.max(rowMaxH, PHOTO_MAX_H);

    const imgKey = p.path || p.url || '';
    const imgData = photoDataMap.get(imgKey);

    // Cell background (subtle, only visible behind letterbox bars)
    doc.setFillColor(248, 245, 240);
    doc.rect(cx, cy, PHOTO_CELL_W, PHOTO_MAX_H, 'F');

    if (imgData) {
      try {
        doc.addImage(imgData, 'JPEG', drawX, drawY, drawW, drawH);
      } catch {
        // Image add failed — leave the placeholder bg visible
      }
    } else {
      doc.setTextColor(160, 155, 150);
      doc.setFontSize(7); doc.setFont('helvetica', 'italic');
      doc.text('photo unavailable', cx + PHOTO_CELL_W / 2, cy + PHOTO_MAX_H / 2, { align: 'center' });
    }

    // Single-line caption beneath the cell (date + GPS or just date)
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
  // Close out final partial row
  if (col !== 0) {
    y = rowStartY + PHOTO_MAX_H + PHOTO_CAPTION_H + 4;
  }
  y += 6;
  return y;
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════
function totalGalleryPhotoCount(inspections) {
  let n = 0;
  for (const insp of inspections) {
    for (const rd of Object.values(insp.rooms || {})) {
      n += (rd.moveIn?.photos?.length || 0);
      n += (rd.moveOut?.photos?.length || 0);
    }
  }
  return n;
}

// Single-line caption: "May 6 · 39.7,-89.3" or "May 6"
// Middle-dot (·, U+00B7) is in latin-1 and renders fine in jsPDF helvetica.
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
