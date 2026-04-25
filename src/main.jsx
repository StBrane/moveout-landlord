// ═══════════════════════════════════════════════════════════════════════════
// main.jsx — MoveOut Shield Landlord app entry point
// ═══════════════════════════════════════════════════════════════════════════
// Hash-based router (no react-router needed — keeps the dep list identical
// to the tenant app). Three primary screens:
//
//   #/                               → Portfolio (property list)
//   #/property/{propertyId}          → Property detail (inspection list)
//   #/compare/{propertyId}/{aId}/{bId} → Changes view (diff)
//
// The bundle import pipeline fires on two entry points:
//   1. Cold-start — App.getLaunchUrl() returns the .mosinsp URL if the app
//      was opened by tapping the file
//   2. Runtime — App.addListener('appUrlOpen', ...) fires if the app was
//      already running
// ═══════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useCallback, useMemo } from 'react';
import ReactDOM from 'react-dom/client';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { App as CapApp } from '@capacitor/app';
import { SplashScreen } from '@capacitor/splash-screen';

import {
  THEME, STATE_LAWS, ROOMS,
} from './lib/constants';
import {
  loadPortfolio, savePortfolio,
  createProperty, getProperty, addImportedInspection,
} from './lib/portfolioStore';
import { importBundle } from './lib/bundleImport';
import { makePhotoStore } from './lib/photoStore';

import PortfolioScreen from './screens/PortfolioScreen';
import PropertyScreen from './screens/PropertyScreen';
import ChangesScreen from './screens/ChangesScreen';
import ImportProgressModal from './components/ImportProgressModal';

const IS_NATIVE = Capacitor.isNativePlatform();

