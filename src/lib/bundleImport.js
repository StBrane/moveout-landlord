// ═══════════════════════════════════════════════════════════════════════════
// bundleImport.js — MoveOut Shield Landlord bundle importer
// ═══════════════════════════════════════════════════════════════════════════
// Parses .mosinsp files produced by the tenant MoveOut Shield app, validates
// them against BUNDLE_SCHEMA v1, writes embedded photos back to the landlord
// app's Directory.Data, and returns normalized inspection records ready to
// insert into the portfolio.
//
// Contract: see BUNDLE_SCHEMA.md in the tenant repo. This module implements
// the consumer side of the contract defined there.
//
// A single bundle may produce TWO inspections if the tenant recorded both
// move-in AND move-out phases. They're split so the landlord can compare
// each phase independently against the landlord's own inspections.
//
// Public API:
//   parseBundleString(jsonString)           → { bundle, errors[] }
//   verifyIntegrity(bundle)                 → Promise<boolean>
//   readBundleFile(url, deps)               → Promise<string>
//   importBundle(url, deps, property, opts) → Promise<{ inspections[], warnings[] }>
// ═══════════════════════════════════════════════════════════════════════════

import { SUPPORTED_BUNDLE_SCHEMA_VERSIONS, PHOTO_ROOT, uid, INSPECTION_TYPES } from './constants.js';

// ───────────────────────────────────────────────────────────────────────────
// STEP 1: Pure parse & validate — no IO
// ───────────────────────────────────────────────────────────────────────────
export function parseBundleString(jsonString) {
  const errors = [];
  let bundle = null;

  try {
    bundle = JSON.parse(jsonString);
  } catch (e) {
    return { bundle: null, errors: [`Invalid JSON: ${e.message}`] };
  }

  if (bundle.app !== 'moveout-shield') {
    errors.push(`Not a MoveOut Shield bundle (app="${bundle.app}")`);
  }
  if (typeof bundle.schemaVersion !== 'number') {
    errors.push('Missing or invalid schemaVersion');
  } else if (!SUPPORTED_BUNDLE_SCHEMA_VERSIONS.includes(bundle.schemaVersion)) {
    errors.push(
      `Unsupported schemaVersion ${bundle.schemaVersion}. ` +
      `This app supports: ${SUPPORTED_BUNDLE_SCHEMA_VERSIONS.join(', ')}. ` +
      `Update MoveOut Shield Landlord from the App Store to import this inspection.`
    );
  }
  if (!bundle.inspection || typeof bundle.inspection !== 'object') {
    errors.push('Missing inspection object');
  } else {
    if (!bundle.inspection.id) errors.push('inspection.id missing');
    if (!bundle.inspection.rooms || typeof bundle.inspection.rooms !== 'object') {
      errors.push('inspection.rooms missing');
    }
  }
  if (!bundle.photos || typeof bundle.photos !== 'object') {
    errors.push('Missing photos map');
  }
  if (!bundle.manifest || typeof bundle.manifest !== 'object') {
    errors.push('Missing manifest');
  }

  return { bundle, errors };
}

// ───────────────────────────────────────────────────────────────────────────
// STEP 2: Verify integrity hash. Returns true if hash matches. Accepts the
// djb2 fallback (with a warning logged by caller if needed).
// ───────────────────────────────────────────────────────────────────────────
export async function verifyIntegrity(bundle) {
  const claimed = bundle?.manifest?.integrityHash;
  if (!claimed) return false;

  const clone = JSON.parse(JSON.stringify(bundle));
  delete clone.manifest.integrityHash;
  const canonical = JSON.stringify(clone);

  if (claimed.startsWith('djb2-')) {
    let hash = 5381;
    for (let i = 0; i < canonical.length; i++) hash = ((hash << 5) + hash + canonical.charCodeAt(i)) | 0;
    const recomputed = 'djb2-' + (hash >>> 0).toString(16);
    return recomputed === claimed;
  }

  try {
    const bytes = new TextEncoder().encode(canonical);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hex = Array.from(new Uint8Array(digest))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    return hex === claimed;
  } catch {
    return false;
  }
}

