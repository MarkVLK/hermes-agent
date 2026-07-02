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
import { resolveConnection } from '../src/gateway/connection';
import { applyEvent, emptyStream } from '../src/store/message-stream';

const base = process.argv[2] ?? 'http://127.0.0.1:8899';

function ok(label: string, extra = '') {
  console.log(`✓ ${label}${extra ? ` — ${extra}` : ''}`);
}

async function main() {
  const { config, status } = await resolveConnection(base);
  ok('resolveConnection', `version=${status.version} auth=${config.authMode}`);

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