// ─────────────────────────────────────────────────────────────────────────
// Hash router — tiny, no dependency
// ─────────────────────────────────────────────────────────────────────────
function parseRoute(hash) {
  const parts = (hash || '').replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts.length === 0) return { name: 'portfolio' };
  if (parts[0] === 'property' && parts[1]) return { name: 'property', propertyId: parts[1] };
  if (parts[0] === 'compare' && parts[1] && parts[2] && parts[3]) {
    return { name: 'compare', propertyId: parts[1], aId: parts[2], bId: parts[3] };
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
  const [importing, setImporting] = useState(null);   // { fileName, progress } | null
  const [importError, setImportError] = useState(null);
  const [importSuccess, setImportSuccess] = useState(null);

  const photoStore = useMemo(() => makePhotoStore({ Capacitor, Filesystem, Directory }), []);

  // Persist portfolio on every change
  useEffect(() => { savePortfolio(portfolio); }, [portfolio]);

  // Listen for hash changes
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  // Hide the splash screen once React is mounted
  useEffect(() => {
    if (IS_NATIVE) SplashScreen.hide().catch(() => {});
  }, []);

  // Bundle import pipeline — handles both cold-start and runtime URL opens
  const handleIncomingBundle = useCallback(async (url) => {
    if (!url) return;
    if (!url.toLowerCase().includes('mosinsp')) return;

    const fileName = url.split('/').pop() || 'inspection.mosinsp';
    setImportError(null);
    setImportSuccess(null);
    setImporting({ fileName, progress: null });

    try {
      // We need a property to attach this to. For v1 skeleton:
      //   - If the bundle has property name/address, create a new property
      //   - Landlord can later move the inspection to an existing property
      //     from the property detail screen (v2 feature)
      // Read the bundle metadata first (read-only peek, no photo writes)
      const deps = { Capacitor, Filesystem, Directory };
      const { readBundleFile, parseBundleString } = await import('./lib/bundleImport');
      const json = await readBundleFile(url, deps);
      const { bundle, errors } = parseBundleString(json);
      if (errors.length) throw new Error(errors.join('\n'));

      // Create/find the property based on address match
      let targetProperty = null;
      const addr = (bundle.inspection.address || '').trim().toLowerCase();
      if (addr) {
        targetProperty = portfolio.properties.find(
          p => p.address.trim().toLowerCase() === addr
        );
      }

      let workingPortfolio = portfolio;
      if (!targetProperty) {
        const result = createProperty(workingPortfolio, {
          name: bundle.inspection.name || 'Imported Property',
          address: bundle.inspection.address || '',
          stateIdx: bundle.inspection.stateIdx,
        });
        workingPortfolio = result.portfolio;
        targetProperty = result.property;
      }

      // Now run the full import (writes photos to disk)
      const importResult = await importBundle(url, deps, targetProperty, {
        onProgress: (done, total, phase) =>
          setImporting({ fileName, progress: { done, total, phase } }),
      });

      // Add each split inspection to the property
      for (const insp of importResult.inspections) {
        workingPortfolio = addImportedInspection(workingPortfolio, targetProperty.id, insp);
      }

      setPortfolio(workingPortfolio);
      setImporting(null);
      setImportSuccess({
        propertyId: targetProperty.id,
        propertyName: targetProperty.name,
        inspectionsAdded: importResult.inspections.length,
        warnings: importResult.warnings,
      });

      // Navigate to the new property
      navigate(`/property/${targetProperty.id}`);
    } catch (e) {
      console.error('Import failed:', e);
      setImportError(e?.message || String(e));
      setImporting(null);
    }
  }, [portfolio]);

  // Cold-start: check if app was opened from a .mosinsp file
  useEffect(() => {
    if (!IS_NATIVE) return;
    CapApp.getLaunchUrl()
      .then(result => { if (result?.url) handleIncomingBundle(result.url); })
      .catch(() => {});
  }, [handleIncomingBundle]);

  // Runtime: listen for incoming URLs while app is already open
  useEffect(() => {
    if (!IS_NATIVE) return;
    const promise = CapApp.addListener('appUrlOpen', (event) => {
      if (event?.url) handleIncomingBundle(event.url);
    });
    return () => { promise.then(h => h.remove()).catch(() => {}); };
  }, [handleIncomingBundle]);

  // ─── Render ─────────────────────────────────────────────────────────
  return (
    <div style={{ background: THEME.bg, color: THEME.text, minHeight: '100vh' }}>
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
          onCompare={(aId, bId) => navigate(`/compare/${route.propertyId}/${aId}/${bId}`)}
          photoStore={photoStore}
        />
      )}
      {route.name === 'compare' && (
        <ChangesScreen
          portfolio={portfolio}
          propertyId={route.propertyId}
          aId={route.aId}
          bId={route.bId}
          onBack={() => navigate(`/property/${route.propertyId}`)}
          photoStore={photoStore}
        />
      )}

      {importing && <ImportProgressModal info={importing} />}
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
          title="Inspection imported"
          body={
            `Added ${importSuccess.inspectionsAdded} inspection(s) to "${importSuccess.propertyName}".` +
            (importSuccess.warnings.length ? `\n\n${importSuccess.warnings.length} warning(s) — check the inspection for details.` : '')
          }
          onDismiss={() => setImportSuccess(null)}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Minimal toast modal for import results — inline here to avoid yet another file
// ─────────────────────────────────────────────────────────────────────────
function ToastModal({ kind, title, body, onDismiss }) {
  const color = kind === 'error' ? THEME.danger : THEME.success;
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 24,
    }}>
      <div style={{
        background: THEME.bgCard, borderRadius: 16, padding: 24, maxWidth: 420, width: '100%',
        border: `2px solid ${color}`,
      }}>
        <div style={{ fontSize: 18, fontWeight: 700, color, marginBottom: 10 }}>{title}</div>
        <div style={{ fontSize: 14, color: THEME.text, whiteSpace: 'pre-wrap', marginBottom: 20 }}>{body}</div>
        <button
          onClick={onDismiss}
          style={{
            background: color, color: '#fff', border: 'none', borderRadius: 10,
            padding: '10px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer', width: '100%',
          }}
        >Dismiss</button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
ReactDOM.createRoot(document.getElementById('root')).render(<App />);
