// ═══════════════════════════════════════════════════════════════════════════
// main.jsx — MoveOut Shield Landlord app entry point (v0.3.0)
// ═══════════════════════════════════════════════════════════════════════════
// Hash-based router. Six primary routes:
//
//   #/                                       → Portfolio (property list)
//   #/property/{propertyId}                  → Property detail (leases + records)
//   #/capture/{propertyId}/{inspectionId}    → CaptureScreen (per-room items+pills)
//   #/photodoc/{propertyId}/{inspectionId}   → PhotoDocGridScreen (flat photo grid)
//   #/compare/{propertyId}/{aId}/{bId}[/{cId}]→ ChangesScreen (2- or 3-way)
//   #/findings/{propertyId}/{tenancyId}      → TenancyFindingsScreen
//
// PDF import (replaces the dead .mosinsp share-target flow):
//   - PropertyScreen's "+ Import PDF" calls onImportPdf({ propertyId })
//   - main.jsx triggers a hidden <input type="file" accept=".pdf">
//   - On pick: read as ArrayBuffer → write to Directory.Data under
//     MoveOutShieldLandlord/<propertyId>/pdfs/<uid>.pdf
//   - Read pageCount via pdf-lib (lazy import)
//   - attachPdf(portfolio, propertyId, { id, fileName, path, importedAt, pageCount })
//   - PDF stays on disk forever (until detachPdf), referenced from
//     property.attachedPdfs[]. PdfPickerSheet shows them as bundle options.
//
// Photo Document routing (the new fast-path capture flow):
//   - + Photo Document main tap creates an "Other:N" record and calls onCapture
//     with { route: 'photodoc' } so the route uses #/photodoc/...
//   - + Photo Document chevron picks (Baseline/Mid-lease/Post-tenant/Turnover/Other-with-label)
//     create their respective typed record and use #/capture/... (existing CaptureScreen)
//   - Pills button on lease card opens a record picker → routes to #/capture/...
//
// The .mosinsp pipeline is gone. parseBundleString, readBundleFile, importBundle,
// importBundleFromMemory, ConfirmImportModal, getLaunchUrl/appUrlOpen handlers,
// findTenancyForDate (still in portfolioStore for the diff engine), and all
// related state are removed.
// ═══════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import ReactDOM from 'react-dom/client';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
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
import PhotoDocGridScreen from './screens/PhotoDocGridScreen.jsx';
import TenancyFindingsScreen from './screens/TenancyFindingsScreen.jsx';

const IS_NATIVE = Capacitor.isNativePlatform();

