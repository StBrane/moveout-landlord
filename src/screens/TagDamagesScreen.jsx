// ═══════════════════════════════════════════════════════════════════════════
// TagDamagesScreen.jsx — flag photos as damage evidence
// v0.3.0
// ═══════════════════════════════════════════════════════════════════════════
// Sub-screen of PhotoDocGridScreen. Reached when the user taps the
// "Tag damages" button on the grid action bar.
//
// Pattern (CobaltBalancer's tagDamage modal): tap any photo to toggle its
// `damaged: true/false` flag. Flagged photos surface in the PDF builder's
// "Items Flagged" section as a 4-up evidence gallery with a FLAGGED badge.
// This is independent of the per-item Clean/Fair/Damaged pill statuses on
// CaptureScreen — a photo can be flagged without any item being marked
// damaged, and vice versa. The two systems are intentionally orthogonal.
//
// Photos stay in their assigned room while flagging — only `photo.damaged`
// flips. Room/slot location is preserved.
//
// Layout:
//
//   ┌──────────────────────────────────────────┐
//   │ Header                                   │
//   │   ‹ Photo Document                       │
//   │   Tag damages · 4 flagged                │
//   ├──────────────────────────────────────────┤
//   │ Helper text                              │
//   │   "Tap any photo showing damage"         │
//   │   "Untouched photos = clean"             │
//   ├──────────────────────────────────────────┤
//   │ FLAT PHOTO GRID (3-up, dark theme)       │
//   │   flagged: red 3px outline, normal br.   │
//   │   unflagged: dimmed brightness           │
//   │   FLAGGED badge top-right when active    │
//   │   room chip preserved at bottom          │
//   ├──────────────────────────────────────────┤
//   │ STICKY BOTTOM                            │
//   │   [✓ Done — N flagged]                   │
//   └──────────────────────────────────────────┘
//
// "Done" navigates back regardless of state — flagging is fully optional and
// any number of flags (including zero) is a valid commit. The screen exists
// to surface a fast tap-grid review path; the user has full freedom over
// what they flag.
// ═══════════════════════════════════════════════════════════════════════════

import { useMemo, useCallback } from 'react';
import { THEME, ROOMS } from '../lib/constants.js';

// Same convention as PhotoDocGridScreen / TagRoomsScreen — photos in this
// room slot are visually shown as "untagged" rather than under their room
// name. Tag Damages doesn't move photos between rooms; this is just the
// label-resolution rule for the bottom chip.
const DEFAULT_ROOM_ID = 'other';

