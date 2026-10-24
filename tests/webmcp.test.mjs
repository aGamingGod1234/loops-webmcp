import assert from 'node:assert/strict';
import test from 'node:test';

Object.defineProperty(globalThis, 'localStorage', { value: { getItem: () => null, setItem: () => {} }, configurable: true });
Object.defineProperty(globalThis, 'document', { value: {}, configurable: true });
Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true });
const { registerTools, getModelContext, TOOL_NAMES } = await import('../src/webmcp.ts');

function context({ useSignal = false, failAt } = {}) {
  const tools = new Map();
  return { tools, registerTool(tool, options) {
    if (tool.name === failAt || tools.has(tool.name)) throw new Error('registration failed');
    tools.set(tool.name, tool);
    if (useSignal) options.signal.addEventListener('abort', () => tools.delete(tool.name));
  }, ...(useSignal ? {} : { unregisterTool: name => tools.delete(name) }) };
}

for (const useSignal of [true, false]) {
  test(`registration cleans up and remounts with ${useSignal ? 'document signals' : 'legacy navigator unregisterTool'}`, async () => {
    const ctx = context({ useSignal });
    document.modelContext = useSignal ? ctx : {};
    navigator.modelContext = useSignal ? undefined : ctx;
    assert.equal(getModelContext(), ctx);
    const first = new AbortController();
    assert.deepEqual(await registerTools(first.signal), [...TOOL_NAMES]);
    assert.equal(ctx.tools.get('approve_draft').annotations.consequentialHint, true);
    first.abort();
    assert.equal(ctx.tools.size, 0);
    const second = new AbortController();
    assert.deepEqual(await registerTools(second.signal), [...TOOL_NAMES]);
    second.abort();
    assert.deepEqual(await registerTools(second.signal), []);
    assert.equal(ctx.tools.size, 0);
  });

  test(`registration failure removes partial registrations (${useSignal ? 'signals' : 'unregisterTool'})`, async () => {
    const ctx = context({ useSignal, failAt: 'add_loop' });
    document.modelContext = ctx;
    const ac = new AbortController();
    assert.deepEqual(await registerTools(ac.signal), []);
    assert.equal(ctx.tools.size, 0);
  });
}

test('registered tools share the draft workflow and return validation errors without mutations', async () => {
  const ctx = context();
  document.modelContext = ctx;
  const ac = new AbortController();
  await registerTools(ac.signal);
  const invoke = (name, args) => ctx.tools.get(name).execute(args);
  const loop = invoke('add_loop', { title: 'Test workflow' });
  assert.equal(invoke('draft_message', { id: loop.id, body: 'Hello' }).status, 'draft');
  assert.equal(invoke('get_loop', { id: loop.id }).draft.body, 'Hello');
  assert.equal(invoke('approve_draft', { id: loop.id }).status, 'done');
  assert.equal(invoke('approve_draft', { id: loop.id }).ok, false);
  assert.equal(invoke('add_loop', { title: 'Bad date', due: '2026-02-30' }).ok, false);
  assert.equal(invoke('list_loops', { status: 'done' }).loops.length, 1);
  ac.abort();
});

test('promise-based registration failure rolls back tools and reports offline', async () => {
  const ctx = context({ useSignal: true });
  const register = ctx.registerTool;
  ctx.registerTool = (tool, options) => {
    if (tool.name === 'add_loop') return Promise.reject(new Error('Permission denied'));
    register(tool, options);
    return Promise.resolve();
  };
  document.modelContext = ctx;
  assert.deepEqual(await registerTools(new AbortController().signal), []);
  assert.equal(ctx.tools.size, 0);
});

test('aborting pending registrations does not remove a later mount', async () => {
  const ctx = context({ useSignal: true });
  const register = ctx.registerTool;
  ctx.registerTool = (tool, options) => {
    register(tool, options);
    return new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason));
      queueMicrotask(resolve);
    });
  };
  document.modelContext = ctx;
  const first = new AbortController();
  const pending = registerTools(first.signal);
  first.abort();
  const second = new AbortController();
  assert.deepEqual(await registerTools(second.signal), [...TOOL_NAMES]);
  assert.deepEqual(await pending, []);
  assert.equal(ctx.tools.size, TOOL_NAMES.length);
  second.abort();
});
