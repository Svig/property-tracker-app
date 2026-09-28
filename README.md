# Viewing Register

A small full-stack app for capturing and tracking property clients: a sign-in
form for viewings, a dashboard to manage leads through to close, and admin
user management. Node/Express API + MariaDB (or PostgreSQL) + a plain
HTML/JS frontend (no build step).

```
property-tracker-app/
├── backend/          Express API
│   ├── config/db.js       database layer (MariaDB or Postgres, same API)
│   ├── middleware/auth.js JWT auth + admin guard
│   ├── routes/             auth, users, clients, viewing endpoints
│   ├── server.js
│   └── package.json
├── database/
│   ├── init.mariadb.sql   schema + seed admin (MariaDB)
│   └── init.postgres.sql  schema + seed admin (PostgreSQL)
├── public/            frontend (plain HTML/CSS/JS, served by Express)
└── README.md           you are here
```

This was built and smoke-tested locally against a real MariaDB instance
(login, client CRUD, notes, viewing state, CSV export, and role permissions
were all exercised end-to-end) before being handed to you, so the steps
below are exactly what worked.

---

## 1. Prerequisites

- Node.js 18+ (`node -v` to check)
- MariaDB 10.x **or** PostgreSQL 14+, running locally

## 2. Set up the database

### Option A — MariaDB

```bash
# Log in as an admin MySQL/MariaDB user
mysql -u root -p < database/init.mariadb.sql
```

This creates the `viewing_register` database, all tables, and seeds one
admin login.

**Then create a dedicated app user** — don't point the app at `root`.
On Debian/Ubuntu-family systems the `root` DB user is typically
socket-auth-only and won't accept the password-based connection this app
makes, which is exactly what we ran into while testing this build:

```sql
CREATE USER 'viewingapp'@'localhost' IDENTIFIED BY 'choose-a-real-password';
GRANT ALL PRIVILEGES ON viewing_register.* TO 'viewingapp'@'localhost';
FLUSH PRIVILEGES;
```

### Option B — PostgreSQL

```bash
psql -U postgres -f database/init.postgres.sql
```

Then create an app role the same way (`CREATE ROLE viewingapp LOGIN
PASSWORD '...'; GRANT ALL ON ALL TABLES IN SCHEMA public TO viewingapp;`).

## 3. Configure the backend

```bash
cd backend
cp .env.example .env
```

Edit `.env`:

```
DB_CLIENT=mariadb        # or "postgres"
DB_HOST=localhost
DB_PORT=3306              # 5432 for postgres
DB_USER=viewingapp
DB_PASSWORD=choose-a-real-password
DB_NAME=viewing_register
JWT_SECRET=<generate one — see below>
```

Generate a real secret rather than leaving the placeholder:

```bash
openssl rand -hex 32
```

## 4. Install and run

```bash
cd backend
npm install
npm start
```

You should see `Viewing Register running at http://localhost:4000`.
Open that URL in a browser — the frontend is served from the same server.

## 5. First login

```
Email:    admin@example.com
Password: ChangeMe123!
```

**Change this password immediately** — log in, then use
`POST /api/auth/change-password`, or add that as a small settings screen
before you go live (not built yet — flag if you want it added).

## 6. Adding more users

Only an admin can create logins, from the **Manage Users** tab. New users
default to the `agent` role (can capture and manage clients, cannot manage
other users). You can promote someone to `admin` at creation or by editing
their role afterwards.

---

## Security notes before you expose this beyond your own machine

This was built to be functionally correct and to run cleanly on your local
machine first, as you asked. A few things are worth tightening before any
public/hosted deployment:

- **JWT storage**: the frontend currently keeps the auth token in
  `localStorage`. That's fine for local/internal use; for public hosting,
  moving to an httpOnly cookie is safer against XSS token theft.
- **CSV export auth**: because a plain `<a href>` download link can't send
  an `Authorization` header, that one endpoint also accepts the token as
  `?token=`. It's the same JWT, just in the URL instead of a header —
  which means it can end up in browser history or server access logs.
  Fine for local use; for a public deployment, swap this for a short-lived,
  single-use signed download link instead.
- **Rate limiting**: there's currently no rate limit on `/api/auth/login`.
  Add one (e.g. `express-rate-limit`) before this is internet-facing.
