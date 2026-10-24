# Loops

An inbox for open loops — things you owe, things waiting on someone else, and drafts awaiting review in a local prototype.

You work it like Superhuman or Linear. ChatGPT works the same live state via WebMCP. The agent can draft and file; approval is a separate action.

That is what people actually want agents to do: email, follow-ups, calendar nudges, admin — without going rogue.

## Why WebMCP

Loops registers imperative tools on `document.modelContext` / `navigator.modelContext`. ChatGPT (desktop in-app browser) and Chrome 149+ with WebMCP testing can read your inbox, draft a reply, and stop. Approval is a separate tool (`approve_draft`) with a `consequentialHint` annotation, also available as a button in the UI. Both use the same store.

The agent proposes. You approve, or explicitly delegate approval. Tool descriptions and annotations guide the host; the app does not enforce a separate human-confirmation gate.

## Run

Use Node.js 24 LTS (`nvm use` reads `.nvmrc`) and npm. The lockfile pins the dependency tree.

```bash
npm ci
npm run dev
```

Production build:

```bash
npm run build
npm run preview
```

Run `npm test` for date, store, and WebMCP regression checks. CI runs a clean install, tests, and the production build on Node 24.

This is a local prototype: approving records a `Sent.` event and changes the loop status. It does not send email or contact any external service.

No auth. State lives in `localStorage` under `loops.v2`. First visit starts empty — add a loop yourself, or ask an agent to file one.

Compatibility headers (already set for Vite dev/preview, Vercel, Netlify, and `public/_headers`):

- `Origin-Agent-Cluster: ?1`
- `Permissions-Policy: tools=(self)`

Never ship `Origin-Agent-Cluster: ?0`.

WebMCP is experimental; see the [Chrome setup guide](https://developer.chrome.com/docs/ai/webmcp) for local testing. The current [WebMCP draft](https://webmachinelearning.github.io/webmcp/) uses `document.modelContext` and registration abort signals. Loops also supports older `navigator.modelContext` hosts with `unregisterTool`, so React development remounts clean up correctly. Registration failures leave the regular inbox available.

## How judges test

Open the deployed URL in ChatGPT desktop’s in-app browser (or Chrome 149+ with `chrome://flags/#enable-webmcp-testing`). Then:

1. **`plan_today`** — prioritized work: overdue, drafts awaiting approval, due today.
2. **`draft_message`** on a loop — writes a pending draft. Does **not** send. Status becomes `draft`; closed loops must be reopened first.
3. **Human Approve** in the UI, *or* **`approve_draft`** — records approval locally. Appends a `sent` event, clears the draft, marks the loop done (one-shot) or waiting (if a reply is expected).
4. **`list_loops`** — confirm the new state. Same data the human sees.

Drafting and approval are separate operations. Only invoke `approve_draft` with explicit approval or delegated authority. The app has no mail transport.

### Tools

| Tool | Access | What it does |
|---|---|---|
| `list_loops` | read | Compact list + counts. `status` may be `owed`, `waiting`, `draft`, `done`, or `today`. |
| `get_loop` | read | Full loop: people, notes, draft, events. |
| `search_loops` | read | Title / people / notes / draft search. |
| `plan_today` | read | Structured plan the agent can act on. |
| `add_loop` | write | Create a loop. |
| `update_loop` | write | Patch title, status, due, notes, people. |
| `draft_message` | write | File a pending draft. Does not send. |
| `approve_draft` | **consequential** | Record approval / close out the draft locally. Human-equivalent of Approve. |
| `snooze_loop` | write | Push due (`until` is ISO or relative, e.g. `3d`). |
| `close_loop` | write | Mark done, optional reason. |

## Keyboard

`j` / `k` move · `↵` open · `a` approve · `e` edit draft · `s` snooze · `c` close · `n` new · `/` search · `esc` back

## Stack

Vite · React · TypeScript. Client-only. MIT.
