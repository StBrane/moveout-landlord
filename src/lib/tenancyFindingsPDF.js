// ═══════════════════════════════════════════════════════════════════════════
// tenancyFindingsPDF.js — generate a Tenancy Findings PDF
// ═══════════════════════════════════════════════════════════════════════════
// Builds the dispute-grade evidence package from a damageReport result.
//
//   1. Cover page  — property + tenancy + evidence tier + summary boxes +
//                    records-present indicators
//   2. Per-tier body — items grouped by tier (Bulletproof first, Disputed last),
//                      each with status badges, change descriptor, party data,
//                      and notes
//   3. Photo galleries at the bottom — one section per inspection that exists,
//                                       3-up thumbnails with room/timestamp/GPS
//   4. Certification footer
//
// Public API:
//   buildTenancyFindingsPDF(report, property, tenancy, photoStore) → Promise<jsPDF>
//
// `report` is the output of buildDamageReport(). The structure is:
//   {
//     evidenceTier:   { stars, label },
//     records:        { landlordBaseline, tenantMoveIn, landlordPostTenant,
//                       tenantMoveOut, precedingTurnover },  // each is {kind,inspection,slot} or null
//     items: [
//       { roomId, roomName, roomIcon, itemIndex, itemLabel,
//         tier, change, details, parties, photos, notes }
//     ],
//     summary: { itemCount, byTier, hasTurnover },
//   }
// ═══════════════════════════════════════════════════════════════════════════

import { jsPDF } from 'jspdf';
import {
  ROOMS, STATUS,
  inspectionTypeById, formatDate, formatTenancySpan,
} from './constants.js';
import { TIERS, TIER_META } from './damageReport.js';

// Render constants
const PAGE_W = 215.9;
const PAGE_H = 279.4;
const MARGIN = 18;
const COL_W = PAGE_W - MARGIN * 2;
const FOOTER_LIMIT = 272;

// Brand
const BRAND_RGB = [27, 58, 45];
const BRAND2_RGB = [43, 106, 79];
const TENANT_RGB = [30, 64, 175];
const LANDLORD_RGB = [6, 95, 70];

// Status visual treatment
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

// Tier colors — RGB triplets matching TIER_META.color hex strings
const TIER_RGB = {
  [TIERS.BULLETPROOF]:             [6, 95, 70],
  [TIERS.STRONG_CORROBORATED]:     [43, 106, 79],
  [TIERS.STRONG_ONE_PARTY]:        [43, 106, 79],
  [TIERS.STRONG_STATUS_AGREEMENT]: [27, 58, 45],
  [TIERS.TENANT_ONLY_EVIDENCE]:    [124, 58, 237],
  [TIERS.DISPUTED]:                [217, 119, 6],
};
const TIER_BG_RGB = {
  [TIERS.BULLETPROOF]:             [220, 252, 231],
  [TIERS.STRONG_CORROBORATED]:     [220, 252, 231],
  [TIERS.STRONG_ONE_PARTY]:        [220, 252, 231],
  [TIERS.STRONG_STATUS_AGREEMENT]: [236, 253, 245],
  [TIERS.TENANT_ONLY_EVIDENCE]:    [243, 232, 255],
  [TIERS.DISPUTED]:                [254, 243, 199],
};

// Display order — Bulletproof first (strongest evidence), Disputed last
const TIER_DISPLAY_ORDER = [
  TIERS.BULLETPROOF,
  TIERS.STRONG_CORROBORATED,
  TIERS.STRONG_ONE_PARTY,
  TIERS.STRONG_STATUS_AGREEMENT,
  TIERS.TENANT_ONLY_EVIDENCE,
  TIERS.DISPUTED,
];

const PARTY_LABEL = {
  landlordBaseline:   'Landlord baseline',
  tenantMoveIn:       'Tenant move-in',
  landlordPostTenant: 'Landlord post-tenant',
  tenantMoveOut:      'Tenant move-out',
  precedingTurnover:  'Turnover',
};