- **HTTPS**: `npm start` runs plain HTTP. Put this behind a reverse proxy
  (Caddy, nginx, or your hosting provider's TLS) for anything beyond
  localhost.
- **CORS**: currently wide open (`cors()` with no options) since it's
  running locally. Lock this to your real frontend origin once deployed.

None of this blocks local use — it's the checklist for the day you move
this to "public consumption," which you mentioned is the eventual plan.

---

## API reference (quick)

All endpoints except `/api/auth/login` require `Authorization: Bearer <token>`.

| Method | Path | Who | Purpose |
|---|---|---|---|
| POST | `/api/auth/login` | anyone | log in, returns JWT |
| GET | `/api/auth/me` | any logged-in user | restore session |
| POST | `/api/auth/change-password` | any logged-in user | change own password |
| GET | `/api/users` | admin | list logins |
| POST | `/api/users` | admin | create a login |
| PATCH | `/api/users/:id` | admin | change role / active status |
| DELETE | `/api/users/:id` | admin | remove a login |
| GET | `/api/clients` | any logged-in user | list clients + notes |
| POST | `/api/clients` | any logged-in user | sign-in form submission |
| PATCH | `/api/clients/:id` | any logged-in user | update status/fields |
| DELETE | `/api/clients/:id` | any logged-in user | remove a client |
| POST | `/api/clients/:id/notes` | any logged-in user | add follow-up note |
| GET | `/api/clients/export/csv` | any logged-in user | download CSV |
| GET | `/api/viewing/current` | any logged-in user | current property + recents |
| POST | `/api/viewing/current` | any logged-in user | set the property being shown |

---

## Changelog — theme application (latest round)

The theme fields set from the super admin console (`app_name`,
`primary_color`, `brass_color`, `logo_url`) are now actually applied in
the tenant app — previously they were stored and editable but nothing
read them.

- `POST /api/auth/login` and `GET /api/auth/me` now join `tenants` and
  return a `theme` object alongside `user`.
- `public/app.js` applies it via `applyTheme()`: overrides the `--ink`
  and `--brass` CSS variables on `:root`, swaps the header's text for a
  logo `<img>` if `logo_url` is set, and sets the page title. Runs after
  every login and every session-restore (`/auth/me` on page load) — never
  cached across sessions, so a shared device can never show a stale
  tenant's colors after switching tenants or logging out. Verified this
  specifically: simulated a session carrying a leftover `--ink` override
  from a previous tenant, then applied an unbranded tenant's theme (all
  fields `null`) and confirmed the override is actually removed, not just
  overwritten with a falsy value.
- **Scope deliberately limited**: only the two "identity" colors are
  overridden, not every derived shade (`--ink-light`, `--brass-dark`,
  chip colors, etc.) — those stay fixed. A fully recomputed per-tenant
  palette (e.g. via `color-mix()` or precomputed light/dark variants) is
  a reasonable follow-up if the two-color override doesn't give enough
  visual distinction between tenants in practice.
- **Only applies after login** — the login screen itself (before a tenant
  is known) still shows generic "Viewing Register" branding, since there's
  no tenant resolution before authentication yet (see "Multi-tenancy"
  section below — subdomain-based resolution is what would enable
  pre-login branding).
- Tested end-to-end: created a tenant with custom colors/logo via the
  super admin console, logged in as its admin, confirmed the API returns
  that tenant's exact theme — and confirmed the Default tenant's admin
  still gets its own (unbranded) theme, not Acme's, logging in
  immediately after. No cross-tenant leakage.

### Previous round — global super admin layer

You now have two completely separate login surfaces:

- **The tenant app** (`/`) — what agents and tenant admins use day to day.
  Unchanged in spirit, just now sitting under a bigger platform.
- **The super admin console** (`/superadmin`) — a separate page, separate
  login, separate JWT type, for managing tenants themselves. Log in with:
  ```
  Email:    superadmin@example.com
  Password: ChangeMeSuperAdmin123!
  ```
  **Change this immediately** — there's no UI for it yet (only tenant
  users have a password-reset flow so far); use
  `POST /api/superadmin/auth/change-password` directly for now, or ask
  for a "change my password" screen to be added to the console.

