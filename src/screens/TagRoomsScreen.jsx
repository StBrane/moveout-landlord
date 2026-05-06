// ═══════════════════════════════════════════════════════════════════════════
// TagRoomsScreen.jsx — paint-mode room assignment for Photo Document grids
// v0.3.0
// ═══════════════════════════════════════════════════════════════════════════
// Sub-screen of PhotoDocGridScreen. Reached when the user taps the
// "Tag rooms" button on the grid action bar.
//
// Pattern (AgentSleek): pick a room chip from the top palette, then tap
// any photo to "paint" it with that room. Tapping with no chip active is
// a no-op (with a toast). Tap an already-painted photo with a different
// chip selected to reassign. Tap with the SAME chip active to clear back
// to "untagged" (no — too easy to mistap; instead the chip-tap is the only
// reassignment surface, and clearing happens by selecting the "Other" chip
// which puts it back in the default room slot).
//
// Photos move between room slots via the parent's `onMovePhoto(loc, toRoomId)`
// callback. The photo's slot is preserved (always 'moveOut' for Photo Doc
// records). Only the roomId changes.
//
// Layout:
//
//   ┌──────────────────────────────────────────┐
//   │ Header                                   │
//   │   ‹ Back to Photo Document               │
//   │   Tag rooms · 7/12 tagged                │
//   ├──────────────────────────────────────────┤
//   │ ROOM CHIP PALETTE (horizontal scroll)    │
//   │   [🚪 Entry (3)] [🛋️ Living (1)] ...     │
//   │   active chip: brand background, white   │
//   │   inactive: paper, ink                   │
//   │   chip with tally: shows count           │
//   ├──────────────────────────────────────────┤
//   │ TAGGING STATUS                           │
//   │   "Painting Living Room — tap photos"    │
//   │   (or "Pick a room above first")         │
//   ├──────────────────────────────────────────┤
//   │ FLAT PHOTO GRID (3-up)                   │
//   │   tap to assign to active room           │
//   │   ring color matches assigned room       │
//   ├──────────────────────────────────────────┤
//   │ STICKY BOTTOM                            │
//   │   [Skip & continue · N untagged]         │
//   │     ─ or ─                               │
//   │   [Done · all rooms tagged]              │
//   └──────────────────────────────────────────┘
//
// "Skip & continue" bulk-files all photos still in the default 'other' room
// — but since they're already in 'other', this is a no-op state-wise; it
// just navigates back. "Done" navigates back when everything's tagged.
// ═══════════════════════════════════════════════════════════════════════════

import { useState, useMemo, useCallback } from 'react';
import { THEME, ROOMS } from '../lib/constants.js';

// Room id used as the "untagged" home slot. Photos in this room get the
// special "untagged" treatment in PhotoDocGridScreen and TagRoomsScreen.
// Tagging a photo means moving it OUT of this room into another room.
const DEFAULT_ROOM_ID = 'other';

// Toast duration in ms — one-shot tip when user taps a photo without picking
// a chip first.
const TOAST_DURATION = 1600;

