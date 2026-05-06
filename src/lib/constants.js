// ═══════════════════════════════════════════════════════════════════════════
// constants.js — shared data tables for the landlord app
// ═══════════════════════════════════════════════════════════════════════════
// ROOMS, STATE_LAWS mirror the tenant app exactly.
//
// INSPECTION_TYPES is landlord-specific. Each type has a `defaultSlot` field
// that determines whether captured data lands in the moveIn or moveOut slot
// of the inspection record. This mapping is what lets the diff engine compare
// landlord baselines against tenant-side records apples-to-apples — though
// note that as of v0.3, tenant-side records no longer arrive via .mosinsp
// import; tenant evidence comes in as attached PDFs at the property level.
// ═══════════════════════════════════════════════════════════════════════════

// ─── STATE DEPOSIT LAWS ─────────────────────────────────────────────────────
export const STATE_LAWS = [
  ["Alabama","AL",60,"2× deposit","Written itemization required"],
  ["Alaska","AK","14–30","2× + damages","14 days if no deductions; 30 days with deductions"],
  ["Arizona","AZ",14,"2× deposit","Must provide itemized statement"],
  ["Arkansas","AR",60,"2× deposit","Written notice required"],
  ["California","CA",21,"2× deposit","Most tenant-friendly laws in the US"],
  ["Colorado","CO",60,"3× deposit","30 days if month-to-month lease"],
  ["Connecticut","CT",30,"2× deposit","Must pay interest on deposit held >1 year"],
  ["Delaware","DE",20,"2× deposit","Written itemization required within 20 days"],
  ["Florida","FL","15–60","3× deposit","15 days if no deductions; 30 days with deductions"],
  ["Georgia","GA",30,"3× deposit","Written notice of deductions required"],
  ["Hawaii","HI",14,"3× deposit","One of the shortest return windows"],
  ["Idaho","ID",21,"3× deposit","Written itemization required"],
  ["Illinois","IL",30,"2× + 5% interest","Interest accrues annually on deposits"],
  ["Indiana","IN",45,"3× deposit","Written itemization required"],
  ["Iowa","IA",30,"2× deposit","Must provide itemized list of deductions"],
  ["Kansas","KS",30,"1.5× deposit","Written itemization required"],
  ["Kentucky","KY","30–60","2× deposit","30 days if no deductions; 60 days with"],
  ["Louisiana","LA",30,"2× deposit","Itemization must be mailed"],
  ["Maine","ME",30,"2× deposit","Written statement required"],
  ["Maryland","MD",45,"3× deposit","Must pay interest on deposits"],
  ["Massachusetts","MA",30,"3× + interest","Must pay 5% interest or bank rate annually"],
  ["Michigan","MI",30,"2× deposit","Written itemization required"],
  ["Minnesota","MN",21,"2× deposit","Must include interest at rate set by Dept. of Commerce"],
  ["Mississippi","MS",45,"2× deposit","Written notice required"],
  ["Missouri","MO",30,"2× deposit","Itemized list of deductions required"],
  ["Montana","MT","10–30","2× deposit","10 days if no damage; 30 days with damage"],
  ["Nebraska","NE",14,"2× deposit","One of the shortest return windows"],
  ["Nevada","NV",30,"2× deposit","Written itemization required"],
  ["New Hampshire","NH",30,"2× deposit","Written statement with receipts required"],
  ["New Jersey","NJ",30,"2× deposit","Must pay annual interest on deposits"],
  ["New Mexico","NM",30,"Up to 3×","Written itemization required"],
  ["New York","NY",14,"2× deposit","14-day window is strict — landlords often miss it"],
  ["North Carolina","NC",30,"2× deposit","Small claims up to $10,000"],
  ["North Dakota","ND",30,"3× deposit","Written itemization required"],
  ["Ohio","OH",30,"2× + damages","Written itemization required"],
  ["Oklahoma","OK",45,"2× deposit","Written statement required"],
  ["Oregon","OR",31,"2× deposit","Written accounting required"],
  ["Pennsylvania","PA",30,"2× deposit","Deposit held >2 years must earn interest"],
  ["Rhode Island","RI",20,"2× deposit","Written itemization required"],
  ["South Carolina","SC",30,"3× deposit","Landlord must provide written notice"],
  ["South Dakota","SD",14,"2× deposit","14-day window for itemization"],
  ["Tennessee","TN",30,"2× deposit","Written statement of deductions required"],
  ["Texas","TX",30,"3× + $100 + attorney fees","Strong tenant protections"],
  ["Utah","UT",30,"2× deposit","Written itemization required"],
  ["Vermont","VT",14,"2× deposit","One of the shortest return windows"],
  ["Virginia","VA",45,"Damages + 5% interest","Written itemization required"],
  ["Washington","WA",30,"2× deposit","Must provide move-out checklist"],
  ["West Virginia","WV",60,"Written damages","No statutory penalty — sue in small claims"],
  ["Wisconsin","WI",21,"2× deposit","Written itemization required"],
  ["Wyoming","WY",30,"None specified","No statutory penalty — rely on small claims"],
];