**Why a separate table, not a flag:** a super admin is stored in a new
`super_admins` table, not as a special row in `users`. This was a
deliberate choice over "a user with no tenant_id" — with a genuinely
separate table, there is no query that could ever accidentally surface a
super admin inside a tenant's Manage Users list, because they're not in
the same table to begin with. Tested directly: created a new tenant,
fetched its user list as that tenant's own admin, and confirmed only the
tenant's own admin appears — the super admin is structurally absent, not
just filtered out.

**What the console does:**
- Lists every tenant on the platform, with user/client counts, theme
  colors, and subscription tier at a glance.
- **Create a tenant** — name, slug, theme (colors, logo, app display
  name), the future-use allowed email domain, subscription tier, and the
  tenant's first admin account, all in one step (a tenant needs at least
  one admin to be usable, so this isn't optional).
- **Edit a tenant** — same fields, plus active/inactive.
- **Delete a tenant** — cascades to every user, client, property, and
  note that belongs to it (existing foreign keys already had
  `ON DELETE CASCADE`; this is the first place that actually gets
  exercised). The console requires typing the tenant's slug to confirm,
  since this is irreversible.
- **Switch to Tenant** — the "log into any tenant" capability. This
  issues a normal tenant-scoped session token *as that tenant's primary
  admin* (not a fake identity — a real login as a real user in their
  data) and redirects to the tenant app. A "\u2190 Back to Super Admin" link
  appears in the tenant app's header for the rest of that browser
  session so you can hop back without logging in again.

**Two real gaps this surfaced and fixed while building it**, not just
theoretical: I actually created a second tenant, deactivated it, and
confirmed both of these before considering it done —
- Deactivating a tenant now actually blocks its users from logging in
  (previously `tenants.is_active` was just a column nobody checked).
  Worth knowing: this blocks new logins immediately, but a user already
  logged in keeps their session until their token naturally expires (12h)
  — it's not an instant kick. Flag it if you want immediate revocation;
  that needs a DB check on every request rather than just at login, which
  is a deliberate tradeoff I didn't want to make silently.
- The same email existing in two different tenants (two agencies onboard
  someone with the same personal address) is now handled correctly —
  login checks the password against every matching account rather than
  assuming the first match found is the right one.

**Subscription tiers:** `tenants.subscription_tier` exists and is
editable from the console (free/starter/pro), but nothing reads it
anywhere yet — no feature is actually gated by tier. That's genuinely
next-phase work: deciding which features belong to which tier, and
adding the checks in the relevant routes/UI. The column and the console
control exist now so that work is additive later, same reasoning as
adding `tenant_id` early.

**Migrating an existing database:** run `migrate_005_super_admin.*.sql`
if you already have `is_super_admin` on your `users` table (i.e. you ran
`migrate_004`) — it renames that column to `is_primary_admin`, adds the
`super_admins` table, seeds the first super admin, and adds
`subscription_tier`. Also worth knowing: `migrate_004`'s MariaDB script
was corrected based on real Aiven testing — `ADD COLUMN IF NOT EXISTS`
isn't valid MySQL syntax (that's a MariaDB-only extension) regardless of
host, and a `NOT EXISTS` correlated subquery needed rewriting as a
`LEFT JOIN ... IS NULL`. If you ran the original broken version and
patched it by hand already, you're in the same place this corrected
version would leave you — no need to re-run anything.

### Previous round — Render/Aiven hosting fixes, tenant-level admin protection, user profiles

**Hosting/deployment fixes, from getting this actually running on Render + Aiven:**
- The app now bootstraps its own database schema on every startup (creates
  tables, seeds the admin, safe to run repeatedly) — see `backend/scripts/bootstrap-db.js`.
  This exists because your machine couldn't reach Aiven directly (likely a
  corporate firewall blocking the non-standard port), but Render's servers
  could — so the app initializing itself removes the need to connect from
  your laptop at all.
- `db.js` now accepts a single `DATABASE_URL` connection string (what
  Aiven/Supabase/Neon show you directly) instead of requiring five separate
  `DB_HOST`/`DB_PORT`/etc variables. It also detects and correctly parses
  that same string if it gets pasted into `DB_HOST` by mistake (an easy
  slip since providers display it as one field) — with a warning to move
  it to `DATABASE_URL` properly, but it works either way now.
