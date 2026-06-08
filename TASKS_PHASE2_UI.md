# STRIKE SCF — PHASE 2 UI/UX TASKS
> Multi-agent execution plan. Generated 2026-06-07.
> Paste this into Claude Code as the orchestrator prompt.
> Every agent reads `apps/web/CLAUDE.md` completely before touching code.

---

## CRITICAL CONVENTIONS (every agent must follow without exception)

- **Auth:** `getUser()` always — never `getSession()`. Admin client + manual `.eq()` scope filter on all data queries.
- **AI model:** `claude-haiku-4-5-20251001` hardcoded for all in-app AI calls. Never change this.
- **CSS:** Hand-built CSS with design tokens only. No Tailwind, no shadcn, no MUI. Tokens in `app/globals.css` + `app/marketplace.css`. Every new style uses existing CSS variables — do not introduce raw hex values.
- **No form elements:** Never use `<form>` tags. Use controlled state + onClick handlers.
- **Types:** Import shared types from `packages/types`.
- **Roles:** `org_admin` / `org_member` for anchors and suppliers. `bank_admin` / `bank_credit_officer` for banks. `strike_admin` for platform.
- **Portals are role-derived:** Portal type comes from `users.role` at login via `PortalContext`. Never hardcode portal type.
- **Ghost mode (Tier 0):** `organizations.kyb_status = 'not_started'` AND `organizations.network_visible = false` = ghost. Ghost orgs are NEVER returned in any counterparty query. Enforce at the API layer, not just UI.
- **Commit format:** `[TRACK-X] T{N}.{M}: {description}`
- **After every task:** Run `tsc --noEmit`. It must pass clean. Fix all type errors before committing.
- **If blocked:** Write `BLOCKED_TX_Y.md` in repo root with exact blocker. Move to next task.

---

## TRACK A — NAVIGATION & SIDEBAR OVERHAUL
> Touches: `portal-shell.tsx`, sidebar nav config, global CSS
> Agent: Solo. Estimated: 4–6 hours.
> Parallel-safe: Yes — no overlap with other tracks.

### TA.1 — Remove portal label text from sidebar header
**Problem:** Sidebar displays "Supplier Portal", "Anchor Portal", "Bank Portal" as a label. This is redundant and breaks the unified platform feel.
**Action:**
- Find every instance of portal label text in `portal-shell.tsx` and any role-conditional rendering blocks
- Remove the label entirely. The user knows what portal they're in.
- Do NOT remove the org name or user name from the sidebar bottom — those stay.

### TA.2 — Collapsible sidebar with icon-only mode
**Action:**
- Add a collapse toggle button at the top of the sidebar (chevron-left icon when expanded, chevron-right when collapsed)
- Collapsed state: sidebar width reduces to 56px, shows only icons, no text labels
- Expanded state: current width with icon + label
- Persist collapse state in `localStorage` key `strike_sidebar_collapsed`
- Collapsed state must not break tooltips — add `title` attribute to each nav icon so the browser shows a native tooltip on hover
- Transition: `transition: width 200ms ease` — smooth, no jank
- All portal shells (bank, anchor, supplier) get the same collapse behavior

### TA.3 — Replace sidebar icons with meaningful ones
**Problem:** Current sidebar icons are generic and visually weak.
**Action:**
- Use inline SVG icons (no external library — keep it consistent with the existing pattern)
- Replace icons across all portals with the following mappings:

| Nav Item | New Icon Concept | SVG Description |
|---|---|---|
| Dashboard | Grid/home | 4-square grid |
| Strike Place / Marketplace | Building with columns | Institutional/exchange building |
| My Deals | Handshake | Two hands meeting |
| Strike Rooms | Chat bubbles | Two overlapping speech bubbles |
| Strike Passport | Shield with checkmark | Shield + tick |
| Programs | Layers/stack | 3 stacked horizontal bars |
| Analytics/Reporting | Bar chart ascending | 3 bars with upward trend |
| Supply Graph | Network nodes | 3 nodes connected by lines |
| Strike AI | Lightning bolt | Stylized bolt (current one is fine if it exists) |
| Notifications | Bell | Bell shape |

- Icons must be 20×20 viewBox, stroke-based (not filled), `currentColor` for color inheritance
- Active state: icon color uses `var(--blue)` (Strike blue). Inactive: `var(--gray)`

