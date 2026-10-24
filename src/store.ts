import { daysUntil, isDueToday, isOverdue, parseUntil, relativeDue } from "./dates.ts";
import type {
  CompactLoop,
  Counts,
  DraftAuthor,
  Filter,
  Loop,
  LoopStatus,
  Person,
} from "./types";
import { STATUSES } from "./types.ts";

const KEY = "loops.v2";

type Listener = () => void;

let loops: Loop[] = load();
const listeners = new Set<Listener>();

function load(): Loop[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Loop[];
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

function persist(next = loops) {
  // Commit only after storage succeeds so failed tool calls can be retried safely.
  localStorage.setItem(KEY, JSON.stringify(next));
  loops = next;
  for (const fn of listeners) fn();
}

function clone(): Loop[] {
  return loops.map((l) => ({
    ...l,
    people: l.people.map((p) => ({ ...p })),
    events: l.events.map((e) => ({ ...e })),
    draft: l.draft ? { ...l.draft } : null,
  }));
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getSnapshot(): Loop[] {
  return loops;
}

function nid(): string {
  return `lp_${Math.random().toString(36).slice(2, 8)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function requireLoop(id: string): Loop {
  const found = loops.find((l) => l.id === id);
  if (!found) throw new Error(`Unknown loop: ${id}`);
  return found;
}

function patch(id: string, fn: (loop: Loop) => Loop): Loop {
  const current = requireLoop(id);
  const next = fn({
    ...current,
    people: current.people.map((p) => ({ ...p })),
    events: current.events.map((e) => ({ ...e })),
    draft: current.draft ? { ...current.draft } : null,
    updatedAt: nowIso(),
  });
  persist(loops.map((l) => (l.id === id ? next : l)));
  return next;
}

export function isTodayLoop(loop: Loop): boolean {
  if (loop.status === "done") return false;
  if (isOverdue(loop.due)) return true;
  if (isDueToday(loop.due)) return true;
  if (loop.draft) return true;
  return false;
}

export function urgency(loop: Loop): number {
  if (loop.status === "done") return 100;
  if (isOverdue(loop.due)) return daysUntil(loop.due) ?? 0;
  if (loop.draft) return 10;
  if (isDueToday(loop.due)) return 20;
  const d = daysUntil(loop.due);
  if (d === null) return 40;
  return 20 + d;
}

export function countsOf(list: Loop[]): Counts {
  return {
    today: list.filter(isTodayLoop).length,
    owed: list.filter((l) => l.status === "owed").length,
    waiting: list.filter((l) => l.status === "waiting").length,
    draft: list.filter((l) => l.status === "draft" || !!l.draft).length,
    done: list.filter((l) => l.status === "done").length,
    all: list.length,
  };
}

export function filterLoops(list: Loop[], filter: Filter, query = ""): Loop[] {
  const q = query.trim().toLowerCase();
  let out = list;
  if (filter === "today") out = out.filter(isTodayLoop);
  else if (filter === "draft") out = out.filter((l) => l.status === "draft" || !!l.draft);
  else out = out.filter((l) => l.status === filter);
  if (q) {
    out = out.filter((l) => {
      const hay = [
        l.title,
        l.notes,
        l.draft?.body ?? "",
        ...l.people.map((p) => p.name),
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }
  return [...out].sort((a, b) => {
    const ua = urgency(a) - urgency(b);
    if (ua !== 0) return ua;
    return (a.due ?? "9").localeCompare(b.due ?? "9");
  });
}

export function compact(loop: Loop): CompactLoop {
  return {
    id: loop.id,
    title: loop.title,
    status: loop.status,
    due: loop.due,
    people: loop.people.map((p) => p.name),
    hasDraft: !!loop.draft,
    overdue: isOverdue(loop.due) && loop.status !== "done",
    dueLabel: relativeDue(loop.due),
  };
}

export function listLoops(status?: Filter): {
  filter: Filter | "all";
  counts: Counts;
  loops: CompactLoop[];
} {
  const all = clone();
  const filter = status ?? "today";
  const list =
    status === undefined
      ? all.filter((l) => l.status !== "done")
      : filterLoops(all, filter);
  return {
    filter: status ?? "all",
    counts: countsOf(all),
    loops: (status === undefined ? list.sort((a, b) => urgency(a) - urgency(b)) : list).map(
      compact,
    ),
  };
}

export function getLoop(id: string): Loop {
  return structuredClone(requireLoop(id));
}

export function addLoop(input: {
  title: string;
  status?: LoopStatus;
  due?: string | null;
  people?: Array<string | Person>;
  notes?: string;
  awaitReply?: boolean;
}): Loop {
  const title = input.title?.trim();
  if (!title) throw new Error("title is required");
  const status = input.status ?? "owed";
  if (!STATUSES.includes(status)) throw new Error(`Invalid status: ${status}`);
  const due = normalizeDue(input.due);
  const people = normalizePeople(input.people);
  const createdAt = nowIso();
  const loop: Loop = {
    id: nid(),
    title,
    status,
    due,
    people,
    notes: input.notes?.trim() ?? "",
    draft: null,
    awaitReply: input.awaitReply ?? status === "waiting",
    createdAt,
    updatedAt: createdAt,
    events: [{ ts: createdAt, actor: "you", text: "Opened." }],
  };
  persist([loop, ...loops]);
  return structuredClone(loop);
}

export function updateLoop(
  id: string,
  patchIn: {
    title?: string;
    status?: LoopStatus;
    due?: string | null;
    notes?: string;
    people?: Array<string | Person>;
    awaitReply?: boolean;
  },
): Loop {
  return patch(id, (loop) => {
    if (patchIn.title !== undefined) {
      const title = patchIn.title.trim();
      if (!title) throw new Error("title cannot be empty");
      loop.title = title;
    }
    if (patchIn.status !== undefined) {
      if (!STATUSES.includes(patchIn.status)) throw new Error(`Invalid status: ${patchIn.status}`);
      loop.status = patchIn.status;
    }
    if (patchIn.due !== undefined) loop.due = normalizeDue(patchIn.due);
    if (patchIn.notes !== undefined) loop.notes = patchIn.notes;
    if (patchIn.people !== undefined) loop.people = normalizePeople(patchIn.people);
    if (patchIn.awaitReply !== undefined) loop.awaitReply = patchIn.awaitReply;
    loop.events = [
      ...loop.events,
      { ts: nowIso(), actor: "you", text: "Updated." },
    ];
    return loop;
  });
}

export function draftMessage(id: string, body: string, createdBy: DraftAuthor = "agent"): Loop {
  const text = body?.trim();
  if (!text) throw new Error("body is required");
  return patch(id, (loop) => {
    if (loop.status === "done") {
      throw new Error("Cannot draft on a closed loop. Re-open it first.");
    }
    loop.draft = { body: text, createdBy, createdAt: nowIso() };
    if (loop.status !== "draft") loop.status = "draft";
    loop.events = [
      ...loop.events,
      {
        ts: nowIso(),
        actor: createdBy === "agent" ? "agent" : "you",
        text: createdBy === "agent" ? "Filed a draft. Waiting on you." : "Edited the draft.",
      },
    ];
    return loop;
  });
}

export function approveDraft(id: string): Loop {
  return patch(id, (loop) => {
    if (!loop.draft) throw new Error("No draft to approve.");
    const nextStatus: LoopStatus = loop.awaitReply ? "waiting" : "done";
    loop.events = [
      ...loop.events,
      { ts: nowIso(), actor: "you", text: "Sent." },
    ];
    loop.draft = null;
    loop.status = nextStatus;
    if (nextStatus === "done") {
      loop.events = [...loop.events, { ts: nowIso(), actor: "you", text: "Closed after send." }];
    }
    return loop;
  });
}

export function snoozeLoop(id: string, until: string): Loop {
  if (!until?.trim()) throw new Error("until is required (ISO or relative, e.g. 3d)");
  const due = parseUntil(until).toISOString();
  return patch(id, (loop) => {
    if (loop.status === "done") throw new Error("Cannot snooze a closed loop.");
    loop.due = due;
    loop.events = [
      ...loop.events,
      { ts: nowIso(), actor: "you", text: `Snoozed to ${relativeDue(due)}.` },
    ];
    return loop;
  });
}

export function closeLoop(id: string, reason?: string): Loop {
  return patch(id, (loop) => {
    loop.status = "done";
    loop.draft = null;
    const text = reason?.trim() ? `Closed. ${reason.trim()}` : "Closed.";
    loop.events = [...loop.events, { ts: nowIso(), actor: "you", text }];
    return loop;
  });
}

export function searchLoops(query: string): CompactLoop[] {
  const q = query?.trim();
  if (!q) return [];
  return filterLoops(clone(), "owed", "")
    .concat(filterLoops(clone(), "waiting", ""))
    .concat(filterLoops(clone(), "draft", ""))
    .concat(filterLoops(clone(), "done", ""))
    .filter((l, i, arr) => arr.findIndex((x) => x.id === l.id) === i)
    .filter((l) => {
      const hay = [l.title, l.notes, l.draft?.body ?? "", ...l.people.map((p) => p.name)]
        .join(" ")
        .toLowerCase();
      return hay.includes(q.toLowerCase());
    })
    .sort((a, b) => urgency(a) - urgency(b))
    .map(compact);
}

export function planToday(): {
  generatedAt: string;
  summary: string;
  items: Array<{
    id: string;
    title: string;
    reason: "overdue" | "draft" | "due_today";
    urgency: number;
    action: string;
    hasDraft: boolean;
    people: string[];
    due: string | null;
  }>;
} {
  const today = filterLoops(clone(), "today");
  const items = today.map((l) => {
    const reason = isOverdue(l.due)
      ? ("overdue" as const)
      : l.draft
        ? ("draft" as const)
        : ("due_today" as const);
    const action = l.draft
      ? "Review draft, then approve_draft or edit"
      : reason === "overdue"
        ? "Write or draft_message, then approve"
        : "Do this today — draft_message if useful";
    return {
      id: l.id,
      title: l.title,
      reason,
      urgency: urgency(l),
      action,
      hasDraft: !!l.draft,
      people: l.people.map((p) => p.name),
      due: l.due,
    };
  });
  const overdue = items.filter((i) => i.reason === "overdue").length;
  const drafts = items.filter((i) => i.reason === "draft").length;
  const due = items.filter((i) => i.reason === "due_today").length;
  const parts: string[] = [];
  if (overdue) parts.push(`${overdue} overdue`);
  if (drafts) parts.push(`${drafts} draft${drafts === 1 ? "" : "s"} to approve`);
  if (due) parts.push(`${due} due today`);
  return {
    generatedAt: nowIso(),
    summary: parts.length ? parts.join(", ") : "Inbox is clear.",
    items,
  };
}

function normalizeDue(due?: string | null): string | null {
  if (due === undefined || due === null || due === "") return null;
  return parseUntil(due).toISOString();
}

function normalizePeople(people?: Array<string | Person>): Person[] {
  if (!people) return [];
  return people
    .map((p) => (typeof p === "string" ? { name: p.trim() } : { name: p.name.trim(), role: p.role }))
    .filter((p) => p.name);
}

if (typeof window !== "undefined" && !localStorage.getItem(KEY)) {
  persist();
}