// ───────────────────────────────────────────────────────────────────────────
// STEP 3: Read a .mosinsp file from a URI. Handles both file:// and content://
// URIs (native share-sheet / intent-filter handoffs), plus in-memory strings
// for testing.
// ───────────────────────────────────────────────────────────────────────────
export async function readBundleFile(url, deps) {
  const { Filesystem } = deps;
  if (!Filesystem) throw new Error('readBundleFile: deps.Filesystem required');

  // Filesystem.readFile returns base64 of the file contents.
  // The file IS base64-of-JSON, so what we get from Filesystem is
  // base64-of(base64-of-JSON). We decode once to get the raw file
  // content, which is itself base64, then decode again for the JSON.
  //
  // Actually — Filesystem.readFile with no encoding arg returns base64.
  // If we want raw text, we pass encoding: 'utf8'. But the file ON DISK
  // is ASCII base64 text (not binary), so utf8 reads it as a string
  // directly, which is what we want.
  let raw;
  try {
    const { data } = await Filesystem.readFile({
      path: url,
      encoding: 'utf8',
    });
    raw = data;
  } catch (e) {
    // Fallback: some content:// URIs on Android require no-encoding read.
    // We get base64 back; decode it to get the ASCII content.
    try {
      const { data } = await Filesystem.readFile({ path: url });
      raw = atobUtf8(data);
    } catch (e2) {
      throw new Error(`Could not read bundle file: ${e.message || e2.message}`);
    }
  }

  // `raw` is now the file contents as a string — ASCII base64 text.
  // Decode to JSON.
  let json;
  try {
    json = atobUtf8(raw.trim());
  } catch (e) {
    throw new Error(`Bundle file is not valid base64: ${e.message}`);
  }
  return json;
}