- SSL support (`DB_SSL`, `DB_SSL_CA`) for hosted databases, which require
  it — the original local-only version had no SSL config at all.

**Super admin protection:** the very first admin account (seeded on
first boot) is now flagged `is_super_admin` and can never be demoted,
deactivated, or deleted by anyone — including other admins, not just
themselves. This guarantees a tenant can never accidentally lock itself
out of admin access. Every other admin can be freely promoted, demoted,
or removed by any admin.

**Role changes:** any admin can now promote an agent to admin or demote
an admin back to agent, from a button on their row in Manage Users (not
available for the super admin, or as a way to demote yourself — the
existing self-protection and the new super-admin protection both still
apply).

**User profile editing:** name, email, and a new optional mobile number
field can now be edited per user from Manage Users (an "Edit" button
opens inline fields). Changing a user's email or mobile automatically
resets `email_verified`/`mobile_verified` back to unverified — there's no
verification flow wired up yet (see below), but the fields exist and the
flag resets correctly so a future verification feature has accurate data
to work from.

**Groundwork for future verification (not enforced yet, by design):**
- `users.email_verified`, `users.mobile`, `users.mobile_verified` columns
  exist now, but nothing in the app currently checks them — login isn't
  gated on verification, and there's no "verify" flow yet for either.
- `tenants.allowed_email_domain` exists for a mentioned future idea:
  restricting new user emails to a tenant's own domain (e.g. only
  `@youragency.co.za` addresses). Also unused for now — just a column
  ready for that logic later, same reasoning as adding `tenant_id` early.
- When you're ready to build either: email verification would need a
  token-based confirmation link (and a way to send email, which nothing
  in this stack currently does), and mobile verification would need an
  SMS provider (Twilio or similar) for an OTP code. Both are meaningfully
  sized features on their own — flag it when you want to tackle one and
  we can scope it properly rather than bolt on something half-working.

### Previous round — modal bug fix, sign-in form changes, managed properties

**Bug fix:** the "Save & Continue" / client-detail popups weren't closing.
Root cause: `public/app.js` appends modals directly to `<body>` (so they can
overlay everything), but nothing ever removed the old one when it closed —
each open silently stacked a new copy on an invisible leftover. Fixed in
`render()`: any existing modal is now removed at the start of every
re-render, before deciding whether a fresh one is needed. No more full
page refresh needed.

**Sign-in form changes:**
- Approximate budget is now two currency-prefixed inputs (from/to) with
  live thousands-formatting, instead of free text.
- "How did you hear about this viewing?" is now multi-select, and reads
  "...this viewing/us?"
- A freehand field follows it, labelled "Referred by who?" when Referral
  is selected, otherwise "Notes" — stored as `source_detail`.
- Confirmation message updated to: *"Thank you, `<name>`! Enjoy your tour
  of the home. If you have any questions or would like price and feature
  sheets, an agent is nearby to help you."* — plus a "View Listing" button
  if the current property has a listing URL.

**Properties are now a managed, first-class thing**, not just a text
label:
- A new **Properties** tab (any logged-in user) to add/edit/delete
  properties with name, address, and listing URL.
- The "change property" screen now picks from your saved properties (with
  autocomplete) or quick-adds a new one by name on the fly.
- Every sign-in links to a property (`property_id`), so "View Listing"
  (opens in a new tab) can show up anywhere that property is referenced.
- Each property has a **Visitors** report — everyone who's signed in for
  it, most recent first.
- Each client's detail view shows their **viewing history** — every
  property they've signed in for and when, matched by phone number within
  the tenant. This is a phone-number match, not a formal merged "person"
  record — a typo'd number won't link up. Worth knowing if you want a
  stricter identity model later (dedupe on save, a manual "merge" action,
  etc.) — flag it if that's worth building next.

**Migrating an existing local database:** don't re-run `init.mariadb.sql`
or `init.postgres.sql` against a database you already set up — it'll try
to recreate tables that exist. Instead run the matching migration
script(s) for whatever you're missing:
- `database/migrate_002_properties.*.sql` — properties, property linking
- `database/migrate_004_user_profile.*.sql` — super admin flag, mobile
  number, verification-groundwork columns