// ─────────────────────────────────────────────────────────────────────────
// Hash router — minimal, no dependency
// ─────────────────────────────────────────────────────────────────────────
function parseRoute(hash) {
  // Hash format: "#/path/segments?key=value"
  const raw = (hash || '').replace(/^#\/?/, '');
  const [pathPart, queryPart] = raw.split('?');
  const parts = pathPart.split('/').filter(Boolean);
  const query = {};
  if (queryPart) {
    for (const kv of queryPart.split('&')) {
      const [k, v] = kv.split('=');
      if (k) query[decodeURIComponent(k)] = v == null ? '' : decodeURIComponent(v);
    }
  }
  if (parts.length === 0) return { name: 'portfolio' };
  if (parts[0] === 'property' && parts[1]) return { name: 'property', propertyId: parts[1] };
  if (parts[0] === 'capture' && parts[1] && parts[2]) {
    return {
      name: 'capture',
      propertyId: parts[1],
      inspectionId: parts[2],
      autoOpenCamera: query.cam === '1',
    };
  }
  if (parts[0] === 'photodoc' && parts[1] && parts[2]) {
    return {
      name: 'photodoc',
      propertyId: parts[1],
      inspectionId: parts[2],
      autoOpenCamera: query.cam === '1',
    };
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
  const [importBusy, setImportBusy] = useState(null);   // { fileName } | null
  const [importError, setImportError] = useState(null);
  const [importSuccess, setImportSuccess] = useState(null);

  // Hidden file input for the property-level "+ Import PDF" button.
  // Triggered programmatically from PropertyScreen via onImportPdf.
  const fileInputRef = useRef(null);
  // Remember which property the user tapped Import from, since the file
  // picker doesn't carry that context through its native dialog.
  const importTargetPropertyIdRef = useRef(null);

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
  // PDF attach flow (replaces the .mosinsp pipeline)
  //
  // Flow:
  //   1. PropertyScreen → "+ Import PDF" → onImportPdf({ propertyId })
  //   2. triggerImportPdf stashes propertyId, opens hidden file input
  //   3. User picks a .pdf
  //   4. handlePdfPicked reads bytes, writes to disk, reads pageCount,
  //      attaches metadata to property.attachedPdfs[]
  //   5. Success toast surfaces filename + page count
  // ─────────────────────────────────────────────────────────────────────
  const triggerImportPdf = useCallback((opts = {}) => {
    importTargetPropertyIdRef.current = opts.propertyId || null;
    fileInputRef.current?.click();
  }, []);

  const handlePdfPicked = useCallback(async (event) => {
    const file = event.target.files?.[0];
    const targetPropertyId = importTargetPropertyIdRef.current;
    if (!file) return;
    event.target.value = '';  // reset so picking the same file twice still fires

    if (!targetPropertyId) {
      setImportError('Internal error: no target property set for PDF import.');
      return;
    }

    if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
      setImportError(`"${file.name}" is not a PDF. Files must have a .pdf extension.`);
      return;
    }

    setImportError(null);
    setImportSuccess(null);
    setImportBusy({ fileName: file.name });

    try {
      // Read the file as an ArrayBuffer — works on web + Capacitor's webview.
      const arrayBuffer = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsArrayBuffer(file);
      });

      // Persist bytes. On native this writes to Directory.Data; on web we
      // stash a blob URL so PDFs survive within-session but not across reloads.
      const pdfId = uid();
      let storedPath;
      if (IS_NATIVE) {
        const base64 = arrayBufferToBase64(arrayBuffer);
        const fileName = `${pdfId}.pdf`;
        const diskPath = `${PHOTO_ROOT}/${targetPropertyId}/pdfs/${fileName}`;
        await Filesystem.writeFile({
          path: diskPath,
          data: base64,
          directory: Directory.Data,
          recursive: true,
        });
        storedPath = diskPath;
      } else {
        // Web fallback: stash a blob URL. pdfMerge.js fetches blob URLs natively.
        const blob = new Blob([arrayBuffer], { type: 'application/pdf' });
        storedPath = URL.createObjectURL(blob);
      }

      // Read pageCount — best-effort, doesn't block attach if it fails.
      let pageCount = null;
      try {
        pageCount = await readPdfPageCount(storedPath);
      } catch {
        // pdf-lib may reject corrupt or password-protected PDFs.
        // Attach anyway — pdfMerge.mergePdfs will skip the file at bundle
        // time if it can't be loaded, with the filename in the warning.
      }

      const pdfRecord = {
        id: pdfId,
        fileName: file.name,
        path: storedPath,
        importedAt: new Date().toISOString(),
        pageCount,
      };

      setPortfolio(prev => attachPdf(prev, targetPropertyId, pdfRecord));
      setImportBusy(null);
      setImportSuccess({
        fileName: file.name,
        pageCount,
      });
    } catch (e) {
      console.error('PDF import failed:', e);
      setImportError(e?.message || String(e));
      setImportBusy(null);
    }
  }, []);

  // ─── Comparison PDF share — invoked from ChangesScreen ────────────────
  // Builds the multi-inspection comparison PDF (item diff + photo galleries)
  // and routes it through the right delivery mechanism for the platform.
  // Native: write to Cache + Share.share. Web: doc.save().
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

  // ─── Capture navigation helper ───────────────────────────────────────
  // v0.3.0+ unified flow: every record routes to PhotoDocGridScreen by
  // default (the canonical post-capture surface). Only the Pills button on
  // a lease card or the Pills entry inside PhotoDocGridScreen routes to
  // CaptureScreen — explicitly via opts.route='capture'. Anywhere else
  // (Photo Document picker, inspection-card tap, attached-record open,
  // Property Photos canonical record), the user lands on the flat-grid
  // photodoc surface with Tag Rooms / Tag Damages / Pills / Generate PDF
  // all reachable from there.
  const handleCapture = useCallback((inspectionId, opts = {}) => {
    const cam = opts.autoOpenCamera ? '?cam=1' : '';
    const screen = opts.route === 'capture' ? 'capture' : 'photodoc';
    navigate(`/${screen}/${route.propertyId}/${inspectionId}${cam}`);
  }, [route.propertyId]);

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
          onCapture={handleCapture}
          onImportPdf={triggerImportPdf}
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
          autoOpenCamera={route.autoOpenCamera}
          onBack={() => navigate(`/property/${route.propertyId}`)}
          photoStore={photoStore}
        />
      )}
      {route.name === 'photodoc' && (
        <PhotoDocGridScreen
          portfolio={portfolio}
          setPortfolio={setPortfolio}
          propertyId={route.propertyId}
          inspectionId={route.inspectionId}
          autoOpenCamera={route.autoOpenCamera}
          onBack={() => navigate(`/property/${route.propertyId}`)}
          onOpenPills={(inspectionId) =>
            navigate(`/capture/${route.propertyId}/${inspectionId}`)
          }
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

      {/* Hidden file input for + Import PDF */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,application/pdf"
        onChange={handlePdfPicked}
        style={{ display: 'none' }}
      />

      {importBusy && <ImportBusyModal info={importBusy} />}

      {importError && (
        <ToastModal
          kind="error"
          title="Import failed"
          body={importError}
          onDismiss={() => setImportError(null)}
        />
      )}

      {importSuccess && (
        <ToastModal
          kind="success"
          title="PDF attached"
          body={
            `"${importSuccess.fileName}" is now attached to this property.` +
            (importSuccess.pageCount
              ? `\n\n${importSuccess.pageCount} page${importSuccess.pageCount === 1 ? '' : 's'} ready to bundle into your reports.`
              : '\n\nReady to bundle into your reports.')
          }
          onDismiss={() => setImportSuccess(null)}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ImportBusyModal — shown while a PDF is being read + written to disk
// ═══════════════════════════════════════════════════════════════════════════
function ImportBusyModal({ info }) {
  return (
    <div style={modalBackdrop}>
      <div style={{
        background: THEME.paper, borderRadius: 16, padding: 24,
        maxWidth: 360, width: '100%',
        border: `2px solid ${THEME.brand}`,
        boxShadow: '0 20px 50px rgba(0,0,0,0.3)',
        textAlign: 'center',
      }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>📄</div>
        <div style={{ fontSize: 16, fontWeight: 700, color: THEME.brand, marginBottom: 6 }}>
          Importing…
        </div>
        <div style={{ fontSize: 13, color: THEME.muted, lineHeight: 1.5, wordBreak: 'break-word' }}>
          {info.fileName}
        </div>
      </div>
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
        <div style={{ fontSize: 14, color: THEME.ink, whiteSpace: 'pre-wrap', marginBottom: 20, lineHeight: 1.5 }}>
          {body}
        </div>
        <button onClick={onDismiss} style={{ ...btnPrimary, background: accent, width: '100%' }}>
          Dismiss
        </button>
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  // Chunk to avoid call stack overflow on large PDFs
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
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
