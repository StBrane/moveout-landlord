# MoveOut Shield — Landlord

Companion to the MoveOut Shield tenant app. Portfolio management, independent inspection capture, and tenant bundle import with side-by-side move-in/move-out comparison.

**Status:** v0.1.0 skeleton — import pipeline, portfolio, and diff view are functional. Inspection capture UI is a TODO (drops in from tenant app).

---

## What this app does

Three capabilities, one code path:

1. **Capture inspections** — landlord's own baselines, turnovers, mid-lease walks, and post-tenant walkthroughs. Full photo documentation with EXIF + GPS.
2. **Import tenant bundles** — tenant shares a `.mosinsp` file via the OS share sheet; it lands in the landlord app and appears in the right property.
3. **Compare anything to anything** — pick any two inspections on a property (landlord vs. tenant, landlord vs. landlord, tenant move-in vs. tenant move-out) and get a structured diff showing status changes, note changes, and photos side by side.

The killer use case: **post-tenant landlord inspection vs. tenant move-out bundle**. When a tenant disputes a deduction, the landlord has their own photos taken minutes after the tenant's — same property, same items, two independent records with timestamps and GPS.

---

## Architecture

- **Capacitor 6+** wrapping a **React 18 + Vite** web app
- **No backend, no accounts, no cloud sync.** Everything local.
- Bundle handoff via OS share sheet — iOS UTI (`com.moveoutshield.inspection`) and Android intent-filter for `.mosinsp` files
- Photos stored under `Directory.Data/MoveOutShieldLandlord/{inspectionId}/`
- Portfolio metadata in `localStorage` (key: `mosl_portfolio_v1`)

Siloed from the tenant app on-device: the tenant app uses `PHOTO_ROOT='MoveOutShield'`, this app uses `'MoveOutShieldLandlord'`. Both apps can coexist on the same device (useful for landlords who also rent).

---

## Repo layout

```
.
├── package.json
├── vite.config.js
├── capacitor.config.ts
├── index.html
├── src/
│   ├── main.jsx                     ← app shell, router, import pipeline
│   ├── lib/
│   │   ├── constants.js             ← ROOMS, STATE_LAWS, INSPECTION_TYPES, THEME
│   │   ├── bundleImport.js          ← .mosinsp parser + import pipeline
│   │   ├── portfolioStore.js        ← localStorage CRUD for properties/inspections
│   │   ├── diff.js                  ← inspection comparison engine
│   │   └── photoStore.js            ← filesystem photo storage
│   ├── screens/
│   │   ├── PortfolioScreen.jsx      ← property list
│   │   ├── PropertyScreen.jsx       ← inspection list + compare picker
│   │   └── ChangesScreen.jsx        ← the diff view
│   └── components/
│       └── ImportProgressModal.jsx
├── ios-config/
│   └── Info.plist.patch.xml         ← UTI declarations (reference + PlistBuddy script)
├── android-config/
│   └── AndroidManifest.intent-filter.xml  ← intent-filter XML (reference)
├── ios-build.yml                    ← Codemagic iOS workflow (patches Info.plist)
├── android-build.yml                ← Codemagic Android workflow (patches manifest)
└── docs/
    └── (link to BUNDLE_SCHEMA.md in tenant repo)
```

---

## Quick start (local dev)

```bash
npm install
npm install @capacitor/core @capacitor/cli \
            @capacitor/app @capacitor/filesystem \
            @capacitor/share @capacitor/splash-screen \
            @capacitor/camera @capacitor/geolocation

npm run dev          # Vite dev server on :5174
```

The web dev server won't have native filesystem or share sheet access — the import pipeline only fully works on device. For UI iteration in the browser, you can manually seed `localStorage` with a portfolio fixture.

---

## Building for iOS

```bash
npm run build
npx cap add ios
npx cap sync ios
npx cap open ios
```

Then in Xcode:

1. **Bundle Identifier:** `com.moveoutshield.landlord`
2. **Signing & Capabilities:** select your team
3. **Info.plist:** paste the contents of `ios-config/Info.plist.patch.xml` (the `<key>` / `<array>` blocks) OR use the PlistBuddy script from that file's comments
4. Build & run on a real device — the simulator doesn't expose share sheet routing properly

