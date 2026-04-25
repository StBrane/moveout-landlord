// ═══════════════════════════════════════════════════════════════════════════
// ImportProgressModal.jsx — full-screen overlay shown during bundle import
// ═══════════════════════════════════════════════════════════════════════════

import { THEME } from '../lib/constants';

export default function ImportProgressModal({ info }) {
  const { fileName, progress } = info;
  const pct = progress && progress.total > 0
    ? Math.round((progress.done / progress.total) * 100)
    : null;

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'rgba(15, 23, 42, 0.95)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 2000, padding: 24,
    }}>
      <div style={{
        background: THEME.bgCard, borderRadius: 16, padding: 28,
        maxWidth: 360, width: '100%', textAlign: 'center',
        border: `1px solid ${THEME.border}`,
      }}>
        <div style={{ fontSize: 32, marginBottom: 10 }}>📥</div>
        <div style={{ fontSize: 16, fontWeight: 700, color: THEME.text, marginBottom: 4 }}>
          Importing inspection
        </div>
        <div style={{
          fontSize: 11, color: THEME.textDim, marginBottom: 18,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {fileName}
        </div>

        {progress ? (
          <>
            <div style={{
              background: THEME.bg, height: 8, borderRadius: 4, overflow: 'hidden',
              border: `1px solid ${THEME.border}`, marginBottom: 10,
            }}>
              <div style={{
                background: THEME.accent, height: '100%',
                width: `${pct || 0}%`, transition: 'width 0.2s ease-out',
              }} />
            </div>
            <div style={{ fontSize: 12, color: THEME.textDim }}>
              {progress.done} of {progress.total} photos
              {progress.phase && (
                <span> · {progress.phase === 'moveIn' ? 'move-in' : 'move-out'}</span>
              )}
            </div>
          </>
        ) : (
          <div style={{ fontSize: 12, color: THEME.textDim }}>Reading bundle…</div>
        )}
      </div>
    </div>
  );
}
