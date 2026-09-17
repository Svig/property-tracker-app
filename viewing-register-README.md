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

### What's still not built (the genuinely new work when you're ready)

Having `tenant_id` everywhere removes the risky part (retrofitting
isolation onto live data). What's left is additive, not a migration:

1. **Tenant provisioning** — right now new tenants only exist if you
   insert a row into `tenants` by hand. A real "sign up a new company"
   flow (creates a tenant + its first admin) doesn't exist yet.
2. **Tenant resolution for public traffic** — today, tenant comes from
   the JWT, which is fine once someone's logged in. For a public
   multi-tenant deployment you'd typically also resolve tenant *before*
   login (e.g. by subdomain — `acme.viewingregister.com`) so each
   company's login page can carry its own branding. That's a routing
   layer, not a data model change.
3. **Applying the theme columns** — `tenants.primary_color` /
   `brass_color` / `logo_url` exist but nothing reads them yet. Wiring
   them into `public/styles.css`'s CSS variables at login time is a small
   frontend task once you're ready.
4. **A super-admin tier** — someone above tenant-admins who can create
   tenants and see across all of them (for support/billing). Not built;
   today's `admin` role is scoped to its own tenant only, by design.
5. **Billing/plan limits**, if this is ever sold rather than used
   internally. Out of scope unless you take this commercial.

Short version: the hard, easy-to-get-wrong part (data isolation) is done
and tested. What's left is provisioning and routing, which you can build
incrementally without touching what's already here.
