# Apollo Server v5 Migration Spec — Gateway

**Card:** 69a23d8ce14db501d4219c83  
**Author:** @think  
**Date:** 2026-02-27  
**Branch:** `feat/dependency-upgrades`  
**Repo:** `ottochain-services`  
**Files affected:** `packages/gateway/src/index.ts`, `packages/gateway/package.json`  
**Feasibility:** HIGH (confirmed by @research — single import change + @as-integrations/express4)

---

## Problem Statement

Apollo Server v5 removes `expressMiddleware` from the `@apollo/server/express4` package path. The gateway currently imports from that path and must migrate to the new `@as-integrations/express4` package.

**Current state:** `@apollo/server@^4.10.0`, `expressMiddleware` from `@apollo/server/express4`  
**Target state:** `@apollo/server@^5.x`, `expressMiddleware` from `@as-integrations/express4`

---

## Changes Required

### 1. `packages/gateway/package.json` — Dependencies

**Remove:**
- `body-parser` — Apollo v5 parses JSON internally; middleware no longer needed
- `@types/body-parser` (devDep)

**Update:**
- `@apollo/server`: `^4.10.0` → `^5.0.0`

**Add:**
- `@as-integrations/express4`: `^3.0.0` (the extracted Express 4 integration package)

No changes needed to `graphql-ws`, `ws`, `cors`, `express`, or other deps.

### 2. `packages/gateway/src/index.ts` — Import changes

**Remove:**
```ts
import { expressMiddleware } from '@apollo/server/express4';
import bodyParser from 'body-parser';
```

**Add:**
```ts
import { expressMiddleware } from '@as-integrations/express4';
```

**Remove from middleware chain:**
```ts
bodyParser.json(),
```

**Final middleware block:**
```ts
app.use(
  '/graphql',
  cors<cors.CorsRequest>(),
  expressMiddleware(server, {
    context: createContext,
  }),
);
```

All other code is unchanged:
- `ApolloServer` construction — unchanged (plugin API is stable)
- `ApolloServerPluginDrainHttpServer` — unchanged, still in `@apollo/server/plugin/drainHttpServer`
- `useServer` / `WebSocketServer` / `graphql-ws` setup — unchanged
- `server.start()` — unchanged
- Health/version routes — unchanged

---

## Acceptance Criteria

| # | Criterion |
|---|-----------|
| AC-1 | `packages/gateway/package.json` declares `@apollo/server@^5.x` |
| AC-2 | `packages/gateway/package.json` declares `@as-integrations/express4` |
| AC-3 | `body-parser` is removed from dependencies |
| AC-4 | `expressMiddleware` is imported from `@as-integrations/express4` (not `@apollo/server/express4`) |
| AC-5 | `bodyParser.json()` middleware call is removed |
| AC-6 | Gateway starts without error on `npm run dev` |
| AC-7 | `POST /graphql` with JSON body returns correct GraphQL response |
| AC-8 | WebSocket subscriptions continue to work (graphql-ws unchanged) |
| AC-9 | `/health` and `/version` routes continue to return 200 |
| AC-10 | CI passes (`npm run build` + `npm test` in gateway package) |

---

## TDD Test Cases

**Group 1: Server Startup (2 tests)**
- T-01: Gateway process starts without throwing
- T-02: `/health` returns `{ status: 'ok', service: 'gateway' }` after startup

**Group 2: GraphQL HTTP (3 tests)**
- T-03: `POST /graphql` with `Content-Type: application/json` and valid query returns `{ data: {...} }`
- T-04: `POST /graphql` with malformed JSON returns 400-level error (Apollo v5 handles parsing)
- T-05: `POST /graphql` introspection query returns schema

**Group 3: CORS (2 tests)**
- T-06: `OPTIONS /graphql` request returns CORS headers
- T-07: Cross-origin `POST /graphql` request succeeds with CORS headers

**Group 4: Subscriptions (2 tests)**
- T-08: WebSocket connection to `/graphql` path succeeds (connection_ack received)
- T-09: Subscription message delivered over WebSocket on event

**Group 5: Regression — body-parser removal (2 tests)**
- T-10: Request without explicit `Content-Type: application/json` header is handled gracefully (Apollo v5 auto-detects)
- T-11: Large JSON body exceeding limit fails with appropriate error (Apollo v5 default limits apply)

**Total: 11 TDD tests**

---

## Implementation Notes

### Why `@as-integrations/express4` and not Express v5?

The gateway uses `express@^4.18.0`. Apollo Server v5 ships integrations for both Express 4 (`@as-integrations/express4`) and Express 5 (`@as-integrations/express5`) as separate packages. The monitor package uses Express v5 but that's independent — no need to upgrade gateway Express as part of this migration.

### body-parser removal

Apollo Server v5 uses its own JSON body parser internally within the Express integration. The `body-parser` middleware is no longer needed and its presence may cause double-parsing. Remove it cleanly.

### No context API changes

The `context` callback passed to `expressMiddleware` has the same signature in Apollo Server v5. `createContext` in `context.ts` does not need to change.

---

## Risk Assessment

**Low risk.** Gateway uses Apollo only for standard HTTP + WebSocket transport. No custom plugins with v4-specific internal hooks. WebSocket/graphql-ws path is entirely independent of the Express integration and is unaffected.

**Rollback:** Revert `package.json` and `index.ts` changes, `npm install`. One-minute rollback.

→ Next stage: **🧪 Test Definition** (@code writes 11 failing tests, then @work implements on `feat/dependency-upgrades`)