// ───────────────────────────────────────────────────────────────────────────
// STEP 4: Full import pipeline. Produces one or two inspection records
// (depending on whether the bundle has move-in data, move-out data, or both).
// Writes embedded photos to PHOTO_ROOT/<inspectionId>/ on disk.
//
// property:  the landlord's property record to attach the inspections to.
//            If null, caller is responsible for creating one first.
// opts:
//   onProgress(photoIdx, total, phase) — optional progress callback
//   deleteSourceAfter (iOS Inbox cleanup) — default true if url is /Inbox/
// ───────────────────────────────────────────────────────────────────────────
export async function importBundle(url, deps, property, opts = {}) {
  const { Filesystem, Directory } = deps;
  if (!Filesystem || !Directory) throw new Error('importBundle: deps.Filesystem and Directory required');

  const onProgress = opts.onProgress || (() => {});
  const warnings = [];

  // Read & parse
  const json = await readBundleFile(url, deps);
  const { bundle, errors } = parseBundleString(json);
  if (errors.length > 0) {
    throw new Error('Bundle validation failed:\n' + errors.join('\n'));
  }

  // Verify integrity (non-fatal — downgrade to warning if fails)
  const ok = await verifyIntegrity(bundle);
  if (!ok) {
    warnings.push('Bundle integrity hash did not verify. The file may have been modified after export.');
  }

  // Split into inspections based on which phases have data
  const splits = splitBundleByPhase(bundle);

  // Build inspection records and write photos for each split
  const inspections = [];
  const totalPhotos = Object.keys(bundle.photos).length;
  let photoCursor = 0;

  for (const split of splits) {
    const inspId = uid();
    const inspection = {
      id: inspId,
      propertyId: property?.id || null,
      type: split.type,
      label: INSPECTION_TYPES[typeKey(split.type)]?.label || 'Imported',
      source: 'tenant',
      editable: false,
      createdAt: bundle.inspection.createdAt || bundle.exportedAt,
      importedAt: new Date().toISOString(),
      sourceBundleId: bundle.inspection.id,
      sourceBundleHash: bundle.manifest.integrityHash,
      tenantAppVersion: bundle.tenantAppVersion || null,
      stateIdx: bundle.inspection.stateIdx,
      rooms: {},
    };

    // For this split, keep only the phase we care about, zero out the other
    for (const [roomId, roomData] of Object.entries(bundle.inspection.rooms)) {
      inspection.rooms[roomId] = {
        moveIn:  split.phase === 'moveIn'  ? { ...roomData.moveIn,  photos: [] } : { statuses: {}, notes: '', photos: [] },
        moveOut: split.phase === 'moveOut' ? { ...roomData.moveOut, photos: [] } : { statuses: {}, notes: '', photos: [] },
      };
    }

    // Write photos for this split's phase and populate photo arrays
    for (const [roomId, roomData] of Object.entries(bundle.inspection.rooms)) {
      const phaseData = roomData[split.phase];
      if (!phaseData || !phaseData.photos) continue;

      for (let i = 0; i < phaseData.photos.length; i++) {
        const photoMeta = phaseData.photos[i];
        const photoKey = `rooms/${roomId}/${split.phase}/${i}`;
        const photoPayload = bundle.photos[photoKey];

        if (!photoPayload) {
          warnings.push(`Photo missing from bundle: ${photoKey}`);
          continue;
        }
        if (photoPayload.missing) {
          warnings.push(`Tenant marked photo as missing: ${photoKey} (${photoPayload.reason || 'no reason given'})`);
          continue;
        }

        // Write the photo file
        const tag = Date.now() + '_' + uid().slice(0, 6);
        const fileName = `${roomId}_${split.phase}_${tag}.jpg`;
        const path = `${PHOTO_ROOT}/${inspId}/${fileName}`;

        try {
          await Filesystem.writeFile({
            path,
            data: photoPayload.base64,
            directory: Directory.Data,
            recursive: true,
          });

          inspection.rooms[roomId][split.phase].photos.push({
            path,
            ts: photoMeta.ts || photoPayload.ts || null,
            lat: typeof photoMeta.lat === 'number' ? photoMeta.lat : (typeof photoPayload.lat === 'number' ? photoPayload.lat : null),
            lng: typeof photoMeta.lng === 'number' ? photoMeta.lng : (typeof photoPayload.lng === 'number' ? photoPayload.lng : null),
            ratio: typeof photoMeta.ratio === 'number' ? photoMeta.ratio : (typeof photoPayload.ratio === 'number' ? photoPayload.ratio : null),
          });
        } catch (e) {
          warnings.push(`Failed to write photo ${photoKey}: ${e.message || 'unknown error'}`);
        }

        photoCursor++;
        onProgress(photoCursor, totalPhotos, split.phase);
      }
    }

    inspections.push(inspection);
  }

  // iOS Inbox cleanup — if this URL came from Inbox, delete after import
  // (iOS copies incoming files into our app's Inbox and won't clean them up)
  const shouldCleanup = opts.deleteSourceAfter !== false && url.includes('/Inbox/');
  if (shouldCleanup) {
    try {
      await Filesystem.deleteFile({ path: url });
    } catch {
      // Non-fatal — just leaves a stray file we couldn't clean up
    }
  }

  return {
    inspections,
    warnings,
    source: {
      bundleId: bundle.inspection.id,
      tenantAppVersion: bundle.tenantAppVersion,
      exportedAt: bundle.exportedAt,
      propertyName: bundle.inspection.name,
      propertyAddress: bundle.inspection.address,
      stateIdx: bundle.inspection.stateIdx,
    },
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Decide whether the bundle has move-in data, move-out data, or both.
// Returns an array of { phase, type } describing inspections to create.
// ───────────────────────────────────────────────────────────────────────────
function splitBundleByPhase(bundle) {
  const rooms = bundle.inspection.rooms || {};
  let hasMoveIn = false;
  let hasMoveOut = false;

  for (const rd of Object.values(rooms)) {
    if (phaseHasData(rd.moveIn)) hasMoveIn = true;
    if (phaseHasData(rd.moveOut)) hasMoveOut = true;
  }

  const splits = [];
  if (hasMoveIn)  splits.push({ phase: 'moveIn',  type: 'tenant_move_in' });
  if (hasMoveOut) splits.push({ phase: 'moveOut', type: 'tenant_move_out' });

  // If the bundle is completely empty, still create an empty move-in record
  // so the landlord sees the import happened, rather than a silent no-op.
  if (splits.length === 0) {
    splits.push({ phase: 'moveIn', type: 'tenant_move_in' });
  }

  return splits;
}

function phaseHasData(phase) {
  if (!phase) return false;
  const hasStatuses = phase.statuses && Object.keys(phase.statuses).length > 0;
  const hasNotes = phase.notes && phase.notes.trim().length > 0;
  const hasPhotos = phase.photos && phase.photos.length > 0;
  return hasStatuses || hasNotes || hasPhotos;
}

// Look up the INSPECTION_TYPES key from a type id string
function typeKey(typeId) {
  for (const [key, val] of Object.entries(INSPECTION_TYPES)) {
    if (val.id === typeId) return key;
  }
  return null;
}

// UTF-8 safe base64 decode (mirror of tenant's btoaUtf8)
function atobUtf8(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
