// ═══════════════════════════════════════════════════════════════════════════
// main.jsx — MoveOut Shield Landlord app entry point (v0.3.0)
// ═══════════════════════════════════════════════════════════════════════════
// Hash-based router. Five primary screens:
//
//   #/                                       → Portfolio (property list)
//   #/property/{propertyId}                  → Property detail
//   #/capture/{propertyId}/{inspectionId}    → Capture (camera + items + photos)
//   #/compare/{propertyId}/{aId}/{bId}       → 2-way compare
//   #/compare/{propertyId}/{aId}/{bId}/{cId} → 3-way compare
//   #/findings/{propertyId}/{tenancyId}      → Tenancy findings
//
// v0.3 changes:
//   - .mosinsp bundle import is GONE. Tenant-side reports now arrive as PDFs
//     and attach to the property via property.attachedPdfs[]. Bundling and
//     comparison happens in PropertyScreen's PdfPickerSheet at PDF time.
//   - Manual file picker now accepts .pdf only. The picked file is copied
//     into Directory.Data under PHOTO_ROOT/<propertyId>/pdfs/ and a record
//     is added to the property's attachedPdfs[].
//   - readPdfPageCount() reads the page count once at attach time so the
//     picker sheet can display "X pages" without re-reading.
// ═══════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import ReactDOM from 'react-dom/client';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { App as CapApp } from '@capacitor/app';
import { SplashScreen } from '@capacitor/splash-screen';

import { THEME, PHOTO_ROOT, uid } from './lib/constants.js';
import {
  loadPortfolio, savePortfolio,
  attachPdf,
} from './lib/portfolioStore.js';
import { makePhotoStore } from './lib/photoStore.js';
import { buildComparisonPDF } from './lib/comparisonPDF.js';
import { buildTenancyFindingsPDF } from './lib/tenancyFindingsPDF.js';
import { readPdfPageCount } from './lib/pdfMerge.js';

import PortfolioScreen from './screens/PortfolioScreen.jsx';
import PropertyScreen from './screens/PropertyScreen.jsx';
import ChangesScreen from './screens/ChangesScreen.jsx';
import CaptureScreen from './screens/CaptureScreen.jsx';
import TenancyFindingsScreen from './screens/TenancyFindingsScreen.jsx';

const IS_NATIVE = Capacitor.isNativePlatform();

// ─────────────────────────────────────────────────────────────────────────
// Hash router — minimal, no dependency
// ─────────────────────────────────────────────────────────────────────────
function parseRoute(hash) {
  const parts = (hash || '').replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts.length === 0) return { name: 'portfolio' };
  if (parts[0] === 'property' && parts[1]) return { name: 'property', propertyId: parts[1] };
  if (parts[0] === 'capture' && parts[1] && parts[2]) {
    return { name: 'capture', propertyId: parts[1], inspectionId: parts[2] };
  }
  if (parts[0] === 'compare' && parts[1] && parts[2] && parts[3]) {
    const ids = [parts[2], parts[3], parts[4]].filter(Boolean);
    return { name: 'compare', propertyId: parts[1], inspectionIds: ids };
  }
  if (parts[0] === 'findings' && parts[1] && parts[2]) {
    return { name: 'findings', propertyId: parts[1], tenancyId: parts[2] };
  }
  return { name: 'portfolio' };
}

function navigate(path) { window.location.hash = path; }