// ─── ROOMS (identical to tenant app) ────────────────────────────────────────
export const ROOMS = [
  { id:"entry",   name:"Entry & Hallway",  icon:"🚪", items:["Front door, locks & deadbolt","Weatherstripping & door seal","Light fixtures & switches","Walls — paint, scuffs, holes","Flooring / tile","Entryway closet (door, rod, shelves)","Smoke / CO detector"] },
  { id:"living",  name:"Living Room",      icon:"🛋️", items:["Walls — holes, scuffs, stains","Ceiling — cracks, water stains","Carpet or flooring","Windows, locks & screens","Blinds / window coverings","Light fixtures & ceiling fan","Outlets & switches","Baseboards & trim","Fireplace (if present)"] },
  { id:"kitchen", name:"Kitchen",          icon:"🍳", items:["Countertops — chips, burns, stains","Cabinets inside & out","Sink, faucet & drain","Garbage disposal","Refrigerator — inside, seals, coils","Stove / oven — burners & interior","Dishwasher","Built-in microwave","Exhaust hood / vent","Flooring","Walls & backsplash","Light fixtures"] },
  { id:"bath1",   name:"Bathroom",         icon:"🚿", items:["Toilet — seat, flush, caulk at base","Sink, faucet & drain","Caulk around sink / vanity","Shower or tub condition & drain","Shower caulk, grout & tile","Shower door / curtain rod","Mirror & medicine cabinet","Exhaust fan","Flooring","Wall tile & grout","Towel bars & hardware","Light fixtures & vanity light"] },
  { id:"bed1",    name:"Bedroom",          icon:"🛏️", items:["Walls — holes, marks, damage","Ceiling condition","Carpet or flooring","Closet — door, rod & shelving","Windows, locks & screens","Blinds / coverings","Light fixtures & ceiling fan","Outlets & switches","Baseboards & trim","Door & hardware"] },
  { id:"bed2",    name:"2nd Bedroom",      icon:"🛏️", items:["Walls — holes, marks, damage","Ceiling condition","Carpet or flooring","Closet — door, rod & shelving","Windows, locks & screens","Blinds / coverings","Light fixtures & ceiling fan","Outlets & switches","Baseboards & trim","Door & hardware"] },
  { id:"bed3",    name:"3rd Bedroom",      icon:"🛏️", items:["Walls — holes, marks, damage","Ceiling condition","Carpet or flooring","Closet — door, rod & shelving","Windows, locks & screens","Blinds / coverings","Light fixtures & ceiling fan","Outlets & switches","Baseboards & trim","Door & hardware"] },
  { id:"bed4",    name:"4th Bedroom",      icon:"🛏️", items:["Walls — holes, marks, damage","Ceiling condition","Carpet or flooring","Closet — door, rod & shelving","Windows, locks & screens","Blinds / coverings","Light fixtures & ceiling fan","Outlets & switches","Baseboards & trim","Door & hardware"] },
  { id:"laundry", name:"Laundry Room",     icon:"🫧", items:["Washer hookups / washer unit","Dryer hookups / dryer unit","Lint trap area","Flooring","Walls","Utility sink (if present)","Shelving & storage"] },
  { id:"garage",  name:"Garage",           icon:"🚗", items:["Garage door operation & safety","Opener & remotes accounted for","Floor — stains, cracks, oil","Walls","Lighting","Entry door to home"] },
  { id:"outdoor", name:"Outdoor / Patio",  icon:"🌿", items:["Patio or deck condition","Fencing & gates","Yard, lawn & landscaping","Exterior lights","Hose bibs / spigots","Storage areas"] },
];

