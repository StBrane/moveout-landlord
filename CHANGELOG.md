# Changelog

All notable changes to the MoveOut Shield Landlord app are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Deferred to v2
- Deductions tab + itemized deduction letter generator
- Portfolio xlsx export
- Subscription paywall (RevenueCat or native IAP)
- State-law deadline countdown dashboard
- Tenant invitation flow with landlord-generated codes for auto-routing
- Multi-user / co-owner property access

## [0.3.0] — 2026-04-25

Inspection capture and PDF export. v1 feature-complete — landlord can now do their own walkthrough end-to-end (rate items, take photos, write notes, export a PDF report) without the placeholder alert.

### Added — capture
- **CaptureScreen** — full room-by-room inspection UI on a new `#/capture/{propertyId}/{inspectionId}` route. Forest header, horizontal scrollable room chips with per-room rated counts, progress bar, items card with Clean/Fair/Damaged/N/A pill toggles, notes card with debounced auto-save, photos card with grid view and GPS badges.
- **Auto-save everywhere** — every status toggle writes immediately; notes textarea debounces at 250ms then commits to the portfolio store. Backing out of the screen never loses work.
- **Camera pipeline** ported from tenant `mainnewest.jsx`:
  - `getUserMedia({ facingMode })` with environment/user flip
  - Canvas snapshot at 0.82 JPEG quality
  - GPS lookup with 3-second timeout (never blocks capture)
  - EXIF stamping via `piexifjs` — timestamp, GPS, software identifier (`MoveOut Shield Landlord`), human-readable description (property + room + phase + inspection type)
  - Save to `Directory.Data/MoveOutShieldLandlord/{inspectionId}/` via PhotoStore
  - Best-effort gallery copy: iOS → Photos album "MoveOut Shield Landlord" via `@capacitor-community/media`; Android → `Pictures/MoveOutShieldLandlord/` via Filesystem.ExternalStorage
  - iOS Photos-access primer modal shown once per install (`mosl_photo_primer_seen` localStorage key)
- **Lightbox viewer** — tap any photo grid thumbnail for full-size view with timestamp, GPS, and a delete button
- **Read-only guard** — imported tenant inspections route through CaptureScreen as view-only (no toggles, no camera button, no notes editing)

### Added — PDF export
- **`buildInspectionPDF(inspection, property, tenancy, photoStore)`** — single-inspection report with cover (forest header, tenancy context, state law block, summary boxes), per-room sections (status pills, notes, 3-column photo grid with GPS captions), certification footer, page numbers
- **PDF picker modal** on PropertyScreen — lists all inspections with date, type icon, and metric chips. Tap to export.
- **Platform-aware delivery** — native: write to `Directory.Cache` then `Share.share()` so the user can email/AirDrop/save; web: `doc.save(filename)` triggers browser download

### Added — UX polish
- **"Open" / "View" button** on every inspection card — green pill that re-enters the inspection. Distinct from the tap-to-select behavior used for compare picking.
- **Empty-state copy** changed from "Tap a type above…" to "Choose a selection from above…" per user feedback

### Changed
- `PropertyScreen.doCreateInspection` no longer shows a placeholder alert — it navigates straight to CaptureScreen via the new `onCapture` prop
- `package.json` bumped to v0.3.0 with `piexifjs ^1.0.6` added as a dependency

### Tested
- All JSX files parse clean via esbuild
- Diff engine still passes 40/40 v0.2.0 regression checks (no functional changes to core data model)
- Auto-save mutation paths verified (status toggle, notes commit, photo append)
- PDF builder produces a non-empty multi-page document on a populated inspection

## [0.2.0] — 2026-04-25

UX overhaul plus tenancy-based data model. **Wipes v0.1.0 portfolio data on first load** (storage key bumped from `mosl_portfolio_v1` to `mosl_portfolio_v2`).

### Added — data model
- **Tenancy concept.** Properties hold tenancies; tenancies hold inspections. Tenancies have tenants[], rent, deposit, startDate, endDate (null = active).
- **Between-tenancies bucket.** Turnover inspections live on the property directly (no tenancy assignment) since they happen between tenants.
- **Slot mapping** in `INSPECTION_TYPES` — each type has a `defaultSlot` (`moveIn` or `moveOut`) so capture data lands in the slot the diff engine expects. Lets landlord baseline data compare cleanly against imported tenant move-out data.
- **`findTenancyForDate`** — used by import pipeline to auto-route imported inspections into the tenancy whose date range contains the bundle's createdAt.
- **`flatInspections`** helper — collects every inspection (across all tenancies + between) sorted by date for compare picker.

