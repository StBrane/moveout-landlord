// ═══════════════════════════════════════════════════════════════════════════
// TenancyFindingsScreen.jsx — grouped-by-tier view of the damage report
// ═══════════════════════════════════════════════════════════════════════════
// Calls buildDamageReport() against a tenancy's records and renders the
// result organized by evidence tier. Strongest evidence first (Bulletproof),
// weakest last (Disputed). Items unchanged across the tenancy are filtered
// out by the engine.
//
// Visual structure:
//   ─ Header (forest band, back button)
//   ─ Evidence summary card (★★★★ rating + label)
//   ─ Per-tier sections, in rank order:
//       Bulletproof, Strong (3 sub-tiers), Tenant-only, Disputed
//   ─ Each section: collapsible (Disputed defaults expanded, others collapsed)
//   ─ Item rows: room icon + label + tier badge + change descriptor
//   ─ Bottom: full-width forest "Share Findings PDF" button
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react';
import { THEME, STATUS, formatTenancySpan } from '../lib/constants.js';
import { getProperty, getTenancy } from '../lib/portfolioStore.js';
import {
  buildDamageReport,
  TIERS, TIER_META,
  ACTIONABLE_TIERS, REVIEW_TIERS,
} from '../lib/damageReport.js';

// Display order — Bulletproof first, Disputed last
const TIER_DISPLAY_ORDER = [
  TIERS.BULLETPROOF,
  TIERS.STRONG_CORROBORATED,
  TIERS.STRONG_ONE_PARTY,
  TIERS.STRONG_STATUS_AGREEMENT,
  TIERS.TENANT_ONLY_EVIDENCE,
  TIERS.DISPUTED,
];

// Tier icons — visual cue alongside the tier label
const TIER_ICON = {
  [TIERS.BULLETPROOF]:             '🛡️',
  [TIERS.STRONG_CORROBORATED]:     '✅',
  [TIERS.STRONG_ONE_PARTY]:        '✅',
  [TIERS.STRONG_STATUS_AGREEMENT]: '✅',
  [TIERS.TENANT_ONLY_EVIDENCE]:    '👥',
  [TIERS.DISPUTED]:                '⚠️',
};

