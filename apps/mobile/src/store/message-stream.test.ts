import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  appendUserMessage,
  applyEvent,
  clearPending,
  emptyStream,
  fromHistory,
  type StreamState,
} from './message-stream';

function run(events: { type: string; payload?: unknown }[], from: StreamState = emptyStream): StreamState {
  return events.reduce((state, event) => applyEvent(state, event), from);
}

test('message deltas accumulate into one assistant bubble and complete', () => {
  const state = run([
    { type: 'message.start' },
    { type: 'message.delta', payload: { text: 'Hello' } },
    { type: 'message.delta', payload: { text: ' world' } },
    { type: 'message.complete' },
  ]);
  assert.equal(state.items.length, 1);
  assert.deepEqual(
    { kind: state.items[0].kind, text: (state.items[0] as { text: string }).text },
    { kind: 'assistant', text: 'Hello world' },
  );
  assert.equal((state.items[0] as { complete: boolean }).complete, true);
  assert.equal(state.streaming, false);
});

test('thinking deltas render separately from the answer; empty deltas ignored', () => {
  const state = run([
    { type: 'message.start' },
    { type: 'thinking.delta', payload: { text: '(◔_◔) synthesizing...' } },
    { type: 'thinking.delta', payload: { text: '' } },
    { type: 'message.delta', payload: { text: 'Answer' } },
  ]);
  assert.deepEqual(
    state.items.map(item => item.kind),
    ['thinking', 'assistant'],
  );
});

test('a new message after complete starts a fresh assistant bubble', () => {
  const state = run([
    { type: 'message.delta', payload: { text: 'one' } },
    { type: 'message.complete' },
    { type: 'message.start' },
    { type: 'message.delta', payload: { text: 'two' } },
  ]);
  assert.deepEqual(
    state.items.map(item => (item as { text: string }).text),
    ['one', 'two'],
  );
});

test('tool lifecycle: start → progress → complete keyed by tool id', () => {
  const state = run([
    { type: 'tool.start', payload: { tool_id: 't1', name: 'Bash' } },
    { type: 'tool.progress', payload: { tool_id: 't1', output: 'partial' } },
    { type: 'tool.complete', payload: { tool_id: 't1' } },
  ]);
  const tool = state.items[0] as { kind: string; name: string; status: string; detail?: string };
  assert.equal(tool.kind, 'tool');
  assert.equal(tool.name, 'Bash');
  assert.equal(tool.status, 'done');
  assert.equal(tool.detail, 'partial');
});

test('tool.complete inline_diff becomes a diff card on the tool item', () => {
  const state = run([
    { type: 'tool.start', payload: { tool_id: 't9', name: 'editor' } },
    {
      type: 'tool.complete',
      payload: { tool_id: 't9', inline_diff: '--- a/x.py\n+++ b/x.py\n-old line\n+new line\n' },
    },
  ]);
  const tool = state.items[0] as { status: string; diff?: string };
  assert.equal(tool.status, 'done');
  assert.match(tool.diff ?? '', /\+new line/);
});

test('tool.complete with error marks the card as error', () => {
  const state = run([
    { type: 'tool.start', payload: { tool_id: 't2', name: 'Edit' } },
    { type: 'tool.complete', payload: { tool_id: 't2', error: 'denied' } },
  ]);
  assert.equal((state.items[0] as { status: string }).status, 'error');
});

test('approval.request sets pending and clearPending removes it', () => {
  const state = run([{ type: 'approval.request', payload: { id: 42, prompt: 'Run rm?' } }]);
  assert.equal(state.pending?.kind, 'approval');
  assert.equal(state.pending?.payload.id, 42);
  assert.equal(clearPending(state).pending, null);
});

test('status.update sets transient text; message.complete clears it', () => {
  let state = run([{ type: 'status.update', payload: { text: 'running tools…' } }]);
  assert.equal(state.statusText, 'running tools…');
  state = applyEvent(state, { type: 'message.complete' });
  assert.equal(state.statusText, '');
});

test('unknown event types are ignored (protocol is an open union)', () => {
  const before = appendUserMessage(emptyStream, 'hi');
  const after = applyEvent(before, { type: 'pet.hatched', payload: { egg: 1 } });
  assert.deepEqual(after, before);
});

test('fromHistory maps stored transcripts, including content-part arrays', () => {
  const state = fromHistory([
    { role: 'user', content: 'question' },
    { role: 'assistant', content: [{ type: 'text', text: 'answer ' }, { type: 'text', text: 'parts' }] },
    { role: 'system', content: 'hidden' },
  ]);
  assert.deepEqual(
    state.items.map(item => [item.kind, (item as { text: string }).text]),
    [
      ['user', 'question'],
      ['assistant', 'answer parts'],
    ],
  );
});
