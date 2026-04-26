// ═══════════════════════════════════════════════════════════════════════════
// photoCapture.js — photo capture pipeline for the landlord app
// ═══════════════════════════════════════════════════════════════════════════
// Handles:
//   - EXIF stamping (timestamp, GPS, software identifier, description)
//   - GPS coordinate lookup with timeout (3s — never block capture)
//   - Single helper to take a snapshot from a video stream into a data URL
//   - Platform-gated gallery save (Android: Pictures album, iOS: Photos album)
//   - iOS Photos-access primer (shown once per install, persisted in localStorage)
//
// Ported from tenant `mainnewest.jsx` with two changes:
//   - PHOTO_ROOT and album name use 'MoveOutShieldLandlord' (not MoveOutShield)
//     so photos don't intermix on shared devices
//   - Software EXIF tag = "MoveOut Shield Landlord" so origin is recoverable
//     from any photo file (forensic / chain-of-custody)
//
// Public API:
//   stampExif(dataUrl, opts)              → stamped dataUrl (or original on error)
//   getGPS(timeoutMs)                     → Promise<{lat, lng}>
//   snapFromVideo(videoEl, canvasEl)      → { dataUrl, ratio }
//   saveToGallery(stampedUrl, savedPath, deps) → Promise<void>  (best-effort)
//   PHOTO_PRIMER_KEY                      → constant key used by primer modal
// ═══════════════════════════════════════════════════════════════════════════

import piexif from 'piexifjs';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';

// localStorage key — same naming convention as ms_photo_primer_seen on tenant
export const PHOTO_PRIMER_KEY = 'mosl_photo_primer_seen';

// Album / folder names — DISTINCT from tenant's so coexisting installs
// don't mix photos in the user's gallery
const IOS_ALBUM_NAME = 'MoveOut Shield Landlord';
const ANDROID_PICTURES_DIR = 'Pictures/MoveOutShieldLandlord';
const SOFTWARE_TAG = 'MoveOut Shield Landlord';

// ─── EXIF date helpers (private) ────────────────────────────────────────────
const p2 = (n) => String(n).padStart(2, '0');