### TA.4 — Remove Settings and AI Agent from sidebar nav
**Action:**
- Remove "Settings" nav item from sidebar for ALL portals (bank, anchor, supplier)
- Remove "AI Agent" nav item from sidebar for ALL portals
- Settings is already accessible via the user button in the bottom-left of the sidebar — confirm this works and the link is obvious
- Strike AI is accessible via the floating trigger button (Track F handles the full AI panel redesign) — the sidebar item is redundant
- Do NOT remove the pages themselves — only remove the sidebar nav links

### TA.5 — Remove Transactions and KYB Review from bank sidebar
**Action:**
- Remove "Transactions" nav item from the bank portal sidebar
- Remove "KYB Review" nav item from the bank portal sidebar
- Remove "Settings" from bank portal sidebar (same as TA.4 but confirm it's also gone for bank)
- These pages are not deleted — only the sidebar links are removed. Direct URL access still works (needed for bank_admin deep links)

### TA.6 — Supply Graph sidebar item — "Coming Soon" treatment
**Action:**
- Keep "Supply Graph" in the bank portal sidebar
- When clicked: do NOT navigate to the supply graph page. Instead, show an inline tooltip or a small overlay/badge that says "Coming Soon" in the Strike brand style
- Alternatively: navigate to `/supply-graph` but render a full-page "Coming Soon" card with the Strike logo and text: "Supply Graph — Available in Phase 2. The full network visualization of your portfolio relationships."
- Do not remove the nav item — it signals future capability to bank users

---

## TRACK B — PORTAL NAVIGATION RESTRUCTURE (ANCHOR + SUPPLIER)
> Touches: anchor/supplier sidebar nav, transactions pages, programs pages, deals pages
> Agent: Solo. Estimated: 5–7 hours.
> Depends on: TA.1 complete (to avoid sidebar conflicts). Can start in parallel if careful.

### TB.1 — Remove Transactions page from anchor and supplier portals
**Action:**
- Remove "Transactions" nav link from anchor portal sidebar
- Remove "Transactions" nav link from supplier portal sidebar
- Do NOT delete the underlying page files — transactions data is surfaced through the Deals page (TB.2)
- Any dashboard widget that links to `/transactions` should be redirected to `/deals` with appropriate filters

### TB.2 — Remove My Programs page from anchor and supplier portals
**Action:**
- Remove "My Programs" nav link from anchor portal sidebar
- Remove "My Programs" nav link from supplier portal sidebar
- Program information is accessible through the Deals page and through the invitation/enrollment flow
- Any dashboard widget linking to `/programs` from anchor/supplier context: redirect to `/deals`

### TB.3 — Verify My Deals page handles the full financing/procurement lifecycle
**Action:**
- Audit `(portal)/deals/` page for both anchor and supplier roles
- Confirm it shows: all active deals, deal status, financing status, counterparty, linked program
- If deals page is missing financing status or program context: add those columns/fields
- Add a "Finance This Deal" CTA on each deal row for deals that are eligible for financing but not yet financed — this is the primary action path replacing the old transactions flow
- Confirm `deal_source` field is displayed (marketplace / imported / direct) — helps user understand how the deal originated

---

## TRACK C — BANK PORTAL REDESIGN: STRIKE PLACE + PROGRAM FLOW
> Touches: bank portal Strike Place page, programs pages, new financing request flow
> Agent: Solo. Estimated: 8–12 hours. Highest complexity in this batch.
> Depends on: TA.4, TA.5 complete.

### TC.1 — Rename "Financing Requests" to "Strike Place" in bank portal
**Action:**
- Find every instance of "Financing Requests" label in the bank portal — sidebar nav, page headers, breadcrumbs, API response labels used in UI, any dashboard widgets
- Replace ALL instances with "Strike Place"
- The route can remain `/financing-requests` or be aliased — do not break existing deep links
- Update the sidebar icon to the exchange/building icon from TA.3

### TC.2 — Redesign Strike Place (bank portal) — trading terminal aesthetic
**Problem:** Current financing requests page looks like a generic list. It needs to feel like a Bloomberg terminal / S&P trading interface adapted for trade finance.

**Design spec:**
- **Top bar:** Live stats row — "Active Requests: 47 | Avg Rate: 3.2% | Total Volume: $124M | Open Offers: 12" — updates in real time via Supabase Realtime subscription
- **Main layout:** Split view. Left 65%: requests table. Right 35%: detail/preview panel that updates when a row is selected (no page navigation for browsing)
- **Requests table columns:** Type badge (RF / IF / PO / DD / Custom / Open) | Requestor (PassportScore ring + name) | Amount | Term | Rate Guidance | Geography | Posted | Status
- **Row styling:** Compact rows (36px height), monospace font for numbers, color-coded type badges using existing CSS variables
- **Filters bar:** Filter by financing type, amount range, geography, PassportScore floor, posted date — all applied client-side with no page reload
- **Sort:** Default sort by posted descending. Clickable column headers for re-sort.
- **Right panel:** When row selected — shows full request details, counterparty PassportScore widget, "Submit Offer" button, "Open Room" button
- **Color palette:** Dark mode should feel like a trading terminal (deep navy backgrounds already exist in dark mode). Light mode: clean institutional white with Strike blue accents.
- **No friendly copy:** This page speaks to credit officers. No onboarding language, no explainer text. Data density is the point.

### TC.3 — Strike Place real-time subscriptions
**Action:**
- Add Supabase Realtime subscription on `financing_requests` table for the Strike Place page
- New requests appear at the top with a subtle flash animation (`background: rgba(20, 40, 204, 0.1)` fading to normal over 1.5s)
- Updated requests (status change, new offer) update in place without full refresh
- Stats row (TC.2 top bar) recalculates on each realtime event

### TC.4 — Redesign bank program flow: program-first, then deal-sourcing
**Current flow (broken):** Bank creates program → invites specific anchors → waits.
**New flow:** Bank creates program (sets parameters) → goes to Strike Place → submits offers on open financing requests → accepted offers link to their program.

**Action:**
- Programs page for banks: remove the "invite anchor" primary CTA from program detail. Replace with: "Source deals on Strike Place →" button that navigates to Strike Place pre-filtered for deals matching this program's financing type and currency.
- Program detail page should show: program parameters, linked deals (deals where the bank has a funded/active offer), offer pipeline (pending offers), available capacity.
- "Linked deals" are populated automatically when a financing offer is accepted — this linkage must be implemented if not already: when `financing_request_offers.status = 'accepted'`, create a `deals` record with `bank_id`, `program_id` (if the bank has a matching program), `deal_source = 'marketplace'`.

### TC.5 — Strike AI: "Create Program" mid-flow when bank has no matching program
**Trigger:** Bank clicks "Submit Offer" on a Strike Place financing request but has no program matching the financing type/currency of the request.

**Action:**
- Detect mismatch: when "Submit Offer" is clicked, check `programs` for this bank filtered by `financing_type` matching the request type and `currency` matching the request currency
- If no match found: do NOT show an error. Instead, open the Strike AI overlay (pre-populated) with message: "You don't have a [Reverse Factoring] program in [USD] yet. I can create one for you right now — it takes about 2 minutes. Want to proceed?"
- Strike AI guides through: program name → credit limit → rate range → payment terms → confirm
- On confirm: calls `POST /api/programs` to create the program, then returns the user to the offer submission form with the new program pre-selected
- This uses the existing agent tool pattern from TASKS.md T8.9 `create_program` tool — wire it here
- Log the action to `agent_actions` table

### TC.6 — Remove KYB approval from bank portal entirely
**Context:** Banks no longer approve KYB. Strike platform handles org verification. Banks evaluate counterparties via PassportScore, not KYB status.
**Action:**
- Remove KYB approval/rejection UI from bank portal (the decision panel with approve/reject/request-info buttons)
- The KYB detail page (`/kyb/[org_id]`) for bank users: convert to read-only view showing PassportScore, business details, trade history — no action buttons
- Remove `approve_kyb` from any agent tool definitions used in bank portal context
- Update any bank dashboard widgets that reference "KYB Queue" — replace with "PassportScore Overview" widget showing distribution of scores across their portfolio
- Strike Admin retains full KYB management capability — do not touch admin portal KYB

---

## TRACK D — ONBOARDING REDESIGN: TWO-TIER GHOST MODE
> Touches: `app/(auth)/`, `app/(onboarding)/`, signup flow, onboarding wizard, organizations table
> Agent: Solo. Estimated: 6–8 hours.
> This is a complete restructure of the entry flow. Read carefully.

### TD.1 — Simplify signup to 5-field form (Tier 0)
**Current state:** Signup leads directly into the KYB wizard.
**Target state:** Signup creates a ghost org. KYB wizard is a separate post-signup flow.

**Signup form fields (exactly these, no more):**
1. Full Name
2. Email
3. Password
4. Company Name
5. Country (dropdown)
6. Role: Anchor / Supplier / Both (radio or segmented control)

**On submit:**
- Create `users` record
- Create `organizations` record with: `kyb_status = 'not_started'`, `network_visible = false`, `passport_score = null`
- Log them in immediately
- Redirect to dashboard (ghost mode)

**No email verification gate before accessing the platform.** Email verification can be a nudge/banner, not a hard gate.

### TD.2 — Ghost mode dashboard experience
**What a Tier 0 (ghost) user sees:**
- Full platform shell is visible: sidebar, topbar, all nav items
- Every actionable page shows a locked state — a centered card with:
  - Strike logo
  - Heading: "Activate your Passport to unlock this feature"
  - Body: one sentence explaining what they're missing (specific to the page — e.g., on Deals: "Submit financing requests and manage your trade pipeline")
  - CTA button: "Activate Passport →" → navigates to `/onboarding`
- Strike AI panel is visible but limited: can answer questions about the platform, cannot access org data, cannot take actions. System prompt for ghost users: "This user has not completed their Passport. Your only goal is to help them understand the value of completing it and guide them to click 'Activate Passport'."
- PassportScore widget on dashboard shows: score ring with `—` inside, label "Passport Inactive", subtext "Complete verification to get your PassportScore"
- Strike Place (marketplace) is visible in browse-only mode: listings are visible, but "Submit Offer" / "Request Financing" / any action button shows the locked state card

### TD.3 — Passport activation wizard (full KYB — Tier 2)
**This is the existing onboarding wizard, re-entered as a post-signup flow.**

**Entry points:**
- "Activate Passport" CTA on every locked feature
- Passport page (always visible in sidebar) — shows activation prompt when `kyb_status = 'not_started'`
- Persistent top banner (dismissible once, shown again after 24h): "Your Passport is inactive. Complete verification to start transacting."

**Wizard steps (same structure as current onboarding, restructured):**

**Step 1 — Identity & Legal**
Fields: Legal Company Name, Operating/Trade Name, Business Registration Number, Tax ID/EIN, Country of Incorporation, State/Province, Date of Incorporation, Industry (NAICS dropdown), Products/Services (text area, 2-3 sentences max)

**Step 2 — Address & Contact**
Fields: Registered Business Address, Operating Address (if different toggle), Company Website, Company Email, Primary Contact Name + Title + Email + Phone

**Step 3 — Ownership & Compliance**
Fields: CEO/Director Name(s), UBO(s) + Ownership % (add-another pattern for multiple UBOs), PEP declaration (Yes/No), Sanctioned countries (Yes/No), Bankruptcy last 7 years (Yes/No), Material litigation (Yes/No)

**Step 4 — Financial & Trade Profile**
Fields:
- Annual Revenue Range (dropdown: <$1M / $1–5M / $5–25M / $25–100M / $100M+)
- Number of Employees (dropdown: 1–10 / 11–50 / 51–200 / 200+)
- Primary Operating Currency (dropdown)
- Countries You Source From (multi-select)
- Countries You Sell To (multi-select)
- Average Invoice Size (dropdown ranges)
- Average Payment Terms Offered / Received (30/45/60/90/120 days)

**Step 4 — Supplier-only additional fields:**
- Number of Active Customers (1–5 / 6–20 / 21–100 / 100+)
- Largest Customer % of Revenue (<10% / 10–25% / 25–50% / >50%)
- Financing Need: Invoices / POs / Both

**Step 4 — Anchor-only additional fields:**
- Number of Active Suppliers (same ranges)
- Largest Supplier % of Spend (same ranges)
- Typical Payment Terms Offered to Suppliers

**Step 5 — Systems & Intent**
Fields: ERP System (SAP / Oracle / NetSuite / QuickBooks / Xero / Other / None), Primary Bank Name, Intent multi-select (Supplier financing / Buyer financing / Find new suppliers / Find new buyers / All of the above), AI matching toggle (Yes/No)

**Step 6 — Document Upload**
Documents split by role:

*All orgs:*
- Certificate of Incorporation / Business Registration (required)
- Government-issued Photo ID of authorized signatory — ID document, NOT selfie (required)
- Proof of Business Address — utility bill, bank letter, lease dated within 90 days (required)
- Corporate Ownership / UBO Declaration — signed document (required)

*Supplier-only additional:*
- Last 6 months business bank statements (required)
- Last 2 years financial statements (if available — clearly marked optional)
- Latest corporate tax return (if available — clearly marked optional)

*Anchor-only additional:*
- Last 2 years financial statements (if available)
- Board resolution or authority letter authorizing the signatory (required)

**Step 7 — Review & Submit**
- Summary of all entered data (read-only review)
- Checkbox: "I confirm all information is accurate and authorize Strike SCF to verify my business details"
- Submit button: "Activate My Passport"

**On submit:**
- Set `organizations.kyb_status = 'submitted'`
- Create document records in `documents` table
- Send confirmation email via Resend
- Redirect to dashboard with success banner: "Passport submitted! We'll notify you when verification is complete — usually within 1–2 business days."
- Platform unlocks immediately on submit (do NOT wait for manual approval to unlock features — see TD.4)

### TD.4 — Platform unlock on submission, not on approval
**Critical architectural decision:** Users gain full platform access when they submit their Passport (kyb_status = 'submitted'), not when it's approved. This removes the bank-approval bottleneck entirely.

**Action:**
- Update all feature gate checks: change condition from `kyb_status === 'approved'` to `kyb_status !== 'not_started'`
- `network_visible`: set to `true` on submission (org becomes visible to counterparties)
- `passport_score`: calculate initial score based on submitted data immediately after submission (call `/api/risk/score` for this org on submission)
- PassportScore will start in the 20–45 range (KYB submitted but unverified = 15/25 for KYB component). This is correct and expected.
- Strike Admin still reviews submissions and can flag/suspend — but the default is open, not gated.

### TD.5 — Enforce ghost mode at API layer
**Action:**
- Add a middleware check (or per-route check) that excludes `network_visible = false` orgs from ALL counterparty queries:
  - `GET /api/marketplace/listings` — exclude ghost orgs as listing creators
  - `GET /api/marketplace/financing` — exclude ghost orgs as requestors
  - Any endpoint that returns org lists to another org — add `.eq('network_visible', true)` filter
- Ghost orgs CAN read platform data (browse Strike Place listings, see programs structure) — they just cannot appear TO others
- This is enforced in API routes, not RLS (service role bypasses RLS — manual filter required)

---

## TRACK E — STRIKE PASSPORT UI FIXES
> Touches: Passport page, PassportScore widget, dashboard
> Agent: Solo. Estimated: 3–4 hours.
> Parallel-safe: Yes.

### TE.1 — Remove PassportScore toggle
**Problem:** There is a toggle to show/hide the PassportScore on the Passport page. This should not exist — the score is always visible.
**Action:**
- Find the toggle control on the Passport page and remove it entirely
- PassportScore ring/widget is always rendered, always visible
- If the score is null (ghost mode / not yet calculated): show `—` with "Pending Verification" label — not hidden, not toggled

### TE.2 — Passport page always in sidebar, always accessible
**Action:**
- Confirm "Strike Passport" is in the sidebar nav for ALL portals (bank, anchor, supplier) at all times
- In ghost mode (Tier 0): Passport page shows the activation wizard prompt, not a locked card — the Passport page IS the onboarding entry point, it should never be locked
- In submitted/pending state: Passport page shows submitted data in read-only mode with "Under Review" banner
- In active state: full Passport with all six sections populated

### TE.3 — Standardize AI insight cards: rounded corners across all portals
**Problem:** Bank portal has square AI insight cards. Anchor and supplier portals have rounded AI insight cards. They should match across all portals.
**Action:**
- Identify the AI insight card component(s) — there may be multiple implementations
- Standardize: all portals use the rounded-corner variant (same border-radius as anchor/supplier)
- Do not change card content or behavior — only the visual treatment
- Locate and remove any square-card CSS overrides specific to the bank portal

---

## TRACK F — STRIKE AI PANEL REDESIGN
> Touches: `ai-panel.tsx` or equivalent, Strike AI page, conversation log
> Agent: Solo. Estimated: 5–7 hours.

### TF.1 — Redesign conversation log collapse — Claude.ai pattern
**Problem:** Current collapse button for the conversation log looks out of place.
**Action:**
- Study the claude.ai pattern: conversation history is in a left sidebar. Sidebar has a collapse toggle that slides it out of view. Main chat area expands to fill the space.
- Implement the same: conversation log is a left panel (fixed width ~280px). Has a collapse button — icon only, no label, positioned at the top-right of the panel. On collapse: panel slides to width 0 (or translates off-screen), main chat area fills the full width. On expand: panel slides back.
- Use CSS transitions: `transition: width 200ms ease` or `transform: translateX(-100%)` with `transition: transform 200ms ease`
- Persist collapse state in `localStorage` key `strike_ai_log_collapsed`
- The collapse button itself should be subtle — a `‹` / `›` chevron icon, not a labeled button

### TF.2 — Strike AI floating trigger button
**Action:**
- Confirm the floating Strike AI trigger button exists on every portal page
- It should show an unread signal count badge (red dot or number) when there are active signals for this org
- Clicking it opens the Strike AI overlay
- Confirm it does NOT appear on the onboarding wizard pages (would be confusing mid-onboarding)

### TF.3 — Remove the standalone "Strike AI" sidebar nav item
**Action (confirm TA.4 handled this):**
- Verify there is no "Strike AI" or "AI Agent" item in any portal sidebar after TA.4 runs
- Strike AI is only accessible via the floating trigger button
- If there is still a sidebar item after TA.4: remove it here

---

## TRACK G — STRIKE ROOMS UI OVERHAUL
> Touches: `(portal)/rooms/`, `rooms/[id]/` pages
> Agent: Solo. Estimated: 6–8 hours.
> This is a complete UI rebuild of the rooms experience.

### TG.1 — Rooms page: add left conversation list panel
**Problem:** When inside a room (chat page), there is no left panel showing other conversations. Users have no way to navigate between rooms without going back to the rooms list.

**Target layout (identical structure to Slack, iMessage, or claude.ai):**
```
┌──────────────────────────────────────────────────────────┐
│  [Collapse ‹]  ROOMS              [+ New Room]           │
├────────────────┬─────────────────────────────────────────┤
│                │                                         │
│  Public        │  [Room Name]                [Members]  │
│  > Industry    │  ─────────────────────────────────────  │
│  > Financing   │                                         │
│                │  [Messages]                             │
│  Private       │                                         │
│  > Deal w/     │                                         │
│    Pacific Dyn │                                         │
│  > Rate nego…  │                                         │
│                │  ─────────────────────────────────────  │
│                │  [Input box]              [Send]        │
└────────────────┴─────────────────────────────────────────┘
```

**Action:**
- The rooms list (left panel) is ~280px wide, shows:
  - Section header "Public" with public rooms this org has joined
  - Section header "Private" with private/deal rooms
  - Each room item: room name, last message preview (truncated), unread count badge, timestamp
  - Active room is highlighted
- Left panel is collapsible (same chevron pattern as TF.1) — toggle persists in `localStorage` key `strike_rooms_nav_collapsed`
- Clicking a room in the left panel: navigates to that room's chat, does not cause full page reload if possible (use router.push or state swap)
- "New Room" button in panel header opens the room creation modal

### TG.2 — Rooms chat page visual redesign
**Problem:** The chat UI looks unpolished.
**Target:**
- Messages from current user: right-aligned, Strike blue background (`var(--blue)`), white text
- Messages from others: left-aligned, card background (`var(--card-bg)` or `var(--offwhite)`), ink text
- Avatar/org initials circle next to each message (left-side messages)
- Timestamps: small, muted, shown on hover or grouped by date separator
- Message input: full-width, rounded, clear focus ring. Send button is an arrow icon, not a label.
- Room header: room name (bold), member count, "View Members" link — clean, no clutter
- No vestigial borders or box-shadows that make it look like a form

### TG.3 — Unread count and notifications integration
**Action:**
- Sidebar nav "Strike Rooms" icon should show an unread count badge (number of rooms with unread messages)
- Badge updates in real-time via Supabase Realtime subscription on `room_messages` where `room_id` in user's joined rooms AND `created_at > last_read_at` from `room_participants`
- Update `room_participants.last_read_at` when user opens a room and scrolls to bottom

---

## TRACK H — "FINANCE AN EXISTING TRADE" IMPLEMENTATION
> Touches: deals import flow, new API routes, document extraction
> Agent: Solo. Estimated: 6–8 hours.
> Depends on: TD.4 (platform unlock logic) for authorization check.

### TH.1 — Understand current state
**Action (read before writing any code):**
- Find the "Finance an existing trade" button and confirm it currently does nothing (likely a stub CTA)
- Locate `(portal)/deals/import/` and `app/api/deals/extract/` — these are the existing import and AI extraction routes
- Read both files completely before proceeding

### TH.2 — Define the "Finance an existing trade" flow
**Use case:** An org wants to submit a financing request for a trade that:
- Did NOT originate on Strike
- May involve a counterparty who is NOT on Strike

**Flow:**
1. User clicks "Finance an existing trade" → opens a modal or navigates to `/deals/import`
2. **Step 1 — Trade details:** User enters:
   - Trade type (Invoice / Purchase Order / both)
   - Invoice/PO number
   - Invoice/PO amount + currency
   - Invoice/PO date
   - Due date / expected payment date
   - Counterparty name (free text — they may not be on Strike)
   - Counterparty country
   - Counterparty email (optional — to invite them to Strike later)
   - Short description of goods/services
3. **Step 2 — Document upload:** Upload the invoice PDF and/or PO document. Strike AI extracts the structured data and pre-fills Step 1 fields (use existing `/api/deals/extract` route). User can review and correct AI-extracted fields.
4. **Step 3 — Financing preferences:**
   - Financing type (Reverse Factoring / Invoice Factoring / PO Financing — whichever is relevant to trade type)
   - Amount to finance (default: 90% of invoice, adjustable)
   - Preferred tenor (30/60/90/120 days dropdown)
   - Notes to banks (optional free text)
   - Post as Open Request (any bank can offer) or Target Specific Bank (dropdown of banks on Strike)
5. **Step 4 — Review & Submit:** Summary. Submit creates:
   - `deals` record with `deal_source = 'imported'`, counterparty details stored in deal notes/metadata
   - `financing_requests` record of type 'open' (or 'preset' if a specific bank was selected)
   - Notification to relevant banks on Strike Place

### TH.3 — Counterparty not on Strike — handling
**Action:**
- If user enters a counterparty email: after deal submission, send an invitation email via Resend: "Your counterparty [OrgName] has submitted a trade for financing on Strike SCF. Joining Strike will allow you to verify the trade and potentially access financing yourself."
- Store the counterparty email in the `deals` record (add `external_counterparty_email` column via migration if it doesn't exist — check schema first)
- On Strike Place, the financing request shows "Counterparty: [Name] (Not yet on Strike)" — banks can still fund against the invoice, they just evaluate the risk differently
- Do NOT block the financing request because the counterparty isn't on Strike — that's the whole point of this feature

### TH.4 — Wire the button
**Action:**
- Find the "Finance an existing trade" button across all portals where it appears
- Wire it to navigate to `/deals/import` (or open the modal if you choose modal pattern — modal is preferred for a cleaner UX)
- Button should only be enabled for orgs in Tier 2 (kyb_status !== 'not_started'). Ghost users see a locked state card.

---

## TRACK I — DARK MODE AUDIT & FIX
> Touches: `globals.css`, dark mode token overrides, component-level styles
> Agent: Solo. Estimated: 4–5 hours.
> Parallel-safe: Yes.

### TI.1 — Audit current dark mode token mapping
**Action:**
- Open `globals.css` and find the `@media (prefers-color-scheme: dark)` or `.dark` class token overrides
- List every token that is overridden in dark mode
- For each token: evaluate whether the override is correct (acceptable contrast, not eye-straining)

### TI.2 — Fix the known problem areas
**Target dark mode feel:** Deep navy base (#0D1B3E range), readable text, Strike blue accents that don't glow harshly, gold (#C9A84C) for highlights only — not backgrounds.

**Common dark mode problems to fix:**
- Text that is too light or too dark on its background (aim for WCAG AA minimum — 4.5:1 contrast ratio)
- Backgrounds that are pure black (#000) — replace with deep navy (`#0D1B3E` or `#0F1E3A`)
- Card backgrounds that are the same color as the page background — add subtle border or slight lightness offset
- Strike blue (#1428CC) as a background in dark mode — this is too bright. Use a darker variant (`#0D1E8A` or lower opacity) for backgrounds. Use the full blue for borders and icons only.
- Gold (#C9A84C) used on dark backgrounds: ensure text remains readable — gold on deep navy is fine; gold on black can be harsh
- Any pure white (#FFF) text on a slightly-off-dark background — keep it, do not change white text to gray unnecessarily
- AI insight cards: dark mode background should be a navy variant, not the same as card backgrounds — slight differentiation

### TI.3 — Test across components
**After fixing tokens:**
- Visually audit each portal (bank, anchor, supplier) in dark mode by checking:
  - Sidebar: nav items, active states, user button
  - Dashboard: stat cards, chart areas, notification items
  - Strike Place / marketplace: table rows, badges, stat bar
  - Rooms: message bubbles, left panel, input area
  - Passport: score ring, section cards
  - Onboarding wizard: step indicators, form fields, document upload areas
- Fix any component that still has hardcoded colors instead of CSS variables

---

## TRACK J — PORTAL TEXT CLEANUP
> Touches: various page headers, breadcrumbs, sidebar, onboarding
> Agent: Solo. Estimated: 1–2 hours.
> Parallel-safe: Yes. Fastest track — do this alongside others.

### TJ.1 — Remove all portal label text
**Action:**
- Global search across all `.tsx` files for the following strings (case-insensitive):
  - "Supplier Portal"
  - "Anchor Portal"
  - "Buyer Portal"
  - "Bank Portal"
  - "Strike SCF Portal"
- For each occurrence: remove the text entirely. Do not replace with anything — the UI context makes the portal self-evident.
- Exceptions: if the string appears in a COMMENT or in a string literal used only for logging/debugging (not displayed in UI) — leave it. Only remove user-visible text.

---

## EXECUTION ORDER

```
START IN PARALLEL (no dependencies):
  Track A — Navigation & sidebar         [AGENT 1]
  Track E — Passport UI fixes            [AGENT 2]
  Track I — Dark mode fixes              [AGENT 3]
  Track J — Portal text cleanup          [AGENT 4]

AFTER TRACK A COMPLETES (or parallel if agents are careful about portal-shell.tsx):
  Track B — Anchor/supplier nav          [AGENT 5]
  Track F — Strike AI panel              [AGENT 6]
  Track G — Strike Rooms                 [AGENT 7]

AFTER TRACK A + B:
  Track C — Bank portal redesign         [AGENT 8]  ← most complex, give it space
  Track D — Onboarding redesign          [AGENT 9]

AFTER TRACK D:
  Track H — Finance existing trade       [AGENT 10]
```

---

## AGENT OPERATING RULES

1. **Read `apps/web/CLAUDE.md` completely before writing a single line of code.**
2. **One track per agent.** Two agents must never edit the same file simultaneously. If your track requires a file another track is touching, wait or coordinate via BLOCKED note.
3. **`portal-shell.tsx` is a shared file.** Tracks A, B, C, F all touch it. Agent 1 (Track A) owns it. Other agents: read it, do not modify it. Submit your sidebar changes as a note in `SIDEBAR_CHANGES_NEEDED.md` and Agent 1 will apply them, OR wait for Track A to complete.
4. **No schema changes without a migration file** in `supabase/migrations/`. Track H may need one column — check first, write migration if needed.
5. **CSS changes:** All new styles use existing CSS variables. No raw hex values except where defining the token itself in `:root`.
6. **After every task:** `tsc --noEmit` must pass clean.
7. **Commit after each completed task:** `[TRACK-X] T{letter}.{number}: {description}`
8. **If blocked:** Write `BLOCKED_{TRACK}_{TASK}.md` in repo root and move to next task.

---

## EFFORT LEVEL RECOMMENDATION

**Run Opus at `max` effort (not `normal`).**

Rationale:
- Track C (bank portal redesign) requires genuine design judgment on the trading terminal aesthetic — Sonnet will produce safe/generic output. Opus produces the architectural decisions and visual reasoning needed.
- Track D (onboarding redesign) is a complete flow restructure with auth state implications — one wrong call (e.g., setting network_visible at the wrong point) breaks ghost mode for every user.
- Track G (Rooms) requires understanding the existing realtime subscription pattern and extending it correctly — wrong implementation creates race conditions.
- Tracks A/E/I/J are low-risk and could run at `normal`, but since you're running multi-agent it's simpler to set everything to `max` and not context-switch effort levels per agent.

**Suggested terminal setup:**
- Open 5 terminals simultaneously (A/E/I/J in parallel first, then B/F/G, then C/D, then H)
- Review each track's output before starting the next batch
- Track C and D deserve a full review before committing — they touch auth and the bank's core workflow

---

## DONE CRITERIA

This batch is complete when:
- [ ] Sidebar is collapsible with meaningful icons across all portals
- [ ] "Supplier Portal" / "Anchor Portal" / "Bank Portal" text is gone everywhere
- [ ] Settings and AI Agent removed from sidebar nav
- [ ] Transactions and KYB removed from bank sidebar
- [ ] Supply Graph shows "Coming Soon"
- [ ] Transactions and My Programs removed from anchor/supplier nav
- [ ] Strike Place in bank portal has trading terminal aesthetic with realtime stats
- [ ] Bank program flow: source deals from Strike Place, Strike AI creates program mid-flow
- [ ] KYB approval removed from bank portal UI
- [ ] Ghost mode: signup creates ghost org, full wizard is post-signup
- [ ] Platform unlocks on submission (kyb_status = 'submitted'), not on bank approval
- [ ] Ghost orgs excluded from all counterparty API queries
- [ ] PassportScore toggle removed — always visible
- [ ] AI insight cards rounded across all portals
- [ ] Rooms has left conversation panel, collapsible
- [ ] Rooms chat UI redesigned (message bubbles, layout)
- [ ] AI panel conversation log collapses Claude.ai-style
- [ ] "Finance an existing trade" is fully implemented
- [ ] Dark mode is clean — no eye-straining colors
- [ ] `tsc --noEmit` passes clean
