# MoveOut Shield — Landlord

Companion to the MoveOut Shield tenant app. Portfolio management with lease tracking, independent inspection capture, and tenant bundle import with 2- or 3-way side-by-side comparison.

**Status:** v0.3.9 — sideload-ready. CI builds for iOS (TestFlight) and Android (signed APK + AAB) via GitHub Actions. Production build verified clean.

---

## What this app does

Three capabilities, one code path:

1. **Capture inspections** — landlord's own baselines, turnovers, mid-lease walks, and post-tenant walkthroughs. Full photo documentation with EXIF + GPS.
2. **Import tenant bundles** — tenant shares a `.mosinsp` file via the OS share sheet; it lands in the landlord app and auto-routes to the right lease by date.
3. **Compare anything to anything** — pick any two inspections on a property (landlord vs. tenant, landlord vs. landlord, tenant move-in vs. tenant move-out) and get a structured diff showing status changes, note changes, and photos side by side.

The killer use case: **post-tenant landlord inspection vs. tenant move-out bundle**. When a tenant disputes a deduction, the landlord has their own photos taken minutes after the tenant's — same property, same items, two independent records with timestamps and GPS.

---

## Architecture

- **Capacitor 8.x** wrapping a **React 18 + Vite** web app
- **No backend, no accounts, no cloud sync.** Everything local.
- Bundle handoff via OS share sheet — iOS UTI (`com.moveoutshield.inspection`) and Android intent-filter for `.mosinsp` files (both injected by CI workflows during build)
- Photos stored under `Directory.Data/MoveOutShieldLandlord/{inspectionId}/`
- Portfolio metadata in `localStorage` (key: `mosl_portfolio_v1`)

Siloed from the tenant app on-device: the tenant app uses `PHOTO_ROOT='MoveOutShield'`, this app uses `'MoveOutShieldLandlord'`. Both apps can coexist on the same device.

---

## Repo layout

```
.
├── package.json
├── vite.config.js
├── capacitor.config.json            ← inverted forest splash
├── index.html
├── SIDELOAD_SETUP.md                ← build-and-install walkthrough
├── src/
│   ├── main.jsx                     ← app shell, router, import pipeline
│   ├── lib/
│   │   ├── constants.js             ← ROOMS, STATE_LAWS, INSPECTION_TYPES, THEME
│   │   ├── bundleImport.js          ← .mosinsp parser + import pipeline
│   │   ├── portfolioStore.js        ← localStorage CRUD
│   │   ├── diff.js                  ← inspection comparison engine
│   │   ├── damageReport.js          ← per-tenancy synthesis (v0.4.0 foundation, 28/28 tested)
│   │   └── photoStore.js            ← filesystem photo storage
│   ├── screens/
│   │   ├── PortfolioScreen.jsx      ← property list
│   │   ├── PropertyScreen.jsx       ← lease list + per-lease 6-button picker
│   │   ├── CaptureScreen.jsx        ← full-screen inspection walkthrough
│   │   └── ChangesScreen.jsx        ← the diff view
│   └── components/
│       └── ImportProgressModal.jsx
├── resources/
│   ├── icon.png                     ← @capacitor/assets source
│   └── splash.png
├── test-fixtures/
│   └── test-bundle.mosinsp          ← synthetic bundle for import flow validation
└── .github/
    └── workflows/
        ├── android-build.yml        ← GitHub Actions — APK + AAB
        └── ios-build.yml            ← GitHub Actions — TestFlight upload
```

---

## Quick start (local dev)

```powershell
npm install
npm run dev
```

That's it. Vite dev server on :5173. All Capacitor packages are pinned in `package.json` — no manual `npm install @capacitor/...` step.

If `npm install` complains about `sharp` (transitive dep of `@capacitor/assets`):

```powershell
npm install --ignore-scripts
```

`@capacitor/assets` is in `optionalDependencies` and only used by CI on macOS to generate icon/splash sizes. Local dev doesn't need it.

The web dev server won't have native filesystem or share sheet access — the import pipeline only fully works on device. For UI iteration in the browser, the manual file picker can ingest `test-fixtures/test-bundle.mosinsp` end-to-end.

---

## Production build

```powershell
npm run build
```

Outputs to `dist/`. ~1MB total, ~325KB gzipped, ~7s build time. Two informational warnings (chunk size, dynamic+static import of constants.js) — both non-blocking.

---

## Sideload / TestFlight / App Store

See `SIDELOAD_SETUP.md` for the per-platform walkthrough:

- **iOS** — push to main → CI builds → TestFlight upload (recommended first; 6 secrets needed, 3 sharable with tenant)
- **Android** — generate keystore, push to main → CI builds → download APK artifact → sideload (4 secrets needed, all landlord-specific because keystores tie to bundle ID)

App ID is `com.moveoutshield.landlord` — distinct from the tenant app's bundle.

---

## What's next

**v0.4.0 — Damage Report.** Synthesis engine already built and tested in `src/lib/damageReport.js` (28/28 passing). Phase 2 is the UI screen + PDF builder. Substantial scope, deferred until after sideload validates the foundation on real devices.

---

## Tenant app

Lives in a separate repo. The tenant app is the **producer** of `.mosinsp` bundles (via PDF + share sheet currently; structured `.mosinsp` export is on its own roadmap). The landlord app is the **consumer**. The bundle schema is documented in the tenant repo's `BUNDLE_SCHEMA.md`.