export default function TagRoomsScreen({
  property, inspection, photoCache, onMovePhoto, onBack,
}) {
  // Active chip — the room that subsequent photo taps will assign to.
  // null = no chip picked, photo taps trigger a toast hint.
  const [activeRoomId, setActiveRoomId] = useState(null);

  // Toast state for one-shot hints. Mostly used for "pick a room first" when
  // user taps a photo with no chip active.
  const [toast, setToast] = useState(null);
  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), TOAST_DURATION);
  }, []);

  // ─── Flat photo list with location pointers ─────────────────────────────
  // Same shape as PhotoDocGridScreen.collectAllPhotos: each entry is
  // { photo, roomId, slot, idx }. We flatten on every render — the inspection
  // changes shape with every tag op so memoization needs the full inspection
  // as a dep, but JSON.stringify it would be wasteful. Just compute fresh.
  const allPhotos = useMemo(() => {
    return collectAllPhotos(inspection);
  }, [inspection]);

  // ─── Tally photos per room for chip badges ─────────────────────────────
  // Exclude DEFAULT_ROOM_ID from the "tagged" count so the progress reads
  // as "rooms-tagged" not "photos-stored-anywhere".
  const tallyByRoom = useMemo(() => {
    const t = {};
    for (const entry of allPhotos) {
      t[entry.roomId] = (t[entry.roomId] || 0) + 1;
    }
    return t;
  }, [allPhotos]);

  const taggedCount = allPhotos.filter(e => e.roomId !== DEFAULT_ROOM_ID).length;
  const untaggedCount = allPhotos.length - taggedCount;
  const allTagged = allPhotos.length > 0 && untaggedCount === 0;

  // ─── Photo tap handler ─────────────────────────────────────────────────
  const handlePhotoTap = useCallback((entry) => {
    if (!activeRoomId) {
      showToast('Pick a room above first');
      return;
    }
    if (entry.roomId === activeRoomId) {
      // Already in this room — soft no-op with feedback
      showToast('Already in ' + (ROOMS.find(r => r.id === activeRoomId)?.name || activeRoomId));
      return;
    }
    onMovePhoto(entry, activeRoomId);
    if (navigator.vibrate) navigator.vibrate(5);
  }, [activeRoomId, onMovePhoto, showToast]);

  if (!inspection) {
    return (
      <div style={{ padding: 20, color: THEME.ink, background: THEME.bg, minHeight: '100vh' }}>
        <div style={{ marginBottom: 14 }}>Photo Document not found.</div>
        <button onClick={onBack} style={btnSecondary}>← Back</button>
      </div>
    );
  }

  // ─── Render ───────────────────────────────────────────────────────────
  return (
    <div style={{
      maxWidth: 720, margin: '0 auto',
      padding: 'calc(env(safe-area-inset-top) + 0px) 0 calc(env(safe-area-inset-bottom) + 32px) 0',
      minHeight: '100vh', background: THEME.bg,
    }}>
      {/* ─── Header ───────────────────────────────────────────────────── */}
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

        <h1 style={{
          margin: 0, fontSize: 19, fontWeight: 700, color: THEME.mint50,
          letterSpacing: '-0.2px',
        }}>
          Tag rooms
        </h1>
        <div style={{ fontSize: 12, color: THEME.mint200, marginTop: 4, opacity: 0.95 }}>
          {taggedCount}/{allPhotos.length} tagged
          {untaggedCount > 0 && ` · ${untaggedCount} untagged`}
        </div>
      </header>

      {/* ─── Room chip palette ────────────────────────────────────────── */}
      <div style={{
        padding: '0 14px',
        marginBottom: 10,
      }}>
        <div style={{
          fontSize: 10, fontWeight: 700, color: THEME.muted,
          textTransform: 'uppercase', letterSpacing: '0.08em',
          marginBottom: 8, paddingLeft: 4,
        }}>
          Pick a room, then tap photos
        </div>
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: 6,
          padding: 6,
          background: THEME.paper,
          borderRadius: 12,
          border: `1px solid ${THEME.edge}`,
        }}>
          {ROOMS.filter(r => r.id !== DEFAULT_ROOM_ID).map(r => {
            const count = tallyByRoom[r.id] || 0;
            const active = activeRoomId === r.id;
            return (
              <RoomChip
                key={r.id}
                room={r}
                count={count}
                active={active}
                onClick={() => setActiveRoomId(active ? null : r.id)}
              />
            );
          })}
          {/* "Other" chip pinned at the end — represents the default/untagged slot.
              Selecting it lets the user move photos BACK to untagged. */}
          {(() => {
            const r = ROOMS.find(x => x.id === DEFAULT_ROOM_ID);
            if (!r) return null;
            const count = tallyByRoom[DEFAULT_ROOM_ID] || 0;
            const active = activeRoomId === DEFAULT_ROOM_ID;
            return (
              <RoomChip
                key={r.id}
                room={r}
                count={count}
                active={active}
                muted
                onClick={() => setActiveRoomId(active ? null : r.id)}
              />
            );
          })()}
        </div>
      </div>

      {/* ─── Painting status ────────────────────────────────────────── */}
      <div style={{
        padding: '0 18px',
        fontSize: 12,
        color: activeRoomId ? THEME.brand2 : THEME.muted,
        marginBottom: 12,
        textAlign: 'center',
        minHeight: 18,
      }}>
        {activeRoomId ? (
          <span>
            🖌️ Painting{' '}
            <strong style={{ color: THEME.brand }}>
              {ROOMS.find(r => r.id === activeRoomId)?.name || activeRoomId}
            </strong>
            {' '}— tap photos below
          </span>
        ) : (
          <span>Pick a room chip to start tagging</span>
        )}
      </div>

      {/* ─── Photo grid ──────────────────────────────────────────────── */}
      {allPhotos.length === 0 ? (
        <div style={{
          padding: '48px 24px', textAlign: 'center',
          color: THEME.muted, fontSize: 13, lineHeight: 1.6,
        }}>
          No photos to tag yet. Capture some on the Photo Document screen first.
        </div>
      ) : (
        <div style={{ padding: '0 14px', marginBottom: 16 }}>
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 4, background: THEME.paper,
            borderRadius: 12, padding: 4,
            border: `1px solid ${THEME.edge}`,
          }}>
            {allPhotos.map((entry) => {
              const { photo, roomId } = entry;
              const src = photo.url || (photo.path ? photoCache[photo.path] : null);
              const isUntagged = roomId === DEFAULT_ROOM_ID;
              const isActiveTag = roomId === activeRoomId && !isUntagged;
              const roomLabel = ROOMS.find(r => r.id === roomId)?.name || roomId;
              return (
                <div
                  key={`${entry.roomId}_${entry.slot}_${entry.idx}`}
                  onClick={() => handlePhotoTap(entry)}
                  style={{
                    position: 'relative', aspectRatio: '1', overflow: 'hidden',
                    cursor: 'pointer', background: THEME.bg, borderRadius: 6,
                    outline: isActiveTag
                      ? `3px solid ${THEME.brand}`
                      : isUntagged
                      ? `2px dashed ${THEME.muted2}`
                      : 'none',
                    outlineOffset: '-2px',
                    transition: 'outline 0.12s, transform 0.08s',
                  }}
                >
                  {src ? (
                    <img src={src} alt="" style={{
                      width: '100%', height: '100%', objectFit: 'cover', display: 'block',
                      filter: isUntagged && activeRoomId ? 'brightness(0.92)' : 'none',
                    }} />
                  ) : (
                    <div style={{
                      height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 10, color: THEME.muted2,
                    }}>loading…</div>
                  )}

                  {/* Damaged badge — top-right (preserved across screens) */}
                  {photo.damaged && (
                    <div style={{
                      position: 'absolute', top: 4, right: 4,
                      background: THEME.danger, color: '#fff',
                      fontSize: 9, fontWeight: 800, padding: '2px 6px',
                      borderRadius: 8, boxShadow: '0 2px 4px rgba(0,0,0,0.4)',
                    }}>
                      ⚠
                    </div>
                  )}

                  {/* Room chip — bottom */}
                  <div style={{
                    position: 'absolute', bottom: 0, left: 0, right: 0,
                    background: isUntagged
                      ? 'linear-gradient(transparent, rgba(120,113,108,0.85))'
                      : 'linear-gradient(transparent, rgba(27,58,45,0.85))',
                    padding: '12px 6px 4px',
                  }}>
                    <div style={{
                      color: '#fff', fontSize: 9, fontWeight: 700,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
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
      )}

      {/* ─── Sticky bottom action ─────────────────────────────────────── */}
      <div style={{ padding: '0 14px' }}>
        {allPhotos.length === 0 ? (
          <button onClick={onBack} style={btnReturn}>
            ← Back to Photo Document
          </button>
        ) : allTagged ? (
          <button onClick={onBack} style={btnPrimaryAccent}>
            ✓ Done · all tagged
          </button>
        ) : (
          <>
            <button onClick={onBack} style={{ ...btnPrimaryAccent, marginBottom: 8 }}>
              Skip & continue · {untaggedCount} untagged
            </button>
            <div style={{
              fontSize: 11, color: THEME.muted2, textAlign: 'center', lineHeight: 1.6,
            }}>
              Untagged photos stay grouped under "Other" in your reports.
            </div>
          </>
        )}
      </div>

      {/* ─── Toast ──────────────────────────────────────────────────── */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          background: THEME.ink, color: THEME.mint50,
          padding: '10px 18px', borderRadius: 999,
          fontSize: 13, fontWeight: 600,
          boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
          zIndex: 100,
          maxWidth: 'calc(100% - 32px)',
        }}>
          {toast}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// RoomChip — single room option in the palette
// ═══════════════════════════════════════════════════════════════════════════
// Active chip is brand-bg + mint-text, inactive is paper-bg + ink.
// `muted` variant for the "Other" chip — visually distinguishes the
// default-untagged slot without making it look unselectable.
function RoomChip({ room, count, active, muted, onClick }) {
  return (
    <button onClick={onClick} style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '8px 12px',
      borderRadius: 999,
      border: active
        ? `2px solid ${THEME.brand}`
        : `1.5px solid ${muted ? THEME.muted2 : THEME.edge}`,
      background: active
        ? THEME.brand
        : muted
        ? THEME.surface
        : THEME.bg,
      color: active
        ? THEME.mint50
        : muted
        ? THEME.muted
        : THEME.ink,
      fontSize: 13,
      fontWeight: active ? 700 : 600,
      cursor: 'pointer',
      transition: 'background 0.12s, color 0.12s, border 0.12s',
      whiteSpace: 'nowrap',
    }}>
      <span style={{ fontSize: 14 }}>{room.icon}</span>
      <span>{room.name}</span>
      {count > 0 && (
        <span style={{
          background: active ? THEME.mint50 : THEME.brand,
          color: active ? THEME.brand : THEME.mint50,
          borderRadius: 999,
          padding: '1px 7px',
          fontSize: 10,
          fontWeight: 800,
          minWidth: 16, textAlign: 'center',
        }}>
          {count}
        </span>
      )}
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

// Walk inspection.rooms[*][slot].photos → flat list with location pointers.
// Sorted newest-first by ts string.
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

// Primary call-to-action when the user has work to commit.
// Forest brand background with mint text — matches "Generate PDF" weight.
const btnPrimaryAccent = {
  background: THEME.brand, color: THEME.mint50,
  border: 'none', borderRadius: 12,
  padding: '14px 18px', fontSize: 15, fontWeight: 700, cursor: 'pointer',
  width: '100%',
};

const btnReturn = {
  background: THEME.mint100, color: THEME.brand,
  border: `2px solid ${THEME.brand}`, borderRadius: 12,
  padding: '12px 18px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
  width: '100%',
};
