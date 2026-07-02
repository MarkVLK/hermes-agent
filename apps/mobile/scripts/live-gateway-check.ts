/**
 * End-to-end check of the mobile app's gateway layer against a real gateway,
 * run in Node (which, like React Native, has fetch + WebSocket globals):
 *
 *   1. hermes dashboard --no-open --port 8899   (in another terminal)
 *   2. npm run gateway:check [-- http://127.0.0.1:8899]
 *
 * Exercises exactly the code paths the phone uses: resolveConnection (status
 * probe + token scrape), HermesGateway.open (WS + gateway.ready), session
 * list/create, prompt.submit streaming into the message-stream reducer, and
 * the projects.* RPCs backing the Projects tab.
 */

import { HermesGateway } from '../src/gateway/client';
import { fetchAuthMe, resolveConnection } from '../src/gateway/connection';
import { applyEvent, emptyStream } from '../src/store/message-stream';

const args = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
const base = args[0] ?? 'http://127.0.0.1:8899';
// --gated <user> <pass>: exercise the cookie/ws-ticket path against a
// password-gated gateway (same session machinery as Nous Portal OAuth).
const gatedIdx = process.argv.indexOf('--gated');
const gated = gatedIdx >= 0 ? { username: process.argv[gatedIdx + 1], password: process.argv[gatedIdx + 2] } : null;

function ok(label: string, extra = '') {
  console.log(`✓ ${label}${extra ? ` — ${extra}` : ''}`);
}

/**
 * Node's fetch has no cookie jar; React Native's does (it shares the OS
 * cookie store the login WebView writes into). Emulate that here so the
 * gated flow runs the same code the app runs.
 */
function installCookieJar() {
  const jar = new Map<string, string>();
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any, init: any = {}) => {
    const headers = new Headers(init.headers ?? {});
    if (jar.size > 0) {
      headers.set('cookie', [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; '));
    }
    const res = await realFetch(input, { ...init, headers });
    for (const raw of res.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(';');
      const eq = pair.indexOf('=');
      if (eq > 0) {
        jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
      }
    }
    return res;
  }) as typeof fetch;
}

async function main() {
  if (gated) {
    installCookieJar();
  }

  const { config, status } = await resolveConnection(base);
  ok('resolveConnection', `version=${status.version} auth=${config.authMode}`);

  if (gated) {
    if (config.authMode !== 'gated') {
      throw new Error('expected an auth-gated gateway for --gated mode');
    }
    if ((await fetchAuthMe(base)) !== null) {
      throw new Error('expected 401 from /api/auth/me before login');
    }
    ok('unauthenticated /api/auth/me → null (login required)');

    const login = await fetch(`${base}/auth/password-login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'basic', username: gated.username, password: gated.password }),
    });
    if (!login.ok) {
      throw new Error(`password login failed: HTTP ${login.status}`);
    }
    ok('login set session cookies (stands in for the in-app WebView OAuth round-trip)');

    const principal = await fetchAuthMe(base);
    if (!principal) {
      throw new Error('cookie session not visible to fetch after login');
    }
    ok('authenticated /api/auth/me', `user=${principal.user_id ?? principal.email}`);
  }

  const gateway = new HermesGateway(config);
  const ready = new Promise<void>(resolve => {
    const unsub = gateway.on('gateway.ready', () => {
      unsub();
      resolve();
    });
  });
  await gateway.open();
  await ready;
  ok('WS connect + gateway.ready');

  const { sessions } = await gateway.sessionList();
  ok('session.list', `${sessions.length} sessions`);

  try {
    const tree = await gateway.projectsTree();
    ok('projects.tree', `${tree.projects.length} projects`);
  } catch (error) {
    console.log(`- projects.tree unavailable (${(error as Error).message}) — pre-v0.18 gateway`);
  }

  const created = await gateway.sessionCreate();
  ok('session.create', created.session_id);

  // 1x1 transparent PNG — the composer's photo-attach path.
  const pixel =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  await gateway.imageAttachBytes(created.session_id, pixel, 'pixel.png');
  ok('image.attach_bytes');

  let stream = emptyStream;
  let eventCount = 0;
  const unsub = gateway.onAny(event => {
    if (event.session_id === created.session_id) {
      stream = applyEvent(stream, event);
      eventCount += 1;
    }
  });
  await gateway.promptSubmit(created.session_id, 'hello from the mobile gateway check');
  await new Promise(resolve => setTimeout(resolve, 6000));
  unsub();
  ok('prompt.submit streaming', `${eventCount} events → ${stream.items.length} chat items, streaming=${stream.streaming}`);
  if (eventCount === 0) {
    throw new Error('no streaming events received');
  }

  gateway.close();
  console.log('\nall gateway-layer checks passed');
  process.exit(0);
}

main().catch(error => {
  console.error(`✗ ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
