// ═══════════════════════════════════════════════════════════════════════════
// CaptureScreen.jsx — room-by-room inspection capture UI
// ═══════════════════════════════════════════════════════════════════════════
// Full-screen route: #/capture/{propertyId}/{inspectionId}
//
// Layout (mirrors tenant app's room screen pattern):
//
//   ┌──────────────────────────────────────────┐
//   │ Forest header: ‹ Back · Inspection name  │
//   │   sub: "Baseline · 23/25 rated · 📸 12"  │
//   ├──────────────────────────────────────────┤
//   │ Room list (chips)                        │
//   │ [🚪 Entry] [🛋️ Living] [🍳 Kitchen] ... │
//   ├──────────────────────────────────────────┤
//   │ ACTIVE ROOM: Living Room                 │
//   │                                          │
//   │ Items card                               │
//   │   Walls — holes, scuffs, stains          │
//   │   [✦ Clean] [✓ Fair] [⚠ Damaged] [— N/A] │
//   │   ...                                    │
//   │                                          │
//   │ Notes card (textarea, auto-save)         │
//   │                                          │
//   │ Photos card (capture button + gallery)   │
//   └──────────────────────────────────────────┘
//
// Auto-save: every status toggle, every notes keystroke (debounced 250ms),
// every captured photo writes to the portfolio store immediately. Backing
// out of the screen never loses work.
//
// Photo capture: getUserMedia → canvas snap → EXIF stamp → save to disk →
// optional gallery copy. Same pipeline as tenant.
// ═══════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';

import {
  THEME, ROOMS, STATUS, inspectionTypeById,
  inspectionMetrics, formatDate,
} from '../lib/constants.js';
import {
  getProperty, getInspection, updateInspection,
} from '../lib/portfolioStore.js';
import {
  stampExif, getGPS, snapFromVideo, saveToGallery,
  shouldShowPhotoPrimer, markPhotoPrimerSeen, buildPhotoDescription,
} from '../lib/photoCapture.js';

const IS_NATIVE = Capacitor.isNativePlatform();

