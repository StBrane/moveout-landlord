// ═══════════════════════════════════════════════════════════════════════════
// constants.js — shared data tables for the landlord app
// ═══════════════════════════════════════════════════════════════════════════
// These mirror the tenant app's ROOMS and STATE_LAWS exactly. Keep them in
// sync when the tenant app adds rooms/items/states. Schema changes require
// a BUNDLE_SCHEMA version bump.
//
// INSPECTION_TYPES is landlord-specific — tenant app only has one type
// (tenant-recorded with a move-in and move-out phase).
// ═══════════════════════════════════════════════════════════════════════════

// ─── STATE DEPOSIT LAWS ─────────────────────────────────────────────────────
// Row shape: [name, abbr, daysToReturn, penalty, notes]
// Index into this array is the `stateIdx` stored on inspections.
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

// ─── ROOMS ──────────────────────────────────────────────────────────────────
// Identical to tenant app. Change in lockstep — schema version bump required
// if structure changes.
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

// ─── STATUS ────────────────────────────────────────────────────────────────
// Status codes used in rooms[roomId][phase].statuses[itemIdx].
// Tenant app uses: clean, fair, damaged, na.
// Landlord app uses the same codes so imported bundles render correctly.
export const STATUS = {
  clean:   { label:"✦ Clean",   short:"CLEAN",  bg:"#DBEAFE", fg:"#1E40AF", ring:"#93C5FD" },
  fair:    { label:"✓ Fair",    short:"FAIR",   bg:"#D1FAE5", fg:"#065F46", ring:"#6EE7B7" },
  damaged: { label:"⚠ Damaged", short:"DAMAGE", bg:"#FEE2E2", fg:"#991B1B", ring:"#FCA5A5" },
  na:      { label:"— N/A",     short:"N/A",    bg:"#E5E7EB", fg:"#374151", ring:"#9CA3AF" },
};

// ─── INSPECTION TYPES (landlord-specific) ──────────────────────────────────
// Each inspection the landlord creates has one of these types. Imported tenant
// bundles are tagged TENANT_MOVE_IN or TENANT_MOVE_OUT based on which phase
// has data. A bundle with both move-in AND move-out data gets split into two
// read-only inspections at import time so they can be individually compared.
export const INSPECTION_TYPES = {
  BASELINE:        { id: 'baseline',        label: 'Baseline',            icon: '📋', editable: true,  source: 'landlord',
                     hint: 'Condition of the unit before a new tenant moves in' },
  TURNOVER:        { id: 'turnover',        label: 'Turnover',            icon: '🔄', editable: true,  source: 'landlord',
                     hint: 'Between tenants, after cleaning and repairs' },
  MID_LEASE:       { id: 'mid_lease',       label: 'Mid-lease walk',      icon: '👣', editable: true,  source: 'landlord',
                     hint: 'Quarterly or annual check-in during tenancy' },
  POST_TENANT:     { id: 'post_tenant',     label: 'Post-tenant',         icon: '🏁', editable: true,  source: 'landlord',
                     hint: 'Landlord\'s own walkthrough after tenant moves out' },
  OTHER:           { id: 'other',           label: 'Other',               icon: '📝', editable: true,  source: 'landlord',
                     hint: 'Insurance, contractor, or custom inspection' },
  TENANT_MOVE_IN:  { id: 'tenant_move_in',  label: 'Tenant move-in',      icon: '📥', editable: false, source: 'tenant',
                     hint: 'Imported from tenant — read-only' },
  TENANT_MOVE_OUT: { id: 'tenant_move_out', label: 'Tenant move-out',     icon: '📤', editable: false, source: 'tenant',
                     hint: 'Imported from tenant — read-only' },
};

// Convenience lookups
export const LANDLORD_INSPECTION_TYPES = Object.values(INSPECTION_TYPES).filter(t => t.source === 'landlord');
export const TENANT_INSPECTION_TYPES   = Object.values(INSPECTION_TYPES).filter(t => t.source === 'tenant');

// ─── THEME ─────────────────────────────────────────────────────────────────
// Landlord app uses a darker, more "pro tool" palette vs tenant app's brighter
// consumer-friendly style. Distinct enough that screenshots can't be confused
// in marketing assets.
export const THEME = {
  bg:        '#0F172A',  // slate-900
  bgCard:    '#1E293B',  // slate-800
  bgElev:    '#334155',  // slate-700
  border:    '#475569',  // slate-600
  text:      '#F1F5F9',  // slate-100
  textDim:   '#94A3B8',  // slate-400
  accent:    '#7C3AED',  // violet-600 — matches tenant's "Send to Landlord" button
  accentDim: '#5B21B6',  // violet-800
  success:   '#10B981',  // emerald-500
  warning:   '#F59E0B',  // amber-500
  danger:    '#EF4444',  // red-500
  tenant:    '#3B82F6',  // blue-500 — color-code tenant-sourced data
  landlord:  '#7C3AED',  // violet — color-code landlord-sourced data
};

// ─── BUNDLE / STORAGE CONSTANTS ────────────────────────────────────────────
export const PHOTO_ROOT = 'MoveOutShieldLandlord';  // distinct from tenant's 'MoveOutShield'
export const STORAGE_KEY_PORTFOLIO = 'mosl_portfolio_v1';
export const STORAGE_KEY_SETTINGS = 'mosl_settings_v1';
export const SUPPORTED_BUNDLE_SCHEMA_VERSIONS = [1];
export const APP_VERSION = '0.1.0';

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
