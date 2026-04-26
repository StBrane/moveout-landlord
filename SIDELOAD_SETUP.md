# Sideload Setup — MoveOut Shield Landlord

Walkthrough for getting v0.3.9 onto your Android phone (sideload) and your iPhone (TestFlight) via the GitHub Actions workflows.

## Overview

Two parallel paths. iOS via TestFlight is faster — your tenant app is already there, you have an Apple Developer account, and the iOS workflow uploads directly to App Store Connect on every push to main. Android requires a one-time keystore generation, then sideload from the GitHub Actions artifact.

This doc covers both. Pick whichever you want to ship first.

---

## Path A — iOS (recommended first)

### Required GitHub Secrets (6 total)

Three are landlord-specific (different from tenant). Three can be shared with tenant if both apps live under the same App Store Connect team.

**Landlord-specific:**
- `IOS_CERTIFICATE_BASE64` — base64-encoded distribution `.p12` for landlord
- `IOS_CERTIFICATE_PASSWORD` — password for that `.p12`
- `IOS_PROVISION_PROFILE_BASE64` — base64-encoded provisioning profile for `com.moveoutshield.landlord`

**Shared with tenant (if same App Store Connect team):**
- `APPSTORE_ISSUER_ID`
- `APPSTORE_KEY_ID`
- `APPSTORE_PRIVATE_KEY`

### Steps to set up