Or use the included `ios-build.yml` for Codemagic CI, which patches Info.plist automatically.

## Building for Android

```bash
npm run build
npx cap add android
npx cap sync android
npx cap open android
```

Then:

1. **Package name:** `com.moveoutshield.landlord`
2. **AndroidManifest.xml** (`android/app/src/main/AndroidManifest.xml`): paste the intent-filter blocks from `android-config/AndroidManifest.intent-filter.xml` inside the `<activity android:name=".MainActivity">` element, **before** the closing `</activity>` tag
3. Build & test on a real device

The `android-build.yml` Codemagic workflow injects the intent-filters automatically via a Python script.

---

## Testing the import pipeline

The only reliable way to test bundle import is on a real device:

1. Install the **tenant** app (or a debug build with the `Send to Landlord` button) on the same device OR a different device you can AirDrop/email from
2. Run an inspection, tap "Send to Landlord"
3. On the receiving device:
   - **iOS:** you should see "MoveOut Shield Landlord" in the share sheet, OR for files received via Mail / Files app, the "Open With" option routes to this app
   - **Android:** tapping the `.mosinsp` attachment in Gmail or the Files app should offer "MoveOut Shield Landlord" as a handler
4. The landlord app opens, shows the import progress modal, creates or matches a property by address, and navigates to the property detail screen with the new inspection(s) attached

If the landlord app doesn't appear in the share sheet:
- **iOS:** verify Info.plist has both `UTExportedTypeDeclarations` AND `CFBundleDocumentTypes`. Reinstall the app (UTI registration happens at install). Reboot if needed — iOS caches handler registrations.
- **Android:** verify `AndroidManifest.xml` has the intent-filters inside MainActivity. Make sure path patterns use `\\\\.mosinsp` (four backslashes in XML source to escape to `\\.` in the compiled manifest).

---

## What's still TODO (v1 completion)

The skeleton has:
- ✅ Portfolio CRUD + status chips
- ✅ Bundle import (share sheet + cold-start + runtime URL handlers)
- ✅ Inspection list with compare selection
- ✅ Full diff engine with 4 comparison modes
- ✅ Changes view with filter (changed/worsened/all), photo pairs, notes diff
- ✅ iOS UTI + Android intent-filter configs
- ✅ CI workflows for both platforms

Missing for v1 completion:
- ⏳ **Inspection capture UI** — the big piece. Drop in the ~900 lines of room/item/photo/notes UI from tenant app's `main.jsx`. Should be a straight transplant with the landlord theme applied. Entry point: `PropertyScreen.jsx` → `handleNewInspection()` currently shows an alert; replace with navigation to a new `CaptureScreen` screen.
- ⏳ **PDF export** — transplant `buildPDFDoc` / `buildPhasePDF` from tenant `main.jsx`; wire to a share button on the PropertyScreen inspection list.
- ⏳ **Image resize + EXIF stamping** — transplant from tenant `main.jsx`. The landlord app should stamp photos with EXIF at capture time (same as tenant) so the chain of custody is intact for disputes.

Deferred to v2:
- Deductions tab / itemized deduction letter generator
- Portfolio xlsx export
- Subscription paywall (RevenueCat or native IAP)
- Multi-user / co-owner access
- Tenant invitation flow (landlord generates code, tenant enters it on signup so bundles auto-route)
- State-law deadline countdown dashboard

---

## Bundle schema

See [`BUNDLE_SCHEMA.md`](../moveout-shield/docs/BUNDLE_SCHEMA.md) in the tenant repo for the full `.mosinsp` format spec. This app implements the **consumer** side of that contract. When bumping the schema, both apps need coordinated updates.

Current supported schema versions: **[1]**

---

## Privacy posture

This app is **offline-first**. Bundles arrive via OS share sheet (device-to-device), never through a server. Portfolio and inspections live in `localStorage` + the app's private Data directory. No analytics, no telemetry, no cloud sync.

Same pillar as the tenant app: *your data never leaves your device.* If we ever add backend sync, this promise breaks for everyone.

---

## License

Proprietary — all rights reserved.
