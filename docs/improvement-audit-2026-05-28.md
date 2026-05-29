# Improvement Audit — 2026-05-28

## 1. Summary

- **Project:** claude-broker (v0.4.0)
- **Working directory:** `/home/rw3iss/Sites/tools/channels`
- **Type:** Backend TypeScript — long-lived broker daemon + per-session MCP shim + CLI. No client UI, no stylesheets.
- **Total findings:** 9 (UI: 0, styling: 0, architecture/code-quality: 9)
- **Baseline:** `tsc --noEmit` clean, 96/96 tests passing.

UI/UX and styling sections are **not applicable** — this project has no
client-facing interface, no CSS/SCSS, no design tokens. The audit focuses
on code architecture (SOLID), duplication, and developer experience, per
the command's lower-priority focus areas.

## 2. UI & UX improvements

None — no user-facing graphical interface. The "interface" is the CLI and
the HTTP API; both are covered under §4.

## 3. Styling & design system

None — no stylesheets in the project.

## 4. Architecture & code quality

### A1 — `JobService` terminal-transition duplication (DRY / SRP)
- **Location:** `src/broker/job-service.ts` — `cancel`, `complete`, `fail`, `markExpired`, `markOrphaned`.
- **Problem:** Five methods repeat the same 6-step skeleton: `get` → throw/return on missing → guard `TERMINAL_STATUSES` → `transitionStatus` → null-check → `publish` + `notifyDone`. ~90 lines of near-identical control flow.
- **Fix:** Extract a private `transitionToTerminal(jobId, to, { patch, event, onMissing, onTerminal })` helper; each public method becomes a 1–3 line call. Behavior preserved exactly (same events, same error types, same sweeper "return null/return existing" semantics).
- **Risk:** Medium (orchestration center) — but covered by 14 job-service unit tests + HTTP/socket/e2e integration.

### A2 — Scattered ISO timestamp formatting (DRY)
- **Location:** `src/adapters/job-store/sqlite.ts:357` (`isoFromMs`), `src/broker/http-server.ts:349-372` (7×), `src/broker/job-service.ts:258,314`.
- **Problem:** `new Date(ms).toISOString()` open-coded in three modules; sqlite has a private `isoFromMs` that nobody else can reuse.
- **Fix:** Add `src/lib/time.ts` exporting `toIso(ms)` and `nowIso(clock)`; replace the open-coded calls.
- **Risk:** Low.

### A3 — CLI JSON-command boilerplate (DRY)
- **Location:** `src/cli/jobs.ts`, `src/cli/sessions.ts` (≈9 actions).
- **Problem:** Every action repeats `resolveClient → httpJson → dieOnError → console.log(JSON.stringify(...,2))`.
- **Fix:** Add `runJson(opts, method, path, body?, failMsg)` to `src/cli/client.ts` that does resolve + call + dieOnError + pretty-print, returning the parsed body for callers that need follow-up (e.g. `submit --wait`).
- **Risk:** Low-medium (touches all CLI commands) — covered by `tests/integration/cli.spec.ts`; output byte-identical.

### A4 — Repeated `--config` option declaration (DRY)
- **Location:** every CLI subcommand across `daemon.ts`, `jobs.ts`, `sessions.ts`, `config.ts`.
- **Problem:** `.option('-c, --config <path>', ...)` is re-declared ~11 times with drifting help text.
- **Fix:** `withConfigOption(cmd)` helper in `src/cli/client.ts` (or a small `cli/options.ts`); apply uniformly.
- **Risk:** Low.

### A5 — Duplicated instructions-combine logic + dead `buildInstructions` (DRY / dead code)
- **Location:** `src/broker/instructions.ts:8` (`buildInstructions`, **never imported**) and `src/shim/load-instructions.ts` (does the same `base + "\n\n" + append` join inline).
- **Problem:** Two implementations of "combine instructions with optional append"; the broker-side one is currently dead.
- **Fix:** Extract `combineInstructions(base, append?)` in `instructions.ts`; have both `buildInstructions(config)` and the shim's `loadInstructions()` delegate to it. This removes the duplication **and** makes `instructions.ts` live (imported by the shim) — extension, not deletion.
- **Risk:** Low.

### A6 — Dead `here` local in `daemon.ts` (cleanup artifact)
- **Location:** `src/cli/daemon.ts:10` + `:118` (`const here = ...` then `void here;`).
- **Problem:** A computed-but-unused local kept alive only by a `void` no-op statement. Pure lint artifact, not functionality.
- **Fix:** Remove both lines.
- **Risk:** Low (no behavior).

### A7 — `SocketServer` register/reconnect duplication (DRY)
- **Location:** `src/broker/socket-server.ts` — `handleRegister` (246-268) and `handleReconnect` (277-296).
- **Problem:** Both evict any prior connection for the session id, set `sessionConn`, call `sessions.register`, and send `registered` — duplicated verbatim.
- **Fix:** Private `attachSession(conn, sessionId, { label?, pid? })` that both handlers call; reconnect adds its log line.
- **Risk:** Medium (connection lifecycle) — covered by `socket-roundtrip.spec.ts` (register, two-shim, reconnect, version-mismatch, crash-isolation).