// ───────────────────────────────────────────────────────────────────────────
// Public: build the findings report
// ───────────────────────────────────────────────────────────────────────────
export async function buildTenancyFindingsPDF(report, property, tenancy, photoStore) {
  if (!report) throw new Error('buildTenancyFindingsPDF: report required');

  // Inspections that contributed to this report — will get photo galleries
  const contributingInspections = [];
  for (const recordKey of ['landlordBaseline', 'tenantMoveIn', 'landlordPostTenant', 'tenantMoveOut', 'precedingTurnover']) {
    const rec = report.records[recordKey];
    if (rec?.inspection) {
      contributingInspections.push({ kind: recordKey, inspection: rec.inspection });
    }
  }

  // Pre-resolve all photo data URLs
  const photoDataMap = new Map();
  for (const { inspection: insp } of contributingInspections) {
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
  doc.text('Tenancy Findings Report', MARGIN, 21);
  doc.text(property?.address || '', MARGIN, 27);
  const reportDate = new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
  doc.text(reportDate, PAGE_W - MARGIN, 21, { align: 'right' });
  doc.text(property?.name || '', PAGE_W - MARGIN, 27, { align: 'right' });
  y = 38;

  // ─── Tenancy block ──────────────────────────────────────────────────────
  if (tenancy) {
    checkY(28);
    doc.setFillColor(248, 245, 240); doc.setDrawColor(196, 181, 165);
    doc.roundedRect(MARGIN, y, COL_W, 22, 3, 3, 'FD');
    doc.setTextColor(...BRAND_RGB);
    doc.setFontSize(9); doc.setFont('helvetica', 'bold');
    doc.text('Tenancy', MARGIN + 4, y + 6);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(40, 40, 40);
    const tenants = tenancy.tenants?.length ? tenancy.tenants.join(', ') : '(unnamed tenants)';
    const span = formatTenancySpan(tenancy);
    doc.text(`Tenants: ${tenants}`, MARGIN + 4, y + 12);
    doc.text(`Lease: ${span}`, MARGIN + 4, y + 17);
    y += 28;
  }

  // ─── Evidence tier card ─────────────────────────────────────────────────
  checkY(28);
  doc.setFillColor(236, 253, 245); doc.setDrawColor(167, 243, 208);
  doc.roundedRect(MARGIN, y, COL_W, 24, 3, 3, 'FD');
  doc.setTextColor(...BRAND_RGB);
  doc.setFontSize(9); doc.setFont('helvetica', 'bold');
  doc.text('EVIDENCE PICTURE', MARGIN + 4, y + 6);
  doc.setFontSize(18); doc.setFont('helvetica', 'bold');
  doc.text(report.evidenceTier.stars, MARGIN + 4, y + 14);
  doc.setFontSize(9); doc.setFont('helvetica', 'normal');
  doc.text(report.evidenceTier.label, MARGIN + 4, y + 20);
  // Right-aligned: total findings
  doc.setFontSize(20); doc.setFont('helvetica', 'bold');
  doc.text(String(report.summary.itemCount), PAGE_W - MARGIN - 4, y + 14, { align: 'right' });
  doc.setFontSize(8); doc.setFont('helvetica', 'normal');
  doc.text(report.summary.itemCount === 1 ? 'finding' : 'findings', PAGE_W - MARGIN - 4, y + 20, { align: 'right' });
  y += 30;

  // ─── Records-present pills row ──────────────────────────────────────────
  const recordList = [
    { key: 'landlordBaseline',   label: 'Landlord baseline',   present: !!report.records.landlordBaseline },
    { key: 'tenantMoveIn',       label: 'Tenant move-in',       present: !!report.records.tenantMoveIn },
    { key: 'landlordPostTenant', label: 'Landlord post-tenant', present: !!report.records.landlordPostTenant },
    { key: 'tenantMoveOut',      label: 'Tenant move-out',      present: !!report.records.tenantMoveOut },
  ];
  checkY(8);
  doc.setTextColor(120, 113, 108);
  doc.setFontSize(7); doc.setFont('helvetica', 'bold');
  doc.text('RECORDS USED', MARGIN, y + 3);
  y += 6;
  let pillX = MARGIN;
  for (const r of recordList) {
    const pillW = doc.getTextWidth(r.label) + 8;
    if (pillX + pillW > PAGE_W - MARGIN) {
      pillX = MARGIN;
      y += 6;
    }
    if (r.present) {
      doc.setFillColor(220, 252, 231);
      doc.setDrawColor(167, 243, 208);
      doc.setTextColor(...BRAND_RGB);
    } else {
      doc.setFillColor(243, 240, 235);
      doc.setDrawColor(231, 227, 220);
      doc.setTextColor(160, 155, 150);
    }
    doc.roundedRect(pillX, y, pillW, 5, 2, 2, 'FD');
    doc.setFontSize(7); doc.setFont('helvetica', 'bold');
    doc.text((r.present ? '✓ ' : '○ ') + r.label, pillX + 4, y + 3.5);
    pillX += pillW + 3;
  }
  y += 9;

  // ─── Per-tier body ──────────────────────────────────────────────────────
  if (report.summary.itemCount === 0) {
    checkY(20);
    doc.setFillColor(220, 252, 231);
    doc.setDrawColor(167, 243, 208);
    doc.roundedRect(MARGIN, y, COL_W, 16, 2, 2, 'FD');
    doc.setTextColor(6, 95, 70);
    doc.setFontSize(11); doc.setFont('helvetica', 'bold');
    doc.text('No findings.', MARGIN + 4, y + 7);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text('Records show no items changed during this tenancy.', MARGIN + 4, y + 12);
    y += 22;
  } else {
    // Group items by tier
    const itemsByTier = {};
    for (const tier of TIER_DISPLAY_ORDER) itemsByTier[tier] = [];
    for (const item of report.items) {
      if (itemsByTier[item.tier]) itemsByTier[item.tier].push(item);
    }

    for (const tier of TIER_DISPLAY_ORDER) {
      const items = itemsByTier[tier];
      if (items.length === 0) continue;
      y = renderTierSection(doc, y, checkY, tier, items);
    }
  }

  // ─── Photo galleries at the bottom ──────────────────────────────────────
  if (totalPhotoCount(contributingInspections) > 0) {
    doc.addPage();
    y = 20;

    // "Photo Evidence" section header
    doc.setFillColor(...BRAND_RGB);
    doc.rect(0, 0, PAGE_W, 18, 'F');
    doc.setTextColor(240, 253, 244);
    doc.setFontSize(15); doc.setFont('helvetica', 'bold');
    doc.text('Photo Evidence', MARGIN, 12);
    y = 26;

    for (const { kind, inspection } of contributingInspections) {
      y = renderInspectionGallery(doc, y, checkY, inspection, kind, photoDataMap);
    }
  }

  // ─── Certification footer ──────────────────────────────────────────────
  if (y + 18 > FOOTER_LIMIT) { doc.addPage(); y = 20; }
  y += 4;
  doc.setTextColor(120, 120, 120); doc.setFontSize(7.5); doc.setFont('helvetica', 'italic');
  const certLine =
    `Tenancy Findings report generated by MoveOut Shield Landlord on ${reportDate}. ` +
    `Items are grouped by evidence strength tier. Photos retain their original EXIF metadata ` +
    `including capture timestamp and GPS coordinates where available.`;
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
// Render one tier section (header band + items)
// ═══════════════════════════════════════════════════════════════════════════
function renderTierSection(doc, y, checkY, tier, items) {
  const meta = TIER_META[tier];
  const tierFg = TIER_RGB[tier] || [60, 60, 60];
  const tierBg = TIER_BG_RGB[tier] || [240, 240, 240];

  // Tier header band
  checkY(16);
  doc.setFillColor(...tierFg);
  doc.roundedRect(MARGIN, y, COL_W, 11, 2, 2, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(11); doc.setFont('helvetica', 'bold');
  doc.text(meta.label, MARGIN + 4, y + 7);
  doc.setFontSize(8); doc.setFont('helvetica', 'normal');
  doc.text(meta.desc, MARGIN + 4, y + 10.5);
  // Right-aligned count
  doc.setFontSize(10); doc.setFont('helvetica', 'bold');
  doc.text(`${items.length} ${items.length === 1 ? 'item' : 'items'}`, PAGE_W - MARGIN - 4, y + 7, { align: 'right' });
  y += 14;

  // Items in this tier
  for (const item of items) {
    y = renderFindingRow(doc, y, checkY, item, tierBg, tierFg);
  }

  y += 4;
  return y;
}

// ═══════════════════════════════════════════════════════════════════════════
// Render one finding row — room + item + status badges + details
// ═══════════════════════════════════════════════════════════════════════════
function renderFindingRow(doc, y, checkY, item, tierBgRgb, tierFgRgb) {
  // Compute layout heights
  const labelLines = doc.splitTextToSize(item.itemLabel, COL_W - 80);
  const detailLines = item.details
    ? doc.splitTextToSize(item.details, COL_W - 8)
    : [];

  // Build party-data pairs (only present parties)
  const partyEntries = [];
  for (const partyKey of ['landlordBaseline', 'tenantMoveIn', 'landlordPostTenant', 'tenantMoveOut', 'precedingTurnover']) {
    const p = item.parties?.[partyKey];
    if (p) partyEntries.push({ key: partyKey, status: p.status, notes: p.notes });
  }

  // Approximate row height before drawing — for page-break safety
  const headerH = Math.max(7, labelLines.length * 4.5);
  const detailH = detailLines.length > 0 ? detailLines.length * 4 + 2 : 0;
  const partyH = partyEntries.length > 0 ? partyEntries.length * 4.5 + 4 : 0;
  const totalH = headerH + detailH + partyH + 4;
  checkY(totalH + 2);

  // Light wash background using tier's bg color
  doc.setFillColor(...tierBgRgb);
  doc.roundedRect(MARGIN, y, COL_W, totalH, 2, 2, 'F');

  // Room + item header line
  doc.setTextColor(28, 25, 23);
  doc.setFontSize(9); doc.setFont('helvetica', 'bold');
  doc.text(`${item.roomIcon} ${item.roomName}`, MARGIN + 3, y + 5);

  // Change descriptor on the right (e.g., "CLEAN -> DAMAGE")
  if (item.change) {
    const fromShort = item.change.from ? STATUS[item.change.from]?.short : '(unrated)';
    const toShort   = item.change.to   ? STATUS[item.change.to]?.short   : '(unrated)';
    const changeText = `${fromShort} \u2192 ${toShort}`;
    doc.setFontSize(8); doc.setFont('helvetica', 'bold');
    doc.setTextColor(...tierFgRgb);
    doc.text(changeText, PAGE_W - MARGIN - 4, y + 5, { align: 'right' });
  }

  // Item label (wrapped)
  doc.setTextColor(60, 60, 60);
  doc.setFontSize(8.5); doc.setFont('helvetica', 'normal');
  doc.text(labelLines, MARGIN + 3, y + 9.5);
  let cursor = y + 9.5 + labelLines.length * 4.5;

  // Engine details (italic)
  if (detailLines.length > 0) {
    cursor += 1;
    doc.setTextColor(110, 105, 100);
    doc.setFontSize(7.5); doc.setFont('helvetica', 'italic');
    doc.text(detailLines, MARGIN + 3, cursor);
    cursor += detailLines.length * 4;
  }

  // Per-party data rows
  if (partyEntries.length > 0) {
    cursor += 2;
    for (const pe of partyEntries) {
      const partyLabel = PARTY_LABEL[pe.key] || pe.key;
      doc.setTextColor(80, 80, 80);
      doc.setFontSize(7.5); doc.setFont('helvetica', 'bold');
      doc.text(partyLabel + ':', MARGIN + 3, cursor + 3);
      // Status badge
      if (pe.status && STATUS[pe.status]) {
        drawStatusBadge(doc, pe.status, MARGIN + 50, cursor, 14);
      }
      // Notes inline (truncated to fit)
      if (pe.notes) {
        const noteText = pe.notes.replace(/\s+/g, ' ').trim();
        const truncatedNote = noteText.length > 80 ? noteText.slice(0, 80) + '…' : noteText;
        doc.setTextColor(100, 95, 90);
        doc.setFontSize(7); doc.setFont('helvetica', 'italic');
        doc.text(truncatedNote, MARGIN + 65, cursor + 3, { maxWidth: COL_W - 70 });
      }
      cursor += 4.5;
    }
  }

  return y + totalH + 2;
}

// ═══════════════════════════════════════════════════════════════════════════
// Status badge — small colored pill matching STATUS visual
// ═══════════════════════════════════════════════════════════════════════════
function drawStatusBadge(doc, status, x, y, w) {
  if (!status) {
    doc.setTextColor(180, 175, 170);
    doc.setFontSize(7); doc.setFont('helvetica', 'normal');
    doc.text('—', x + w / 2, y + 3, { align: 'center' });
    return;
  }
  const meta = STATUS[status];
  if (!meta) return;
  const bgRgb = STATUS_BG_RGB[status] || [240, 240, 240];
  const fgRgb = STATUS_RGB[status] || [60, 60, 60];

  doc.setFillColor(...bgRgb);
  doc.roundedRect(x, y, w, 4.5, 1.5, 1.5, 'F');
  doc.setTextColor(...fgRgb);
  doc.setFontSize(6); doc.setFont('helvetica', 'bold');
  doc.text(meta.short, x + w / 2, y + 3.2, { align: 'center' });
}

// ═══════════════════════════════════════════════════════════════════════════
// Photo gallery — one per inspection
// ═══════════════════════════════════════════════════════════════════════════
function renderInspectionGallery(doc, y, checkY, inspection, kindKey, photoDataMap) {
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

  // Section header
  const partyLabel = PARTY_LABEL[kindKey] || kindKey;
  const sourceColor = inspection.source === 'tenant' ? TENANT_RGB : LANDLORD_RGB;

  checkY(14);
  doc.setFillColor(...sourceColor);
  doc.rect(MARGIN, y, 1.5, 8, 'F');
  doc.setTextColor(28, 25, 23);
  doc.setFontSize(11); doc.setFont('helvetica', 'bold');
  doc.text(partyLabel, MARGIN + 4, y + 5);
  doc.setTextColor(120, 113, 108);
  doc.setFontSize(8); doc.setFont('helvetica', 'normal');
  doc.text(inspection.label || '(unnamed)', MARGIN + 60, y + 5);
  doc.text(`${photos.length} photo${photos.length === 1 ? '' : 's'}`,
           PAGE_W - MARGIN, y + 5, { align: 'right' });
  y += 10;

  if (photos.length === 0) {
    doc.setTextColor(160, 155, 150);
    doc.setFontSize(8); doc.setFont('helvetica', 'italic');
    doc.text('(no photos)', MARGIN + 4, y + 3);
    y += 10;
    return y;
  }

  // 3-up thumbnails
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
        doc.setFillColor(243, 240, 235);
        doc.rect(tx, y, tW, tH, 'F');
      }
    } else {
      doc.setFillColor(243, 240, 235);
      doc.rect(tx, y, tW, tH, 'F');
      doc.setTextColor(160, 155, 150);
      doc.setFontSize(7); doc.setFont('helvetica', 'italic');
      doc.text('photo unavailable', tx + tW / 2, y + tH / 2, { align: 'center' });
    }

    // Caption
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
function totalPhotoCount(contributingInspections) {
  let n = 0;
  for (const { inspection: insp } of contributingInspections) {
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