// ─── STATUS (mirrors tenant app exactly) ────────────────────────────────────
export const STATUS = {
  clean:   { label:"✦ Clean",   short:"CLEAN",  bg:"#DBEAFE", fg:"#1E40AF", ring:"#93C5FD" },
  fair:    { label:"✓ Fair",    short:"FAIR",   bg:"#D1FAE5", fg:"#065F46", ring:"#6EE7B7" },
  damaged: { label:"⚠ Damaged", short:"DAMAGE", bg:"#FEE2E2", fg:"#991B1B", ring:"#FCA5A5" },
  na:      { label:"— N/A",     short:"N/A",    bg:"#E5E7EB", fg:"#374151", ring:"#9CA3AF" },
};

// ─── INSPECTION TYPES ──────────────────────────────────────────────────────
// Order = tenancy lifecycle: Baseline → Mid-lease → Post-tenant → Turnover → Other
//
// `defaultSlot` controls where capture data lands in rooms[id].{moveIn|moveOut}.
// `tenancyLink` describes how this type relates to tenancies:
//   'tenancy'  — belongs to one tenancy
//   'between'  — lives between tenancies (turnover)
//   'imported' — created by import pipeline (DEAD as of v0.3 — kept for shape compat)
// ────────────────────────────────────────────────────────────────────────────
export const INSPECTION_TYPES = {
  BASELINE:        { id: 'baseline',        label: 'Baseline',        icon: '📋', editable: true,  source: 'landlord', defaultSlot: 'moveIn',  tenancyLink: 'tenancy',
                     hint: 'Condition of the unit before a new tenant moves in' },
  MID_LEASE:       { id: 'mid_lease',       label: 'Mid-lease walk',  icon: '👣', editable: true,  source: 'landlord', defaultSlot: 'moveIn',  tenancyLink: 'tenancy',
                     hint: 'Quarterly or annual check-in during tenancy' },
  POST_TENANT:     { id: 'post_tenant',     label: 'Post-tenant',     icon: '🏁', editable: true,  source: 'landlord', defaultSlot: 'moveOut', tenancyLink: 'tenancy',
                     hint: 'Walkthrough the day the tenant hands back keys' },
  TURNOVER:        { id: 'turnover',        label: 'Turnover',        icon: '🔄', editable: true,  source: 'landlord', defaultSlot: 'moveOut', tenancyLink: 'between',
                     hint: 'After cleaning and repairs — sets the next tenant\'s baseline' },
  OTHER:           { id: 'other',           label: 'Other',           icon: '📝', editable: true,  source: 'landlord', defaultSlot: 'moveIn',  tenancyLink: 'tenancy',
                     hint: 'Insurance, contractor, ad-hoc property documentation' },
  TENANT_MOVE_IN:  { id: 'tenant_move_in',  label: 'Tenant move-in',  icon: '📥', editable: false, source: 'tenant',   defaultSlot: 'moveIn',  tenancyLink: 'imported',
                     hint: 'Imported from tenant — read-only (legacy v0.2 records)' },
  TENANT_MOVE_OUT: { id: 'tenant_move_out', label: 'Tenant move-out', icon: '📤', editable: false, source: 'tenant',   defaultSlot: 'moveOut', tenancyLink: 'imported',
                     hint: 'Imported from tenant — read-only (legacy v0.2 records)' },
};