1. **Register the bundle ID** at developer.apple.com — `com.moveoutshield.landlord`. Distinct from tenant's bundle.
2. **Create a distribution provisioning profile** for that bundle ID. Name it `MoveOutShield Landlord Distribution` (must match the workflow's reference exactly).
3. **Export your existing iOS Distribution certificate as `.p12`** if you don't already have it on disk. Mac Keychain → Login → Certificates → right-click your "iPhone Distribution" cert → Export → choose .p12 format → set a password.
4. **Encode certificate and profile to base64** (one-liners):
   ```bash
   base64 -i your-cert.p12 | pbcopy        # paste into IOS_CERTIFICATE_BASE64
   base64 -i your-profile.mobileprovision | pbcopy   # paste into IOS_PROVISION_PROFILE_BASE64
   ```
5. **Add the secrets** in GitHub: repo Settings → Secrets and variables → Actions → New repository secret. Add each of the 6 above.
6. **Verify the team ID** — the workflow has `DEVELOPMENT_TEAM=8Z7U5ZLH9J`. If your team ID differs (check Apple Developer → Membership → Team ID), update both the workflow file and the `ExportOptions.plist` block within it.
7. **Create the app record on App Store Connect** with bundle ID `com.moveoutshield.landlord`. The TestFlight upload step needs the app to exist there.
8. **Push to main** — workflow triggers automatically. Build takes ~25 minutes.
9. **TestFlight build appears** in your developer account once processed. Send to your tester device.

### Common issues

- **"No matching provisioning profile"** — your profile name doesn't match `MoveOutShield Landlord Distribution`. Either rename in Apple Developer or update both references in the workflow YAML.
- **"Code signing identity not found"** — `.p12` decoded fine but cert is for a different team or expired. Re-export from Keychain.
- **"Bundle identifier already exists"** — typo or someone already used `com.moveoutshield.landlord`. Pick another.

---

## Path B — Android (sideload only, no Play Store yet)

### Required GitHub Secrets (4 total)

All landlord-specific. Tenant's Android keystore CANNOT be reused — keystores tie to bundle IDs.

- `ANDROID_KEYSTORE_BASE64` — base64-encoded `keystore.jks`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

### One-time keystore generation

You need `keytool` (comes with Java JDK; if you have Android Studio installed, it's already on your machine).

```powershell
# Run from any folder. Creates keystore.jks in current dir.
keytool -genkey -v `
  -keystore moveout-landlord.jks `
  -keyalg RSA `
  -keysize 2048 `
  -validity 10000 `
  -alias moveout-landlord-key
```

It'll prompt for:
- **Keystore password** — invent one. Save securely. This becomes `ANDROID_KEYSTORE_PASSWORD`.
- **Your name / org / location** — these go into the keystore but aren't seen by users.
- **Key password** — can be the same as keystore password (it'll auto-confirm "yes" if so). This becomes `ANDROID_KEY_PASSWORD`.

The alias `moveout-landlord-key` becomes `ANDROID_KEY_ALIAS`.

### Encode keystore to base64 and add secrets

```powershell
# Windows PowerShell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("moveout-landlord.jks")) | Set-Clipboard
# Now paste into ANDROID_KEYSTORE_BASE64 in GitHub Secrets
```

Add all 4 secrets in GitHub: repo Settings → Secrets and variables → Actions.

### Push and download APK

1. **Push to main** (or use Actions tab → "Build Landlord Android APK & AAB" → Run workflow). Build takes ~10-15 minutes.
2. **Download the APK** from the workflow run page → Artifacts → `moveout-shield-landlord-apk`. It's a zip; extract `app-release.apk`.
3. **Transfer to your phone** — email it to yourself, save to Drive, or use ADB.
4. **Install on phone**:
   - Settings → Apps → Special access → Install unknown apps → enable for your file manager
   - Tap the APK file → Install
5. **Launch** — app icon appears in launcher as "MoveOut Shield Landlord" (forest splash).

### Common issues

- **"App not installed"** — usually means a different signing key was previously used for `com.moveoutshield.landlord`. Uninstall any prior install first.
- **"There was a problem parsing the package"** — APK didn't download fully or got corrupted. Re-download.
- **Keystore loss** — if you lose the keystore, you cannot push updates to a sideloaded app (signature mismatch). Back up `moveout-landlord.jks` immediately after generation. Cloud backup with strong password recommended.

---

## Real artwork — when you're ready

The current `resources/icon.png` and `resources/splash.png` are minimal placeholders (forest background, simple cream silhouette). Before App Store submission, swap in real artwork:

- **`icon.png`** — 1024×1024, your final landlord icon design
- **`splash.png`** — 2732×2732, your final landlord splash screen design

`@capacitor/assets` consumes these on every CI run and generates all the iOS/Android sizes automatically. Just drop the new PNGs in `resources/`, push to main, the new build picks them up. No code changes needed.

---

## Test bundle for dev validation

`test-fixtures/test-bundle.mosinsp` is a synthetic but valid `.mosinsp` file. Use it to validate the import flow in `npm run dev` before sideloading:

1. Run the dev server: `npm run dev`
2. Open the app in browser
3. Create a property (any name) at `123 Test Lane, Indianapolis IN`
4. Create a lease covering Aug 15, 2026 (e.g., move-in 2026-01-01, no end date)
5. Inside that lease's picker → "Import Tenant Report" → select `test-fixtures/test-bundle.mosinsp`
6. Confirm dialog should say "Auto-routed by date" — bundle's date matches the lease
7. Import → Kitchen room shows the imported data, both move-in and move-out

If the bundle doesn't auto-route to your test lease, double-check the lease dates cover Aug 15, 2026.

---

## Versioning across builds

The CI workflows use `github.run_number` for the iOS `CURRENT_PROJECT_VERSION` (build number). Marketing version is hardcoded `0.3.9` in the iOS workflow. When you bump to v0.4.0, edit `MARKETING_VERSION=0.3.9` to `MARKETING_VERSION=0.4.0` in `.github/workflows/ios-build.yml`.

Android version code uses `github.run_number` automatically via Gradle's signing config — no manual bump needed.

---

## Checklist for first sideload

- [ ] Apple Developer account confirmed (you have)
- [ ] Apple Developer team ID matches what's in workflow YAML (or update if not)
- [ ] Bundle ID `com.moveoutshield.landlord` registered
- [ ] Provisioning profile `MoveOutShield Landlord Distribution` created
- [ ] Distribution `.p12` exported and encoded
- [ ] All 6 iOS secrets added to repo
- [ ] App record created on App Store Connect with bundle ID
- [ ] Push to main → wait for CI
- [ ] TestFlight build appears → install on your iPhone
- [ ] Smoke test: create lease, capture inspection, export PDF, share via share sheet
- [ ] Optional now: import `test-bundle.mosinsp` via Files app share sheet to verify intent handling