export default function TenancyFindingsScreen({
  portfolio, propertyId, tenancyId, onBack, onSharePDF, photoStore,
}) {
  const property = getProperty(portfolio, propertyId);
  const tenancy = getTenancy(portfolio, propertyId, tenancyId);

  const [pdfBusy, setPdfBusy] = useState(false);
  // Disputed defaults expanded — landlord needs to attend to these.
  // Other tiers default collapsed so they don't overwhelm the screen.
  const [expandedTiers, setExpandedTiers] = useState({
    [TIERS.DISPUTED]: true,
  });

  // Build the damage report once per render of property/tenancy
  const report = useMemo(() => {
    if (!property || !tenancy) return null;
    return buildDamageReport(property, tenancy);
  }, [property, tenancy]);

  const handleSharePDF = async () => {
    if (!onSharePDF || pdfBusy) return;
    setPdfBusy(true);
    try {
      await onSharePDF({ report, property, tenancy });
    } catch (e) {
      console.error('[TenancyFindingsScreen] share PDF failed', e);
    } finally {
      setPdfBusy(false);
    }
  };

  if (!property || !tenancy) {
    return (
      <div style={{ padding: 20, color: THEME.ink, background: THEME.bg, minHeight: '100vh' }}>
        <div style={{ marginBottom: 14 }}>
          Findings not available — property or lease may have been deleted.
        </div>
        <button onClick={onBack} style={btnSecondary}>← Back</button>
      </div>
    );
  }

  if (!report) {
    return null;
  }

  // Group items by tier for rendering
  const itemsByTier = {};
  for (const tier of TIER_DISPLAY_ORDER) itemsByTier[tier] = [];
  for (const item of report.items) {
    if (itemsByTier[item.tier]) itemsByTier[item.tier].push(item);
  }

  const toggleTier = (tier) => {
    setExpandedTiers(prev => ({ ...prev, [tier]: !prev[tier] }));
  };

  const tenants = tenancy.tenants?.length ? tenancy.tenants.join(', ') : '(unnamed tenants)';
  const span = formatTenancySpan(tenancy);

  // Records present — used to label which are missing
  const recordList = [
    { key: 'landlordBaseline',   label: 'Landlord baseline',   present: !!report.records.landlordBaseline },
    { key: 'tenantMoveIn',       label: 'Tenant move-in',       present: !!report.records.tenantMoveIn },
    { key: 'landlordPostTenant', label: 'Landlord post-tenant', present: !!report.records.landlordPostTenant },
    { key: 'tenantMoveOut',      label: 'Tenant move-out',      present: !!report.records.tenantMoveOut },
  ];

  return (
    <div style={{
      maxWidth: 800, margin: '0 auto',
      padding: 'calc(env(safe-area-inset-top) + 0px) 0 calc(env(safe-area-inset-bottom) + 32px) 0',
      minHeight: '100vh', background: THEME.bg,
    }}>
      {/* ─── Header ─────────────────────────────────────────────────────── */}
      <header style={{
        background: THEME.brand, color: THEME.mint50,
        padding: 'calc(env(safe-area-inset-top) + 14px) 18px 18px 18px',
        borderBottomLeftRadius: 18, borderBottomRightRadius: 18,
        marginBottom: 18,
      }}>
        <button onClick={onBack} style={{
          background: 'rgba(255,255,255,0.1)', color: THEME.mint100,
          border: `1px solid ${THEME.mint400}`, borderRadius: 999,
          padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
          marginBottom: 12, display: 'inline-flex', alignItems: 'center', gap: 6,
        }}>
          <span style={{ fontSize: 14 }}>‹</span> {property.name}
        </button>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Tenancy Findings</h1>
        <div style={{ fontSize: 12, color: THEME.mint200, marginTop: 4 }}>
          {tenants} · {span}
        </div>
      </header>

      <div style={{ padding: '0 16px' }}>
        {/* ─── Evidence summary card ──────────────────────────────────────── */}
        <div style={{
          background: THEME.paper, borderRadius: 16, padding: 16,
          border: `1px solid ${THEME.edge}`,
          marginBottom: 16,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: 11, color: THEME.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Evidence Picture
              </div>
              <div style={{ fontSize: 22, color: THEME.brand, fontWeight: 700, marginTop: 2 }}>
                {report.evidenceTier.stars}
              </div>
            </div>
            <div style={{
              background: THEME.mint100, color: THEME.brand,
              borderRadius: 8, padding: '6px 12px',
              fontSize: 18, fontWeight: 700,
              border: `1px solid ${THEME.mint300}`,
            }}>
              {report.summary.itemCount} {report.summary.itemCount === 1 ? 'finding' : 'findings'}
            </div>
          </div>
          <div style={{ fontSize: 13, color: THEME.ink, marginBottom: 10 }}>
            {report.evidenceTier.label}
          </div>
          {/* Records present/missing indicators */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {recordList.map(r => (
              <span key={r.key} style={{
                fontSize: 11, fontWeight: 600,
                padding: '4px 10px', borderRadius: 999,
                background: r.present ? THEME.mint100 : THEME.surface,
                color: r.present ? THEME.brand : THEME.muted2,
                border: `1px solid ${r.present ? THEME.mint300 : THEME.edge}`,
              }}>
                {r.present ? '✓' : '○'} {r.label}
              </span>
            ))}
          </div>
        </div>

        {/* ─── Per-tier sections ──────────────────────────────────────────── */}
        {report.summary.itemCount === 0 ? (
          <div style={{
            background: THEME.mint100, color: THEME.brand,
            borderRadius: 14, padding: 20,
            border: `1px solid ${THEME.mint300}`,
            textAlign: 'center',
            marginBottom: 16,
          }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🌟</div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>No findings to surface.</div>
            <div style={{ fontSize: 12, marginTop: 6, color: THEME.brand2 }}>
              Records show no items changed during this tenancy. That's a clean lease.
            </div>
          </div>
        ) : (
          TIER_DISPLAY_ORDER.map(tier => {
            const items = itemsByTier[tier];
            if (items.length === 0) return null;
            const meta = TIER_META[tier];
            const isExpanded = !!expandedTiers[tier];

            return (
              <div key={tier} style={{
                background: THEME.paper, borderRadius: 14,
                border: `1px solid ${THEME.edge}`,
                marginBottom: 10, overflow: 'hidden',
              }}>
                {/* Tier header — clickable to toggle */}
                <button onClick={() => toggleTier(tier)} style={{
                  width: '100%', textAlign: 'left',
                  background: 'transparent', border: 'none',
                  padding: '12px 14px', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 10,
                }}>
                  <span style={{ fontSize: 18 }}>{TIER_ICON[tier]}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: meta.color }}>
                      {meta.label}
                    </div>
                    <div style={{ fontSize: 11, color: THEME.muted, marginTop: 2 }}>
                      {meta.desc}
                    </div>
                  </div>
                  <div style={{
                    background: meta.color, color: '#fff',
                    borderRadius: 999, padding: '3px 10px',
                    fontSize: 12, fontWeight: 700,
                    minWidth: 28, textAlign: 'center',
                  }}>
                    {items.length}
                  </div>
                  <span style={{
                    fontSize: 12, color: THEME.muted,
                    transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                    transition: 'transform 0.15s',
                    display: 'inline-block',
                  }}>›</span>
                </button>

                {/* Tier item list */}
                {isExpanded && items.map((item, idx) => (
                  <FindingRow
                    key={`${item.roomId}-${item.itemIndex}`}
                    item={item}
                    isLast={idx === items.length - 1}
                  />
                ))}
              </div>
            );
          })
        )}

        {/* ─── Share PDF button ──────────────────────────────────────────── */}
        {onSharePDF && (
          <button
            onClick={handleSharePDF}
            disabled={pdfBusy || report.summary.itemCount === 0}
            style={{
              background: pdfBusy ? THEME.muted2 :
                          report.summary.itemCount === 0 ? THEME.surface : THEME.brand,
              color: pdfBusy ? THEME.mint100 :
                     report.summary.itemCount === 0 ? THEME.muted : THEME.mint300,
              border: `1px solid ${report.summary.itemCount === 0 ? THEME.edge : THEME.brand}`,
              borderRadius: 12,
              padding: '14px 18px',
              fontSize: 14, fontWeight: 700,
              cursor: pdfBusy ? 'wait' : (report.summary.itemCount === 0 ? 'not-allowed' : 'pointer'),
              width: '100%',
              marginTop: 16,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              opacity: pdfBusy ? 0.7 : 1,
              transition: 'all 0.15s',
            }}
          >
            {pdfBusy ? '⏳ Building Findings PDF…' :
             report.summary.itemCount === 0 ? '— Nothing to share —' :
             '📤 Share Findings PDF'}
          </button>
        )}

        <button onClick={onBack} style={{ ...btnSecondary, marginTop: 12 }}>
          ← Return to Property
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// FindingRow — one item inside an expanded tier section
// ═══════════════════════════════════════════════════════════════════════════
function FindingRow({ item, isLast }) {
  const [showDetail, setShowDetail] = useState(false);

  // Change descriptor: "fair → damaged" or "(new)" if no starting record
  let changeDesc = null;
  if (item.change) {
    const fromLabel = item.change.from ? STATUS[item.change.from]?.short : null;
    const toLabel   = item.change.to   ? STATUS[item.change.to]?.short   : null;
    changeDesc = fromLabel ? `${fromLabel} → ${toLabel}` : `(new) → ${toLabel}`;
  }

  return (
    <div style={{
      borderTop: `1px solid ${THEME.edge}`,
      padding: '10px 14px',
      cursor: 'pointer',
    }} onClick={() => setShowDetail(!showDetail)}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 16 }}>{item.roomIcon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, color: THEME.ink, fontWeight: 600 }}>
            {item.roomName}
          </div>
          <div style={{ fontSize: 12, color: THEME.muted, marginTop: 2, lineHeight: 1.3 }}>
            {item.itemLabel}
          </div>
        </div>
        {changeDesc && (
          <div style={{
            background: THEME.surface, color: THEME.danger,
            borderRadius: 6, padding: '3px 8px',
            fontSize: 10, fontWeight: 700,
            border: `1px solid ${THEME.edge}`,
          }}>
            {changeDesc}
          </div>
        )}
        <span style={{
          fontSize: 10, color: THEME.muted2,
          transform: showDetail ? 'rotate(90deg)' : 'rotate(0deg)',
          transition: 'transform 0.15s',
        }}>›</span>
      </div>

      {showDetail && (
        <div style={{
          marginTop: 10, padding: '10px 0 0 26px',
          fontSize: 12, color: THEME.ink,
          borderTop: `1px dashed ${THEME.edge}`,
        }}>
          {/* Engine's plain-language details */}
          <div style={{ fontStyle: 'italic', color: THEME.muted, marginBottom: 8 }}>
            {item.details}
          </div>

          {/* Per-party data, if any */}
          {Object.entries(item.parties || {}).filter(([, v]) => v).length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
              {Object.entries(item.parties).map(([partyKey, partyData]) => {
                if (!partyData) return null;
                const status = partyData.status;
                const statusMeta = status ? STATUS[status] : null;
                const partyLabel = PARTY_LABEL[partyKey] || partyKey;
                return (
                  <div key={partyKey} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                    <span style={{ color: THEME.muted, fontWeight: 600, minWidth: 110 }}>
                      {partyLabel}:
                    </span>
                    {statusMeta ? (
                      <span style={{
                        background: statusMeta.bg, color: statusMeta.fg,
                        padding: '1px 6px', borderRadius: 4,
                        fontSize: 10, fontWeight: 700,
                        border: `1px solid ${statusMeta.ring}`,
                      }}>
                        {statusMeta.short}
                      </span>
                    ) : (
                      <span style={{ color: THEME.muted2 }}>—</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Notes from each party */}
          {item.notes?.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {item.notes.map((n, i) => (
                <div key={i} style={{ fontSize: 11, lineHeight: 1.4, color: THEME.muted }}>
                  <strong style={{ color: THEME.ink }}>{PARTY_LABEL[n.source] || n.source}:</strong> {n.text}
                </div>
              ))}
            </div>
          )}

          {/* Photo count */}
          {item.photos?.length > 0 && (
            <div style={{ fontSize: 11, color: THEME.muted, marginTop: 8 }}>
              📷 {item.photos.length} photo{item.photos.length === 1 ? '' : 's'} on file
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const PARTY_LABEL = {
  landlordBaseline:   'Landlord baseline',
  tenantMoveIn:       'Tenant move-in',
  landlordPostTenant: 'Landlord post-tenant',
  tenantMoveOut:      'Tenant move-out',
  precedingTurnover:  'Turnover',
};

const btnSecondary = {
  background: THEME.surface, color: THEME.ink,
  border: `1px solid ${THEME.edge}`, borderRadius: 12,
  padding: '14px 18px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
  width: '100%',
};