// ─────────────────────────────────────────────────────────────────────────
// App root
// ─────────────────────────────────────────────────────────────────────────
function App() {
  const [portfolio, setPortfolio] = useState(() => loadPortfolio());
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));

  // PDF import state — replaces the old .mosinsp bundle import flow
  const [pdfImportError, setPdfImportError] = useState(null);
  const [pdfImportSuccess, setPdfImportSuccess] = useState(null);

  // The propertyId we're attaching the next PDF to (set by PropertyScreen
  // when user taps + Import PDF). Cleared after the file picker resolves.
  const pdfImportTargetRef = useRef(null);

  // Hidden file input for the PDF picker, triggered programmatically from
  // PropertyScreen's onImportPdf prop.
  const fileInputRef = useRef(null);

  const photoStore = useMemo(() => makePhotoStore({ Capacitor, Filesystem, Directory }), []);

  // Persist portfolio on every change
  useEffect(() => { savePortfolio(portfolio); }, [portfolio]);

  // Listen for hash changes
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  // Hide splash once mounted
  useEffect(() => {
    if (IS_NATIVE) SplashScreen.hide().catch(() => {});
  }, []);

  // ─────────────────────────────────────────────────────────────────────
  // PDF import (replaces .mosinsp)
  // ─────────────────────────────────────────────────────────────────────
  // Triggered from PropertyScreen's + Import PDF button. Opens the file
  // picker, copies the chosen PDF into Directory.Data, reads its page
  // count via pdf-lib, and adds an attachedPdfs entry to the property.
  // Files are kept under PHOTO_ROOT/<propertyId>/pdfs/ so removeProperty
  // can clean them up alongside photos in a single rmdir.
  const triggerPdfPicker = useCallback((opts = {}) => {
    pdfImportTargetRef.current = opts.propertyId || null;
    fileInputRef.current?.click();
  }, []);

  const handlePdfPicked = useCallback(async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = '';  // reset so picking the same file twice still fires
    const propertyId = pdfImportTargetRef.current;
    pdfImportTargetRef.current = null;

    if (!propertyId) {
      setPdfImportError('No property target — try again from the property screen.');
      return;
    }

    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setPdfImportError(`"${file.name}" is not a PDF.`);
      return;
    }

    try {
      // Read the file as ArrayBuffer
      const arrayBuffer = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsArrayBuffer(file);
      });

      // Convert to base64 for Filesystem.writeFile
      const bytes = new Uint8Array(arrayBuffer);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
      const base64 = btoa(binary);

      // Build a clean filename (avoid filesystem-hostile chars)
      const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, '_');
      const tag = Date.now() + '_' + uid().slice(0, 6);
      const path = `${PHOTO_ROOT}/${propertyId}/pdfs/${tag}_${safeName}`;

      // Persist to disk on native; web stashes a blob URL
      let storedPath;
      if (IS_NATIVE) {
        await Filesystem.writeFile({
          path, data: base64,
          directory: Directory.Data,
          recursive: true,
        });
        storedPath = path;
      } else {
        // Web: keep a blob URL. Won't survive page reload, but works for
        // in-session PDF generation.
        const blob = new Blob([arrayBuffer], { type: 'application/pdf' });
        storedPath = URL.createObjectURL(blob);
      }

      // Read page count for the picker sheet display
      let pageCount = null;
      try {
        pageCount = await readPdfPageCount(storedPath);
      } catch {}

      const pdfRecord = {
        id: uid(),
        fileName: file.name,
        path: storedPath,
        importedAt: new Date().toISOString(),
        pageCount,
      };

      const next = attachPdf(portfolio, propertyId, pdfRecord);
      setPortfolio(next);
      setPdfImportSuccess({ fileName: file.name, propertyId });
    } catch (e) {
      console.error('PDF import failed:', e);
      setPdfImportError(e?.message || String(e));
    }
  }, [portfolio]);

  // ─── Comparison PDF share — invoked from ChangesScreen ────────────────
  // Builds the multi-inspection comparison PDF (item diff + photo galleries)
  // and routes it through the right delivery mechanism for the platform.
  // Mirrors PropertyScreen's handleGeneratePdf pattern: native uses Filesystem
  // + Share.share, web uses doc.save() to trigger browser download.
  const handleShareComparisonPDF = useCallback(async ({ inspections, diff, property }) => {
    if (!inspections || inspections.length < 2) {
      alert('Need at least 2 inspections to build a comparison report.');
      return;
    }
    try {
      const doc = await buildComparisonPDF(inspections, diff, property, photoStore);
      const safeName = (property?.name || 'Property').replace(/\s+/g, '-').replace(/[^A-Za-z0-9-_]/g, '');
      const date = new Date().toISOString().slice(0, 10);
      const fileName = `${safeName}-Comparison-${inspections.length}way-${date}.pdf`;

      if (IS_NATIVE) {
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
            title: `Comparison — ${property?.name || 'Property'}`,
            text: `${inspections.length}-way inspection comparison for ${property?.name || 'this property'}`,
            url: uri,
            dialogTitle: 'Share Comparison Report',
          });
        } catch (e) {
          // User-cancelled share — swallow
          const msg = String(e?.message || '');
          if (!msg.includes('cancel') && !msg.includes('abort') && !msg.includes('dismiss')) throw e;
        }
      } else {
        doc.save(fileName);
      }
    } catch (e) {
      console.error('Comparison PDF export failed:', e);
      alert('Comparison PDF export failed: ' + (e?.message || 'unknown error'));
      throw e;  // rethrow so ChangesScreen can clear its busy state
    }
  }, [photoStore]);

  // ─── Tenancy Findings PDF share — mirrors comparison PDF flow ────────
  const handleShareFindingsPDF = useCallback(async ({ report, property, tenancy }) => {
    if (!report || report.summary.itemCount === 0) {
      alert('No findings to share — records show no items changed during this tenancy.');
      return;
    }
    try {
      const doc = await buildTenancyFindingsPDF(report, property, tenancy, photoStore);
      const safeName = (property?.name || 'Property').replace(/\s+/g, '-').replace(/[^A-Za-z0-9-_]/g, '');
      const date = new Date().toISOString().slice(0, 10);
      const fileName = `${safeName}-Findings-${date}.pdf`;

      if (IS_NATIVE) {
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
            title: `Findings — ${property?.name || 'Property'}`,
            text: `Tenancy Findings report for ${property?.name || 'this property'}`,
            url: uri,
            dialogTitle: 'Share Tenancy Findings',
          });
        } catch (e) {
          const msg = String(e?.message || '');
          if (!msg.includes('cancel') && !msg.includes('abort') && !msg.includes('dismiss')) throw e;
        }
      } else {
        doc.save(fileName);
      }
    } catch (e) {
      console.error('Findings PDF export failed:', e);
      alert('Findings PDF export failed: ' + (e?.message || 'unknown error'));
      throw e;
    }
  }, [photoStore]);

  // ─── Render ─────────────────────────────────────────────────────────
  return (
    <div style={{ background: THEME.bg, color: THEME.ink, minHeight: '100vh' }}>
      {route.name === 'portfolio' && (
        <PortfolioScreen
          portfolio={portfolio}
          setPortfolio={setPortfolio}
          onOpenProperty={(id) => navigate(`/property/${id}`)}
        />
      )}
      {route.name === 'property' && (
        <PropertyScreen
          portfolio={portfolio}
          setPortfolio={setPortfolio}
          propertyId={route.propertyId}
          onBack={() => navigate('/')}
          onCompare={(ids) => navigate(`/compare/${route.propertyId}/${ids.join('/')}`)}
          onCapture={(inspectionId) => navigate(`/capture/${route.propertyId}/${inspectionId}`)}
          onImportPdf={triggerPdfPicker}
          onTenancyFindings={(tenancyId) => navigate(`/findings/${route.propertyId}/${tenancyId}`)}
          photoStore={photoStore}
        />
      )}
      {route.name === 'capture' && (
        <CaptureScreen
          portfolio={portfolio}
          setPortfolio={setPortfolio}
          propertyId={route.propertyId}
          inspectionId={route.inspectionId}
          onBack={() => navigate(`/property/${route.propertyId}`)}
          photoStore={photoStore}
        />
      )}
      {route.name === 'compare' && (
        <ChangesScreen
          portfolio={portfolio}
          propertyId={route.propertyId}
          inspectionIds={route.inspectionIds}
          onBack={() => navigate(`/property/${route.propertyId}`)}
          onSharePDF={handleShareComparisonPDF}
          photoStore={photoStore}
        />
      )}
      {route.name === 'findings' && (
        <TenancyFindingsScreen
          portfolio={portfolio}
          propertyId={route.propertyId}
          tenancyId={route.tenancyId}
          onBack={() => navigate(`/property/${route.propertyId}`)}
          onSharePDF={handleShareFindingsPDF}
          photoStore={photoStore}
        />
      )}

      {/* Hidden file input for the property-level PDF picker */}
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf,.pdf"
        onChange={handlePdfPicked}
        style={{ display: 'none' }}
      />

      {pdfImportError && (
        <ToastModal kind="error" title="PDF import failed" body={pdfImportError}
          onDismiss={() => setPdfImportError(null)} />
      )}

      {pdfImportSuccess && (
        <ToastModal kind="success" title="PDF attached"
          body={`"${pdfImportSuccess.fileName}" is now attached. Use Generate Report to bundle it with a Photo Document.`}
          onDismiss={() => setPdfImportSuccess(null)} />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ToastModal — generic success/error popup
// ═══════════════════════════════════════════════════════════════════════════
function ToastModal({ kind, title, body, onDismiss }) {
  const accent = kind === 'error' ? THEME.danger : THEME.brand2;
  return (
    <div style={modalBackdrop}>
      <div style={{
        background: THEME.paper, borderRadius: 16, padding: 24,
        maxWidth: 420, width: '100%',
        border: `2px solid ${accent}`,
        boxShadow: '0 20px 50px rgba(0,0,0,0.3)',
      }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: accent, marginBottom: 10 }}>{title}</div>
        <div style={{ fontSize: 14, color: THEME.ink, whiteSpace: 'pre-wrap', marginBottom: 20, lineHeight: 1.5 }}>{body}</div>
        <button onClick={onDismiss} style={{ ...btnPrimary, background: accent, width: '100%' }}>Dismiss</button>
      </div>
    </div>
  );
}

// ─── Inline shared styles ──────────────────────────────────────────────
const modalBackdrop = {
  position: 'fixed', inset: 0, background: 'rgba(28, 25, 23, 0.6)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  zIndex: 1000, padding: 24,
};

const btnPrimary = {
  background: THEME.brand, color: THEME.mint50, border: 'none', borderRadius: 10,
  padding: '12px 18px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
};

// ───────────────────────────────────────────────────────────────────────
ReactDOM.createRoot(document.getElementById('root')).render(<App />);
