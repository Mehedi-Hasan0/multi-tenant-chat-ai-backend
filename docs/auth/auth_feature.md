# Auth Feature — Full Summary & Implementation Plan

Below is a single, self-contained summary of **everything we decided** for the Auth feature: architecture, components, data flows, token model, key management (local PEM now; pluggable to KMS later), integration with Supabase, widget flow, admin/service-account flows, security & RLS notes, testing, monitoring, rollout plan, and concrete next steps & artifacts to implement. Use this as your canonical reference for engineering, ops, and onboarding.

---

## 1 — One-line summary

A modular, secure auth service that uses Supabase for user credentials and session rotation, mints **app-issued RS256 JWTs** for all internal/external clients (users, agents, widgets, service accounts), serves a JWKS for verification, stores private keys locally now (PEM in env / encrypted artifact) and is architected so you can switch to Google KMS / Vault later with minimal changes.

---

## 2 — Architecture & Components

### High-level components

- **Auth Service (Vercel / Node + Express)**
  - Endpoints: `/v1/auth/login`, `/v1/auth/refresh`, `/v1/auth/logout`, `/v1/auth/introspect`, `/v1/public/widgets/init`, admin endpoints (`/v1/admin/...`), `/.well-known/jwks.json`.
  - Responsibilities: orchestrate Supabase login/refresh, mint RS256 JWTs, widget session issuance, audit logging, publish JWKS.
- **KeysService (abstraction)**
  - Implementations: `LocalPemKeys` (reads PEM from env) and later `GcpKmsKeys` (asymmetric sign via KMS). Exposes `sign()`, `getJWKS()` and `listPublicKeys()`.
- **Supabase (GoTrue + Postgres)**
  - Credentials, refresh/session management, persistent user/tenant data, extended `public.users` profile table, RLS usage.
- **Redis (Upstash)**
  - JTI replay cache, rate-limiting counters, session quick lookups (serverless friendly).
- **Orchestrator / Other services**
  - Verify app JWTs against JWKS, enforce tenant isolation, accept app JWTs only (not Supabase tokens).

### Deployment notes

- Short term: host Auth Service on **Vercel** (Hobby/free) — store PEM in Vercel env var; cache parsed key per function instance (cold start).
- Long term: switch KeysService to GCP KMS or Hashicorp Vault by replacing implementation only.

---

## 3 — Token model & claims

### Tokens

1. **App Access Token (RS256)** — short TTL (5–15 min)
   - Used by all backend APIs and widget/agent communications.
   - Signed by Auth Service private key (PEM now, KMS later).
2. **Refresh Token** — opaque (supabase-managed recommended for speed)
   - Supabase rotates refresh tokens; Auth Service calls Supabase to refresh and mints new app token.
3. **Service Tokens** — short-lived JWTs for service accounts; store token-hash for revocation.
4. **Widget Token** — ephemeral JWT minted by `POST /v1/public/widgets/init` with `roles: ['widget']` and minimal scopes.

### Canonical JWT claims

```json
{
  "iss":"https://api.example.com",
  "sub":"user:UUID" | "service:ID" | "session:ws_xxx",
  "aud":"ecom-agent",
  "iat": 1690000000,
  "exp": 1690000900,
  "jti":"uuid-v4",
  "tenant_id":"t_abc123",
  "roles":["tenant_admin","agent"],
  "scopes":["kb:read","orders:read"]
}
```

- `kid` in header required; JWKS used for verification.

---

## 4 — Primary API endpoints (outline)

- `POST /v1/auth/login` — email/password → use `supabaseAnon.auth.signInWithPassword()` → fetch user profile (service role) → createAccessToken (RS256) → return `{ access_token, refresh_token (supabase), expires_in, roles, tenant_id }`
- `POST /v1/auth/refresh` — body `{refresh_token}` → `supabaseAnon.auth.refreshSession()` → mint new RS256 access token → return rotated refresh token
- `POST /v1/auth/logout` — optional server-side cleanup; client should call Supabase signOut
- `POST /v1/public/widgets/init` — validate tenant & origin, create widget_session, mint widget_token (short TTL)
- `POST /v1/admin/service-accounts` — create service account entry
- `POST /v1/admin/service-accounts/:id/token` — mint service account token and store hashed token for revocation
- `POST /v1/auth/introspect` — check token against JWKS and DB (user active)
- `GET /.well-known/jwks.json` — publish current & recent public JWKs

---

## 5 — Database & RLS highlights (Supabase)

- **DB tables**:
  - `tenants`, `users` (profiles referencing `auth.users`), `service_accounts`, `service_account_tokens`, `widget_sessions`, `audit_logs`.
- **RLS**:
  - Use `auth.jwt()` claims to enforce tenant isolation: e.g. `USING (tenant_id = (auth.jwt() ->> 'tenant_id'))`.
  - Ensure `tenant_id` exists in `auth.users.app_metadata` during signup/first login.
- **Triggers**:
  - Mirror `auth.users` to `public.users` with triggers to populate tenant info and keep `app_metadata` in sync.

---

## 6 — Keys & JWKS — Local PEM now, pluggable to KMS later

### Local PEM approach (current plan)

- Generate RSA 4096 key pair.
- Store **private PEM** in Vercel env (`JWT_PRIVATE_PEM`) or encrypted artifact in CI.
- At cold start: import private PEM with `jose.importPKCS8()` and cache `KeyLike`.
- Export public JWK via `jose.exportJWK()` and serve `/jwks.json` (include `kid`).
- Sign tokens using `SignJWT` with `kid`.

### KMS pluggable plan (future)

