# Threat Model

## Project Overview
Dienstplan-App is a multi-tenant scheduling and time-tracking SaaS for personal assistance employers. The production system is a React SPA in `artifacts/dienstplan` backed by an Express API in `artifacts/api-server`, with PostgreSQL persistence and session-cookie authentication. Primary actors are assistants, tenant admins, and a platform superadmin/operator.

Production scan scope:
- `artifacts/api-server`
- `artifacts/dienstplan`
- shared production libraries used by those artifacts (`lib/db`, generated API contracts, entitlement helpers, team-scoping helpers)

Usually out of scope unless production reachability is demonstrated:
- `artifacts/mockup-sandbox`
- dev/test scripts and seeders
- dev-only routes guarded by `NODE_ENV !== "production"`
- local test harnesses and Playwright helpers

Deployment assumptions:
- Replit terminates TLS for deployed traffic.
- `NODE_ENV` is `production` in deployed environments.
- Current deployment visibility is `private`, which reduces anonymous public reachability, but authenticated tenants, invited assistants, superadmins, and anyone holding intentionally public tokens or URLs remain valid threat actors.
- The iframe embedding model matters for cookie behavior, but correct TLS transport is assumed to be handled by the platform.

## Assets
- **Tenant business records** — schedules, contracts, shift models, time-tracking entries, and analytics derived from them.
- **Sensitive personnel data** — names, emails, addresses, payroll-related HR fields, tax data, social-security data, health-insurance data, and IBANs.
- **Authentication material** — session cookies, password hashes, invitation tokens, and calendar-feed tokens.
- **Operator capabilities** — platform-wide plan changes, monitoring data, and superadmin-only APIs.
- **Branding and generated documents** — uploaded logos and PDF exports that users may treat as official records.
- **Approval/audit evidence** — who confirmed time entries and when.

## Trust Boundaries
- **Browser to API** — every client request is untrusted until the server authenticates and authorizes it.
- **Session boundary** — possession of a session cookie must not outlive account revocation or role changes beyond intended behavior.
- **Tenant/team boundary** — ownership and `team_members` rows define which data a user may read or modify.
- **Public/tokenized boundary** — calendar feeds and any storage-backed URLs that work without a normal app session.
- **API to object storage** — uploaded files and object fetches must preserve the intended confidentiality of “private” assets.
- **Operator boundary** — `/api/operator/*` must remain reachable only to genuine superadmins.

## Scan Anchors
- `artifacts/api-server/src/middleware/auth.ts`
- `artifacts/api-server/src/lib/teams.ts`
- `artifacts/api-server/src/routes/*.ts`
- `artifacts/api-server/src/lib/objectStorage.ts`
- `artifacts/dienstplan/src/pages/einstellungen.tsx`
- `artifacts/dienstplan/src/lib/pdf-export.ts`
- Dev-only area to usually ignore: `artifacts/mockup-sandbox`

## Threat Categories

### Spoofing
The system issues local sessions and invitation tokens, and it exposes tokenized calendar feeds. The application must ensure that only the intended user can mint or redeem identity-bearing tokens, and that role-bearing sessions are revalidated enough to prevent stale or forged identity from remaining trusted.

Required guarantees:
- Invitation and password-setup flows must be scoped to the correct tenant and target account.
- Public tokens must be unguessable, revocable, and tied to the correct owner state.
- Protected routes must not rely solely on stale session state when account disablement or role revocation should take effect.

### Tampering
Tenant admins can create and modify operational records, but must never be able to alter shared platform state or another tenant’s data. Branding, team membership, and time-tracking confirmation fields are especially sensitive because they can change what other users trust.

Required guarantees:
- Shared or fallback configuration must be operator-owned or account-scoped, never implicitly global-writable.
- Membership changes must require legitimate tenant ownership and an explicit trust relationship.
- Security-relevant audit fields, such as approver identity, must be derived from the authenticated actor server-side.

### Repudiation
Time-tracking approvals and plan or account changes can affect payroll and operations. The system needs a trustworthy record of who performed these actions.

Required guarantees:
- Audit-relevant actor fields must not be client-controlled.
- Account deactivation and other revocation actions must reliably cut off future use so logs remain meaningful.

### Information Disclosure
The core product stores sensitive HR and schedule data across multiple tenants. The main risk is broken team scoping, accidental global fallbacks, or public access to assets meant to live in private storage.

Required guarantees:
- Every data-returning route must enforce the correct team or self scope.
- Bootstrap or fallback behaviors must not expose platform-wide user tables or other tenant records.
- Private object-storage paths must not become publicly readable merely because a path is known.

### Denial of Service
A few endpoints can allocate resources or trigger background work, especially storage uploads and file-serving flows. In this project, the more realistic production DoS risk is abusive file upload or storage consumption rather than classic infrastructure exhaustion.

Required guarantees:
- Upload URL issuance must be restricted to intended callers and bounded by the intended feature use.
- Public or tokenized endpoints should avoid unbounded expensive work.

### Elevation of Privilege
The biggest privilege boundary is between one tenant and another, then between normal admins and the platform superadmin. Any route that trusts raw IDs, shared membership state, or globally shared configuration is a candidate for cross-tenant escalation.

Required guarantees:
- Admin capabilities must remain confined to the caller’s own teams unless an operator-only path explicitly broadens scope.
- Team membership must not be forgeable across tenants.
- Operator routes must require a real superadmin state from the database.

## Explicit Exclusions for Repeated Scans
- Ignore `artifacts/mockup-sandbox` unless a production route imports or exposes it.
- Ignore dev-only helpers, seed scripts, and local setup tools unless they are reachable in production.
- Do not treat the internal object-storage sidecar call to `127.0.0.1:1106` as SSRF by itself; it is an internal service dependency, not attacker-controlled egress.
