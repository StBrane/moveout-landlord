// ═══════════════════════════════════════════════════════════════════════════
// PhotoDocGridScreen.jsx — flat photo grid for Photo Document records
// v0.3.0 — AgentSleek-style fast capture surface
// ═══════════════════════════════════════════════════════════════════════════
// Route: #/photodoc/{propertyId}/{inspectionId}[?cam=1]
//
// Records reach this screen when created via the main "+ Photo Document"
// button on a lease card (auto-numbered Other:N records). Records created
// via the chevron dropdown (Baseline, Mid-lease, etc.) route to CaptureScreen
// instead. Both surfaces operate on the same inspection.rooms[id][phase].photos
// shape, so a record can be edited in either place.
//
// Photos in this flow are born in the "other" room slot, slot=moveOut by
// default (matching the Other inspection type's defaultSlot). Tag Rooms moves
// photos between room slots within the same inspection. Tag Damages toggles
// per-photo damaged flags.
//
// Layout (top to bottom):
//
//   ┌──────────────────────────────────────────┐
//   │ Forest header                            │
//   │   ‹ {property name}                      │
//   │   📝 Other: 3 · 12 photos · 0 flagged    │
//   ├──────────────────────────────────────────┤
//   │ FLAT PHOTO GRID (3-up)                   │
//   │   tap thumbnail → lightbox               │
//   │   per-tile chips: room name, ⚠ flagged   │
//   ├──────────────────────────────────────────┤
//   │ STICKY BOTTOM ACTION BAR                 │
//   │   [+ More photos]                        │
//   │   [Tag rooms (N untagged)]               │
//   │   [Tag damages (N flagged)]              │
//   │   [Rate items — open per-room editor]     │
//   │   [Generate PDF]                         │
//   │   [Save & Return]                        │
//   └──────────────────────────────────────────┘
//
// All buttons simultaneously available — no mandatory pass-through. Each tag
// surface has device-back returning here. Auto-save fires on every photo
// capture, room reassignment, and damage toggle.
//
// Camera capture re-uses the same getUserMedia + EXIF + GPS pipeline as
// CaptureScreen, scoped to the active inspection. Photos written via
// photoStore.save go straight into the "other"/moveOut slot. The user can
// move them between rooms later via Tag Rooms.
// ═══════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';

import {
  THEME, ROOMS, inspectionTypeById,
} from '../lib/constants.js';
import {
  getProperty, getInspection, updateInspection,
} from '../lib/portfolioStore.js';
import {
  stampExif, getGPS, snapFromVideo, saveToGallery,
  shouldShowPhotoPrimer, markPhotoPrimerSeen, buildPhotoDescription,
} from '../lib/photoCapture.js';

import TagRoomsScreen from './TagRoomsScreen.jsx';
import TagDamagesScreen from './TagDamagesScreen.jsx';

const IS_NATIVE = Capacitor.isNativePlatform();

// Default landing slot for Photo Document records. Matches the "other" type's
// defaultSlot in constants.js so PDF builders that key off slot pick the right
// data. Photos taken from this screen always land here regardless of the
// user's choice in Tag Rooms — Tag Rooms moves them, doesn't re-slot them.
const DEFAULT_SLOT = 'moveOut';
const DEFAULT_ROOM_ID = 'other';