export default function TagDamagesScreen({
  property, inspection, photoCache, onToggleDamage, onBack,
}) {
  // Flat list of every photo with location pointers. Damage tagging needs
  // the same (roomId, slot, idx) shape so onToggleDamage can target the
  // right photo across the inspection's room slots.
  const allPhotos = useMemo(() => collectAllPhotos(inspection), [inspection]);

  const flaggedCount = allPhotos.filter(e => e.photo.damaged).length;

  // ─── Tap handler ────────────────────────────────────────────────────
  const handlePhotoTap = useCallback((entry) => {
    onToggleDamage(entry);
    if (navigator.vibrate) navigator.vibrate(5);
  }, [onToggleDamage]);

  if (!inspection) {
    return (
      <div style={{ padding: 20, color: THEME.ink, background: THEME.bg, minHeight: '100vh' }}>
        <div style={{ marginBottom: 14 }}>Photo Document not found.</div>
        <button onClick={onBack} style={btnSecondary}>← Back</button>
      </div>
    );
  }

  // ─── Render ─────────────────────────────────────────────────────────
  // Background uses a darker shade than other screens — the tagDamage UI
  // in CobaltBalancer used a near-black background to make flagged-vs-clean
  // photos read with high contrast. We use THEME.ink with mint-50 text to
  // keep it on-theme while still pulling that contrast trick.
  return (
    <div style={{
      maxWidth: 720, margin: '0 auto',
      padding: 'calc(env(safe-area-inset-top) + 0px) 0 calc(env(safe-area-inset-bottom) + 32px) 0',
      minHeight: '100vh', background: THEME.ink, color: THEME.mint50,
    }}>
      {/* ─── Header ────────────────────────────────────────────────── */}
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
          marginBottom: 12, display: 'inline-flex', alignItems: 'center', gap: 6,
        }}>
          <span style={{ fontSize: 14 }}>‹</span> Photo Document
        </button>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div>
            <h1 style={{
              margin: 0, fontSize: 19, fontWeight: 700, color: THEME.mint50,
              letterSpacing: '-0.2px',
            }}>
              Tag damages
            </h1>
            <div style={{ fontSize: 12, color: THEME.mint200, marginTop: 4, opacity: 0.95 }}>
              Tap any photo showing damage · Independent of pill ratings
            </div>
          </div>
          <div style={{
            background: flaggedCount > 0 ? THEME.danger : 'rgba(255,255,255,0.15)',
            color: '#fff', borderRadius: 999,
            padding: '6px 14px', fontSize: 13, fontWeight: 700,
            whiteSpace: 'nowrap',
          }}>
            {flaggedCount > 0 ? `⚠ ${flaggedCount} flagged` : '0 flagged'}
          </div>
        </div>
      </header>

      {/* ─── Helper banner ──────────────────────────────────────────── */}
      <div style={{
        margin: '0 14px 14px 14px',
        padding: '10px 14px',
        background: 'rgba(255,255,255,0.06)',
        borderLeft: `3px solid ${THEME.mint400}`,
        borderRadius: 8,
        fontSize: 12, lineHeight: 1.55,
        color: THEME.mint200,
      }}>
        Tap a photo to toggle its damage flag.
        Flagged photos appear in the <strong style={{ color: THEME.mint50 }}>Items Flagged</strong> section
        of any PDF you generate from this record.
      </div>

      {/* ─── Empty state ──────────────────────────────────────────── */}
      {allPhotos.length === 0 ? (
        <div style={{
          padding: '48px 24px', textAlign: 'center',
          color: THEME.mint200, fontSize: 13, lineHeight: 1.6,
        }}>
          No photos to flag yet. Capture some on the Photo Document screen first.
          <div style={{ marginTop: 18 }}>
            <button onClick={onBack} style={btnReturnDark}>
              ← Back to Photo Document
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* ─── Photo grid ────────────────────────────────────────── */}
          <div style={{ padding: '0 14px', marginBottom: 16 }}>
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 4, background: 'rgba(0,0,0,0.4)',
              borderRadius: 12, padding: 4,
              border: `1px solid rgba(255,255,255,0.08)`,
            }}>
              {allPhotos.map((entry) => {
                const { photo, roomId } = entry;
                const src = photo.url || (photo.path ? photoCache[photo.path] : null);
                const isUntagged = roomId === DEFAULT_ROOM_ID;
                const roomLabel = ROOMS.find(r => r.id === roomId)?.name || roomId;
                return (
                  <div
                    key={`${entry.roomId}_${entry.slot}_${entry.idx}`}
                    onClick={() => handlePhotoTap(entry)}
                    style={{
                      position: 'relative', aspectRatio: '1', overflow: 'hidden',
                      cursor: 'pointer', background: '#000', borderRadius: 6,
                      outline: photo.damaged ? `3px solid ${THEME.danger}` : 'none',
                      outlineOffset: '-2px',
                      transition: 'outline 0.12s, transform 0.08s',
                      transform: photo.damaged ? 'scale(0.97)' : 'scale(1)',
                    }}
                  >
                    {src ? (
                      <img src={src} alt="" style={{
                        width: '100%', height: '100%', objectFit: 'cover', display: 'block',
                        // Dim unflagged photos slightly — flagged ones snap to full brightness
                        // so the eye picks them out instantly. Same pattern as CobaltBalancer.
                        filter: photo.damaged ? 'none' : 'brightness(0.78)',
                        transition: 'filter 0.12s',
                      }} />
                    ) : (
                      <div style={{
                        height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 10, color: THEME.muted2,
                      }}>loading…</div>
                    )}

                    {/* FLAGGED badge — only visible when active */}
                    {photo.damaged && (
                      <div style={{
                        position: 'absolute', top: 6, right: 6,
                        background: THEME.danger, color: '#fff',
                        fontSize: 10, fontWeight: 800, padding: '3px 8px',
                        borderRadius: 12, boxShadow: '0 2px 6px rgba(0,0,0,0.5)',
                        letterSpacing: '0.04em',
                      }}>
                        ⚠ FLAGGED
                      </div>
                    )}

                    {/* Room chip — bottom — preserved across screens for consistency */}
                    <div style={{
                      position: 'absolute', bottom: 0, left: 0, right: 0,
                      background: 'linear-gradient(transparent, rgba(0,0,0,0.85))',
                      padding: '12px 6px 4px',
                    }}>
                      <div style={{
                        color: '#fff', fontSize: 9, fontWeight: 700,
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        opacity: isUntagged ? 0.6 : 0.95,
                        letterSpacing: '0.02em',
                      }}>
                        {isUntagged ? '— UNTAGGED' : roomLabel.toUpperCase()}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ─── Sticky bottom ──────────────────────────────────────── */}
          <div style={{ padding: '0 14px' }}>
            <button onClick={onBack} style={btnPrimaryDanger}>
              {flaggedCount > 0
                ? `✓ Done · ${flaggedCount} flagged`
                : 'Done · no flags'}
            </button>
            {flaggedCount > 0 && (
              <div style={{
                fontSize: 11, color: THEME.mint200, opacity: 0.7,
                textAlign: 'center', lineHeight: 1.6, marginTop: 8,
              }}>
                Flagged photos will appear in your generated PDFs.
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

// Walk inspection.rooms[*][slot].photos → flat list with location pointers.
// Newest-first by ts. Same logic as PhotoDocGridScreen and TagRoomsScreen
// — duplicated rather than shared because each file's needs are simple
// enough that a shared helper module would add more import surface than
// it saves in lines.
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
  out.sort((a, b) => parseTs(b.photo.ts) - parseTs(a.photo.ts));
  return out;
}

function parseTs(ts) {
  if (!ts) return 0;
  const t = new Date(ts).getTime();
  return Number.isFinite(t) ? t : 0;
}

// ─── Shared styles ─────────────────────────────────────────────────────────
const btnSecondary = {
  background: THEME.surface, color: THEME.ink,
  border: `1px solid ${THEME.edge}`, borderRadius: 12,
  padding: '12px 18px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
};

// Primary done button on the dark Tag Damages screen.
// Uses brand2 (lighter forest green) so it has more punch on the dark bg.
const btnPrimaryDanger = {
  background: THEME.brand2, color: THEME.mint50,
  border: 'none', borderRadius: 12,
  padding: '14px 18px', fontSize: 15, fontWeight: 700, cursor: 'pointer',
  width: '100%',
};

// Back button styled for the dark background — light/glassy.
const btnReturnDark = {
  background: 'rgba(255,255,255,0.1)', color: THEME.mint50,
  border: `1.5px solid ${THEME.mint400}`, borderRadius: 12,
  padding: '12px 18px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
  width: 'auto',
};