A fresh install (including the auto-bootstrap on first deploy) just uses
the current init scripts directly and gets everything in one go.

---

## Keeping this codebase up to date as it evolves

The easiest workflow from here: put this folder under git locally, and
from then on I can give you either full updated files (as this
conversation has been doing) or you can ask me to describe changes as a
diff — either way, `git diff` after copying updated files over shows you
exactly what changed, and `git log` gives you a real history instead of a
pile of zip files.

```bash
cd property-tracker-app
git init
git add .
git commit -m "Initial version"
```

Next time you get an updated zip from me: extract it over the existing
folder (your `.env` and `node_modules` aren't in the zip, so they're
untouched), then `git status` / `git diff` shows precisely what changed
before you commit it.

**Honest recommendation given how this session went:** a chat interface
is a genuinely awkward way to iterate on a real, multi-file codebase —
every round trip means re-explaining context, re-pasting file content,
and me re-testing things from scratch in a throwaway container each time
(which is exactly why this session needed several rounds of "the
container reset, let me reinstall MariaDB again"). Claude Code works
directly in your actual project folder on your machine: it keeps the real
git history, runs your real dev server, and can act on the codebase
directly rather than through file uploads/downloads each round. For
ongoing work on this app specifically, it would substantially cut the
overhead you're feeling right now.

## Multi-tenancy & rebranding — where this stands now

You asked for `tenant_id` to be added now so coming back to multi-tenant
later is additive rather than a rewrite. That's done — not just a nullable
column bolted on, but wired through the whole stack:

- **Schema**: a `tenants` table exists (with `app_name`, `primary_color`,
  `brass_color`, `logo_url` columns ready for per-tenant theming). Every
  other table — `users`, `clients`, `client_notes`, `current_viewing`,
  `recent_properties` — carries `tenant_id`, with foreign keys and indexes
  on it. `current_viewing` is now keyed by `tenant_id` directly (one row
  per tenant) instead of a fixed singleton row. `users.email` is unique
  per tenant, not globally, so the same email can exist in two tenants.
- **Backend**: the JWT now carries `tenant_id`, and every single query in
  every route file — list, create, update, delete, notes, CSV export,
  current viewing — filters by `req.user.tenant_id`. This was actually
  tested, not just written: I stood up a second tenant locally, logged in
  as both, and confirmed zero crossover — separate client lists, separate
  viewing properties, separate user lists, and a tenant-1 admin gets a
  clean 404 (not the data) when guessing at a tenant-2 client's ID.
- **Seed data**: one tenant (`Default`, id 1) is seeded, with the admin
  user inside it. Nothing about how you use the app today changes — you
  just happen to be the only tenant.

### What's now built vs. what's still open

Tenant provisioning and a super-admin tier — both listed as "not built"
in the round that first added `tenant_id` — are now built, tested, and
covered above in the "global super admin layer" changelog entry. What's
genuinely still open:

1. **Tenant resolution for public traffic** — today, tenant comes from
   the JWT, which is fine once someone's logged in. For a public
   multi-tenant deployment you'd typically also resolve tenant *before*
   login (e.g. by subdomain — `acme.viewingregister.com`) so each
   company's login page can carry its own branding. That's a routing
   layer, not a data model change.
2. **Applying the theme columns to the actual UI** — `tenants.primary_color`
   / `brass_color` / `logo_url` are now editable from the super admin
   console, but the tenant app itself (`public/styles.css`'s CSS
   variables) doesn't read them yet — every tenant currently looks the
   same regardless of what's set. Wiring that up (fetch the tenant's
   theme at login, apply as CSS variable overrides) is a self-contained
   frontend task.
3. **Subscription tier enforcement** — the tier is stored and editable,
   nothing is gated by it yet. See the changelog entry above.
4. **Billing/plan limits**, if this is ever sold rather than used
   internally. Out of scope unless you take this commercial.

Short version: the hard, easy-to-get-wrong parts (data isolation,
platform-level tenant management, keeping a super admin structurally
separate from tenant data) are done and tested. What's left is theming
and monetization, which you can build incrementally whenever you're
ready — nothing here needs another data-model rework to get to it.
incrementally without touching what's already here.
