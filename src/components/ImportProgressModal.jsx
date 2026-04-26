// ═══════════════════════════════════════════════════════════════════════════
// ImportProgressModal.jsx — full-screen overlay during bundle import
// ═══════════════════════════════════════════════════════════════════════════

import { THEME } from '../lib/constants.js';

export default function ImportProgressModal({ info }) {
  const { fileName, progress } = info;
  const pct = progress && progress.total > 0
    ? Math.round((progress.done / progress.total) * 100)
    : null;

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'rgba(28, 25, 23, 0.85)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 2000, padding: 24,
    }}>
      <div style={{
        background: THEME.paper, borderRadius: 16, padding: 28,
        maxWidth: 360, width: '100%', textAlign: 'center',
        border: `2px solid ${THEME.brand}`,
        boxShadow: '0 20px 50px rgba(0,0,0,0.4)',
      }}>
        <div style={{ fontSize: 32, marginBottom: 10 }}>📥</div>
        <div style={{ fontSize: 16, fontWeight: 700, color: THEME.brand, marginBottom: 4 }}>
          Importing inspection
        </div>
        <div style={{
          fontSize: 11, color: THEME.muted, marginBottom: 18,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {fileName}
        </div>

        {progress ? (
          <>
            <div style={{
              background: THEME.surface, height: 8, borderRadius: 4, overflow: 'hidden',
              border: `1px solid ${THEME.edge}`, marginBottom: 10,
            }}>
              <div style={{
                background: THEME.brand2, height: '100%',
                width: `${pct || 0}%`, transition: 'width 0.2s ease-out',
              }} />
            </div>
            <div style={{ fontSize: 12, color: THEME.muted }}>
              {progress.done} of {progress.total} photos
              {progress.phase && (
                <span> · {progress.phase === 'moveIn' ? 'move-in' : 'move-out'}</span>
              )}
            </div>
          </>
        ) : (
          <div style={{ fontSize: 12, color: THEME.muted }}>Reading bundle…</div>
        )}
      </div>
    </div>
  );
}
