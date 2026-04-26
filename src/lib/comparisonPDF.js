// ═══════════════════════════════════════════════════════════════════════════
// comparisonPDF.js — generate a side-by-side comparison PDF
// ═══════════════════════════════════════════════════════════════════════════
// Builds the dispute-grade evidence package:
//
//   1. Cover page  — property + N inspection cards + summary boxes
//   2. Per-room diff — item rows with status changes highlighted
//   3. Notes diff  — only rooms where notes changed
//   4. Photo galleries at the bottom — one section per inspection
//
// Public API:
//   buildComparisonPDF(inspections, diff, property, photoStore) → Promise<jsPDF>
//
// `diff` is the output of diffInspections() for 2-way OR a threeWayMatrix
// from ChangesScreen for 3-way. The function detects which by length.
//
// Photo galleries appear AFTER all room diffs, mirroring the user's request:
// "pics get galleries at the bottom of the page". For 3-way comparisons,
// each inspection gets its own gallery section.
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
const FOOTER_LIMIT = 272;

// Brand colors
const BRAND_RGB = [27, 58, 45];
const BRAND2_RGB = [43, 106, 79];
const TENANT_RGB = [30, 64, 175];        // #1E40AF — same as STATUS.clean fg
const LANDLORD_RGB = [6, 95, 70];        // #065F46 — same as STATUS.fair fg

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
  worsened: [254, 226, 226],   // pink wash
  improved: [220, 252, 231],   // mint wash
  added:    [254, 249, 195],   // amber wash
  removed:  [243, 232, 255],   // lavender wash
  mixed:    [254, 249, 195],
};