export default function PhotoDocGridScreen({
  portfolio, setPortfolio, propertyId, inspectionId,
  onBack, onOpenRatings, autoOpenCamera, photoStore,
}) {
  const property = getProperty(portfolio, propertyId);
  const inspection = getInspection(portfolio, propertyId, inspectionId);
  const typeEntry = inspection ? inspectionTypeById(inspection.type) : null;
  // Use the type's defaultSlot when present, otherwise fall back to moveOut.
  // Other → moveIn, but we override to moveOut so Photo Document captures
  // land in the same slot as Turnover/Post-tenant — keeps the PDF builder's
  // "items flagged" gallery consistent across record types.
  const slot = DEFAULT_SLOT;

  // ── Internal sub-screen routing ──────────────────────────────────────
  // 'grid' = this screen, 'tagRooms' = paint mode, 'tagDamages' = flag mode.
  // Sub-screens get device-back via Android handler in main.jsx? No — the
  // landlord app uses hash routing, but the photodoc subscreens are below
  // the route level. Keep a local sub-screen state and intercept device
  // back here via window history pushes. Simplest: just toggle in-place
  // and let the user use the back arrow inside each sub-screen.
  const [subScreen, setSubScreen] = useState('grid');

  // ── Camera state ─────────────────────────────────────────────────────
  const [camOpen, setCamOpen] = useState(false);
  const [stream, setStream] = useState(null);
  const [facing, setFacing] = useState('environment');
  const [flash, setFlash] = useState(false);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  // ── iOS Photos primer ────────────────────────────────────────────────
  const [photoPrimer, setPhotoPrimer] = useState(false);

  // ── Permission denied modal ──────────────────────────────────────────
  const [permissionDenied, setPermissionDenied] = useState(false);

  // ── Lightbox state ───────────────────────────────────────────────────
  // { roomId, slot, idx } — points to a photo in inspection.rooms[roomId][slot].photos
  const [lightbox, setLightbox] = useState(null);

  // ── Photo path → web URL cache (mirrors CaptureScreen pattern) ──────
  const [photoCache, setPhotoCache] = useState({});

  // ── Resolve all photos in the inspection to web URLs ─────────────────
  // PhotoDocGrid shows photos from EVERY room slot (since the user might
  // tag photos to different rooms across the same inspection). Iterate
  // every (room, slot) in inspection.rooms and warm the cache.
  useEffect(() => {
    if (!inspection || !photoStore) return;
    let cancelled = false;
    (async () => {
      const updates = {};
      for (const roomId of Object.keys(inspection.rooms || {})) {
        for (const phaseKey of ['moveIn', 'moveOut']) {
          const photos = inspection.rooms[roomId]?.[phaseKey]?.photos || [];
          for (const p of photos) {
            if (p.path && !photoCache[p.path]) {
              const url = await photoStore.toWebUrl(p.path);
              if (url) updates[p.path] = url;
            }
          }
        }
      }
      if (!cancelled && Object.keys(updates).length > 0) {
        setPhotoCache(prev => ({ ...prev, ...updates }));
      }
    })();
    return () => { cancelled = true; };
  }, [inspection?.id, allPhotosFingerprint(inspection)]);

  // ── Camera lifecycle: stop tracks on unmount or screen change ────────
  useEffect(() => () => {
    stream?.getTracks().forEach(t => t.stop());
  }, [stream]);

  // ── Auto-open camera on mount when ?cam=1 was set ────────────────────
  // Only fires once per inspection. Guards against re-firing when user
  // backs into the screen later. Skips if record already has photos.
  const autoOpenAttemptedRef = useRef(false);
  useEffect(() => {
    if (!autoOpenCamera) return;
    if (autoOpenAttemptedRef.current) return;
    if (!inspection || !inspection.editable) return;
    if (totalPhotoCount(inspection) > 0) return;
    autoOpenAttemptedRef.current = true;
    requestOpenCam();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpenCamera, inspection?.id]);

  // ── Wire stream to video element when both are ready ─────────────────
  useEffect(() => {
    if (stream && videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);

  if (!property || !inspection) {
    return (
      <div style={{ padding: 20, color: THEME.ink, background: THEME.bg, minHeight: '100vh' }}>
        <div style={{ marginBottom: 14 }}>Photo Document not found.</div>
        <button onClick={onBack} style={btnSecondary}>← Back</button>
      </div>
    );
  }

  if (!inspection.editable) {
    return (
      <div style={{ padding: 20, color: THEME.ink, background: THEME.bg, minHeight: '100vh' }}>
        <div style={{ marginBottom: 14 }}>
          This record was imported and is read-only.
        </div>
        <button onClick={onBack} style={btnSecondary}>← Back</button>
      </div>
    );
  }

  // ── Derived: flat list of every photo across all room slots ──────────
  // Each entry carries (roomId, slot, idx) so lightbox/edit operations
  // can target the right slice of inspection.rooms. Sorted by capture time
  // descending (newest first) so the user sees recent shots at the top.
  const allPhotos = useMemo(() => {
    return collectAllPhotos(inspection);
  }, [inspection]);

  // ── Counts for the action bar labels ─────────────────────────────────
  const totalPhotos = allPhotos.length;
  const untaggedPhotos = allPhotos.filter(p => p.roomId === DEFAULT_ROOM_ID).length;
  const flaggedPhotos = allPhotos.filter(p => p.photo.damaged).length;

  // ─── Camera flow ─────────────────────────────────────────────────────
  const requestOpenCam = () => {
    if (shouldShowPhotoPrimer()) {
      setPhotoPrimer(true);
      return;
    }
    openCam();
  };

  const dismissPhotoPrimer = () => {
    markPhotoPrimerSeen();
    setPhotoPrimer(false);
    openCam();
  };

  async function openCam() {
    setCamOpen(true);
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing, width: { ideal: 1920 } },
      });
      setStream(s);
    } catch (err) {
      setCamOpen(false);
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setPermissionDenied(true);
      } else if (err.name === 'NotFoundError' || err.name === 'OverconstrainedError') {
        alert('No camera found on this device.');
      } else {
        alert('Camera unavailable: ' + (err.message || 'unknown error'));
      }
    }
  }

  const closeCam = () => {
    stream?.getTracks().forEach(t => t.stop());
    setStream(null);
    setCamOpen(false);
  };

  const flipCam = async () => {
    const nf = facing === 'environment' ? 'user' : 'environment';
    setFacing(nf);
    stream?.getTracks().forEach(t => t.stop());
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: nf } });
      setStream(s);
    } catch {}
  };

  const snapPhoto = async () => {
    if (!videoRef.current || !canvasRef.current) return;
    const { dataUrl, ratio } = snapFromVideo(videoRef.current, canvasRef.current);
    setFlash(true);
    setTimeout(() => setFlash(false), 150);

    const ts = new Date().toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });

    const gps = await getGPS(3000);
    const description = buildPhotoDescription({
      propertyName: property.name,
      propertyAddress: property.address,
      roomLabel: 'Photo Document',
      phaseLabel: 'Capture',
      inspectionType: typeEntry?.label,
    });
    const stampedUrl = stampExif(dataUrl, {
      lat: gps.lat, lng: gps.lng, when: new Date(), description,
    });

    let photo;
    if (IS_NATIVE && photoStore) {
      const saved = await photoStore.save(inspectionId, DEFAULT_ROOM_ID, slot, stampedUrl);
      if (saved) {
        photo = { path: saved.path, ts, lat: gps.lat, lng: gps.lng, ratio, damaged: false };
        const webUrl = await photoStore.toWebUrl(saved.path);
        if (webUrl) setPhotoCache(prev => ({ ...prev, [saved.path]: webUrl }));
        saveToGallery(stampedUrl, saved.path).catch(() => {});
      }
    } else {
      // Web fallback: keep dataUrl in memory only (won't persist past reload)
      photo = { url: stampedUrl, ts, lat: gps.lat, lng: gps.lng, ratio, damaged: false };
    }

    if (!photo) return;

    // New photos always land in the default room+slot. Tag Rooms can move them.
    const next = updateInspection(portfolio, propertyId, inspectionId, mutateInspection(inspection, (rooms) => {
      const targetRoom = rooms[DEFAULT_ROOM_ID] || { moveIn: blankPhase(), moveOut: blankPhase() };
      const phase = targetRoom[slot] || blankPhase();
      rooms[DEFAULT_ROOM_ID] = {
        ...targetRoom,
        [slot]: { ...phase, photos: [...phase.photos, photo] },
      };
    }));
    setPortfolio(next);
  };

  // ─── Photo movement helpers (called by TagRoomsScreen) ───────────────
  // Move a photo from (fromRoomId, fromSlot, idx) to (toRoomId, slot).
  // Used by Tag Rooms paint mode. Source slot is preserved as fromSlot
  // (never re-slotted), since photos started life in the default slot.
  const movePhotoToRoom = useCallback((photoLoc, toRoomId) => {
    const { roomId: fromRoomId, slot: fromSlot, idx } = photoLoc;
    if (fromRoomId === toRoomId) return;  // no-op
    const next = updateInspection(portfolio, propertyId, inspectionId, mutateInspection(inspection, (rooms) => {
      const fromRoom = rooms[fromRoomId];
      if (!fromRoom) return;
      const fromPhase = fromRoom[fromSlot];
      if (!fromPhase || !fromPhase.photos[idx]) return;
      const photo = fromPhase.photos[idx];

      // Remove from source
      rooms[fromRoomId] = {
        ...fromRoom,
        [fromSlot]: {
          ...fromPhase,
          photos: fromPhase.photos.filter((_, i) => i !== idx),
        },
      };

      // Append to destination (always uses fromSlot to preserve slot semantics)
      const toRoom = rooms[toRoomId] || { moveIn: blankPhase(), moveOut: blankPhase() };
      const toPhase = toRoom[fromSlot] || blankPhase();
      rooms[toRoomId] = {
        ...toRoom,
        [fromSlot]: {
          ...toPhase,
          photos: [...toPhase.photos, photo],
        },
      };
    }));
    setPortfolio(next);
  }, [portfolio, propertyId, inspectionId, inspection]);

  // ─── Damage flag toggle (called by TagDamagesScreen) ─────────────────
  const togglePhotoDamage = useCallback((photoLoc) => {
    const { roomId, slot: photoSlot, idx } = photoLoc;
    const next = updateInspection(portfolio, propertyId, inspectionId, mutateInspection(inspection, (rooms) => {
      const room = rooms[roomId];
      if (!room) return;
      const phase = room[photoSlot];
      if (!phase || !phase.photos[idx]) return;
      rooms[roomId] = {
        ...room,
        [photoSlot]: {
          ...phase,
          photos: phase.photos.map((p, i) =>
            i === idx ? { ...p, damaged: !p.damaged } : p
          ),
        },
      };
    }));
    setPortfolio(next);
  }, [portfolio, propertyId, inspectionId, inspection]);

  // ─── Photo delete (from lightbox) ────────────────────────────────────
  const deletePhoto = (photoLoc) => {
    const { roomId, slot: photoSlot, idx } = photoLoc;
    const room = inspection.rooms[roomId];
    const photo = room?.[photoSlot]?.photos?.[idx];
    if (!confirm('Delete this photo?')) return;
    if (photo?.path && photoStore) {
      photoStore.remove(photo.path).catch(() => {});
    }
    const next = updateInspection(portfolio, propertyId, inspectionId, mutateInspection(inspection, (rooms) => {
      const r = rooms[roomId];
      if (!r) return;
      const phase = r[photoSlot];
      if (!phase) return;
      rooms[roomId] = {
        ...r,
        [photoSlot]: {
          ...phase,
          photos: phase.photos.filter((_, i) => i !== idx),
        },
      };
    }));
    setPortfolio(next);
    setLightbox(null);
  };

  // ─── Sub-screen routing ──────────────────────────────────────────────
  if (subScreen === 'tagRooms') {
    return (
      <TagRoomsScreen
        property={property}
        inspection={inspection}
        photoCache={photoCache}
        onMovePhoto={movePhotoToRoom}
        onBack={() => setSubScreen('grid')}
      />
    );
  }
  if (subScreen === 'tagDamages') {
    return (
      <TagDamagesScreen
        property={property}
        inspection={inspection}
        photoCache={photoCache}
        onToggleDamage={togglePhotoDamage}
        onBack={() => setSubScreen('grid')}
      />
    );
  }

  // ─── Grid render ─────────────────────────────────────────────────────
  return (
    <div style={{
      maxWidth: 720, margin: '0 auto',
      padding: 'calc(env(safe-area-inset-top) + 0px) 0 calc(env(safe-area-inset-bottom) + 32px) 0',
      minHeight: '100vh', background: THEME.bg,
    }}>
      {/* ─── Forest header ──────────────────────────────────────────────── */}
      <header style={{
        background: THEME.brand, color: THEME.mint50,
        padding: 'calc(env(safe-area-inset-top) + 14px) 18px 16px 18px',
        borderBottomLeftRadius: 18, borderBottomRightRadius: 18,
        marginBottom: 12,
      }}>
        <button onClick={onBack} style={{
          background: 'rgba(255,255,255,0.1)', color: THEME.mint100,
          border: `1px solid ${THEME.mint400}`, borderRadius: 999,
          padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
          marginBottom: 10, display: 'inline-flex', alignItems: 'center', gap: 6,
        }}>
          <span style={{ fontSize: 14 }}>‹</span> {property.name}
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 24 }}>{typeEntry?.icon || '📝'}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 style={{
              margin: 0, fontSize: 17, fontWeight: 700, color: THEME.mint50,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {inspection.label}
            </h1>
            <div style={{ fontSize: 11, color: THEME.mint200, marginTop: 2, opacity: 0.95 }}>
              📸 {totalPhotos} {totalPhotos === 1 ? 'photo' : 'photos'}
              {flaggedPhotos > 0 && ` · ⚠ ${flaggedPhotos} flagged`}
              {untaggedPhotos > 0 && totalPhotos > 0 && ` · ${untaggedPhotos} untagged`}
            </div>
          </div>
        </div>
      </header>

      {/* ─── ACTION BUTTONS AT TOP ──────────────────────────────────────── */}
      {/* All actions sit above the gallery — Tag rooms / Tag damages / Rate items /
          + More photos / Generate PDF. The user reads "what can I do?" first,
          then the gallery as evidence below. */}
      <div style={{
        padding: '0 14px',
        display: 'flex', flexDirection: 'column', gap: 8,
        marginBottom: 14,
      }}>
        <button onClick={requestOpenCam} style={btnSecondaryAccent}>
          + More photos
        </button>

        <button
          onClick={() => setSubScreen('tagRooms')}
          disabled={totalPhotos === 0}
          style={{
            ...btnSecondaryAccent,
            opacity: totalPhotos === 0 ? 0.4 : 1,
            cursor: totalPhotos === 0 ? 'not-allowed' : 'pointer',
          }}
        >
          {untaggedPhotos > 0
            ? `Tag rooms (${untaggedPhotos} untagged)`
            : 'Tag rooms'}
        </button>

        <button
          onClick={() => setSubScreen('tagDamages')}
          disabled={totalPhotos === 0}
          style={{
            ...btnSecondaryAccent,
            opacity: totalPhotos === 0 ? 0.4 : 1,
            cursor: totalPhotos === 0 ? 'not-allowed' : 'pointer',
          }}
        >
          {flaggedPhotos > 0
            ? `Tag damages (${flaggedPhotos} flagged)`
            : 'Tag damages'}
        </button>

        <button
          onClick={() => onOpenRatings && onOpenRatings(inspectionId)}
          style={btnSecondaryAccent}
        >
          🪄 Rate items · open per-room editor
        </button>
      </div>

      {/* ─── PHOTO GALLERY ──────────────────────────────────────────────── */}
      {totalPhotos === 0 ? (
        <div style={{ padding: '40px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 44, marginBottom: 12, opacity: 0.6 }}>📷</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: THEME.ink, marginBottom: 6 }}>
            No photos yet
          </div>
          <div style={{ fontSize: 13, color: THEME.muted, lineHeight: 1.6 }}>
            Tap <strong>+ More photos</strong> above to start capturing.
          </div>
        </div>
      ) : (
        <div style={{ padding: '0 14px', marginBottom: 14 }}>
          <div style={{
            fontSize: 10, fontWeight: 700, color: THEME.muted,
            textTransform: 'uppercase', letterSpacing: '0.08em',
            marginBottom: 6, paddingLeft: 4,
          }}>
            Photos
          </div>
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 4, background: THEME.paper,
            borderRadius: 12, padding: 4, overflow: 'hidden',
            border: `1px solid ${THEME.edge}`,
          }}>
            {allPhotos.map((entry, i) => {
              const { photo, roomId, slot: photoSlot, idx } = entry;
              const src = photo.url || (photo.path ? photoCache[photo.path] : null);
              const isUntagged = roomId === DEFAULT_ROOM_ID;
              const roomLabel = ROOMS.find(r => r.id === roomId)?.name || roomId;
              return (
                <div
                  key={`${roomId}_${photoSlot}_${idx}`}
                  onClick={() => setLightbox(entry)}
                  style={{
                    position: 'relative', aspectRatio: '1', overflow: 'hidden',
                    cursor: 'pointer', background: THEME.bg, borderRadius: 6,
                    outline: photo.damaged ? `3px solid ${THEME.danger}` : 'none',
                    outlineOffset: '-2px',
                  }}
                >
                  {src ? (
                    <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  ) : (
                    <div style={{
                      height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 10, color: THEME.muted2,
                    }}>loading…</div>
                  )}

                  {/* Damaged badge — top-right */}
                  {photo.damaged && (
                    <div style={{
                      position: 'absolute', top: 4, right: 4,
                      background: THEME.danger, color: '#fff',
                      fontSize: 9, fontWeight: 800, padding: '2px 6px',
                      borderRadius: 8, boxShadow: '0 2px 4px rgba(0,0,0,0.4)',
                    }}>
                      ⚠ FLAGGED
                    </div>
                  )}

                  {/* Room chip — bottom */}
                  <div style={{
                    position: 'absolute', bottom: 0, left: 0, right: 0,
                    background: 'linear-gradient(transparent, rgba(0,0,0,0.7))',
                    padding: '12px 6px 4px',
                  }}>
                    <div style={{
                      color: '#fff', fontSize: 9, fontWeight: 600,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      opacity: isUntagged ? 0.6 : 1,
                    }}>
                      {isUntagged ? '— untagged' : roomLabel}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ─── PILLS SUMMARY (bottom — only if rated items or notes exist) ── */}
      <RatingsSummaryBlock
        inspection={inspection}
        onOpenRatings={onOpenRatings}
        inspectionId={inspectionId}
      />

      {/* ─── Save & Return — sits under all content as the back-action ──── */}
      <div style={{ padding: '14px 14px 0 14px' }}>
        <button onClick={onBack} style={btnReturn}>
          ← Save & Return to Property
        </button>
        <div style={{
          textAlign: 'center', fontSize: 10, color: THEME.muted2, marginTop: 10,
        }}>
          Auto-saved · changes are kept locally on this device
        </div>
      </div>

      {/* ─── Hidden canvas for snapshot capture ───────────────────────── */}
      <canvas ref={canvasRef} style={{ display: 'none' }} />

      {/* ─── Camera overlay ───────────────────────────────────────────── */}
      {camOpen && (
        <CameraOverlay
          videoRef={videoRef}
          flash={flash}
          onClose={closeCam}
          onFlip={flipCam}
          onSnap={snapPhoto}
          recordLabel={inspection.label}
          photoCount={totalPhotos}
        />
      )}

      {/* ─── iOS Photos primer ────────────────────────────────────────── */}
      {photoPrimer && <PhotoPrimer onContinue={dismissPhotoPrimer} />}

      {/* ─── Camera permission denied modal ───────────────────────────── */}
      {permissionDenied && (
        <PermissionDeniedModal
          onRetry={() => { setPermissionDenied(false); openCam(); }}
          onDismiss={() => setPermissionDenied(false)}
        />
      )}

      {/* ─── Lightbox ─────────────────────────────────────────────────── */}
      {lightbox && (() => {
        const { roomId, slot: photoSlot, idx } = lightbox;
        const photo = inspection.rooms?.[roomId]?.[photoSlot]?.photos?.[idx];
        if (!photo) return null;
        return (
          <Lightbox
            photo={photo}
            roomLabel={ROOMS.find(r => r.id === roomId)?.name || roomId}
            isUntagged={roomId === DEFAULT_ROOM_ID}
            src={photo.url || (photo.path ? photoCache[photo.path] : null)}
            onClose={() => setLightbox(null)}
            onDelete={() => deletePhoto(lightbox)}
          />
        );
      })()}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// RatingsSummaryBlock — per-room summary of rated items, shown below the gallery
// ═══════════════════════════════════════════════════════════════════════════
// Renders only when at least one room has rated items or notes. Each room
// gets a card with: room icon + name, count of rated items, count of damaged
// items, count of notes characters. Tapping the card opens the Rate items
// editor (CaptureScreen) for this record so the user can edit ratings for
// any room.
//
// Rationale: this gives the user a quick "what's on this record" view from
// the photodoc grid without having to enter the full Rate items editor.
// Read-only summary; tap to edit.
function RatingsSummaryBlock({ inspection, onOpenRatings, inspectionId }) {
  // Walk every room slot and tally rated/damaged/notes
  const summary = collectRatingsSummary(inspection);

  if (summary.length === 0) {
    // Don't render anything — no pills work has been done on this record
    return null;
  }

  return (
    <div style={{ padding: '0 14px', marginBottom: 14 }}>
      <div style={{
        fontSize: 10, fontWeight: 700, color: THEME.muted,
        textTransform: 'uppercase', letterSpacing: '0.08em',
        marginBottom: 6, paddingLeft: 4,
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <span>🪄 Rate items</span>
        <span style={{ color: THEME.muted2, fontWeight: 500, textTransform: 'none', letterSpacing: 0 }}>
          · tap to edit
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {summary.map(row => (
          <button
            key={`${row.roomId}_${row.slot}`}
            onClick={() => onOpenRatings && onOpenRatings(inspectionId)}
            style={{
              background: THEME.paper,
              border: `1px solid ${row.damaged > 0 ? THEME.danger : THEME.edge}`,
              borderLeft: `4px solid ${row.damaged > 0 ? THEME.danger : THEME.brand2}`,
              borderRadius: 10, padding: '10px 12px',
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left',
              width: '100%',
            }}
          >
            <span style={{ fontSize: 18 }}>{row.icon}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: THEME.ink }}>
                {row.name}
              </div>
              <div style={{ fontSize: 11, color: THEME.muted, marginTop: 2, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <span>
                  <strong style={{ color: THEME.brand2 }}>{row.rated}</strong>
                  {' '}{row.rated === 1 ? 'item' : 'items'} rated
                </span>
                {row.damaged > 0 && (
                  <span style={{ color: THEME.danger, fontWeight: 600 }}>
                    · {row.damaged} damaged
                  </span>
                )}
                {row.hasNotes && (
                  <span style={{ color: THEME.muted2 }}>· notes</span>
                )}
              </div>
            </div>
            <span style={{ color: THEME.muted2, fontSize: 14 }}>›</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// Walk inspection.rooms → produce one row per (roomId, slot) that has any
// rated items or notes. Skip rooms with no engagement at all.
function collectRatingsSummary(inspection) {
  if (!inspection?.rooms) return [];
  const out = [];
  for (const room of ROOMS) {
    const rd = inspection.rooms[room.id];
    if (!rd) continue;
    for (const slot of ['moveIn', 'moveOut']) {
      const phase = rd[slot];
      if (!phase) continue;
      const statuses = phase.statuses || {};
      const ratedKeys = Object.keys(statuses);
      const ratedCount = ratedKeys.length;
      const damagedCount = ratedKeys.filter(k => statuses[k] === 'damaged').length;
      const hasNotes = (phase.notes || '').trim().length > 0;
      if (ratedCount === 0 && !hasNotes) continue;
      out.push({
        roomId: room.id,
        slot,
        name: room.name,
        icon: room.icon,
        rated: ratedCount,
        damaged: damagedCount,
        hasNotes,
      });
    }
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// CameraOverlay — fullscreen camera with snap, flip, close (mirrors CaptureScreen)
// ═══════════════════════════════════════════════════════════════════════════
function CameraOverlay({ videoRef, flash, onClose, onFlip, onSnap, recordLabel, photoCount = 0 }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: '#000',
      zIndex: 2000, display: 'flex', flexDirection: 'column',
    }}>
      <div style={{
        padding: 'calc(env(safe-area-inset-top) + 12px) 14px 12px 14px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        background: 'rgba(0,0,0,0.6)',
      }}>
        <button onClick={onClose} style={{
          background: 'rgba(255,255,255,0.15)', color: '#fff', border: 'none',
          borderRadius: 20, padding: '7px 14px', fontSize: 13, fontWeight: 600,
          cursor: 'pointer',
        }}>✕ Close</button>
        <div style={{
          color: '#fff', fontSize: 12, fontWeight: 600, opacity: 0.9,
          maxWidth: '60%', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {recordLabel}
        </div>
        <button onClick={onFlip} style={{
          background: 'rgba(255,255,255,0.15)', color: '#fff', border: 'none',
          borderRadius: 20, padding: '7px 14px', fontSize: 13, fontWeight: 600,
          cursor: 'pointer',
        }}>🔄 Flip</button>
      </div>

      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
        {flash && (
          <div style={{
            position: 'absolute', inset: 0, background: '#fff',
            opacity: 0.8, animation: 'fadeOut 0.15s ease-out',
          }} />
        )}
      </div>

      <div style={{
        background: '#111',
        padding: '18px 24px',
        paddingBottom: 'max(30px, calc(env(safe-area-inset-bottom, 8px) + 16px))',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <button onClick={onClose} style={{
          color: '#aaa', fontSize: 14, padding: '8px 16px',
          background: 'transparent', border: 'none', cursor: 'pointer',
        }}>✕ Done</button>

        <div style={{ position: 'relative' }}>
          <button onClick={onSnap} style={{
            width: 68, height: 68, borderRadius: '50%',
            background: '#fff', border: '4px solid #555',
            fontSize: 28, display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer',
          }}>●</button>
          {photoCount > 0 && (
            <div style={{
              position: 'absolute', top: -6, right: -6,
              background: THEME.mint300, color: THEME.brand,
              borderRadius: 20, minWidth: 22, height: 22,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, fontWeight: 800, padding: '0 5px',
            }}>
              {photoCount}
            </div>
          )}
        </div>

        <div style={{ color: '#777', fontSize: 12, textAlign: 'right' }}>
          Tap ●<br />to capture
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PhotoPrimer — iOS Photos library primer
// ═══════════════════════════════════════════════════════════════════════════
function PhotoPrimer({ onContinue }) {
  return (
    <div style={modalBackdrop}>
      <div style={{
        background: THEME.paper, borderRadius: 16, padding: 24,
        maxWidth: 420, width: '100%',
        border: `2px solid ${THEME.brand}`,
        boxShadow: '0 20px 50px rgba(0,0,0,0.3)',
      }}>
        <div style={{ fontSize: 32, marginBottom: 8, textAlign: 'center' }}>📷</div>
        <div style={{ fontSize: 17, fontWeight: 700, color: THEME.brand, marginBottom: 10, textAlign: 'center' }}>
          One-time photo access
        </div>
        <div style={{ fontSize: 13, color: THEME.inkSoft, marginBottom: 14, lineHeight: 1.5 }}>
          MoveOut Shield Landlord saves a copy of every inspection photo to a "MoveOut Shield Landlord"
          album in your iPhone's Photos app, so you have evidence even if you delete the app.
        </div>
        <div style={{ fontSize: 12, color: THEME.muted, marginBottom: 18, lineHeight: 1.5 }}>
          On the next screen, iOS will ask for Photos access. Choose <strong>Full Access</strong>.
          You can change this later in Settings.
        </div>
        <button onClick={onContinue} style={{ ...btnPrimary, width: '100%' }}>
          Continue to camera
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PermissionDeniedModal — camera permission denied recovery
// ═══════════════════════════════════════════════════════════════════════════
function PermissionDeniedModal({ onRetry, onDismiss }) {
  return (
    <div style={modalBackdrop}>
      <div style={{
        background: THEME.paper, borderRadius: 16, padding: 24,
        maxWidth: 420, width: '100%',
        border: `2px solid ${THEME.danger}`,
        boxShadow: '0 20px 50px rgba(0,0,0,0.3)',
      }}>
        <div style={{ fontSize: 32, marginBottom: 8, textAlign: 'center' }}>📷</div>
        <div style={{ fontSize: 17, fontWeight: 700, color: THEME.danger, marginBottom: 10, textAlign: 'center' }}>
          Camera access is off
        </div>
        <div style={{ fontSize: 13, color: THEME.inkSoft, marginBottom: 14, lineHeight: 1.5 }}>
          MoveOut Shield Landlord needs camera access to capture inspection photos.
        </div>
        <div style={{ fontSize: 12, color: THEME.muted, marginBottom: 18, lineHeight: 1.5 }}>
          If you just declined the prompt, tap Retry. Otherwise, open
          <strong> Settings → MoveOut Shield Landlord → Camera</strong> and turn it on,
          then come back and tap Retry.
        </div>
        <button onClick={onRetry} style={{ ...btnPrimary, width: '100%', marginBottom: 8 }}>
          Retry
        </button>
        <button onClick={onDismiss} style={{ ...btnSecondary, width: '100%' }}>
          Not now
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Lightbox — full-size photo with metadata, delete option
// ═══════════════════════════════════════════════════════════════════════════
function Lightbox({ photo, src, roomLabel, isUntagged, onClose, onDelete }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)',
      zIndex: 2000, display: 'flex', flexDirection: 'column',
    }} onClick={onClose}>
      <div style={{
        padding: 'calc(env(safe-area-inset-top) + 14px) 14px 14px 14px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <button onClick={(e) => { e.stopPropagation(); onClose(); }} style={{
          background: 'rgba(255,255,255,0.15)', color: '#fff', border: 'none',
          borderRadius: 20, padding: '7px 14px', fontSize: 13, fontWeight: 600,
          cursor: 'pointer',
        }}>✕ Close</button>
        <button onClick={(e) => { e.stopPropagation(); onDelete(); }} style={{
          background: 'rgba(239,68,68,0.85)', color: '#fff', border: 'none',
          borderRadius: 20, padding: '7px 14px', fontSize: 13, fontWeight: 600,
          cursor: 'pointer',
        }}>🗑 Delete</button>
      </div>

      <div style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 14, overflow: 'hidden',
      }} onClick={(e) => e.stopPropagation()}>
        {src ? (
          <img src={src} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
        ) : (
          <div style={{ color: '#fff' }}>loading…</div>
        )}
      </div>

      <div style={{
        padding: '14px 18px calc(env(safe-area-inset-bottom) + 18px) 18px',
        color: '#fff', fontSize: 12, lineHeight: 1.6,
      }}>
        <div style={{
          display: 'inline-block', padding: '3px 10px', borderRadius: 12,
          background: isUntagged ? 'rgba(255,255,255,0.15)' : THEME.brand2,
          fontSize: 10, fontWeight: 700, marginBottom: 6,
        }}>
          {isUntagged ? 'UNTAGGED' : roomLabel.toUpperCase()}
        </div>
        {photo.damaged && (
          <div style={{
            display: 'inline-block', padding: '3px 10px', borderRadius: 12,
            background: THEME.danger,
            fontSize: 10, fontWeight: 700, marginBottom: 6, marginLeft: 6,
          }}>
            ⚠ FLAGGED
          </div>
        )}
        <div>📅 {photo.ts}</div>
        {photo.lat && <div>📍 GPS: {photo.lat}, {photo.lng}</div>}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

// Walk the inspection's room slots and return a flat list of photo entries
// with their location (roomId, slot, idx) attached. Sorted newest-first by ts.
function collectAllPhotos(inspection) {
  if (!inspection?.rooms) return [];
  const out = [];
  for (const roomId of Object.keys(inspection.rooms)) {
    for (const slot of ['moveIn', 'moveOut']) {
      const photos = inspection.rooms[roomId]?.[slot]?.photos || [];
      photos.forEach((photo, idx) => {
        out.push({ photo, roomId, slot, idx });
      });
    }
  }
  // Sort newest-first by ts string. ts is human-readable
  // ("Jan 15, 09:42 AM"), so we parse it back to a Date for comparison.
  // Falls back to insertion order if ts is missing.
  out.sort((a, b) => {
    const ta = parseTs(a.photo.ts);
    const tb = parseTs(b.photo.ts);
    return tb - ta;
  });
  return out;
}

function parseTs(ts) {
  if (!ts) return 0;
  const t = new Date(ts).getTime();
  return Number.isFinite(t) ? t : 0;
}

// Fingerprint the inspection's photo state so the photoCache effect re-runs
// when photos are added/removed/moved. Cheap to compute, doesn't rely on
// deep object identity.
function allPhotosFingerprint(inspection) {
  if (!inspection?.rooms) return '';
  let fp = '';
  for (const roomId of Object.keys(inspection.rooms)) {
    for (const slot of ['moveIn', 'moveOut']) {
      fp += `${roomId}:${slot}:${inspection.rooms[roomId]?.[slot]?.photos?.length || 0}|`;
    }
  }
  return fp;
}

function totalPhotoCount(inspection) {
  if (!inspection?.rooms) return 0;
  let total = 0;
  for (const roomId of Object.keys(inspection.rooms)) {
    total += (inspection.rooms[roomId]?.moveIn?.photos?.length || 0);
    total += (inspection.rooms[roomId]?.moveOut?.photos?.length || 0);
  }
  return total;
}

// Empty phase shape for new room slots created during photo movement.
function blankPhase() {
  return { statuses: {}, notes: '', photos: [] };
}

// Mutator helper — produces a patch for updateInspection that runs mutateRoomsFn
// against a shallow copy of the rooms map. Each touched room is itself shallow-
// copied so reassigning a slot doesn't mutate the original record.
function mutateInspection(inspection, mutateRoomsFn) {
  const rooms = { ...inspection.rooms };
  for (const roomId of Object.keys(rooms)) {
    rooms[roomId] = { ...rooms[roomId] };
  }
  mutateRoomsFn(rooms);
  return { rooms };
}

// ─── Shared styles ─────────────────────────────────────────────────────────
const btnPrimary = {
  background: THEME.brand, color: THEME.mint50, border: 'none', borderRadius: 12,
  padding: '14px 18px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
};

const btnSecondary = {
  background: THEME.surface, color: THEME.ink,
  border: `1px solid ${THEME.edge}`, borderRadius: 12,
  padding: '14px 18px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
};

// Mid-strength action button used in the sticky bottom bar.
// Mint-tinted background, brand border so they read as "Photo Document
// scoped actions" — distinct from the primary green generate-PDF style.
const btnSecondaryAccent = {
  background: THEME.mint50, color: THEME.brand,
  border: `2px solid ${THEME.mint300}`, borderRadius: 12,
  padding: '13px 16px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
  width: '100%',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};

// "Save & Return" button — brand-outlined to read as a back-action.
const btnReturn = {
  background: THEME.mint100, color: THEME.brand,
  border: `2px solid ${THEME.brand}`, borderRadius: 12,
  padding: '12px 18px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
  width: '100%',
};

const modalBackdrop = {
  position: 'fixed', inset: 0, background: 'rgba(28, 25, 23, 0.7)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  zIndex: 2100, padding: 24,
};
