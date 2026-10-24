import {
  addLoop,
  approveDraft,
  closeLoop,
  draftMessage,
  getLoop,
  listLoops,
  planToday,
  searchLoops,
  snoozeLoop,
  updateLoop,
} from "./store.ts";
import { STATUSES } from "./types.ts";
import type { Filter, LoopStatus } from "./types";
import type { ModelContext, WebMcpTool } from "./vite-env";

export const TOOL_NAMES = [
  "list_loops",
  "get_loop",
  "add_loop",
  "update_loop",
  "draft_message",
  "approve_draft",
  "snooze_loop",
  "close_loop",
  "search_loops",
  "plan_today",
] as const;

const FILTERS = [...STATUSES, "today"] as const;

function str(args: Record<string, unknown>, key: string, required = false): string {
  const v = args[key];
  if (v === undefined || v === null || v === "") {
    if (required) throw new Error(`${key} is required`);
    return "";
  }
  if (typeof v !== "string") throw new Error(`${key} must be a string`);
  return v;
}

function optStr(args: Record<string, unknown>, key: string): string | undefined {
  if (!(key in args) || args[key] === undefined) return undefined;
  return str(args, key);
}

function peopleOf(args: Record<string, unknown>): Array<string> | undefined {
  if (!("people" in args) || args.people === undefined) return undefined;
  const v = args.people;
  if (!Array.isArray(v)) throw new Error("people must be an array of names");
  return v.map((p) => {
    if (typeof p === "string") return p;
    if (p && typeof p === "object" && "name" in p && typeof (p as { name: unknown }).name === "string") {
      return (p as { name: string }).name;
    }
    throw new Error("people items must be strings");
  });
}