### A8 — Tool dispatch is not Open/Closed (OCP)
- **Location:** `src/shim/tool-handlers.ts` (`DEFAULT_TOOLS` schemas) and `src/broker/socket-server.ts:320` (`dispatchToolCall` switch).
- **Problem:** Adding a tool means editing two files in lockstep (the comment in `tool-handlers.ts` even documents this coupling). The schema lives apart from the routing.
- **Fix:** A single tool registry — each entry declares `name`, `description`, `inputSchema`, and a `handler(service, jobId, args, ctx)` that returns the result payload. The shim lists `registry.map(t => t.schema)`; the broker routes via `registry[name].handler`. Adding a tool becomes one entry in one file. Wire protocol, tool names, schemas, and the `{ ok, status }` return shape stay identical.
- **Risk:** Medium (internal routing only — no wire/HTTP surface change). Covered by socket-roundtrip + e2e (complete_job) and job-service units (fail/note/ack). The broker registry and the shim's schema list must agree, so the registry is the single source.

### DX1 — Untyped `submit` action options
- **Location:** `src/cli/jobs.ts:51` — `opts: Record<string, any>`.
- **Problem:** Loses all type checking on the most complex command's flags.
- **Fix:** Declare a `SubmitOpts` interface for the action signature.
- **Risk:** Low.

## 5. Recommended execution plan

- **Phase A (low risk, applied automatically):** A2, A3, A4, A5, A6, DX1.
- **Phase B (medium risk, applied — user said "implement all"):** A1, A7, A8.
- **Phase C (high risk / plan only):** None. No finding touches the public
  HTTP surface, the wire protocol, the config schema, or >10 files. The tool
  registry (A8) is the most architectural change but is internal-only and
  fully test-covered, so it lands in Phase B rather than being deferred.

## 6. Verification log

Baseline: `tsc --noEmit` clean, 96/96 tests.

**Phase A (applied):**
- A2 — `src/lib/time.ts` (`toIso`/`toIsoOrNull`/`nowIso`); wired into
  `sqlite.ts` (removed private `isoFromMs`), `http-server.ts` (serializers),
  `job-service.ts` (progress/comment timestamps).
- A3 — `runJson` + `printJson` in `cli/client.ts`; `jobs.ts`/`sessions.ts`
  collapsed onto it (`submit` keeps its two-step client for `--wait`).
- A4 — `withConfigOption` in `cli/client.ts`; applied across
  `jobs/sessions/config/daemon`.
- A5 — `combineInstructions` + `buildInstructions` moved to
  `src/lib/instructions.ts` (was dead `broker/instructions.ts`); shim's
  `load-instructions.ts` now delegates. Dependency direction stays
  shim → lib.
- A6 — removed dead `here`/`void here` + unused `fileURLToPath` import in
  `daemon.ts`.
- DX1 — typed `submit` action options (`SubmitOpts`) in `jobs.ts`.
- Verified: `tsc` clean, 96/96.

**Phase B (applied — standing approval via "implement all"):**
- A1 — `JobService.transitionToTerminal` private helper (overloaded:
  throwing for client/tool calls, quiet for sweeper). `cancel`/`complete`/
  `fail`/`markExpired`/`markOrphaned` now 1–4 lines each. Messages/events/
  error types preserved. Verified: 19/19 job-service + sweeper.
- A7 — `SocketServer.attachSession` extracted from the duplicated
  register/reconnect handlers. Verified: 7/7 socket + shim roundtrip.
- A8 — tool dispatch made Open/Closed: tool contract relocated to
  `src/broker/tools.ts` (sibling to `wire.ts`, keeps shim → broker
  direction), `ToolName` union added, broker routing moved to
  `src/broker/tool-router.ts` with a `Record<ToolName, ToolHandler>` map
  that the compiler forces to stay in sync with the schema list. Switch in
  `socket-server.ts` replaced by `dispatchTool`. Behavior (arg coercion,
  `{ ok, status }` shape, error throws) preserved. **New test:**
  `tests/unit/tool-router.spec.ts` (7 cases). Verified: full suite 103/103.

**Phase C:** none — no finding touched the HTTP surface, wire protocol,
config schema, or >10 files.

**Docs synced:** `CLAUDE.md` ("New tool the shim exposes" now points at
`broker/tools.ts` + `tool-router.ts`), `docs/how-it-works.md` (reply-flow
section updated from `dispatchToolCall` to `dispatchTool`/`tool-router.ts`).
No user-facing surface (CLI flags, HTTP routes, config keys, wire messages,
tool names/schemas) changed, so README needed no functional update.

**Net:** internal-only refactor. Public behavior identical; 103/103 tests
green (96 original + 7 new).
