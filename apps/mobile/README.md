# Hermes Mobile

A React Native (Expo) client for the Hermes Agent gateway — chat with Hermes,
browse the gateway's code, and work with Projects from your phone. It speaks
the same JSON-RPC-over-WebSocket protocol as Hermes Desktop and the web
dashboard, via the shared `@hermes/shared` client.

Background and protocol details: `docs/plans/ios-app-feasibility.md` in the
repo root.

## Run it on your iPhone

1. On the machine that runs Hermes:

   ```bash
   hermes dashboard --no-open
   ```

   The phone must be able to reach that machine — same Wi-Fi, or (better) a
   [Tailscale](https://tailscale.com) tailnet. Note the URL, e.g.
   `http://my-mac:8899`.

2. Start the dev server in this directory:

   ```bash
   npm install
   npm start
   ```

3. Install **Expo Go** from the App Store, scan the QR code, and enter your
   gateway URL on the connect screen.

The app auto-detects the gateway's auth mode from `GET /api/status`. Token
mode (private/loopback binds) works today; OAuth-gated gateways are not wired
up yet.

## Sections

- **Chat** — sessions list (`session.list`), streaming conversations
  (`prompt.submit` + `message.delta`/`tool.*` events), tool cards, and
  approve/deny sheets for `approval.request`.
- **Code** — browse the gateway host's filesystem (`/api/fs/list`), preview
  files (`/api/fs/read-text`).
- **Projects** — Hermes v0.18.0 first-class Projects (`projects.tree`), with
  "new chat in project". Older gateways see an upgrade hint.

## Development

```bash
npm run typecheck        # tsc --noEmit
npm test                 # unit tests (message-stream reducer, connection auth)
npm run gateway:check    # end-to-end against a live gateway on 127.0.0.1:8899
```

The core layers are platform-neutral TypeScript (they run in Node as well as
React Native):

- `src/gateway/` — connection/auth (`connection.ts`), typed RPC + REST client
  (`client.ts`), protocol payload types (`types.ts`).
- `src/store/` — nanostores state: connection lifecycle with
  foreground-reconnect (`connection.ts`), sessions + per-session streams
  (`chat.ts`), the pure streaming reducer (`message-stream.ts`), projects
  (`projects.ts`).
- `src/app/` — expo-router screens (connect, tabs, chat thread, file viewer).