### Added — UX
- **Persistent picker / catalog.** "+ New Inspection" panel stays open by default and serves as the access point for both creating new inspections and finding existing ones.
- **Inspection-type lifecycle order:** Baseline → Mid-lease → Post-tenant → Turnover → Other. Matches the natural tenancy timeline.
- **Tenancy sections** with active-first sort. Active tenancy expanded; past tenancies collapsible.
- **Inspection card metric chips** — items rated count (`23/25`) and photo count (`📸 12`) on the right of each card. Same pattern as tenant app.
- **Source color stripe** on every inspection card — blue for tenant-imported, forest green for landlord-captured.
- **Big-thumb back button** in forest-green header with chevron, matching tenant app's header style.
- **New-tenancy modal** with tenant names, rent, deposit, move-in/out dates.
- **"Copy last turnover as baseline"** option in the new-tenancy modal — appears only when prior turnover exists. Saves re-walking the unit between tenants.
- **Bottom anchor row:** Compare Inspections / Generate Report (PDF — placeholder) / Return to Portfolio.
- **3-way compare.** Pick 2 OR 3 inspections; ChangesScreen renders side-by-side or 3-column matrix automatically.
- **3-column matrix** detects worsening progressions (severity strictly increases A→B→C) and surfaces them in the "Worsened" filter.
- **Manual "Tenant's Report" import button** in the picker. Opens a file picker for `.mosinsp` files saved locally — useful when share sheet handoff fails.
- **Confirm-first import dialog.** Shows bundle summary (property name, address, export date, photo count, state law) before any photos are written to disk. User can cancel.
- **Cream/forest theme.** Ports tenant app's design tokens (`#F5F2EE` cream bg, `#1B3A2D` forest green brand, full mint accent palette). Replaces the dark slate skeleton theme.

### Changed
- `STORAGE_KEY_PORTFOLIO` bumped from `mosl_portfolio_v1` to `mosl_portfolio_v2` — installs of v0.1.0 will see a fresh empty portfolio (intentional, no migration code).
- `propertyStatus` derivation updated for tenancy model: empty / has-history / tenant-active / turnover / dispute-ready.
- `STATUS_CHIPS` colors updated to match cream theme palette.
- All screens repainted with cream/forest tokens.

### Tested
- 40/40 regression checks passing across:
  - Property + tenancy CRUD
  - Tenancy-linked vs between-tenancies routing
  - Date-range tenancy lookup
  - Slot mapping table
  - Imported-inspection attachment + read-only enforcement
  - Diff engine on landlord-baseline-vs-tenant-move-out (correctly classifies all transitions)
  - Inspection metric counters (rated/possible/photos)
  - `flatInspections` sorting
  - Property status derivation
  - Copy-from-turnover cloning

## [0.1.0] — 2026-04-24

Initial skeleton. Functional but missing the inspection capture UI.

### Added
- **Portfolio management** — create, list, and delete properties; per-property status chip derived from inspection mix (empty / baseline-only / tenant-active / turnover / dispute-ready)
- **Bundle import pipeline** — full handler for `.mosinsp` files arriving via OS share sheet
  - Cold-start launch URL handler via `App.getLaunchUrl()`
  - Runtime URL listener via `App.addListener('appUrlOpen', …)`
  - Validates against `BUNDLE_SCHEMA` v1 with friendly error messages for unsupported versions
  - Verifies SHA-256 integrity hash (downgrades to warning if mismatch — non-fatal)
  - Auto-creates new property OR matches existing property by address
  - Splits bundles with both move-in and move-out into two read-only inspections
  - Writes embedded photos to `Directory.Data/MoveOutShieldLandlord/{inspectionId}/`
  - Cleans up `/Inbox/` source files on iOS after successful import
  - Progress UI showing photo count and active phase during import
- **Diff engine** — compares any two inspections regardless of source or phase
  - Auto-detects active phase per inspection (handles landlord baseline using `moveIn` slot vs. tenant move-out using `moveOut` slot)
  - Classifies changes as: unchanged, added, removed, improved, worsened, mixed
  - Severity ordering (clean=0, fair/na=1, damaged=2) drives improved/worsened classification
  - Filter helpers: `changedItemsOnly`, `worsenedItemsOnly`
- **Changes view** — side-by-side render of A vs. B with photo pair grid, notes diff, status badges, change-type indicators, and three filter chips
- **Inspection types** — six types: baseline, turnover, mid-lease, post-tenant, other, plus two read-only imported types (tenant_move_in, tenant_move_out)
- **Photo siloing** — `PHOTO_ROOT='MoveOutShieldLandlord'` keeps the landlord app's photos separate from the tenant app's `'MoveOutShield'`
- **iOS UTI registration** — declares `com.moveoutshield.inspection` UTI and registers as the handler so `.mosinsp` files route here from share sheet, Mail, AirDrop, and Files app
- **Android intent-filters** — three filter variants covering `content://` and `file://` schemes with full pathPattern escape coverage for files containing dots
- **Codemagic CI workflows** — `ios-build.yml` patches Info.plist via PlistBuddy; `android-build.yml` injects intent-filters via Python regex

### Architecture
- Capacitor 6 + React 18 + Vite (matches tenant app stack)
- Hash-based router (no react-router dep)
- localStorage-backed portfolio (`mosl_portfolio_v1`)
- Offline-first, no backend, no accounts, no cloud sync
- 19 source files, ~2,200 lines total

### Tested
- Diff engine: 12/12 validation checks pass against landlord-baseline-vs-tenant-move-out scenario
- All `.js` files parse clean via Node syntax check
- All `.jsx` files parse clean via esbuild
