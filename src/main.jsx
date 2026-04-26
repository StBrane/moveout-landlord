// ═══════════════════════════════════════════════════════════════════════════
// main.jsx — MoveOut Shield Landlord app entry point (v0.2.0)
// ═══════════════════════════════════════════════════════════════════════════
// Hash-based router. Three primary screens:
//
//   #/                                      → Portfolio (property list)
//   #/property/{propertyId}                 → Property detail (catalog)
//   #/compare/{propertyId}/{aId}/{bId}      → 2-way compare
//   #/compare/{propertyId}/{aId}/{bId}/{cId} → 3-way compare
//
// Bundle import fires on three entry points:
//   1. Cold-start launch URL (App.getLaunchUrl)
//   2. Runtime URL handler (App.appUrlOpen)
//   3. Manual file picker (in-app "Tenant's Report" button → file input)
//
// All three funnel into handleIncomingBundle, which:
//   - Reads + parses the .mosinsp
//   - Shows a confirm-first dialog with bundle summary
//   - Matches or creates a property by address
//   - Matches a tenancy by createdAt date, or creates a placeholder tenancy
//   - Imports inspection records with photos
//   - Routes to the property detail screen
// ═══════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import ReactDOM from 'react-dom/client';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { App as CapApp } from '@capacitor/app';
import { SplashScreen } from '@capacitor/splash-screen';

import { THEME } from './lib/constants.js';
import {
  loadPortfolio, savePortfolio,
  createProperty, getProperty,
  createTenancy, findTenancyForDate,
  addImportedInspection,
} from './lib/portfolioStore.js';
import {
  parseBundleString, readBundleFile, importBundle,
} from './lib/bundleImport.js';
import { makePhotoStore } from './lib/photoStore.js';
import { buildComparisonPDF } from './lib/comparisonPDF.js';
import { buildTenancyFindingsPDF } from './lib/tenancyFindingsPDF.js';

