import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildWsUrl, extractSessionToken, normalizeBaseUrl } from './connection';

test('normalizeBaseUrl accepts bare host:port and strips trailing slash', () => {
  assert.equal(normalizeBaseUrl('myhost:8899'), 'http://myhost:8899');
  assert.equal(normalizeBaseUrl('https://hermes.example.com/'), 'https://hermes.example.com');
  assert.equal(normalizeBaseUrl('https://example.com/hermes/'), 'https://example.com/hermes');
});

test('buildWsUrl: token mode uses ?token=, https becomes wss', () => {
  assert.equal(
    buildWsUrl({ baseUrl: 'http://127.0.0.1:8899', token: 'abc', authMode: 'token' }),
    'ws://127.0.0.1:8899/api/ws?token=abc',
  );
  assert.equal(
    buildWsUrl({ baseUrl: 'https://example.com/hermes', token: 'a/b', authMode: 'token' }),
    'wss://example.com/hermes/api/ws?token=a%2Fb',
  );
});

test('buildWsUrl: gated mode requires a ticket and uses ?ticket=', () => {
  assert.equal(
    buildWsUrl({ baseUrl: 'https://example.com', authMode: 'gated' }, 'tkt1'),
    'wss://example.com/api/ws?ticket=tkt1',
  );
  assert.throws(() => buildWsUrl({ baseUrl: 'https://example.com', authMode: 'gated' }));
});

test('fetchAuthMe: 401 means "log in", 200 returns the principal', async () => {
  const { fetchAuthMe } = await import('./connection');
  const unauth = (async () => new Response('{}', { status: 401 })) as typeof fetch;
  assert.equal(await fetchAuthMe('http://gw', unauth), null);

  const authed = (async () =>
    new Response(JSON.stringify({ user_id: 'u1', provider: 'nous' }), { status: 200 })) as typeof fetch;
  assert.deepEqual(await fetchAuthMe('http://gw', authed), { user_id: 'u1', provider: 'nous' });
});

test('mintWsTicket parses the ticket and raises NotLoggedInError on 401', async () => {
  const { mintWsTicket, NotLoggedInError } = await import('./connection');
  const minted = (async () =>
    new Response(JSON.stringify({ ticket: 'tk_1', ttl_seconds: 30 }), { status: 200 })) as typeof fetch;
  assert.equal(await mintWsTicket('http://gw', minted), 'tk_1');

  const expired = (async () => new Response('{}', { status: 401 })) as typeof fetch;
  await assert.rejects(mintWsTicket('http://gw', expired), NotLoggedInError);
});

test('extractSessionToken finds the token the gateway injects into index.html', () => {
  const html = '<script>window.__HERMES_SESSION_TOKEN__="dA5rcVNQ-abc_123";</script>';
  assert.equal(extractSessionToken(html), 'dA5rcVNQ-abc_123');
  assert.equal(extractSessionToken('<html>no token</html>'), null);
});