function wrap(fn: (args: Record<string, unknown>) => unknown) {
  return (args: Record<string, unknown>) => {
    try {
      const result = fn(args ?? {});
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  };
}

const tools: WebMcpTool[] = [
  {
    name: "list_loops",
    description:
      "List open loops in compact form, plus folder counts. Optional status: owed, waiting, draft, done, or today (overdue + due today + drafts awaiting approval). Omit status for all open loops.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        status: {
          type: "string",
          enum: [...FILTERS],
          description: "Folder to list. today = overdue + due today + drafts.",
        },
      },
    },
    execute: wrap((args) => {
      const status = optStr(args, "status");
      if (status && !FILTERS.includes(status as (typeof FILTERS)[number])) {
        throw new Error(`status must be one of ${FILTERS.join(", ")}`);
      }
      return listLoops(status as Filter | undefined);
    }),
  },
  {
    name: "get_loop",
    description:
      "Get one loop in full: title, people, notes, pending draft, and the event timeline. Use before drafting or approving.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["id"],
      properties: {
        id: { type: "string", description: "Loop id" },
      },
    },
    execute: wrap((args) => getLoop(str(args, "id", true))),
  },
  {
    name: "add_loop",
    description:
      "Open a new loop. The agent files it; a human still owns sending. Default status is owed.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["title"],
      properties: {
        title: { type: "string" },
        status: { type: "string", enum: [...STATUSES] },
        due: { type: "string", description: "ISO date or relative (3d, 1w)" },
        people: { type: "array", items: { type: "string" } },
        notes: { type: "string" },
      },
    },
    execute: wrap((args) =>
      addLoop({
        title: str(args, "title", true),
        status: optStr(args, "status") as LoopStatus | undefined,
        due: optStr(args, "due") ?? null,
        people: peopleOf(args),
        notes: optStr(args, "notes"),
      }),
    ),
  },
  {
    name: "update_loop",
    description: "Patch a loop's title, status, due date, notes, or people. Does not send mail.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["id"],
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        status: { type: "string", enum: [...STATUSES] },
        due: { type: "string", description: "ISO, relative, or empty to clear" },
        notes: { type: "string" },
        people: { type: "array", items: { type: "string" } },
      },
    },
    execute: wrap((args) =>
      updateLoop(str(args, "id", true), {
        title: optStr(args, "title"),
        status: optStr(args, "status") as LoopStatus | undefined,
        due: "due" in args ? (optStr(args, "due") ?? null) : undefined,
        notes: optStr(args, "notes"),
        people: peopleOf(args),
      }),
    ),
  },
  {
    name: "draft_message",
    description:
      "Write a pending draft on an open loop. Does NOT send. Status becomes draft. Closed loops must be reopened first. Approval is a separate UI action or approve_draft call.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["id", "body"],
      properties: {
        id: { type: "string" },
        body: { type: "string", description: "The unsent message. Keep it short and human." },
      },
    },
    execute: wrap((args) => draftMessage(str(args, "id", true), str(args, "body", true), "agent")),
  },
  {
    name: "approve_draft",
    annotations: { consequentialHint: true },
    description:
      "CONSEQUENTIAL. Records approval locally: appends a sent event, clears the draft, then closes the loop (one-shot) or sets it to waiting if a reply is expected. No email is delivered. Equivalent to the human Approve button. Only call with the human's explicit approval or delegated authority.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["id"],
      properties: {
        id: { type: "string" },
      },
    },
    execute: wrap((args) => approveDraft(str(args, "id", true))),
  },
  {
    name: "snooze_loop",
    description: "Push a loop's due date. until is an ISO date or relative like 3d, 1w, 2m.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["id", "until"],
      properties: {
        id: { type: "string" },
        until: { type: "string", description: "ISO datetime or relative: 3d, 1w, 2m" },
      },
    },
    execute: wrap((args) => snoozeLoop(str(args, "id", true), str(args, "until", true))),
  },
  {
    name: "close_loop",
    description: "Mark a loop done. Optional reason is stored on the timeline.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["id"],
      properties: {
        id: { type: "string" },
        reason: { type: "string" },
      },
    },
    execute: wrap((args) => closeLoop(str(args, "id", true), optStr(args, "reason"))),
  },
  {
    name: "search_loops",
    description: "Search titles, people, notes, and drafts.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["query"],
      properties: {
        query: { type: "string" },
      },
    },
    execute: wrap((args) => ({
      query: str(args, "query", true),
      loops: searchLoops(str(args, "query", true)),
    })),
  },
  {
    name: "plan_today",
    description:
      "Return a prioritized plan of what to do now: overdue first, then drafts awaiting approval, then due today. Structured items an agent can act on with draft_message or get_loop.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
    execute: wrap(() => planToday()),
  },
];

export function getModelContext(): ModelContext | null {
  return [document.modelContext, navigator.modelContext].find(
    (ctx) => typeof ctx?.registerTool === "function",
  ) ?? null;
}

export async function registerTools(signal: AbortSignal): Promise<string[]> {
  const ctx = getModelContext();
  if (!ctx || signal.aborted) return [];
  const names: string[] = [];
  const legacyNames: string[] = [];
  const pending: Promise<void>[] = [];
  const registration = new AbortController();
  let active = true;
  const cleanup = () => {
    if (!active) return;
    active = false;
    registration.abort();
    // Older navigator implementations ignore the registration signal.
    for (const name of legacyNames) {
      try { ctx.unregisterTool?.(name); } catch { /* Already removed by the signal. */ }
    }
    signal.removeEventListener("abort", cleanup);
  };
  signal.addEventListener("abort", cleanup, { once: true });
  try {
    for (const tool of tools) {
      const result = ctx.registerTool(tool, { signal: registration.signal });
      if (result) pending.push(result);
      else legacyNames.push(tool.name);
      names.push(tool.name);
    }
    await Promise.all(pending);
  } catch (error) {
    cleanup();
    // A host may mix promise-based registrations with synchronous failures.
    await Promise.allSettled(pending);
    if (!signal.aborted) console.warn("WebMCP tools could not be registered.", error);
    return [];
  }
  return signal.aborted ? [] : names;
}