import PortfolioScreen from './screens/PortfolioScreen.jsx';
import PropertyScreen from './screens/PropertyScreen.jsx';
import ChangesScreen from './screens/ChangesScreen.jsx';
import CaptureScreen from './screens/CaptureScreen.jsx';
import TenancyFindingsScreen from './screens/TenancyFindingsScreen.jsx';
import ImportProgressModal from './components/ImportProgressModal.jsx';

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
  const [importing, setImporting] = useState(null);
  const [importError, setImportError] = useState(null);
  const [importSuccess, setImportSuccess] = useState(null);
  const [importConfirm, setImportConfirm] = useState(null);  // { url, bundle, summary } | null

  // Hidden file input for the manual "Tenant's Report" button.
  // Triggered programmatically from PropertyScreen.
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
  // STEP 1: Read + parse the bundle, show confirm dialog with summary.
  // The actual photo writes don't happen until user confirms.
  // ─────────────────────────────────────────────────────────────────────
  const beginIncomingBundle = useCallback(async (url) => {
    if (!url) return;
    if (!url.toLowerCase().includes('mosinsp')) return;

    setImportError(null);
    setImportSuccess(null);

    try {
      const json = await readBundleFile(url, { Filesystem });
      const { bundle, errors } = parseBundleString(json);
      if (errors.length) {
        setImportError(errors.join('\n'));
        return;
      }

      // Compute a summary the user can review before commit
      const photoCount = bundle.manifest?.photoCount || Object.keys(bundle.photos || {}).length;

      // Auto-route preview — match by address, then by date to a tenancy.
      // Cold-start path doesn't have a "tapped from" context (user came in
      // from share sheet), so routingMismatch is always false here.
      const bundleAddr = (bundle.inspection.address || '').trim().toLowerCase();
      const matchedProperty = bundleAddr
        ? portfolio.properties.find(p => p.address.trim().toLowerCase() === bundleAddr)
        : null;
      const bundleDate = bundle.inspection.createdAt || bundle.exportedAt;
      const autoRouteTenancy = matchedProperty
        ? findTenancyForDate(matchedProperty, bundleDate)
        : null;

      const summary = {
        propertyName: bundle.inspection.name || '(no property name)',
        propertyAddress: bundle.inspection.address || '(no address)',
        exportedAt: bundle.exportedAt,
        bundleDate,
        photoCount,
        stateName: bundle.stateLaw?.[0] || null,
        propertyMatched: !!matchedProperty,
        autoRouteTenancyTenants: autoRouteTenancy?.tenants?.join(', ') || null,
        tappedFromTenancyTenants: null,
        routingMismatch: false,
      };

      setImportConfirm({ url, bundle, summary });
    } catch (e) {
      console.error('Bundle read/parse failed:', e);
      setImportError(e?.message || String(e));
    }
  }, [portfolio]);

  // ─────────────────────────────────────────────────────────────────────
  // STEP 2: User confirmed — actually import (writes photos to disk,
  // creates/updates property and tenancy, attaches inspections).
  // ─────────────────────────────────────────────────────────────────────
  const commitIncomingBundle = useCallback(async () => {
    if (!importConfirm) return;
    const { url, bundle } = importConfirm;
    setImportConfirm(null);

    const fileName = url.split('/').pop() || 'inspection.mosinsp';
    setImporting({ fileName, progress: null });

    try {
      // Match property by address (case-insensitive trim)
      let workingPortfolio = portfolio;
      const addr = (bundle.inspection.address || '').trim().toLowerCase();
      let targetProperty = addr
        ? workingPortfolio.properties.find(p => p.address.trim().toLowerCase() === addr)
        : null;

      if (!targetProperty) {
        const result = createProperty(workingPortfolio, {
          name: bundle.inspection.name || 'Imported Property',
          address: bundle.inspection.address || '',
          stateIdx: bundle.inspection.stateIdx,
        });
        workingPortfolio = result.portfolio;
        targetProperty = result.property;
      }

      // Match tenancy by date range, or create a placeholder one.
      // We use the bundle's inspection createdAt as the anchor.
      const bundleDate = bundle.inspection.createdAt || bundle.exportedAt;
      let targetTenancy = findTenancyForDate(targetProperty, bundleDate);

      if (!targetTenancy) {
        // No matching tenancy — create one. We don't know the tenant's name
        // (the bundle doesn't carry it for privacy reasons), so it's a
        // placeholder. The landlord can edit it later.
        const tenantName = '(Tenant from imported bundle)';
        const tenancyResult = createTenancy(workingPortfolio, targetProperty.id, {
          tenants: [tenantName],
          rent: null,
          deposit: null,
          startDate: bundleDate.slice(0, 10),  // YYYY-MM-DD
          endDate: null,
        });
        workingPortfolio = tenancyResult.portfolio;
        targetTenancy = tenancyResult.tenancy;
      }

      // Run the actual import (photo writes to disk)
      const importResult = await importBundle(
        url,
        { Filesystem, Directory },
        targetProperty,
        {
          onProgress: (done, total, phase) =>
            setImporting({ fileName, progress: { done, total, phase } }),
        }
      );

      // Attach split inspections to the tenancy
      for (const insp of importResult.inspections) {
        workingPortfolio = addImportedInspection(
          workingPortfolio, targetProperty.id, targetTenancy.id, insp
        );
      }

      setPortfolio(workingPortfolio);
      setImporting(null);
      setImportSuccess({
        propertyId: targetProperty.id,
        propertyName: targetProperty.name,
        tenancyId: targetTenancy.id,
        inspectionsAdded: importResult.inspections.length,
        warnings: importResult.warnings,
      });

      navigate(`/property/${targetProperty.id}`);
    } catch (e) {
      console.error('Import commit failed:', e);
      setImportError(e?.message || String(e));
      setImporting(null);
    }
  }, [importConfirm, portfolio]);

  // ─────────────────────────────────────────────────────────────────────
  // Cold-start: app opened from a .mosinsp file
  // ─────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!IS_NATIVE) return;
    CapApp.getLaunchUrl()
      .then(result => { if (result?.url) beginIncomingBundle(result.url); })
      .catch(() => {});
  }, [beginIncomingBundle]);

  // Runtime: app already open, OS hands us a URL
  useEffect(() => {
    if (!IS_NATIVE) return;
    const promise = CapApp.addListener('appUrlOpen', (event) => {
      if (event?.url) beginIncomingBundle(event.url);
    });
    return () => { promise.then(h => h.remove()).catch(() => {}); };
  }, [beginIncomingBundle]);

  // ─────────────────────────────────────────────────────────────────────
  // Manual file picker — invoked from PropertyScreen's "Tenant's Report"
  // button. Works on both web and native (browser file input is universal).
  //
  // The picker remembers which tenancy the user tapped from (if any) via
  // tappedFromTenancyIdRef. When the bundle loads, we compare the bundle's
  // auto-routed target tenancy to where the user tapped from and surface
  // any mismatch in the confirmation dialog.
  // ─────────────────────────────────────────────────────────────────────
  const tappedFromTenancyIdRef = useRef(null);
  const tappedFromPropertyIdRef = useRef(null);

  const triggerFilePicker = useCallback((opts = {}) => {
    tappedFromTenancyIdRef.current = opts.tenancyId || null;
    tappedFromPropertyIdRef.current = opts.propertyId || null;
    fileInputRef.current?.click();
  }, []);

  const handleFilePicked = useCallback(async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = '';  // reset so picking the same file twice still fires

    if (!file.name.toLowerCase().endsWith('.mosinsp')) {
      setImportError(`"${file.name}" is not a MoveOut Shield bundle. Files must have a .mosinsp extension.`);
      return;
    }

    try {
      // Read the file via FileReader — works in browser AND in Capacitor's
      // webview. Capacitor.Filesystem isn't needed for File objects from
      // an <input type="file">.
      const text = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsText(file);
      });

      // The .mosinsp content is base64-of-JSON — decode once
      let json;
      try {
        json = atob(text.trim());
        // Handle potential UTF-8 multibyte characters (matches tenant exporter)
        const bytes = new Uint8Array(json.length);
        for (let i = 0; i < json.length; i++) bytes[i] = json.charCodeAt(i);
        json = new TextDecoder().decode(bytes);
      } catch (e) {
        setImportError(`File is not a valid MoveOut Shield bundle: ${e.message}`);
        return;
      }

      const { bundle, errors } = parseBundleString(json);
      if (errors.length) {
        setImportError(errors.join('\n'));
        return;
      }

      const photoCount = bundle.manifest?.photoCount || Object.keys(bundle.photos || {}).length;

      // Determine auto-route target — match by address to existing property,
      // then by date to a tenancy within that property. This is what the
      // import will do if the user confirms; we surface the routing in the
      // confirmation dialog.
      const bundleAddr = (bundle.inspection.address || '').trim().toLowerCase();
      const matchedProperty = bundleAddr
        ? portfolio.properties.find(p => p.address.trim().toLowerCase() === bundleAddr)
        : null;
      const bundleDate = bundle.inspection.createdAt || bundle.exportedAt;
      const autoRouteTenancy = matchedProperty
        ? findTenancyForDate(matchedProperty, bundleDate)
        : null;

      // Was this triggered from inside a specific lease's card?
      const tappedFromTenancyId = tappedFromTenancyIdRef.current;
      const tappedFromTenancy = tappedFromTenancyId && matchedProperty
        ? matchedProperty.tenancies.find(t => t.id === tappedFromTenancyId)
        : null;
      const routingMismatch = tappedFromTenancy && autoRouteTenancy &&
        tappedFromTenancy.id !== autoRouteTenancy.id;

      const summary = {
        propertyName: bundle.inspection.name || '(no property name)',
        propertyAddress: bundle.inspection.address || '(no address)',
        exportedAt: bundle.exportedAt,
        bundleDate,
        photoCount,
        stateName: bundle.stateLaw?.[0] || null,
        // Auto-route info for the confirmation dialog
        propertyMatched: !!matchedProperty,
        autoRouteTenancyTenants: autoRouteTenancy?.tenants?.join(', ') || null,
        tappedFromTenancyTenants: tappedFromTenancy?.tenants?.join(', ') || null,
        routingMismatch,
      };

      // For manual pick, we don't have a URL — we have the JSON directly.
      // Stash it as an in-memory bundle for commit. Use a synthetic url
      // marker so commitIncomingBundle knows to skip Filesystem.readFile.
      setImportConfirm({
        url: `manual:${file.name}`,
        bundle,
        summary,
        manualJson: json,    // bypass the re-read in importBundle
        manualFileName: file.name,
      });
    } catch (e) {
      console.error('Manual file pick failed:', e);
      setImportError(e?.message || String(e));
    }
  }, [portfolio]);

  // Override commit when we came from manual pick — importBundle expects a URL
  // it can read from Filesystem, but we already have the JSON in memory. We
  // shim the deps with a fake Filesystem that returns our cached JSON.
  const commitManualBundle = useCallback(async () => {
    if (!importConfirm?.manualJson) return commitIncomingBundle();
    const { bundle, manualJson, manualFileName } = importConfirm;
    setImportConfirm(null);
    setImporting({ fileName: manualFileName, progress: null });

    try {
      let workingPortfolio = portfolio;
      const addr = (bundle.inspection.address || '').trim().toLowerCase();
      let targetProperty = addr
        ? workingPortfolio.properties.find(p => p.address.trim().toLowerCase() === addr)
        : null;

      if (!targetProperty) {
        const result = createProperty(workingPortfolio, {
          name: bundle.inspection.name || 'Imported Property',
          address: bundle.inspection.address || '',
          stateIdx: bundle.inspection.stateIdx,
        });
        workingPortfolio = result.portfolio;
        targetProperty = result.property;
      }

      const bundleDate = bundle.inspection.createdAt || bundle.exportedAt;
      let targetTenancy = findTenancyForDate(targetProperty, bundleDate);

      if (!targetTenancy) {
        const tenancyResult = createTenancy(workingPortfolio, targetProperty.id, {
          tenants: ['(Tenant from imported bundle)'],
          rent: null,
          deposit: null,
          startDate: bundleDate.slice(0, 10),
          endDate: null,
        });
        workingPortfolio = tenancyResult.portfolio;
        targetTenancy = tenancyResult.tenancy;
      }

      // For manual pick, we do the import work inline since we already have
      // parsed bundle + JSON. Build inspections and write photos directly.
      const importResult = await importBundleFromMemory(
        bundle, targetProperty, { Filesystem, Directory },
        {
          onProgress: (done, total, phase) =>
            setImporting({ fileName: manualFileName, progress: { done, total, phase } }),
        }
      );

      for (const insp of importResult.inspections) {
        workingPortfolio = addImportedInspection(
          workingPortfolio, targetProperty.id, targetTenancy.id, insp
        );
      }

      setPortfolio(workingPortfolio);
      setImporting(null);
      setImportSuccess({
        propertyId: targetProperty.id,
        propertyName: targetProperty.name,
        tenancyId: targetTenancy.id,
        inspectionsAdded: importResult.inspections.length,
        warnings: importResult.warnings,
      });

      navigate(`/property/${targetProperty.id}`);
    } catch (e) {
      console.error('Manual import commit failed:', e);
      setImportError(e?.message || String(e));
      setImporting(null);
    }
  }, [importConfirm, portfolio, commitIncomingBundle]);

  // Decide which commit handler to call based on whether import was manual or share-sheet
  const confirmImport = useCallback(() => {
    if (importConfirm?.manualJson) commitManualBundle();
    else commitIncomingBundle();
  }, [importConfirm, commitManualBundle, commitIncomingBundle]);

  // ─── Comparison PDF share — invoked from ChangesScreen ────────────────
  // Builds the multi-inspection comparison PDF (item diff + photo galleries)
  // and routes it through the right delivery mechanism for the platform.
  // Mirrors PropertyScreen's handleExportPDF pattern: native uses Filesystem
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
          onImportTenantReport={triggerFilePicker}
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

      {/* Hidden file input for manual .mosinsp picker */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".mosinsp,application/octet-stream"
        onChange={handleFilePicked}
        style={{ display: 'none' }}
      />

      {importing && <ImportProgressModal info={importing} />}

      {importConfirm && (
        <ConfirmImportModal
          summary={importConfirm.summary}
          onConfirm={confirmImport}
          onCancel={() => setImportConfirm(null)}
        />
      )}

      {importError && (
        <ToastModal kind="error" title="Import failed" body={importError}
          onDismiss={() => setImportError(null)} />
      )}

      {importSuccess && (
        <ToastModal kind="success" title="Inspection imported"
          body={
            `Added ${importSuccess.inspectionsAdded} inspection(s) to "${importSuccess.propertyName}".` +
            (importSuccess.warnings.length
              ? `\n\n${importSuccess.warnings.length} warning(s) — check the inspection for details.`
              : '')
          }
          onDismiss={() => setImportSuccess(null)} />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// importBundleFromMemory — parallel of importBundle that operates on an
// in-memory bundle (for manual file pick path). Avoids re-reading the file.
// ═══════════════════════════════════════════════════════════════════════════
async function importBundleFromMemory(bundle, property, deps, opts = {}) {
  const { Filesystem, Directory } = deps;
  const onProgress = opts.onProgress || (() => {});
  const warnings = [];

  // Lazy-import to keep top-level imports clean
  const { uid, INSPECTION_TYPES, PHOTO_ROOT } = await import('./lib/constants.js');

  // Determine which slots have data
  let hasMoveIn = false, hasMoveOut = false;
  for (const rd of Object.values(bundle.inspection.rooms || {})) {
    const phaseHasContent = (p) =>
      (p?.statuses && Object.keys(p.statuses).length > 0) ||
      (p?.notes && p.notes.trim().length > 0) ||
      (p?.photos && p.photos.length > 0);
    if (phaseHasContent(rd.moveIn)) hasMoveIn = true;
    if (phaseHasContent(rd.moveOut)) hasMoveOut = true;
  }
  const splits = [];
  if (hasMoveIn)  splits.push({ phase: 'moveIn',  type: 'tenant_move_in' });
  if (hasMoveOut) splits.push({ phase: 'moveOut', type: 'tenant_move_out' });
  if (splits.length === 0) splits.push({ phase: 'moveIn', type: 'tenant_move_in' });

  const inspections = [];
  const totalPhotos = Object.keys(bundle.photos || {}).length;
  let cursor = 0;

  for (const split of splits) {
    const inspId = uid();
    const typeEntry = Object.values(INSPECTION_TYPES).find(t => t.id === split.type);
    const inspection = {
      id: inspId,
      propertyId: property.id,
      type: split.type,
      label: typeEntry?.label || 'Imported',
      source: 'tenant',
      editable: false,
      createdAt: bundle.inspection.createdAt || bundle.exportedAt,
      importedAt: new Date().toISOString(),
      sourceBundleId: bundle.inspection.id,
      sourceBundleHash: bundle.manifest?.integrityHash,
      tenantAppVersion: bundle.tenantAppVersion || null,
      stateIdx: bundle.inspection.stateIdx,
      rooms: {},
    };

    for (const [roomId, roomData] of Object.entries(bundle.inspection.rooms || {})) {
      inspection.rooms[roomId] = {
        moveIn:  split.phase === 'moveIn'  ? { ...roomData.moveIn,  photos: [] } : { statuses: {}, notes: '', photos: [] },
        moveOut: split.phase === 'moveOut' ? { ...roomData.moveOut, photos: [] } : { statuses: {}, notes: '', photos: [] },
      };
    }

    for (const [roomId, roomData] of Object.entries(bundle.inspection.rooms || {})) {
      const phaseData = roomData[split.phase];
      if (!phaseData?.photos) continue;
      for (let i = 0; i < phaseData.photos.length; i++) {
        const photoMeta = phaseData.photos[i];
        const key = `rooms/${roomId}/${split.phase}/${i}`;
        const payload = bundle.photos?.[key];
        if (!payload) { warnings.push(`Photo missing: ${key}`); continue; }
        if (payload.missing) { warnings.push(`Photo unavailable: ${key} (${payload.reason || 'no reason'})`); continue; }

        const tag = Date.now() + '_' + uid().slice(0, 6);
        const fileName = `${roomId}_${split.phase}_${tag}.jpg`;
        const path = `${PHOTO_ROOT}/${inspId}/${fileName}`;

        try {
          await Filesystem.writeFile({ path, data: payload.base64, directory: Directory.Data, recursive: true });
          inspection.rooms[roomId][split.phase].photos.push({
            path,
            ts: photoMeta.ts || payload.ts || null,
            lat: typeof photoMeta.lat === 'number' ? photoMeta.lat : (typeof payload.lat === 'number' ? payload.lat : null),
            lng: typeof photoMeta.lng === 'number' ? photoMeta.lng : (typeof payload.lng === 'number' ? payload.lng : null),
            ratio: typeof photoMeta.ratio === 'number' ? photoMeta.ratio : (typeof payload.ratio === 'number' ? payload.ratio : null),
          });
        } catch (e) {
          warnings.push(`Failed to write photo ${key}: ${e.message || 'unknown'}`);
        }
        cursor++;
        onProgress(cursor, totalPhotos, split.phase);
      }
    }
    inspections.push(inspection);
  }

  return { inspections, warnings };
}

// ═══════════════════════════════════════════════════════════════════════════
// ConfirmImportModal — shown after parsing, before photo writes.
// Lets the user verify they're importing the right bundle.
// ═══════════════════════════════════════════════════════════════════════════
function ConfirmImportModal({ summary, onConfirm, onCancel }) {
  const exportedDate = summary.exportedAt
    ? new Date(summary.exportedAt).toLocaleDateString('en-US', { dateStyle: 'medium' })
    : 'unknown date';
  const bundleDateStr = summary.bundleDate
    ? new Date(summary.bundleDate).toLocaleDateString('en-US', { dateStyle: 'medium' })
    : null;

  // Routing summary text — three cases:
  //   1. Mismatch: bundle's date wants tenancy A, user tapped from tenancy B
  //   2. Match: bundle's date matches the tenancy user tapped from (or no tap)
  //   3. No tenancy match: will create a new tenancy automatically
  let routingNote = null;
  if (summary.routingMismatch) {
    routingNote = {
      kind: 'warning',
      title: '⚠ Routing mismatch',
      body: `This bundle's date (${bundleDateStr}) matches ${summary.autoRouteTenancyTenants}'s lease, but you tapped Import from ${summary.tappedFromTenancyTenants}'s lease. The import will follow the bundle's date and land in ${summary.autoRouteTenancyTenants}'s lease.`,
    };
  } else if (summary.autoRouteTenancyTenants) {
    routingNote = {
      kind: 'info',
      title: 'Auto-routed by date',
      body: `This bundle's date (${bundleDateStr}) falls within ${summary.autoRouteTenancyTenants}'s lease. It will be imported there.`,
    };
  } else if (summary.propertyMatched) {
    routingNote = {
      kind: 'info',
      title: 'New lease will be created',
      body: `This bundle's date (${bundleDateStr}) doesn't fall within any current lease. A placeholder lease will be created for it — you can rename and edit it after import.`,
    };
  } else {
    routingNote = {
      kind: 'info',
      title: 'New property will be created',
      body: 'This bundle\'s address doesn\'t match any property you have. A new property will be created for it.',
    };
  }

  return (
    <div style={modalBackdrop}>
      <div style={{
        background: THEME.paper, borderRadius: 16, padding: 24,
        maxWidth: 440, width: '100%',
        border: `2px solid ${THEME.brand}`,
        boxShadow: '0 20px 50px rgba(0,0,0,0.3)',
        maxHeight: '90vh', overflowY: 'auto',
      }}>
        <div style={{ fontSize: 13, color: THEME.muted, fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Import inspection bundle
        </div>
        <div style={{ fontSize: 18, fontWeight: 700, color: THEME.ink, marginBottom: 14 }}>
          Review before importing
        </div>

        <div style={{
          background: THEME.bg, borderRadius: 10, padding: 14, marginBottom: 12,
          border: `1px solid ${THEME.edge}`,
        }}>
          <SummaryRow label="Property"    value={summary.propertyName} />
          <SummaryRow label="Address"     value={summary.propertyAddress} />
          <SummaryRow label="Exported"    value={exportedDate} />
          <SummaryRow label="Photos"      value={summary.photoCount} />
          {summary.stateName && <SummaryRow label="State law" value={summary.stateName} />}
        </div>

        {routingNote && (
          <div style={{
            background: routingNote.kind === 'warning' ? '#FEF3C7' : THEME.mint50,
            border: `1px solid ${routingNote.kind === 'warning' ? '#FDE68A' : THEME.mint300}`,
            borderRadius: 10, padding: 12, marginBottom: 16,
          }}>
            <div style={{
              fontSize: 12, fontWeight: 700,
              color: routingNote.kind === 'warning' ? '#92400E' : THEME.brand,
              marginBottom: 4,
            }}>
              {routingNote.title}
            </div>
            <div style={{
              fontSize: 12,
              color: routingNote.kind === 'warning' ? '#78350F' : THEME.inkSoft,
              lineHeight: 1.5,
            }}>
              {routingNote.body}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onCancel} style={{ ...btnSecondary, flex: 1 }}>Cancel</button>
          <button onClick={onConfirm} style={{ ...btnPrimary, flex: 1 }}>Import</button>
        </div>
      </div>
    </div>
  );
}

function SummaryRow({ label, value }) {
  return (
    <div style={{ display: 'flex', gap: 12, padding: '4px 0', fontSize: 13 }}>
      <div style={{ width: 80, color: THEME.muted, flexShrink: 0 }}>{label}</div>
      <div style={{ flex: 1, color: THEME.ink, fontWeight: 500, wordBreak: 'break-word' }}>{value}</div>
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

const btnSecondary = {
  background: THEME.surface, color: THEME.ink,
  border: `1px solid ${THEME.edge}`, borderRadius: 10,
  padding: '12px 18px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
};

// ───────────────────────────────────────────────────────────────────────
ReactDOM.createRoot(document.getElementById('root')).render(<App />);
