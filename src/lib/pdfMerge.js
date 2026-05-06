// ═══════════════════════════════════════════════════════════════════════════
// pdfMerge.js — append attached PDFs onto a generated jsPDF doc
// ═══════════════════════════════════════════════════════════════════════════
// The landlord's report (single inspection, comparison, or evidence bundle)
// is built with jsPDF. Attached PDFs (receipts, repair invoices, tenant
// reports) live as bytes on disk. This module merges the two into one
// final PDF so the landlord ships a single artifact.
//
// pdf-lib is used because jsPDF can't import existing PDF pages —
// addImage works for raster but not vector PDF content. pdf-lib copies
// pages page-for-page preserving searchable text, vector graphics,
// and original page sizes.
//
// Public API:
//   mergePdfs(jsPdfDoc, attachedPdfs, photoStore) → Promise<Blob>
//   readPdfPageCount(path) → Promise<number | null>
//
// On success: returns a Blob containing the merged PDF.
// On any pdf-lib error reading an attached PDF: that attachment is
// skipped, a warning is logged, and the merge continues. Better to ship
// the landlord's report without one corrupt attachment than to fail
// the whole export.
// ═══════════════════════════════════════════════════════════════════════════

import { PDFDocument } from 'pdf-lib';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';

const IS_NATIVE = Capacitor.isNativePlatform();

export async function mergePdfs(jsPdfDoc, attachedPdfs, photoStore) {
  // If nothing to merge, just return the jsPDF as a Blob
  if (!attachedPdfs || attachedPdfs.length === 0) {
    return jsPdfDoc.output('blob');
  }

  // Read jsPDF output as ArrayBuffer for pdf-lib
  const baseBytes = jsPdfDoc.output('arraybuffer');
  const merged = await PDFDocument.load(baseBytes);

  for (const attached of attachedPdfs) {
    try {
      const bytes = await readAttachedPdfBytes(attached);
      if (!bytes) continue;
      const incoming = await PDFDocument.load(bytes);
      const pages = await merged.copyPages(incoming, incoming.getPageIndices());
      for (const page of pages) merged.addPage(page);
    } catch (e) {
      console.warn(`[pdfMerge] Failed to merge ${attached.fileName}:`, e?.message || e);
      // Skip this attachment, keep going
    }
  }

  const outBytes = await merged.save();
  return new Blob([outBytes], { type: 'application/pdf' });
}

// ─── PDF page count helper, used at attach time ────────────────────────────
// Read a PDF's page count without keeping the bytes in memory. Used by the
// attach flow to populate the .pageCount field on the attached record so
// the picker sheet can display it.
export async function readPdfPageCount(path) {
  try {
    const bytes = await readPathAsArrayBuffer(path);
    if (!bytes) return null;
    const doc = await PDFDocument.load(bytes);
    return doc.getPageCount();
  } catch (e) {
    console.warn(`[pdfMerge] Could not read page count for ${path}:`, e?.message || e);
    return null;
  }
}

// ─── Internal: read bytes of an attached PDF from disk ─────────────────────
async function readAttachedPdfBytes(attached) {
  if (!attached?.path) return null;
  return readPathAsArrayBuffer(attached.path);
}

async function readPathAsArrayBuffer(path) {
  if (IS_NATIVE) {
    // Capacitor: read as base64, decode to ArrayBuffer
    try {
      const { data } = await Filesystem.readFile({
        path,
        directory: Directory.Data,
      });
      // base64 → Uint8Array → ArrayBuffer
      const binary = atob(data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return bytes.buffer;
    } catch (e) {
      console.warn(`[pdfMerge] Filesystem read failed for ${path}:`, e?.message || e);
      return null;
    }
  } else {
    // Web: path is a blob URL stashed at attach time. Fetch it.
    try {
      const res = await fetch(path);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.arrayBuffer();
    } catch (e) {
      console.warn(`[pdfMerge] Fetch failed for ${path}:`, e?.message || e);
      return null;
    }
  }
}
