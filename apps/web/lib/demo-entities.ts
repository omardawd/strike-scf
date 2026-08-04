// Fixed IDs for the isolated demo tenant seeded by supabase/seed-demo.sql.
// Single source of truth — both the client-side demo script and the
// server-side reset route import from here so the two never drift apart.

export const DEMO_ORG_ID = 'de200000-0000-0000-0000-000000000001' // Harborview Retail Group (buyer, demo login)
export const DEMO_IRONBRIDGE_ORG_ID = 'de200000-0000-0000-0000-000000000002'
export const DEMO_CEDARLINE_ORG_ID = 'de200000-0000-0000-0000-000000000003'
export const DEMO_VANTAGE_ORG_ID = 'de200000-0000-0000-0000-000000000004'
export const DEMO_SUPPLIER_ORG_IDS = [DEMO_IRONBRIDGE_ORG_ID, DEMO_CEDARLINE_ORG_ID, DEMO_VANTAGE_ORG_ID]
export const DEMO_ALL_ORG_IDS = [DEMO_ORG_ID, ...DEMO_SUPPLIER_ORG_IDS]

export const DEMO_BANK_ID = 'de100000-0000-0000-0000-000000000001'
export const DEMO_PROGRAM_ID = 'de300000-0000-0000-0000-000000000001'

export const DEMO_LISTING_IDS = [
  'de600000-0000-0000-0000-000000000001', // Hot-Rolled Steel Coils (Ironbridge)
  'de600000-0000-0000-0000-000000000002', // Galvanized Steel Sheet (Ironbridge)
  'de600000-0000-0000-0000-000000000003', // Corrugated Shipping Cartons (Cedarline)
  'de600000-0000-0000-0000-000000000004', // SMT PCB Assembly (Vantage)
  'de600000-0000-0000-0000-000000000005', // Structural Steel Angle Bar (Ironbridge, matched -> seeded deal)
]

export const DEMO_IRONBRIDGE_COILS_LISTING_ID = DEMO_LISTING_IDS[0]

// Seeded deals — pre-populated, static narrative content. Reset keeps these
// rows exactly as seeded and only removes anything created live on top.
export const DEMO_IRONBRIDGE_DEAL_ID = 'de700000-0000-0000-0000-000000000001' // completed, real negotiation history
export const DEMO_CEDARLINE_DEAL_ID = 'de700000-0000-0000-0000-000000000002' // delivery_confirmed, financeable
export const DEMO_SEEDED_DEAL_IDS = [DEMO_IRONBRIDGE_DEAL_ID, DEMO_CEDARLINE_DEAL_ID]

// Seeded agent_tasks — the one "capital optimization" proposal card. Reset
// keeps this row and clears its thread (agent_task_messages), but removes
// any other agent_tasks the live Scene 5 run created for the demo org.
export const DEMO_PLAN_TASK_ID = 'de900000-0000-0000-0000-000000000001'
export const DEMO_SEEDED_AGENT_TASK_IDS = [DEMO_PLAN_TASK_ID]

// Seeded Strike Room — real ai_suggestion-style messages narrating the
// Ironbridge negotiation (same underlying deal as DEMO_IRONBRIDGE_DEAL_ID).
// Reset keeps this row + its messages exactly as seeded (excluded from the
// generic "delete every room a demo org created" cleanup) and only removes
// any OTHER room a live run creates.
export const DEMO_ROOM_ID = 'dea00000-0000-0000-0000-000000000001'
export const DEMO_SEEDED_ROOM_IDS = [DEMO_ROOM_ID]
