# Active Tasks

> Superseded: this file is a historical snapshot and is no longer the planning source of truth. Use `BACKLOG.md` for the proposed canonical backlog and `AUDIT-REPORT.md` for the May 2026 audit evidence.

Current work in progress. One task actively worked at a time.

---

## 🎯 CURRENT: Auth + OAuth Implementation

**Type**: coding
**Created**: 2026-01-27
**Status**: ready-to-start

### Objective
Validate basic auth (✅ complete), add Apple OAuth (primary), then Google OAuth.

### Audit Results
- ✅ login/signup/logout routes
- ✅ session management (cookies, 30 day expiry)
- ✅ password hashing (bcrypt)
- ✅ OAuth model in prisma schema
- ✅ User model supports OAuth-only users
- ❌ no OAuth routes
- ❌ no OAuth helper functions

### Work Units (TDD)

#### Unit 1: OAuth Utility Functions
**Files:** `app/lib/auth.server.ts`, `test/lib/auth.server.test.ts`
**Scope:**
- [ ] `findOrCreateOAuthUser(provider, providerUserId, providerUsername, email?)` — find existing OAuth link or create new user
- [ ] `linkOAuthAccount(userId, provider, providerUserId, providerUsername)` — link OAuth to existing user
- [ ] Tests for: new user creation, existing user lookup, account linking, duplicate prevention

#### Unit 2a: Apple OAuth Initiation
**Files:** `app/routes/auth.apple.tsx`, `test/routes/auth.apple.test.ts`
**Scope:**
- [ ] Route that redirects to Apple's authorization URL
- [ ] State parameter for CSRF protection
- [ ] Proper scopes (name, email)

#### Unit 2b: Apple OAuth Callback
**Files:** `app/routes/auth.apple.callback.tsx`, `test/routes/auth.apple.callback.test.ts`
**Scope:**
- [ ] Handle Apple's POST response (id_token)
- [ ] Verify JWT, extract user info
- [ ] Call findOrCreateOAuthUser
- [ ] Create session, redirect

#### Unit 2c: Apple Sign-In Button
**Files:** `app/routes/login.tsx`, `app/routes/signup.tsx`
**Scope:**
- [ ] Add "Sign in with Apple" button
- [ ] Link to auth/apple route

#### Unit 3a: Google OAuth Initiation
**Files:** `app/routes/auth.google.tsx`, `test/routes/auth.google.test.ts`
**Scope:**
- [ ] Route that redirects to Google's authorization URL
- [ ] State parameter for CSRF protection

#### Unit 3b: Google OAuth Callback
**Files:** `app/routes/auth.google.callback.tsx`, `test/routes/auth.google.callback.test.ts`
**Scope:**
- [ ] Handle Google's response (code)
- [ ] Exchange code for tokens
- [ ] Get user info from Google
- [ ] Call findOrCreateOAuthUser
- [ ] Create session, redirect

#### Unit 3c: Google Sign-In Button
**Files:** `app/routes/login.tsx`, `app/routes/signup.tsx`
**Scope:**
- [ ] Add "Sign in with Google" button
- [ ] Link to auth/google route

### Environment Setup Needed
- Apple Developer account: Service ID, Key, Team ID
- Google Cloud Console: OAuth Client ID, Secret

### Progress Log

#### 2026-01-27 - ready-to-start
Audit complete. Work units defined. Ready to begin with Unit 1.

---

## Shopping List Implementation (Option 2)

**Type**: coding
**Status**: in-progress

### Objective
Move shopping list behavior to server-backed D1 state so item ordering/check/deletion/category/icon metadata syncs across sessions/devices.

### Phase Plan (Option 2)

#### Unit 1 (required): D1 schema + server persistence wiring
**Scope**
- [ ] Add D1-backed fields to `ShoppingListItem`: `categoryKey`, `iconKey`, `sortIndex`, `checkedAt`, `deletedAt`
- [ ] Add migration/backfill SQL for existing shopping list rows
- [ ] Update shopping list loader/action server wiring so item state comes from D1 (`deletedAt` filter, ordering by `sortIndex`, checked state via `checkedAt`)
- [ ] Ensure add/remove/clear/toggle flows persist to D1 with soft-delete semantics and deterministic ordering
- [ ] Add/update tests for model + route action/loader coverage

#### Unit 2 (if feasible): item-card toggle UX + checked-to-bottom ordering
**Scope**
- [ ] Entire item card toggles check/uncheck (not only checkbox control)
- [ ] Checked items move to bottom with ordering persisted server-side (`sortIndex` normalization)
- [ ] Client uses optimistic toggle + server reconcile (cross-session source of truth remains D1)
- [ ] Add/update UI interaction tests for card toggle and checked ordering behavior

#### Unit 3 (next): sync + conflict behavior hardening
**Scope**
- [ ] Add explicit conflict handling tests for concurrent toggles/reorders across sessions
- [ ] Add idempotency coverage for repeated action submissions
- [ ] Validate soft-deleted rows can be restored deterministically via add flows

#### Unit 4 (next): regression/integration coverage
**Scope**
- [ ] Expand route/model integration tests for category/icon metadata lifecycle
- [ ] Add end-to-end flow assertions for cross-device/session sync path

---

## ROADMAP (revised 2026-01-27)

1. **auth + oauth** ← CURRENT
2. recipe CRUD validation
3. steps & ingredients (add stepOutputUse)
4. image upload
5. deployment (validation checkpoint)
6. search + fellow chefs
7. recipe sharing + forking + spooning
8. UI polish (catalyst, aesthetic TBD)
9. MCP
10. mobile app

---

## BACKLOG (deferred items)

- Pagination (Phase 2)
- Reorder steps (Phase 3)
- Edit cookbook title (Phase 5)
- Check off shopping list items (Phase 6)
- Clear completed shopping items (Phase 6)

---

## Notes

- Only one task in "CURRENT" at a time
- OAuth: Apple first, Google second
- stepOutputUse: blocking, core to SJ recipe structure
- UI polish: NO assumptions, discuss aesthetic first
