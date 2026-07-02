# Hermes iOS App — Feasibility Study

**Date:** 2026-07-02
**Codebase analyzed:** upstream `NousResearch/hermes-agent` `main` @ `9738870` (2026-07-02, post-v0.18.0 "2026.7.1")
**Verification:** wire-protocol claims in §3 were validated against a **live v0.18.0 gateway** (`hermes dashboard`, loopback token mode) with a raw WebSocket client; captured frames are quoted verbatim. Everything else is code-verified with file references.

> ⚠️ **Fork freshness:** this fork's `main` is at 2026-06-15 (pre-v0.17.0) and does **not** contain the first-class Projects feature that shipped upstream in v0.18.0 (2026-07-01). Sync the fork before starting implementation; all file references below are against upstream `main`.

---

## 1. Executive summary

**Verdict: an iOS app is very feasible, and requires zero server-side changes.**

The Hermes gateway was explicitly designed for this. The WebSocket transport's own docstring says it exists so every RPC and event flows through the same handlers "whether the client is Ink over stdio or **an iOS / web client over WebSocket**" (`tui_gateway/ws.py:1-12`). Hermes Desktop connects to a remote gateway through exactly two surfaces an iOS app can reuse as-is:

1. **JSON-RPC 2.0 over WebSocket** at `/api/ws` — sessions, prompting, streaming, approvals, projects (~128 methods).
2. **REST** under `/api/*` — status/auth probe, session history, file browsing, uploads.

The three requested sections map cleanly onto existing server capabilities:

| iOS tab | Backing surface | Maturity |
|---|---|---|
| **Chat** | `session.*`, `prompt.submit`, streaming events, `approval/clarify/*.respond` | Complete, battle-tested (desktop + web + TUI all use it) |
| **Code** | `/api/fs/*` (browse/read/write), diff payloads from `tool.*` events, `/api/pty` terminal WS | Complete on server; UI is the work |
| **Projects** | `projects.*` RPCs (v0.18.0): CRUD + `projects.tree` (project → repo → lane → session) | New in v0.18.0, validated live below |

**Recommended approach (phased):**