export default function CaptureScreen({
  portfolio, setPortfolio, propertyId, inspectionId,
  onBack, photoStore,
}) {
  const property = getProperty(portfolio, propertyId);
  const inspection = getInspection(portfolio, propertyId, inspectionId);

  // Find which tenancy (if any) this inspection belongs to
  const tenancy = useMemo(() => {
    if (!property || !inspection?.tenancyId) return null;
    return property.tenancies.find(t => t.id === inspection.tenancyId) || null;
  }, [property, inspection]);

  const typeEntry = inspection ? inspectionTypeById(inspection.type) : null;
  const slot = typeEntry?.defaultSlot || 'moveIn';

  const [activeRoomId, setActiveRoomId] = useState(ROOMS[0].id);
  const [notesDraft, setNotesDraft] = useState('');     // debounced — committed to portfolio after delay
  const [photoCache, setPhotoCache] = useState({});     // path → object URL

  // Camera state
  const [camOpen, setCamOpen] = useState(false);
  const [stream, setStream] = useState(null);
  const [facing, setFacing] = useState('environment');
  const [flash, setFlash] = useState(false);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  // iOS Photos primer
  const [photoPrimer, setPhotoPrimer] = useState(false);

  // Lightbox for viewing photos full-size
  const [lightbox, setLightbox] = useState(null);  // {idx} | null

  // Sync notesDraft when active room or inspection changes
  useEffect(() => {
    if (!inspection) return;
    setNotesDraft(inspection.rooms?.[activeRoomId]?.[slot]?.notes || '');
  }, [activeRoomId, inspection?.id, slot]);

  // Debounced notes save — every 250ms after last keystroke, push to portfolio
  useEffect(() => {
    if (!inspection) return;
    const current = inspection.rooms?.[activeRoomId]?.[slot]?.notes || '';
    if (notesDraft === current) return;

    const t = setTimeout(() => {
      const next = updateInspection(portfolio, propertyId, inspectionId, mutateInspection(inspection, (rooms) => {
        rooms[activeRoomId] = {
          ...rooms[activeRoomId],
          [slot]: {
            ...rooms[activeRoomId][slot],
            notes: notesDraft,
          },
        };
      }));
      setPortfolio(next);
    }, 250);

    return () => clearTimeout(t);
  }, [notesDraft, activeRoomId, slot]);

  // Resolve photos to displayable URLs (via PhotoStore.toWebUrl on native)
  useEffect(() => {
    if (!inspection || !photoStore) return;
    const photos = inspection.rooms?.[activeRoomId]?.[slot]?.photos || [];
    let cancelled = false;
    (async () => {
      const updates = {};
      for (const p of photos) {
        if (p.path && !photoCache[p.path]) {
          const url = await photoStore.toWebUrl(p.path);
          if (url) updates[p.path] = url;
        }
      }
      if (!cancelled && Object.keys(updates).length > 0) {
        setPhotoCache(prev => ({ ...prev, ...updates }));
      }
    })();
    return () => { cancelled = true; };
  }, [activeRoomId, slot, inspection?.rooms?.[activeRoomId]?.[slot]?.photos?.length]);

  // Stop camera stream on unmount
  useEffect(() => () => {
    stream?.getTracks().forEach(t => t.stop());
  }, [stream]);

  if (!property || !inspection) {
    return (
      <div style={{ padding: 20, color: THEME.ink, background: THEME.bg, minHeight: '100vh' }}>
        <div style={{ marginBottom: 14 }}>Inspection not found.</div>
        <button onClick={onBack} style={btnSecondary}>← Back</button>
      </div>
    );
  }

  if (!inspection.editable) {
    return (
      <div style={{ padding: 20, color: THEME.ink, background: THEME.bg, minHeight: '100vh' }}>
        <div style={{ marginBottom: 14 }}>
          This inspection was imported from a tenant bundle and is read-only.<br/>
          Editing imported tenant data could invalidate it as evidence.
        </div>
        <button onClick={onBack} style={btnSecondary}>← Back</button>
      </div>
    );
  }

  const activeRoom = ROOMS.find(r => r.id === activeRoomId);
  const phaseData = inspection.rooms?.[activeRoomId]?.[slot] || { statuses: {}, notes: '', photos: [] };
  const totalMetrics = inspectionMetrics(inspection);

  // ─── Status toggle ─────────────────────────────────────────────────────
  const handleStatusToggle = (itemIdx, statusKey) => {
    const current = phaseData.statuses[itemIdx];
    const nextStatus = current === statusKey ? null : statusKey;
    const next = updateInspection(portfolio, propertyId, inspectionId, mutateInspection(inspection, (rooms) => {
      const phase = rooms[activeRoomId][slot];
      const statuses = { ...phase.statuses };
      if (nextStatus == null) delete statuses[itemIdx];
      else statuses[itemIdx] = nextStatus;
      rooms[activeRoomId] = { ...rooms[activeRoomId], [slot]: { ...phase, statuses } };
    }));
    setPortfolio(next);
  };

  // ─── Photo capture flow ────────────────────────────────────────────────
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

  const openCam = async () => {
    setCamOpen(true);
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing, width: { ideal: 1920 } },
      });
      setStream(s);
    } catch (err) {
      setCamOpen(false);
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        alert('Camera permission denied — enable it in Settings → Apps → MoveOut Shield Landlord → Permissions → Camera');
      } else {
        alert('Camera unavailable: ' + (err.message || 'unknown error'));
      }
    }
  };

  // Wire stream to video element when both are ready
  useEffect(() => {
    if (stream && videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);

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
      roomLabel: activeRoom.name,
      phaseLabel: slot === 'moveIn' ? 'Move-In' : 'Move-Out',
      inspectionType: typeEntry?.label,
    });
    const stampedUrl = stampExif(dataUrl, {
      lat: gps.lat, lng: gps.lng, when: new Date(), description,
    });

    let photo;
    if (IS_NATIVE && photoStore) {
      const saved = await photoStore.save(inspectionId, activeRoomId, slot, stampedUrl);
      if (saved) {
        photo = { path: saved.path, ts, lat: gps.lat, lng: gps.lng, ratio };
        // Pre-warm cache so photo appears instantly
        const webUrl = await photoStore.toWebUrl(saved.path);
        if (webUrl) setPhotoCache(prev => ({ ...prev, [saved.path]: webUrl }));
        // Best-effort save to system gallery (non-blocking)
        saveToGallery(stampedUrl, saved.path).catch(() => {});
      }
    } else {
      // Web fallback: stash data URL directly. Won't survive page reload.
      photo = { url: stampedUrl, ts, lat: gps.lat, lng: gps.lng, ratio };
    }

    if (!photo) return;

    const next = updateInspection(portfolio, propertyId, inspectionId, mutateInspection(inspection, (rooms) => {
      const phase = rooms[activeRoomId][slot];
      rooms[activeRoomId] = {
        ...rooms[activeRoomId],
        [slot]: { ...phase, photos: [...phase.photos, photo] },
      };
    }));
    setPortfolio(next);
  };

  const deletePhoto = (idx) => {
    const photo = phaseData.photos[idx];
    if (!confirm('Delete this photo?')) return;
    if (photo?.path && photoStore) {
      photoStore.remove(photo.path).catch(() => {});
    }
    const next = updateInspection(portfolio, propertyId, inspectionId, mutateInspection(inspection, (rooms) => {
      const phase = rooms[activeRoomId][slot];
      rooms[activeRoomId] = {
        ...rooms[activeRoomId],
        [slot]: { ...phase, photos: phase.photos.filter((_, i) => i !== idx) },
      };
    }));
    setPortfolio(next);
    setLightbox(null);
  };

  const ratedHere = Object.keys(phaseData.statuses).length;
  const phaseLabel = slot === 'moveIn' ? 'Move-In' : 'Move-Out';
  const phaseColor = slot === 'moveIn' ? THEME.tenant : THEME.brand2;
  const phaseAccentBg = slot === 'moveIn' ? '#DBEAFE' : THEME.mint200;

  return (
    <div style={{
      maxWidth: 720, margin: '0 auto',
      padding: 'calc(env(safe-area-inset-top) + 0px) 0 calc(env(safe-area-inset-bottom) + 32px) 0',
      minHeight: '100vh', background: THEME.bg,
    }}>
      {/* ─── Forest header ──────────────────────────────────────────────── */}
      <header style={{
        background: THEME.brand, color: THEME.mint50,
        padding: 'calc(env(safe-area-inset-top) + 14px) 18px 18px 18px',
        borderBottomLeftRadius: 18, borderBottomRightRadius: 18,
        marginBottom: 14,
      }}>
        <button onClick={onBack} style={{
          background: 'rgba(255,255,255,0.1)', color: THEME.mint100,
          border: `1px solid ${THEME.mint400}`, borderRadius: 999,
          padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
          marginBottom: 12, display: 'inline-flex', alignItems: 'center', gap: 6,
        }}>
          <span style={{ fontSize: 14 }}>‹</span> {property.name}
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 26 }}>{typeEntry?.icon}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 style={{
              margin: 0, fontSize: 18, fontWeight: 700, color: THEME.mint50,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {inspection.label}
            </h1>
            <div style={{ fontSize: 11, color: THEME.mint200, marginTop: 2, opacity: 0.95 }}>
              {typeEntry?.label} · {phaseLabel} · {totalMetrics.possible > 0 ? `${Math.round((totalMetrics.rated / totalMetrics.possible) * 100)}% rated` : '—'} · 📸 {totalMetrics.photos}
            </div>
          </div>
        </div>
      </header>

      <div style={{ padding: '0 14px' }}>

        {/* ─── Room chip selector ──────────────────────────────────────── */}
        <div style={{
          display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14,
        }}>
          {ROOMS.map(rm => {
            const isActive = rm.id === activeRoomId;
            const rmPhase = inspection.rooms?.[rm.id]?.[slot];
            const rmRated = rmPhase ? Object.keys(rmPhase.statuses).length : 0;
            const rmPhotos = rmPhase?.photos?.length || 0;
            const hasContent = rmRated > 0 || rmPhotos > 0 || (rmPhase?.notes || '').trim().length > 0;
            return (
              <button
                key={rm.id}
                onClick={() => setActiveRoomId(rm.id)}
                style={{
                  background: isActive ? THEME.brand : (hasContent ? THEME.mint100 : THEME.paper),
                  color: isActive ? THEME.mint50 : (hasContent ? THEME.brand : THEME.muted),
                  border: `1px solid ${isActive ? THEME.brand : (hasContent ? THEME.mint300 : THEME.edge)}`,
                  borderRadius: 999, padding: '8px 14px',
                  fontSize: 13, fontWeight: 600, cursor: 'pointer',
                  whiteSpace: 'nowrap', flexShrink: 0,
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                }}
              >
                <span>{rm.icon}</span>
                <span>{rm.name}</span>
                {hasContent && (
                  <span style={{
                    background: isActive ? 'rgba(255,255,255,0.25)' : THEME.mint300,
                    color: isActive ? THEME.mint50 : THEME.brand,
                    fontSize: 10, padding: '1px 6px', borderRadius: 999, fontWeight: 700,
                  }}>
                    {Math.round((rmRated / rm.items.length) * 100)}%
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* ─── Progress bar ─────────────────────────────────────────────── */}
        <div style={{
          background: THEME.surface, borderRadius: 8, height: 5,
          marginBottom: 14, overflow: 'hidden',
        }}>
          <div style={{
            background: phaseColor, height: '100%', borderRadius: 8,
            transition: 'width 0.3s',
            width: `${Math.round((ratedHere / activeRoom.items.length) * 100)}%`,
          }} />
        </div>

        {/* ─── Items card ──────────────────────────────────────────────── */}
        <div style={card}>
          <div style={{
            padding: '10px 14px', background: phaseAccentBg,
            borderBottom: `1px solid ${THEME.edge}`,
            fontSize: 10.5, fontWeight: 700, color: phaseColor,
            letterSpacing: '0.1em', textTransform: 'uppercase',
          }}>
            {activeRoom.icon} {activeRoom.name} · {Math.round((ratedHere / activeRoom.items.length) * 100)}% rated
          </div>
          {activeRoom.items.map((item, i) => {
            const st = phaseData.statuses[i];
            return (
              <div key={i} style={{
                padding: '12px 14px',
                borderBottom: i < activeRoom.items.length - 1 ? `1px solid ${THEME.edge}` : 'none',
              }}>
                <div style={{
                  fontSize: 13.5, color: THEME.inkSoft, marginBottom: 8, lineHeight: 1.4,
                }}>{item}</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {Object.entries(STATUS).map(([key, cfg]) => (
                    <button
                      key={key}
                      onClick={() => handleStatusToggle(i, key)}
                      style={{
                        padding: '6px 12px', borderRadius: 20,
                        fontSize: 12, fontWeight: 600,
                        background: st === key ? cfg.bg : THEME.bg,
                        color: st === key ? cfg.fg : THEME.muted2,
                        border: `1.5px solid ${st === key ? cfg.ring : THEME.edge}`,
                        boxShadow: st === key ? `0 0 0 2px ${cfg.ring}` : 'none',
                        transform: st === key ? 'scale(1.06)' : 'scale(1)',
                        transition: 'all 0.12s',
                        cursor: 'pointer',
                      }}
                    >
                      {cfg.label}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* ─── Notes card ───────────────────────────────────────────────── */}
        <div style={card}>
          <div style={{
            padding: '10px 14px', background: THEME.surface,
            borderBottom: `1px solid ${THEME.edge}`,
            fontSize: 10.5, fontWeight: 700, color: THEME.muted,
            letterSpacing: '0.1em', textTransform: 'uppercase',
          }}>
            Notes — auto-saved
          </div>
          <textarea
            value={notesDraft}
            onChange={e => setNotesDraft(e.target.value)}
            placeholder="Anything specific to remember about this room…"
            style={{
              width: '100%', padding: '13px 14px', fontSize: 13.5,
              color: THEME.inkSoft, border: 'none', minHeight: 80,
              lineHeight: 1.6, background: THEME.paper, outline: 'none',
              boxSizing: 'border-box', resize: 'vertical',
              fontFamily: 'inherit',
            }}
          />
        </div>

        {/* ─── Photos card ──────────────────────────────────────────────── */}
        <div style={card}>
          <div style={{
            padding: '10px 14px', background: THEME.surface,
            borderBottom: `1px solid ${THEME.edge}`,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <span style={{
              fontSize: 10.5, fontWeight: 700, color: THEME.muted,
              letterSpacing: '0.1em', textTransform: 'uppercase',
            }}>
              Photos ({phaseData.photos.length}) · GPS tagged
            </span>
            <button
              onClick={requestOpenCam}
              style={{
                background: THEME.brand, color: THEME.mint50,
                borderRadius: 20, padding: '6px 14px',
                fontSize: 12, fontWeight: 600, cursor: 'pointer',
                border: 'none',
              }}
            >
              📷 Camera
            </button>
          </div>
          {phaseData.photos.length === 0 ? (
            <div
              onClick={requestOpenCam}
              style={{
                padding: '32px 16px', textAlign: 'center',
                color: THEME.muted2, fontSize: 13, cursor: 'pointer',
                background: THEME.paper,
              }}
            >
              <div style={{ fontSize: 32, marginBottom: 6 }}>📷</div>
              Tap Camera to add GPS-tagged photos
            </div>
          ) : (
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 2, padding: 2, background: THEME.paper,
            }}>
              {phaseData.photos.map((p, i) => {
                const src = p.url || (p.path ? photoCache[p.path] : null);
                return (
                  <div
                    key={i}
                    onClick={() => setLightbox({ idx: i })}
                    style={{
                      position: 'relative', aspectRatio: '1', overflow: 'hidden',
                      cursor: 'pointer', background: THEME.bg,
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
                    <div style={{
                      position: 'absolute', bottom: 0, left: 0, right: 0,
                      background: 'rgba(0,0,0,0.6)', padding: '2px 4px',
                    }}>
                      <div style={{ color: '#fff', fontSize: 9 }}>{p.ts}</div>
                      {p.lat && <div style={{ color: THEME.mint300, fontSize: 8 }}>📍 GPS</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <button onClick={onBack} style={{ ...btnReturn, marginTop: 18 }}>
          ← Done — Return to Property
        </button>

        <div style={{ textAlign: 'center', fontSize: 10, color: THEME.muted2, marginTop: 14 }}>
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
          phaseLabel={phaseLabel}
          roomName={activeRoom.name}
        />
      )}

      {/* ─── iOS Photos primer ────────────────────────────────────────── */}
      {photoPrimer && (
        <PhotoPrimer onContinue={dismissPhotoPrimer} />
      )}

      {/* ─── Lightbox ─────────────────────────────────────────────────── */}
      {lightbox && phaseData.photos[lightbox.idx] && (
        <Lightbox
          photo={phaseData.photos[lightbox.idx]}
          src={
            phaseData.photos[lightbox.idx].url ||
            photoCache[phaseData.photos[lightbox.idx].path]
          }
          onClose={() => setLightbox(null)}
          onDelete={() => deletePhoto(lightbox.idx)}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// CameraOverlay — fullscreen camera view with snap, flip, close buttons
// ═══════════════════════════════════════════════════════════════════════════
function CameraOverlay({ videoRef, flash, onClose, onFlip, onSnap, phaseLabel, roomName }) {
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
          {roomName} · {phaseLabel}
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
        padding: '14px 18px calc(env(safe-area-inset-bottom) + 18px) 18px',
        background: 'rgba(0,0,0,0.6)',
        display: 'flex', justifyContent: 'center',
      }}>
        <button onClick={onSnap} style={{
          background: '#fff', border: '4px solid rgba(255,255,255,0.6)',
          width: 72, height: 72, borderRadius: '50%',
          cursor: 'pointer', boxShadow: '0 4px 14px rgba(0,0,0,0.4)',
        }} />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PhotoPrimer — explains why we want Photos library access on iOS
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
// Lightbox — full-size photo with metadata, delete option
// ═══════════════════════════════════════════════════════════════════════════
function Lightbox({ photo, src, onClose, onDelete }) {
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
        <div>📅 {photo.ts}</div>
        {photo.lat && <div>📍 GPS: {photo.lat}, {photo.lng}</div>}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Helper — produce a patch object for updateInspection that mutates rooms
// ═══════════════════════════════════════════════════════════════════════════
function mutateInspection(inspection, mutateRoomsFn) {
  const rooms = { ...inspection.rooms };
  // Deep-ish copy each room being potentially modified
  for (const roomId of Object.keys(rooms)) {
    rooms[roomId] = { ...rooms[roomId] };
  }
  mutateRoomsFn(rooms);
  return { rooms };
}

// ─── Shared styles ─────────────────────────────────────────────────────────
const card = {
  background: THEME.paper, borderRadius: 14, overflow: 'hidden',
  marginBottom: 14, border: `1px solid ${THEME.edge}`,
};

const btnPrimary = {
  background: THEME.brand, color: THEME.mint50, border: 'none', borderRadius: 12,
  padding: '14px 18px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
};

const btnSecondary = {
  background: THEME.surface, color: THEME.ink,
  border: `1px solid ${THEME.edge}`, borderRadius: 12,
  padding: '14px 18px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
  width: '100%',
};

// "Done" button at the bottom of the capture screen. Brand-outlined so it
// reads as a back-action, distinct from the beige cards above it.
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