// ───────────────────────────────────────────────────────────────────────────
// Public: build the comparison report
// ───────────────────────────────────────────────────────────────────────────
export async function buildComparisonPDF(inspections, diff, property, photoStore) {
  if (!inspections || inspections.length < 2) {
    throw new Error('buildComparisonPDF: at least 2 inspections required');
  }
  const isThreeWay = inspections.length === 3;

  // Pre-resolve all photo data URLs across ALL inspections.
  // Galleries embed photos so we need data URLs ahead of time.
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
  const checkY = (n = 10) => { if (y + n > FOOTER_LIMIT) { doc.addPage(); y = 20; } };

  // ─── Header band ────────────────────────────────────────────────────────
  doc.setFillColor(...BRAND_RGB);
  doc.rect(0, 0, PAGE_W, 30, 'F');
  doc.setTextColor(240, 253, 244);
  doc.setFontSize(20); doc.setFont('helvetica', 'bold');
  doc.text('MoveOut Shield Landlord', MARGIN, 13);
  doc.setFontSize(10); doc.setFont('helvetica', 'normal');
  doc.text(`Comparison Report — ${inspections.length} inspections`, MARGIN, 21);
  doc.text(property?.address || '', MARGIN, 27);
  const reportDate = new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
  doc.text(reportDate, PAGE_W - MARGIN, 21, { align: 'right' });
  doc.text(property?.name || '', PAGE_W - MARGIN, 27, { align: 'right' });
  y = 38;

  // ─── Inspection cards (2 or 3 across) ──────────────────────────────────
  const cardCount = inspections.length;
  const gap = 4;
  const cardW = (COL_W - gap * (cardCount - 1)) / cardCount;
  const cardH = 26;
  checkY(cardH + 4);

  inspections.forEach((insp, idx) => {
    const cx = MARGIN + idx * (cardW + gap);
    const sourceColor = insp.source === 'tenant' ? TENANT_RGB : LANDLORD_RGB;
    const sideLabel = String.fromCharCode(65 + idx); // A, B, C
    const typeEntry = inspectionTypeById(insp.type) || {};

    // Card body
    doc.setFillColor(249, 247, 244);
    doc.setDrawColor(231, 227, 220);
    doc.roundedRect(cx, y, cardW, cardH, 2, 2, 'FD');
    // Left accent stripe (source color)
    doc.setFillColor(...sourceColor);
    doc.rect(cx, y, 1.5, cardH, 'F');

    // Side + source label
    doc.setTextColor(120, 113, 108);
    doc.setFontSize(7); doc.setFont('helvetica', 'bold');
    const headerLine = `${sideLabel} · ${insp.source === 'tenant' ? 'TENANT' : 'LANDLORD'}`;
    doc.text(headerLine, cx + 4, y + 5);

    // Inspection type label
    doc.setTextColor(28, 25, 23);
    doc.setFontSize(9); doc.setFont('helvetica', 'bold');
    const labelLines = doc.splitTextToSize(insp.label || typeEntry.label || '(unnamed)', cardW - 6);
    doc.text(labelLines.slice(0, 2), cx + 4, y + 11);

    // Date
    doc.setTextColor(120, 113, 108);
    doc.setFontSize(7); doc.setFont('helvetica', 'normal');
    doc.text(formatDate(insp.createdAt), cx + 4, y + cardH - 4);
  });
  y += cardH + 6;

  // ─── Summary boxes ─────────────────────────────────────────────────────
  // For 2-way, use diff.summary directly. For 3-way, compute from matrix.
  const summary = computeSummary(inspections, diff, isThreeWay);
  const boxes = [
    { label: 'Total\nItems',    value: String(summary.total),    bg: [243, 240, 235], fg: [60, 60, 60] },
    { label: 'Changed',         value: String(summary.changed),  bg: [254, 249, 195], fg: [146, 64, 14] },
    { label: 'Worsened',        value: String(summary.worsened), bg: summary.worsened > 0 ? [254, 226, 226] : [220, 252, 231], fg: summary.worsened > 0 ? [153, 27, 27] : [6, 95, 70] },
    { label: 'Improved',        value: String(summary.improved), bg: [220, 252, 231], fg: [6, 95, 70] },
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

  // ─── Per-room diff sections ────────────────────────────────────────────
  if (isThreeWay) {
    y = renderThreeWayBody(doc, y, checkY, diff, inspections);
  } else {
    y = renderTwoWayBody(doc, y, checkY, diff);
  }

  // ─── Photo galleries at the bottom ─────────────────────────────────────
  // Always start galleries on a fresh page so the visual break is clear.
  if (totalGalleryPhotoCount(inspections) > 0) {
    doc.addPage();
    y = 20;

    // "Photo Evidence" section header
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

  // ─── Certification footer ──────────────────────────────────────────────
  if (y + 16 > FOOTER_LIMIT) { doc.addPage(); y = 20; }
  y += 4;
  doc.setTextColor(120, 120, 120); doc.setFontSize(7.5); doc.setFont('helvetica', 'italic');
  const certLine =
    `Comparison report generated by MoveOut Shield Landlord on ${reportDate}. ` +
    `Photos retain their original EXIF metadata including capture timestamp and GPS coordinates where available.`;
  const certLines = doc.splitTextToSize(certLine, COL_W);
  doc.text(certLines, MARGIN, y);

  // Page numbers
  const pageCount = doc.internal.getNumberOfPages();
  for (let pn = 1; pn <= pageCount; pn++) {
    doc.setPage(pn);
    doc.setTextColor(160, 155, 150);
    doc.setFontSize(7); doc.setFont('helvetica', 'normal');
    doc.text(`Page ${pn} of ${pageCount}`, PAGE_W - MARGIN, PAGE_H - 8, { align: 'right' });
  }

  return doc;
}

// ═══════════════════════════════════════════════════════════════════════════
// Summary computation — handles both 2-way and 3-way input shapes
// ═══════════════════════════════════════════════════════════════════════════
function computeSummary(inspections, diff, isThreeWay) {
  if (!isThreeWay && diff?.summary) {
    return {
      total:    diff.summary.totalItems,
      changed:  diff.summary.changedItems,
      worsened: diff.summary.worsenedItems,
      improved: diff.summary.improvedItems,
    };
  }
  // 3-way: count from the matrix
  // For 3-way "worsened" is "got worse from earliest to latest"
  let total = 0, changed = 0, worsened = 0, improved = 0;
  for (const roomEntry of diff.rooms) {
    for (const item of roomEntry.items) {
      total++;
      const seen = item.statuses.filter(s => s != null);
      if (seen.length === 0) continue;
      const distinct = new Set(seen).size;
      if (distinct > 1) {
        changed++;
        // Compare first present to last present for worsened/improved
        const first = item.statuses.find(s => s != null);
        const last = [...item.statuses].reverse().find(s => s != null);
        const sev = { clean: 0, fair: 1, na: 1, damaged: 2 };
        if (sev[last] > sev[first]) worsened++;
        else if (sev[last] < sev[first]) improved++;
      }
    }
  }
  return { total, changed, worsened, improved };
}

// ═══════════════════════════════════════════════════════════════════════════
// 2-way body — mirrors RoomDiffTwoWay structure
// ═══════════════════════════════════════════════════════════════════════════
function renderTwoWayBody(doc, y, checkY, diff) {
  // Iterate rooms with content
  const visibleRooms = (diff.rooms || []).filter(rd => {
    const hasItemChanges = rd.items.some(it => it.changeType !== 'unchanged');
    const hasNoteChange = rd.notes?.changed;
    return hasItemChanges || hasNoteChange;
  });

  if (visibleRooms.length === 0) {
    checkY(20);
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

  // Room header band
  checkY(20);
  doc.setFillColor(...BRAND2_RGB);
  doc.roundedRect(MARGIN, y, COL_W, 9, 2, 2, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(10); doc.setFont('helvetica', 'bold');
  doc.text(`${rd.room.icon} ${rd.room.name}`, MARGIN + 4, y + 6);

  // Right-aligned counts
  const summaryParts = [];
  if (rd.summary.worsened > 0) summaryParts.push(`${rd.summary.worsened} worsened`);
  if (rd.summary.improved > 0) summaryParts.push(`${rd.summary.improved} improved`);
  if (rd.summary.added > 0) summaryParts.push(`${rd.summary.added} added`);
  if (rd.summary.removed > 0) summaryParts.push(`${rd.summary.removed} removed`);
  if (summaryParts.length) {
    doc.setFontSize(7); doc.setFont('helvetica', 'normal');
    doc.text(summaryParts.join(' · '), PAGE_W - MARGIN - 4, y + 6, { align: 'right' });
  }
  y += 12;

  // Column headers
  if (changedItems.length > 0) {
    doc.setTextColor(120, 113, 108);
    doc.setFontSize(7); doc.setFont('helvetica', 'bold');
    doc.text('ITEM', MARGIN + 2, y + 3.5);
    doc.text('A', MARGIN + COL_W - 38, y + 3.5, { align: 'center' });
    doc.text('B', MARGIN + COL_W - 16, y + 3.5, { align: 'center' });
    y += 6;

    // Item rows
    for (const item of changedItems) {
      checkY(7);
      // Wash background per change-type
      const wash = CHANGE_RGB[item.changeType];
      if (wash) {
        const lines = doc.splitTextToSize(item.label, COL_W - 50);
        const rowH = Math.max(5, lines.length * 4) + 1;
        doc.setFillColor(...wash);
        doc.rect(MARGIN, y - 0.5, COL_W, rowH, 'F');
      }

      // Item label
      doc.setTextColor(28, 25, 23);
      doc.setFontSize(8); doc.setFont('helvetica', 'normal');
      const lines = doc.splitTextToSize(item.label, COL_W - 50);
      doc.text(lines, MARGIN + 2, y + 3);

      // Status badges A and B
      drawStatusBadge(doc, item.a.status, MARGIN + COL_W - 44, y, 12);
      drawStatusBadge(doc, item.b.status, MARGIN + COL_W - 22, y, 12);

      // Arrow if changed
      if (item.changeType !== 'unchanged') {
        doc.setTextColor(180, 100, 30);
        doc.setFontSize(7); doc.setFont('helvetica', 'bold');
        doc.text('→', MARGIN + COL_W - 32, y + 3, { align: 'center' });
      }

      y += Math.max(5, lines.length * 4) + 1;
    }
    y += 2;
  }

  // Notes diff
  if (rd.notes?.changed) {
    checkY(8);
    doc.setFillColor(254, 249, 195);
    doc.rect(MARGIN, y, COL_W, 5, 'F');
    doc.setTextColor(146, 64, 14);
    doc.setFontSize(7); doc.setFont('helvetica', 'bold');
    doc.text('NOTES CHANGED', MARGIN + 3, y + 3.5);
    y += 7;

    // A note
    if (rd.notes.a) {
      const aLines = doc.splitTextToSize(rd.notes.a, COL_W - 4);
      checkY(aLines.length * 4 + 4);
      doc.setTextColor(...TENANT_RGB);
      doc.setFontSize(7); doc.setFont('helvetica', 'bold');
      doc.text('A:', MARGIN + 2, y + 3);
      doc.setTextColor(60, 60, 60);
      doc.setFont('helvetica', 'italic');
      doc.text(aLines, MARGIN + 7, y + 3);
      y += aLines.length * 4 + 1;
    }
    // B note
    if (rd.notes.b) {
      const bLines = doc.splitTextToSize(rd.notes.b, COL_W - 4);
      checkY(bLines.length * 4 + 4);
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
// 3-way body — three-column matrix
// ═══════════════════════════════════════════════════════════════════════════
function renderThreeWayBody(doc, y, checkY, matrix, inspections) {
  const visibleRooms = (matrix.rooms || []).filter(rd =>
    rd.items.some(it => new Set(it.statuses.filter(s => s != null)).size > 1)
  );

  if (visibleRooms.length === 0) {
    checkY(20);
    doc.setFillColor(220, 252, 231);
    doc.setDrawColor(167, 243, 208);
    doc.roundedRect(MARGIN, y, COL_W, 16, 2, 2, 'FD');
    doc.setTextColor(6, 95, 70);
    doc.setFontSize(11); doc.setFont('helvetica', 'bold');
    doc.text('No changes across inspections.', MARGIN + 4, y + 9);
    y += 22;
    return y;
  }

  for (const rd of visibleRooms) {
    y = renderThreeWayRoom(doc, y, checkY, rd);
  }
  return y;
}

function renderThreeWayRoom(doc, y, checkY, rd) {
  const changedItems = rd.items.filter(it =>
    new Set(it.statuses.filter(s => s != null)).size > 1
  );
  if (changedItems.length === 0) return y;

  // Room header band
  checkY(20);
  doc.setFillColor(...BRAND2_RGB);
  doc.roundedRect(MARGIN, y, COL_W, 9, 2, 2, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(10); doc.setFont('helvetica', 'bold');
  doc.text(`${rd.room.icon} ${rd.room.name}`, MARGIN + 4, y + 6);
  y += 12;

  // Column headers (A B C)
  doc.setTextColor(120, 113, 108);
  doc.setFontSize(7); doc.setFont('helvetica', 'bold');
  doc.text('ITEM', MARGIN + 2, y + 3.5);
  doc.text('A', MARGIN + COL_W - 50, y + 3.5, { align: 'center' });
  doc.text('B', MARGIN + COL_W - 32, y + 3.5, { align: 'center' });
  doc.text('C', MARGIN + COL_W - 14, y + 3.5, { align: 'center' });
  y += 6;

  for (const item of changedItems) {
    checkY(7);
    const lines = doc.splitTextToSize(item.label, COL_W - 60);
    const rowH = Math.max(5, lines.length * 4) + 1;

    // Wash if any worsening pattern detected
    const sev = { clean: 0, fair: 1, na: 1, damaged: 2 };
    const seen = item.statuses.filter(s => s != null);
    if (seen.length >= 2) {
      const first = item.statuses.find(s => s != null);
      const last = [...item.statuses].reverse().find(s => s != null);
      const wash = sev[last] > sev[first] ? CHANGE_RGB.worsened
                 : sev[last] < sev[first] ? CHANGE_RGB.improved
                 : CHANGE_RGB.mixed;
      if (wash) { doc.setFillColor(...wash); doc.rect(MARGIN, y - 0.5, COL_W, rowH, 'F'); }
    }

    doc.setTextColor(28, 25, 23);
    doc.setFontSize(8); doc.setFont('helvetica', 'normal');
    doc.text(lines, MARGIN + 2, y + 3);

    drawStatusBadge(doc, item.statuses[0], MARGIN + COL_W - 56, y, 12);
    drawStatusBadge(doc, item.statuses[1], MARGIN + COL_W - 38, y, 12);
    drawStatusBadge(doc, item.statuses[2], MARGIN + COL_W - 20, y, 12);

    y += rowH;
  }
  y += 6;
  return y;
}

// ═══════════════════════════════════════════════════════════════════════════
// Status badge — small colored pill matching STATUS visual
// ═══════════════════════════════════════════════════════════════════════════
function drawStatusBadge(doc, status, x, y, w) {
  if (!status) {
    doc.setTextColor(180, 175, 170);
    doc.setFontSize(8); doc.setFont('helvetica', 'normal');
    doc.text('—', x, y + 3, { align: 'center' });
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
// Photo gallery — one per inspection, 3-column thumbnails with captions
// ═══════════════════════════════════════════════════════════════════════════
function renderInspectionGallery(doc, y, checkY, inspection, idx, photoDataMap) {
  // Collect ALL photos from this inspection (both phases, all rooms)
  const photos = [];
  for (const rm of ROOMS) {
    const rd = inspection.rooms?.[rm.id];
    if (!rd) continue;
    for (const phaseKey of ['moveIn', 'moveOut']) {
      const phase = rd[phaseKey];
      if (!phase?.photos) continue;
      for (const p of phase.photos) {
        photos.push({ ...p, room: rm.name, roomIcon: rm.icon, phase: phaseKey });
      }
    }
  }

  // Section header — even if no photos, render the header so reader knows
  checkY(14);
  const sideLabel = String.fromCharCode(65 + idx);
  const sourceColor = inspection.source === 'tenant' ? TENANT_RGB : LANDLORD_RGB;
  doc.setFillColor(...sourceColor);
  doc.rect(MARGIN, y, 1.5, 8, 'F');
  doc.setTextColor(28, 25, 23);
  doc.setFontSize(11); doc.setFont('helvetica', 'bold');
  doc.text(`${sideLabel} — ${inspection.label}`, MARGIN + 4, y + 5);
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

  // Render thumbnails 3-up
  const tW = 56;
  const captionH = 14;
  const gap = 4;
  let tx = MARGIN;
  let rowMaxH = 0;
  let col = 0;

  for (const p of photos) {
    const tH = Math.min(Math.round(tW * (p.ratio || 0.75)), 60);
    if (col === 3) {
      y += rowMaxH + captionH + 2;
      tx = MARGIN;
      rowMaxH = 0;
      col = 0;
    }
    checkY(tH + captionH + 2);
    rowMaxH = Math.max(rowMaxH, tH);

    const imgKey = p.path || p.url || '';
    const imgData = photoDataMap.get(imgKey);

    if (imgData) {
      try {
        doc.addImage(imgData, 'JPEG', tx, y, tW, tH);
      } catch {
        // Fallback gray box
        doc.setFillColor(243, 240, 235);
        doc.rect(tx, y, tW, tH, 'F');
      }
    } else {
      // Missing photo data — draw a placeholder
      doc.setFillColor(243, 240, 235);
      doc.rect(tx, y, tW, tH, 'F');
      doc.setTextColor(160, 155, 150);
      doc.setFontSize(7); doc.setFont('helvetica', 'italic');
      doc.text('photo unavailable', tx + tW / 2, y + tH / 2, { align: 'center' });
    }

    // Caption block
    let cy = y + tH + 3;
    doc.setTextColor(80, 80, 80);
    doc.setFontSize(6.5); doc.setFont('helvetica', 'bold');
    doc.text(`${p.roomIcon} ${p.room}`, tx, cy, { maxWidth: tW });
    cy += 3;
    doc.setFont('helvetica', 'normal');
    if (p.ts) {
      doc.text(formatDateForCaption(p.ts), tx, cy, { maxWidth: tW });
      cy += 3;
    }
    if (p.lat && p.lng) {
      doc.setFontSize(5.5);
      doc.text(`${p.lat}, ${p.lng}`, tx, cy, { maxWidth: tW });
    }

    tx += tW + gap;
    col++;
  }
  y += rowMaxH + captionH + 6;
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

function formatDateForCaption(ts) {
  if (!ts) return '';
  if (/^\d{4}-\d{2}-\d{2}T/.test(ts)) {
    const d = new Date(ts);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  return ts;
}