export const LANDLORD_INSPECTION_TYPES = Object.values(INSPECTION_TYPES).filter(t => t.source === 'landlord');
export const TENANT_INSPECTION_TYPES   = Object.values(INSPECTION_TYPES).filter(t => t.source === 'tenant');
export const inspectionTypeById = (id) => Object.values(INSPECTION_TYPES).find(t => t.id === id) || null;

// ─── THEME — cream/forest, ported from tenant styles.css ───────────────────
export const THEME = {
  bg:        '#F5F2EE',
  paper:     '#F9F7F4',
  surface:   '#F0EDE8',
  edge:      '#E7E3DC',
  edgeStrong:'#C4B5A5',

  ink:       '#1C1917',
  inkSoft:   '#292524',
  muted:     '#78716C',
  muted2:    '#A8A29E',

  brand:     '#1B3A2D',
  brand2:    '#2D6A4F',
  emerald:   '#065F46',

  mint50:    '#F0FDF4',
  mint100:   '#ECFDF5',
  mint200:   '#D1FAE5',
  mint300:   '#86EFAC',
  mint400:   '#6EE7B7',
  mint600:   '#059669',

  tenant:    '#1E40AF',
  landlord:  '#2D6A4F',

  success:   '#059669',
  warning:   '#D97706',
  danger:    '#991B1B',
};

// ─── BUNDLE / STORAGE CONSTANTS ────────────────────────────────────────────
// SUPPORTED_BUNDLE_SCHEMA_VERSIONS removed — .mosinsp bundle import dropped
// in v0.3. Tenant-side reports now arrive as PDFs and attach to the property
// via property.attachedPdfs (see portfolioStore.js).
export const PHOTO_ROOT = 'MoveOutShieldLandlord';
export const STORAGE_KEY_PORTFOLIO = 'mosl_portfolio_v2';
export const STORAGE_KEY_SETTINGS  = 'mosl_settings_v1';
export const APP_VERSION = '0.3.0';
export const PORTFOLIO_SCHEMA_VERSION = 2;

// ─── HELPERS ───────────────────────────────────────────────────────────────
export const totalItems = ROOMS.reduce((s, r) => s + r.items.length, 0);

export const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g,
    c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)));

export const blankPhase = () => ({ statuses: {}, notes: '', photos: [] });
export const blankRooms = () => {
  const d = {};
  ROOMS.forEach(r => { d[r.id] = { moveIn: blankPhase(), moveOut: blankPhase() }; });
  return d;
};

// ─── INSPECTION COMPLETION METRICS ─────────────────────────────────────────
// Powers the "23/25" chip on inspection cards. Only counts rooms the landlord
// actually engaged with — denominator is rooms touched, not all rooms.
// ────────────────────────────────────────────────────────────────────────────
export function inspectionMetrics(inspection) {
  if (!inspection) return { rated: 0, possible: 0, photos: 0 };
  const type = inspectionTypeById(inspection.type);
  const slot = type?.defaultSlot || 'moveIn';

  let rated = 0;
  let possible = 0;
  let photos = 0;

  for (const room of ROOMS) {
    const phaseData = inspection.rooms?.[room.id]?.[slot];
    if (!phaseData) continue;
    const ratedHere = phaseData.statuses ? Object.keys(phaseData.statuses).length : 0;
    const photosHere = phaseData.photos ? phaseData.photos.length : 0;
    const hasNotes = (phaseData.notes || '').trim().length > 0;
    if (ratedHere > 0 || photosHere > 0 || hasNotes) {
      possible += room.items.length;
      rated   += ratedHere;
      photos  += photosHere;
    }
  }
  return { rated, possible, photos };
}

// ─── DATE FORMATTING ───────────────────────────────────────────────────────
export function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatDateShort(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function formatTenancySpan(tenancy) {
  if (!tenancy) return '';
  const start = tenancy.startDate ? formatDate(tenancy.startDate) : '?';
  const end = tenancy.endDate ? formatDate(tenancy.endDate) : 'ongoing';
  return `${start} → ${end}`;
}
