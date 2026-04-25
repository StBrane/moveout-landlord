# Changelog

All notable changes to the MoveOut Shield Landlord app are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added (v1 completion targets)
- Inspection capture UI — full room-by-room walkthrough with photos, statuses, notes (transplant from tenant `main.jsx` with landlord theme applied)
- PDF export per inspection (transplant tenant's `buildPDFDoc` / `buildPhasePDF`)
- Capture-time photo resize + EXIF GPS/timestamp stamping (transplant from tenant)

### Deferred to v2
- Deductions tab + itemized deduction letter generator
- Portfolio xlsx export
- Subscription paywall (RevenueCat or native IAP)
- State-law deadline countdown dashboard
- Tenant invitation flow with landlord-generated codes for auto-routing
- Multi-user / co-owner property access

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