function toExifDate(when) {
  const d = when instanceof Date ? when : new Date(when || Date.now());
  return `${d.getFullYear()}:${p2(d.getMonth() + 1)}:${p2(d.getDate())} ` +
         `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
}

// Decimal lat/lng → EXIF rational triplet [degrees, minutes, seconds]
function toExifGPS(value) {
  const v = Math.abs(parseFloat(value));
  if (Number.isNaN(v)) return null;
  const deg = Math.floor(v);
  const minFloat = (v - deg) * 60;
  const min = Math.floor(minFloat);
  const sec = Math.round((minFloat - min) * 60 * 10000);
  return [[deg, 1], [min, 1], [sec, 10000]];
}

// ─── PUBLIC: stampExif ──────────────────────────────────────────────────────
// Embed timestamp, GPS, software ID, and a human-readable description into
// a JPEG data URL. Returns the original data URL on any error — never block
// the capture pipeline because of a metadata write failure.
export function stampExif(dataUrl, { lat, lng, when, description } = {}) {
  try {
    const dt = toExifDate(when);
    const zeroth = {
      [piexif.ImageIFD.Software]: SOFTWARE_TAG,
      [piexif.ImageIFD.DateTime]: dt,
      ...(description ? { [piexif.ImageIFD.ImageDescription]: description } : {}),
    };
    const exif = {
      [piexif.ExifIFD.DateTimeOriginal]: dt,
      [piexif.ExifIFD.DateTimeDigitized]: dt,
    };
    const gps = {};
    if (lat != null && lng != null) {
      const latR = toExifGPS(lat);
      const lngR = toExifGPS(lng);
      if (latR && lngR) {
        gps[piexif.GPSIFD.GPSLatitudeRef]  = +lat >= 0 ? 'N' : 'S';
        gps[piexif.GPSIFD.GPSLatitude]     = latR;
        gps[piexif.GPSIFD.GPSLongitudeRef] = +lng >= 0 ? 'E' : 'W';
        gps[piexif.GPSIFD.GPSLongitude]    = lngR;
        gps[piexif.GPSIFD.GPSDateStamp]    = dt.split(' ')[0];
      }
    }
    return piexif.insert(piexif.dump({ '0th': zeroth, 'Exif': exif, 'GPS': gps }), dataUrl);
  } catch {
    return dataUrl;
  }
}

// ─── PUBLIC: getGPS ─────────────────────────────────────────────────────────
// Resolves with current coords or {lat: null, lng: null} after timeout.
// Stores 5-decimal precision for human readability — full precision isn't
// necessary for a property-level claim (5 decimals = ~1.1m).
export function getGPS(timeoutMs = 3000) {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve({ lat: null, lng: null });
      return;
    }
    const timeout = setTimeout(() => resolve({ lat: null, lng: null }), timeoutMs);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        clearTimeout(timeout);
        resolve({
          lat: p.coords.latitude.toFixed(5),
          lng: p.coords.longitude.toFixed(5),
        });
      },
      () => {
        clearTimeout(timeout);
        resolve({ lat: null, lng: null });
      },
      { timeout: timeoutMs, maximumAge: 30000 }
    );
  });
}

// ─── PUBLIC: snapFromVideo ──────────────────────────────────────────────────
// Capture a JPEG snapshot from a <video> element using a hidden <canvas>.
// Returns { dataUrl, ratio } so the caller can wire it into PhotoStore.
export function snapFromVideo(videoEl, canvasEl, jpegQuality = 0.82) {
  if (!videoEl || !canvasEl) throw new Error('snapFromVideo: video and canvas refs required');
  canvasEl.width = videoEl.videoWidth;
  canvasEl.height = videoEl.videoHeight;
  canvasEl.getContext('2d').drawImage(videoEl, 0, 0);
  const dataUrl = canvasEl.toDataURL('image/jpeg', jpegQuality);
  const ratio = videoEl.videoWidth ? (videoEl.videoHeight / videoEl.videoWidth) : 0.75;
  return { dataUrl, ratio };
}

// ─── PUBLIC: saveToGallery ──────────────────────────────────────────────────
// Best-effort copy of the captured photo into the user's device gallery.
// Failures are non-fatal (the in-app copy still exists at savedPath). The
// in-app copy lives under PHOTO_ROOT/<inspId>/ and is what the app reads
// for diff/PDF; this function exists so users see their inspection photos
// in their normal Photos app too.
export async function saveToGallery(stampedDataUrl, savedPath) {
  if (!Capacitor.isNativePlatform() || !stampedDataUrl) return;
  const platform = Capacitor.getPlatform();

  // ── iOS: write to Photos album via @capacitor-community/media ───────────
  if (platform === 'ios') {
    try {
      const Media = registerPlugin('Media');

      // Find or create the album. Filter to user-created albums — iOS
      // createAlbum sometimes returns smart-album identifiers that
      // savePhoto rejects with argumentError.
      let albumId;
      const result = await Media.getAlbums();
      const albums = result?.albums || result || [];
      const existing = albums.find(
        (a) => a.name === IOS_ALBUM_NAME && (a.type === 'user' || !a.type)
      );

      if (existing) {
        albumId = existing.identifier;
      } else {
        await Media.createAlbum({ name: IOS_ALBUM_NAME });
        const refreshed = await Media.getAlbums();
        const refreshedList = refreshed?.albums || refreshed || [];
        albumId = refreshedList.find(
          (a) => a.name === IOS_ALBUM_NAME && (a.type === 'user' || !a.type)
        )?.identifier;
      }

      // Get the file:// URI of our saved in-app copy
      if (savedPath) {
        const { uri } = await Filesystem.getUri({
          path: savedPath,
          directory: Directory.Data,
        });
        // fileName arg is documented as Android-only — omit on iOS
        await Media.savePhoto({
          path: uri,
          ...(albumId ? { albumIdentifier: albumId } : {}),
        });
      }
    } catch (e) {
      console.warn('[Gallery save iOS]', e?.code, e?.message, JSON.stringify(e || {}));
    }
    return;
  }

  // ── Android: write a copy to Pictures/MoveOutShieldLandlord ──────────────
  // No Media plugin needed on Android — Filesystem.writeFile to ExternalStorage
  // lands in /storage/emulated/0/Pictures, where the system Gallery indexes.
  if (platform === 'android') {
    try {
      const base64 = stampedDataUrl.split(',')[1];
      const picPath = `${ANDROID_PICTURES_DIR}/${Date.now()}.jpg`;
      await Filesystem.writeFile({
        path: picPath,
        data: base64,
        directory: Directory.ExternalStorage,
        recursive: true,
      });
    } catch (e) {
      console.warn('[Gallery save Android]', e?.code, e?.message, JSON.stringify(e || {}));
    }
  }
}

// ─── PUBLIC: shouldShowPhotoPrimer ──────────────────────────────────────────
// Returns true if the iOS Photos-access primer should be shown before the
// next camera open. Always false on non-iOS or if already seen.
export function shouldShowPhotoPrimer() {
  if (typeof Capacitor === 'undefined' || Capacitor.getPlatform?.() !== 'ios') return false;
  try {
    return localStorage.getItem(PHOTO_PRIMER_KEY) !== '1';
  } catch {
    return false;
  }
}

export function markPhotoPrimerSeen() {
  try { localStorage.setItem(PHOTO_PRIMER_KEY, '1'); } catch {}
}

// ─── PUBLIC: buildPhotoDescription ──────────────────────────────────────────
// Construct the human-readable EXIF description string. Stamping it into the
// photo means the origin context is recoverable from any photo file by
// reading EXIF metadata.
export function buildPhotoDescription({ propertyAddress, propertyName, roomLabel, phaseLabel, inspectionType }) {
  return [
    'MoveOut Shield Landlord inspection',
    propertyName && `Property: ${propertyName}`,
    propertyAddress && `Address: ${propertyAddress}`,
    inspectionType && `Type: ${inspectionType}`,
    roomLabel && `Room: ${roomLabel}`,
    phaseLabel && `Phase: ${phaseLabel}`,
  ].filter(Boolean).join(' · ');
}