- **Phase 0 (~1 week):** a SwiftUI shell + WKWebView pointed at the existing responsive `web/` dashboard. Working iPhone app immediately; Chat and Sessions work today. Limitation: the web SPA currently has **no Projects UI** (zero project references in `web/src`), so this phase is Chat-centric.
- **Phase 1+ (~6–10 engineer-weeks):** the real app — **React Native/Expo** is the pragmatic choice for this codebase (reuses `@hermes/shared`'s gateway client verbatim, and the team already lives in React 19 + TypeScript); **native SwiftUI** is the premium alternative (port two small TS files to Swift). Both are laid out in §4.

---

## 2. How Hermes Desktop connects to a remote gateway (the contract to implement)

Reference implementation: `apps/desktop/electron/connection-config.cjs`, `apps/desktop/src/hermes.ts`, and the non-Electron equivalent `web/src/lib/api.ts` + `web/src/lib/gatewayClient.ts`.

### 2.1 Probe

`GET /api/status` is public (no auth) and tells the client everything it needs to decide how to authenticate:

```json
{"version": "0.18.0", "release_date": "2026.7.1", "auth_required": false,
 "auth_providers": [], "gateway_running": false, "active_sessions": 0, ...}
```
*(captured live)*

### 2.2 Auth — two modes

**Token mode** (`auth_required: false` — loopback binds, LAN binds with `--insecure`, Tailscale-style private networks):

- REST: header `X-Hermes-Session-Token: <token>`.
- WS: query param `?token=<token>`.
- The token is generated per server start and injected into the served SPA as `window.__HERMES_SESSION_TOKEN__` (the desktop scrapes it from `index.html` — `apps/desktop/electron/dashboard-token.cjs`). An iOS client does the same: fetch `/`, regex the token out. **Validated live:** connecting `/api/ws` without the token is rejected with HTTP 403 even on loopback; with `?token=` it accepts and immediately pushes `gateway.ready`.

**Gated mode** (`auth_required: true` — public binds, hosted/Nous Portal gateways):

- Login yields HttpOnly cookies: `hermes_session_at` (access, short TTL) + `hermes_session_rt` (rotating refresh) with `__Host-`/`__Secure-` variants (`hermes_cli/dashboard_auth/cookies.py`).
- WS upgrades can't carry cookies-as-auth reliably, so the client **mints a single-use, 30s-TTL ticket**: `POST /api/auth/ws-ticket` (cookie-authed, `hermes_cli/dashboard_auth/routes.py:605`) → connect `?ticket=<ticket>` (`hermes_cli/dashboard_auth/ws_tickets.py`). Mint a fresh ticket on every connect attempt. The legacy `?token=` path is unconditionally rejected in gated mode (`hermes_cli/web_server.py`, `_ws_auth_reason`).
- iOS note: `URLSession` handles HttpOnly cookies transparently via `HTTPCookieStorage`; the OAuth login itself can run in `ASWebAuthenticationSession`.

**URL construction** (`connection-config.cjs`): base `https://host[/prefix]` → `wss://host[/prefix]/api/ws?token=…|?ticket=…`. Respect a reverse-proxy base path; the SPA gets it as `window.__HERMES_BASE_PATH__`. New in v0.18: in *global-remote* mode (one backend serving multiple desktop profiles) REST calls carry a `?profile=<scope>` query param (`pathWithGlobalRemoteProfile` in `connection-config.cjs`) — a single-profile mobile client can ignore this initially.

### 2.3 Reconnect / resume (app-layer responsibility)

The shared client deliberately does **not** auto-reconnect (15s connect timeout, `onState` callbacks; `apps/shared/src/json-rpc-gateway.ts`). The desktop orchestrates reconnection in `apps/desktop/src/app/gateway/hooks/use-gateway-boot.ts`, and the server keeps orphaned WS sessions alive for a grace window so a returning client can `session.resume` (`tui_gateway/ws.py`). This is exactly the behavior an iOS app needs after backgrounding (see §6.1).

---

## 3. The wire protocol (validated live against v0.18.0)

JSON-RPC 2.0, one JSON frame per WebSocket text message, both directions. (The v0.18 server coalesces high-frequency `*.delta` frames into batched sends on a ~33ms timer, but still writes **one frame per WS message** — `tui_gateway/ws.py::_safe_send_many`. A robust client should nonetheless tolerate newline-joined frames in one message, since the protocol is documented as newline-delimited.)

**Frame shapes:**

```
request   {"jsonrpc":"2.0","id":<n|str>,"method":"<method>","params":{...}}
response  {"jsonrpc":"2.0","id":...,"result":...} | {"jsonrpc":"2.0","id":...,"error":{"code","message"}}
event     {"jsonrpc":"2.0","method":"event","params":{"type":<name>,"session_id":...,"payload":...}}
```

### 3.1 Captured handshake and chat loop

On accept the server immediately pushes (captured):

```json
{"jsonrpc":"2.0","method":"event","params":{"type":"gateway.ready","payload":{"skin":{...}}}}
```

Session create → prompt → streaming (captured):

```json
>> {"jsonrpc":"2.0","id":"ios8","method":"session.create","params":{"cwd":"/tmp"}}
<< {"jsonrpc":"2.0","id":"ios8","result":{"session_id":"018f5c21","stored_session_id":"20260702_171605_38570a",
    "message_count":0,"messages":[],"info":{"model":"anthropic/claude-sonnet-4","tools":{},"skills":{},
    "cwd":"/tmp","branch":"","lazy":true,"desktop_contract":2,"profile_name":"default"}}}

>> {"jsonrpc":"2.0","id":"ios9","method":"prompt.submit","params":{"session_id":"018f5c21","text":"hello"}}
<< {"jsonrpc":"2.0","id":"ios9","result":{"status":"streaming"}}
<< {"jsonrpc":"2.0","method":"event","params":{"type":"session.info","session_id":"018f5c21","payload":{"model":"anthropic/claude-sonnet-4",...}}}
<< {"jsonrpc":"2.0","method":"event","params":{"type":"message.start","session_id":"018f5c21"}}
<< {"jsonrpc":"2.0","method":"event","params":{"type":"thinking.delta","session_id":"018f5c21","payload":{"text":"(◔_◔) synthesizing..."}}}
```

### 3.2 Event catalog

Authoritative TS type: `GatewayEventName` in `apps/shared/src/json-rpc-gateway.ts` (open union — treat unknown types as ignorable):

`gateway.ready`, `session.info`, `message.start`, `message.delta`, `message.complete`, `thinking.delta`, `reasoning.delta`, `reasoning.available`, `status.update`, `tool.start`, `tool.progress`, `tool.complete`, `tool.generating`, `clarify.request`, `approval.request`, `sudo.request`, `secret.request`, `background.complete`, `error`, `skin.changed`.

### 3.3 The RPC surface an iOS app needs

~128 methods are registered in `tui_gateway/server.py` (`@method(...)` + `@_projects_method(...)` at `server.py:10350-10441`). The mobile-relevant slice:

- **Sessions:** `session.create/resume/list/most_recent/active_list/activate/close/delete/title/history/status/usage/branch/undo/compress/save/interrupt/steer/cwd.set`, `session.context_breakdown`
- **Prompting:** `prompt.submit`, `prompt.background`
- **Interactive replies:** `approval.respond`, `clarify.respond`, `sudo.respond`, `secret.respond`, `terminal.read.respond`
- **Attachments:** `image.attach`, `image.attach_bytes`, `pdf.attach`, `file.attach`, `image.detach`, `clipboard.paste`
- **Projects (v0.18.0):** `projects.list/get/create/update/delete/add_folder/remove_folder/set_primary/archive/set_active/for_cwd/tree/project_sessions/discover_repos/record_repos`, `project.facts`
- **Commands/completion:** `commands.catalog`, `command.dispatch`, `slash.exec`, `complete.slash`, `complete.path`
- **Models/config:** `model.options`, `model.save_key`, `config.get/set`
- **Misc worth having:** `tools.list`, `skills.manage`, `cron.manage`, `agents.list`, `voice.*`, `rollback.list/diff/restore`, `process.list/stop/kill`

Interactive flow: when the agent needs permission, the server emits e.g. `approval.request` with a payload carrying an id + prompt; the client answers with `approval.respond`. This is what makes the WS RPC strictly better than the OpenAI-compatible REST server (`gateway/platforms/api_server.py`) for a first-party app — the latter has no approval/clarify/projects surface.

### 3.4 Projects RPCs (captured live)

```json
>> {"jsonrpc":"2.0","id":"ios4","method":"projects.create","params":{"name":"Demo iOS Project","folders":["/tmp"],"use":true}}
<< {"jsonrpc":"2.0","id":"ios4","result":{"project":{"id":"p_ea889827","slug":"demo-ios-project","name":"Demo iOS Project",
    "description":null,"icon":null,"color":null,"board_slug":null,"primary_path":"/tmp","archived":false,
    "created_at":1783012565,"folders":[{"path":"/tmp","label":null,"is_primary":true,"added_at":1783012565}]}}}

>> {"jsonrpc":"2.0","id":"ios6","method":"projects.tree","params":{"preview_limit":3}}
<< {"jsonrpc":"2.0","id":"ios6","result":{"projects":[{"id":"p_ea889827","label":"Demo iOS Project","path":"/tmp",
    "color":null,"icon":null,"isAuto":false,"sessionCount":0,"lastActive":0.0,
    "repos":[{"id":"/tmp","label":"tmp","path":"/tmp","groups":[],"sessionCount":0}],
    "previewSessions":[]}],"active_id":"p_ea889827","scoped_session_ids":[]}}
```

Gotcha found while validating: `projects.project_sessions` takes `project_id` (error 5063 `"project_id required"` when passed `id`).

### 3.5 REST endpoints (verified present in `hermes_cli/web_server.py`)

- Status/auth: `GET /api/status`, `POST /api/auth/ws-ticket`
- Sessions/history: `GET /api/sessions`, `GET /api/sessions/search`, `GET /api/sessions/{id}`, `GET /api/sessions/{id}/messages`, `GET /api/sessions/{id}/export`, `PATCH|DELETE /api/sessions/{id}`, `GET /api/sessions/stats`
- Raw FS (Code tab): `GET /api/fs/list`, `GET /api/fs/read-text`, `GET /api/fs/read-data-url`, `GET /api/fs/git-root`, `GET /api/fs/default-cwd`, `POST /api/fs/write-text` (new in v0.18)
- Managed files: `GET /api/files`, `GET /api/files/read`, `GET /api/files/download`, `POST /api/files/upload`, `POST /api/files/upload-stream`, `POST /api/files/mkdir`, `DELETE /api/files`
- Other WS: `/api/pty` (terminal), `/api/pub` + `/api/events` (broadcast sidecars)

The complete typed request/response reference is `web/src/lib/api.ts` — every endpoint with TypeScript types, directly translatable to Swift `Codable` structs.

---

## 4. Approach comparison and recommendation

| | **WKWebView wrapper** (web/ SPA) | **React Native / Expo** | **Native SwiftUI** |
|---|---|---|---|
| Time to working app | **Days** | 6–10 weeks | 8–14 weeks |
| Chat | ✅ today (`web/src/pages/ChatPage.tsx`) | build (reference: desktop `use-message-stream.ts`) | build |
| Code section | partial (`FilesPage`, xterm.js PTY) | build | build |
| Projects section | ❌ **web SPA has no Projects UI** | build against `projects.*` | build against `projects.*` |
| Protocol code reuse | 100% (it *is* the web client) | **`@hermes/shared` `JsonRpcGatewayClient` runs verbatim** (RN has standard `WebSocket`); `api.ts` types verbatim | port ~2 files to Swift |
| Feel / iOS integration | webby; fine for v0 | near-native; Expo gives APNs, Keychain (SecureStore), share sheet | best |
| Maintenance vs fast-moving protocol (3 minor releases in June) | free — server serves matching SPA | low — shared package moves with the monorepo | highest — Swift port drifts, needs contract tests |
| Team fit | trivial | **high — entire front-end estate is React 19 + TS in this monorepo** | new toolchain + language |
| App Store | viable but review-risky if it's *only* a web wrapper | fully viable | fully viable |

**Recommendation:**

1. **Phase 0 — WKWebView shell now.** A ~200-line SwiftUI app: connection screen (gateway URL + token/OAuth), Keychain storage, WKWebView loading the gateway-served dashboard. This is the cheapest possible "Hermes on my iPhone" and de-risks auth/networking immediately. It is not the end state (no Projects UI, webby chat).
2. **Phase 1 — commit to React Native/Expo for the real app** (`apps/mobile/` in the monorepo, alongside `apps/desktop` and `apps/shared`). Rationale: the hard, drift-prone code (gateway client, event dispatch, REST types) is **already written in TypeScript and shared**; the desktop's chat architecture (nanostores + streaming reducer in `use-message-stream.ts`, assistant-ui message components) ports with modest effort; and every future protocol addition lands in one shared package instead of a parallel Swift port. Choose native SwiftUI instead only if long-term iOS polish (widgets, Live Activities, deep system integration) outweighs the duplicated protocol maintenance — §5 and §6 apply identically either way; the Swift port is genuinely small (`JsonRpcGatewayClient` ≈ 350 lines → `URLSessionWebSocketTask`; `api.ts` types → `Codable`).

---

## 5. Mapping the Chat / Code / Projects tabs

### 5.1 Chat tab

- **Session list:** `session.list` (WS) or `GET /api/sessions` (REST, richer filtering/search). Group by project via `projects.tree` / `projects.for_cwd`. Desktop reference: `apps/desktop/src/app/chat/sidebar/virtual-session-list.tsx`.
- **Open session:** `session.resume` (attaches this WS to the live session) → `session.history` for the transcript.
- **Compose/send:** `prompt.submit`; queueing (`prompt.background`), steering (`session.steer`), interrupt (`session.interrupt`). Attachments via `image.attach_bytes` (camera roll → base64) / `pdf.attach` / `file.attach`.
- **Streaming render loop:** reduce events into the message list — `message.start` → append assistant message; `message.delta`/`thinking.delta`/`reasoning.delta` → append text (collapsible thinking block); `tool.start/progress/complete` → tool cards; `message.complete` → finalize; `status.update` → status pill. The complete reference reducer is `apps/desktop/src/app/session/hooks/use-message-stream.ts`.
- **Interactive prompts:** render `approval.request` / `clarify.request` / `secret.request` / `sudo.request` as action sheets; reply with the matching `*.respond`. These are first-class mobile moments (approve a tool call from your phone).
- **Model picker:** `model.options` (captured live — returns providers with auth state) + `model.save_key`.

### 5.2 Code tab

- **File browser:** `GET /api/fs/list` (dir listing) + `GET /api/fs/git-root` + `GET /api/fs/default-cwd`; scope the root to the active project's folders. `.gitignore` filtering is client-side today (desktop `apps/desktop/src/lib/desktop-fs.ts`).
- **File viewer:** `GET /api/fs/read-text` / `read-data-url` (images) with syntax highlighting (Shiki in JS approaches; Highlightr/Splash in Swift). Light edits: `POST /api/fs/write-text`.
- **Diffs:** file-edit tools already emit structured diff payloads in `tool.*` events — render like desktop's `apps/desktop/src/components/chat/diff-lines.tsx` + `apps/desktop/src/store/tool-diffs.ts`. This gives a Claude-app-style "review the agent's changes" surface with no new server work.
- **Terminal (defer to later phase):** `/api/pty` WebSocket; xterm.js works in RN via WebView, or SwiftTerm natively.

### 5.3 Projects tab

- **Overview:** `projects.tree {preview_limit}` → project cards (name/icon/color, repos, session counts, preview sessions). Auto-discovered repos appear alongside explicit projects (`projects.discover_repos`/`record_repos` power desktop's repo-first discovery; on mobile, list-only).
- **Project detail:** `projects.project_sessions {project_id}` → lanes (main branch / kanban / linked worktrees per `tui_gateway/project_tree.py`) with sessions; "new chat in this project" = `session.create {cwd: primary_path}`.
- **CRUD:** `projects.create/update/add_folder/remove_folder/set_primary/archive/delete/set_active`; folder paths come from the gateway host's FS, so pick folders via `/api/fs/list`, not an iOS file picker.
- **Data model** (`hermes_cli/projects_db.py`): per-profile SQLite at `$HERMES_HOME/projects.db`; a Project = named multi-folder workspace; sessions belong by longest-prefix `cwd` match; optional kanban board binding (`board_slug`).
- Defer from desktop's v0.18 coding rail: review pane and worktree management UI — view-only lanes are enough for v1.

---

## 6. iOS-specific concerns

### 6.1 Backgrounding and reconnect (the big one)

iOS suspends apps (and kills sockets) seconds after backgrounding. The server is already built for this: sessions survive WS disconnects for a grace window (WS-orphan reaper, `tui_gateway/ws.py`), and `session.resume` + `session.history` restore state. Required client behavior: on `scenePhase == .active` (or RN `AppState` change) → reconnect (fresh ticket in gated mode) → `session.resume` → refetch history tail → resubscribe UI. The 15s connect-timeout comment in `apps/shared/src/json-rpc-gateway.ts` exists precisely for sleep/wake.

### 6.2 Push notifications — the one real gap

Long agent turns will finish while the app is suspended, and **there is no APNs pipeline today**. Mitigations, cheapest first: (a) none for v1 — users re-open the app and resume, exactly like the web dashboard; (b) reuse an existing messaging platform (Telegram/iMessage-via-Photon handoff — `handoff.request/state` RPCs exist) for "turn finished" pings; (c) proper APNs, which needs a small server-side notifier plugin + a hosted broker or direct APNs creds on self-hosted gateways — the only item in this study that requires new server code, and it's optional.

### 6.3 Security & storage

- Store gateway URL + token in **Keychain** (`kSecAttrAccessibleAfterFirstUnlock`); never in UserDefaults.
- ATS: HTTPS/WSS works out of the box; self-hosted plain-HTTP LAN gateways need an ATS local-network exception (or push users to Tailscale, which the docs already favor).
- Gated mode: cookies in `HTTPCookieStorage`; refresh rotation is server-driven; re-login via `ASWebAuthenticationSession` when the refresh cookie dies.

### 6.4 App Store

A BYO-server client (like Prompt, Blink, or Home Assistant) is fine for review; ship with a demo/connect screen, not a bundled backend. The `hermes://` URL scheme (registered by desktop) can be adopted for pairing links/QR onboarding.

---

## 7. Phased roadmap

| Phase | Scope | Effort (1 eng) |
|---|---|---|
| **0. WebView shell** | SwiftUI connection screen + Keychain + WKWebView on the served dashboard; token & OAuth modes | ~1 week |
| **1. App skeleton + gateway client** | Expo app in `apps/mobile/`; reuse `@hermes/shared`; connect/probe/auth; reconnect + resume lifecycle | 1–2 weeks |
| **2. Chat tab** | session list, transcript, streaming reducer, composer, approvals/clarify sheets, attachments, model picker | 2–3 weeks |
| **3. Projects tab** | `projects.tree` overview, project detail lanes, CRUD, new-chat-in-project | 1–2 weeks |
| **4. Code tab** | FS browser scoped to project, file viewer w/ highlighting, diff cards from tool events | 1–2 weeks |
| **5. Polish** | haptics, share sheet ingestion, `hermes://` pairing QR, iPad layout, (optional) APNs plugin | 1–2 weeks |

**Total: ~6–10 engineer-weeks** for a genuinely good v1 after the Phase-0 shell.

---

## 8. Appendix — key files for implementers

**Protocol / clients**
- `tui_gateway/ws.py` — WS transport; the de-facto protocol spec (docstring) + orphan grace + delta coalescing
- `tui_gateway/server.py` — all RPC handlers (`@method`, `@_projects_method` @ 10350-10441)
- `apps/shared/src/json-rpc-gateway.ts` — canonical TS client (reuse in RN / port to Swift)
- `web/src/lib/gatewayClient.ts`, `web/src/lib/api.ts` — browser client + fully-typed REST reference
- `hermes_cli/web_server.py` — REST routes, `/api/ws|pty|pub|events`, `_ws_auth_reason` (auth truth table)

**Auth**
- `apps/desktop/electron/connection-config.cjs` — URL/auth construction incl. global-remote `?profile=`
- `apps/desktop/electron/dashboard-token.cjs` — token scrape from index.html
- `hermes_cli/dashboard_auth/` — cookie/session providers, `routes.py:605` ws-ticket, `ws_tickets.py` threat model

**Projects (v0.18.0)**
- `hermes_cli/projects_db.py` — data model; `tui_gateway/project_tree.py` — project → repo → lane tree
- `apps/desktop/src/store/projects.ts` — client-side store driving all `projects.*` RPCs
- `apps/desktop/src/app/chat/sidebar/projects/`, `project-dialog.tsx` — UI reference
- `tests/tui_gateway/test_projects_rpc.py` — RPC param shapes

**Chat UI reference**
- `apps/desktop/src/app/session/hooks/use-message-stream.ts` — streaming event reducer
- `apps/desktop/src/app/chat/` (composer, sidebar), `apps/desktop/src/components/assistant-ui/`, `components/chat/diff-lines.tsx`