- Implement `GcpKmsKeys` that calls Cloud KMS `asymmetricSign()` for signing; still publish public JWKs in JWKS endpoint for local verification.
- Swap implementations by configuration (factory pattern).

### Rotation policy

- Generate new key pair; deploy private PEM to environment; publish new public JWK; keep old JWKs in JWKS until `max_token_lifetime + safety` passes; then remove old JWK.

---

## 7 — Widget flow (ephemeral tokens)

1. Widget loads on merchant site (script contains `tenantId` and public config only).
2. Widget calls `POST /v1/public/widgets/init` with origin header.
3. Auth Service validates origin vs tenant.domains in Supabase.
4. Auth Service creates `widget_session` row and signs short-lived widget token (RS256) with `roles: ['widget']`.
5. Widget uses widget token in `Authorization` for subsequent API requests to Orchestrator/Backend.
6. If token expires, widget re-calls init (subject to rate limits).

Security: domain whitelist, rate limiting, JTI replay protection (Redis).

---

## 8 — Middleware & verification

- `authenticateToken` middleware:
  - Extract token, verify signature via JWKS (cached locally or via `createRemoteJWKSet`), check `iss`, `aud`, `exp`.
  - On `sub` starting `user:`, optionally check DB `status` for active user.
  - Attach `req.user` containing `id`, `tenant_id`, `roles`, `scopes`, `jti`.
  - `requireRole` and `requireScope` for route-level authorization.

Performance: verification done locally with public key(s) — no KMS calls.

---

## 9 — Security & hardening checklist

- Use RS256; do not publish private key.
- PEM stored in Vercel env for now; use encrypted artifacts in CI for repo storage.
- Use Upstash (serverless Redis) for JTI replay and rate-limits.
- Enforce domain whitelisting for widgets.
- Add audit logging for `auth_login`, `auth_refresh`, `auth_logout`, `widget_init`, `admin.token.mint`.
- Protect admin endpoints: require tenant_admin roles + additional MFA if possible.
- For order-sensitive actions (refunds), require agent confirmation — do not allow auto-LLM to perform sensitive actions without a human for thresholds.

---

## 10 — Testing & CI (must-have tests)

- Unit tests: `KeysService.sign()` and `getJWKS()` verification; `AuthService.login()`, `refresh()`.
- Integration tests (Newman/Postman): login → verify token via JWKS → call protected endpoint; widget init & protected call; admin token mint & revocation.
- Rotation test: staging rotate key and ensure old tokens still verify while new tokens are signed with new `kid`.
- Revocation test: add `jti` to revocation store and ensure token is rejected.

CI needs secure decrypt step (age/gpg) to create PEM for integration tests — do not store decrypted key in logs.

---

## 11 — Monitoring & SLOs

**Metrics**

- sign_ops_per_min, token_issue_latency_ms, token_verify_failures, widget_init_rate, revocation_events.

**Alerts**

- token_verify_failure_rate > 1% sustained.
- sign latency P95 > 500ms (KMS or cold-start issue).
- sudden spike in sign_ops (possible abuse).

**SLO**

- Token issuance P95 < 300ms (local PEM).
- JWKS availability 99.9%.

---

## 12 — Rollout plan & timeline (practical)

**Phase 0 — Prep (days 0–3)**

- Implement KeysService (LocalPem), JWKS, middleware, basic endpoints.
- Generate dev & prod PEMs, set in Vercel env (prod separate).
- Add Upstash Redis for JTI.
- Create Postman tests.

**Phase 1 — MVP (week 1–2)**

- Login/refresh flows (Supabase-backed) and app token minting.
- Widget init endpoint and widget-token usage.
- Audit logs & basic dashboards.
- Run integration tests & pilot with 1 merchant.

**Phase 2 — Harden (weeks 3–6)**

- Rate-limiting, JTI replay store + redis, admin service account tokens & revocation.
- Key rotation docs & CI scripts (encrypt/decrypt).
- Add monitoring & alerts.

**Phase 3 — Scale & KMS swap (month 2–3)**

- Implement `GcpKmsKeys` class and test in staging.
- Roll out to prod if needed for compliance or centralized key management.

---

## 13 — Acceptance criteria & launch checklist

- [ ] `/v1/auth/login` issues RS256 `access_token` with `kid` header and valid claims.
- [ ] `/.well-known/jwks.json` returned and verification of tokens works in sample backend.
- [ ] `POST /v1/public/widgets/init` returns `widget_token` and `session_id`; widget_token verifies.
- [ ] Rate limiting & JTI replay protection implemented (Upstash).
- [ ] Key rotation tested in staging and documented.
- [ ] CI integration tests pass (login → verify → protected endpoint).
- [ ] Monitoring & alerts configured.

---

## 14 — Files & artifacts I can produce for you now

(ready to create in canvas / repo — tell me which)

- `keys.service` interface + `localPem.ts` implementation (full code).
- `gcpKms.ts` stub (KMS implementation template).
- `AUTH_API.postman_collection.json` covering login, refresh, introspect, widget-init, protected echo.
- `KEY_ROTATION.md` runbook (detailed steps & templates).
- `CI` snippet (GitHub Actions) to decrypt PEM and run integration tests.
- `JWKS` test script (generate and validate JWKS).

---

## 15 — Suggested immediate next steps (priority)

1. Implement / commit `KeysService` (LocalPem) and `/.well-known/jwks.json` in the auth repo.
2. Add `JWT_PRIVATE_PEM` to Vercel env (staging) and deploy.
3. Run Postman collection: login → verify token → widget init → protected route. Fix issues.
4. Add Upstash Redis and plug JTI & rate-limit checks.
5. Create `KEY_ROTATION.md` and test rotation in staging (generate new PEM, deploy env, observe JWKS).

---
