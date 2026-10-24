import assert from 'node:assert/strict';
import test from 'node:test';

const data = new Map();
Object.defineProperty(globalThis, 'localStorage', { value: {
  getItem: key => data.get(key) ?? null,
  setItem: (key, value) => data.set(key, value),
}, configurable: true });
const store = await import('../src/store.ts');

test('draft approval preserves the waiting or done workflow and persisted state', () => {
  const waiting = store.addLoop({ title: 'Waiting for a reply', status: 'waiting' });
  store.draftMessage(waiting.id, 'Please send the details.');
  assert.equal(store.getLoop(waiting.id).status, 'draft');
  assert.equal(store.getLoop(waiting.id).events.some(event => event.text === 'Sent.'), false);
  store.approveDraft(waiting.id);
  assert.equal(store.getLoop(waiting.id).status, 'waiting');
  assert.equal(store.getLoop(waiting.id).draft, null);

  const once = store.addLoop({ title: 'One-shot reply' });
  store.draftMessage(once.id, 'Here are the details.');
  store.approveDraft(once.id);
  assert.equal(store.getLoop(once.id).status, 'done');
  assert.throws(() => store.approveDraft(once.id), /No draft/);
  assert.throws(() => store.draftMessage(once.id, 'Another'), /closed loop/);
  assert.deepEqual(JSON.parse(data.get('loops.v2')), store.getSnapshot());
});

test('create, update, and snooze share local calendar date parsing', () => {
  process.env.TZ = 'America/Los_Angeles';
  const loop = store.addLoop({ title: 'Deadline', due: '2026-10-25' });
  assert.equal(new Date(loop.due).getDate(), 25);
  store.updateLoop(loop.id, { due: '2026-10-26' });
  assert.equal(new Date(store.getLoop(loop.id).due).getDate(), 26);
  store.snoozeLoop(loop.id, '2026-10-27');
  assert.equal(new Date(store.getLoop(loop.id).due).getDate(), 27);
  assert.throws(() => store.updateLoop(loop.id, { due: '2026-02-30' }), /Invalid date/);
  assert.equal(new Date(store.getLoop(loop.id).due).getDate(), 27);
});

test('storage failures leave memory, persisted data, and subscribers unchanged', () => {
  const loop = store.addLoop({ title: 'Keep this draft' });
  store.draftMessage(loop.id, 'Do not lose this message');
  const snapshot = store.getSnapshot();
  const saved = data.get('loops.v2');
  let notifications = 0;
  const unsubscribe = store.subscribe(() => notifications++);
  const setItem = localStorage.setItem;
  localStorage.setItem = () => { throw new Error('Storage full'); };
  try {
    assert.throws(() => store.addLoop({ title: 'Must not be added' }), /Storage full/);
    assert.throws(() => store.approveDraft(loop.id), /Storage full/);
    assert.equal(store.getSnapshot(), snapshot);
    assert.equal(store.getLoop(loop.id).draft.body, 'Do not lose this message');
    assert.equal(data.get('loops.v2'), saved);
    assert.equal(notifications, 0);
  } finally {
    localStorage.setItem = setItem;
    unsubscribe();
  }
  store.approveDraft(loop.id);
  assert.equal(store.getLoop(loop.id).status, 'done');
});
