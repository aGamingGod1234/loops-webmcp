import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { formatWhen, relativeDue } from "./dates";
import {
  addLoop,
  approveDraft,
  closeLoop,
  countsOf,
  draftMessage,
  filterLoops,
  getSnapshot,
  isTodayLoop,
  snoozeLoop,
  subscribe,
} from "./store";
import { FILTERS } from "./types";
import type { Filter, Loop, LoopStatus } from "./types";
import { registerTools } from "./webmcp";

const EMPTY_INBOX = {
  title: "Nothing here yet.",
  body: "Hit New loop, or ask an agent to add one.",
};

const EMPTY: Record<Filter, { title: string; body: string }> = {
  today: {
    title: "Nothing asking for you.",
    body: "That’s the point. Overdue work, drafts waiting on a tap, and anything due today land here.",
  },
  owed: {
    title: "You don’t owe anyone a thing.",
    body: "When someone is waiting on you — an intro, a recap, a reservation — it will sit in this list.",
  },
  waiting: {
    title: "No one is holding you up.",
    body: "Refunds, take-homes, replies you’re tracking live here until they move.",
  },
  draft: {
    title: "No drafts waiting for a human.",
    body: "The agent can file a draft. Approval is a separate action in the UI or an authorized agent call.",
  },
  done: {
    title: "Closed loops live here.",
    body: "Finished work stays out of Today, so the inbox can stay small.",
  },
};

export function App() {
  const loops = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const [filter, setFilter] = useState<Filter>("today");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [banner, setBanner] = useState(true);
  const [tools, setTools] = useState<string[]>([]);
  const [connected, setConnected] = useState(false);
  const [composing, setComposing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftText, setDraftText] = useState("");
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const counts = useMemo(() => countsOf(loops), [loops]);
  const visible = useMemo(() => filterLoops(loops, filter, query), [loops, filter, query]);
  const selected = visible.find((l) => l.id === selectedId) ?? visible[0] ?? null;

  useEffect(() => {
    setSelectedId(selected?.id ?? null);
  }, [selected?.id]);

  useEffect(() => {
    const ac = new AbortController();
    void registerTools(ac.signal).then((names) => {
      if (ac.signal.aborted) return;
      setTools(names);
      setConnected(names.length > 0);
    });
    return () => ac.abort();
  }, []);

  useEffect(() => {
    if (selected?.draft) setDraftText(selected.draft.body);
    else setDraftText("");
    setEditing(false);
    setSnoozeOpen(false);
  }, [selected?.id, selected?.draft?.createdAt]);

  const move = useCallback(
    (dir: 1 | -1) => {
      if (!visible.length) return;
      const idx = Math.max(0, visible.findIndex((l) => l.id === selected?.id));
      const next = visible[(idx + dir + visible.length) % visible.length];
      setSelectedId(next.id);
    },
    [visible, selected],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      if (e.key === "Escape") {
        if (composing) setComposing(false);
        else if (showDetail) setShowDetail(false);
        else (e.target as HTMLElement)?.blur?.();
        return;
      }
      if (typing || composing || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "j") move(1);
      if (e.key === "k") move(-1);
      if (e.key === "/" ) {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === "n") setComposing(true);
      if (e.key === "Enter" && selected) setShowDetail(true);
      if (e.key === "a" && selected?.draft && !editing) approveDraft(selected.id);
      if (e.key === "e" && selected?.draft) setEditing(true);
      if (e.key === "s" && selected && selected.status !== "done") setSnoozeOpen((v) => !v);
      if (e.key === "c" && selected && selected.status !== "done") closeLoop(selected.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [move, selected, composing, showDetail, editing]);

  const filterLabel = FILTERS.find((f) => f.id === filter)?.label ?? "Today";

  return (
    <div className="app">
      {!connected && banner && (
        <div className="banner">
          <span>
            Agent tools need ChatGPT desktop’s in-app browser, or Chrome 149+ with{" "}
            <code>chrome://flags/#enable-webmcp-testing</code>. The inbox works either way.
          </span>
          <button className="dismiss" onClick={() => setBanner(false)} aria-label="Dismiss">
            Dismiss
          </button>
        </div>
      )}

      <div className={"shell" + (showDetail ? " show-detail" : "")}>
        <aside className="rail">
          <div className="brand">
            <div className="wordmark">Loops</div>
            <div className="tagline">What still needs you.</div>
          </div>
          <button className="new-btn" onClick={() => setComposing(true)}>
            New loop
          </button>
          <nav className="filters">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                className={"filter" + (filter === f.id ? " active" : "")}
                onClick={() => {
                  setFilter(f.id);
                  setShowDetail(false);
                }}
              >
                <span>{f.label}</span>
                <span className="count">{counts[f.id === "draft" ? "draft" : f.id]}</span>
              </button>
            ))}
          </nav>
          <div className="rail-foot">
            <div className={"agent" + (connected ? "" : " missing")}>
              <span className="dot" />
              {connected ? (
                <>
                  <strong>Agent connected</strong>
                  <div> · {tools.length} tools</div>
                  <div className="tool-tip">{tools.join("\n")}</div>
                </>
              ) : (
                <>
                  <strong>Agent offline</strong>
                  <div>UI works without it.</div>
                </>
              )}
            </div>
            <div className="keys">j k move · n new · / search</div>
          </div>
        </aside>

        <section className="list">
          <div className="mobile-rail">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                className={"filter" + (filter === f.id ? " active" : "")}
                onClick={() => setFilter(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="list-head">
            <h1>{filterLabel}</h1>
            <div className="meta">
              {visible.length} {visible.length === 1 ? "loop" : "loops"}
            </div>
          </div>
          <input
            ref={searchRef}
            className="search"
            placeholder="Search people, notes, drafts"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="rows">
            {visible.length === 0 ? (
              <div className="empty">
                <h2>
                  {query
                    ? "Nothing matches."
                    : loops.length === 0
                      ? EMPTY_INBOX.title
                      : EMPTY[filter].title}
                </h2>
                <p>
                  {query
                    ? "Try a name, or clear the search."
                    : loops.length === 0
                      ? EMPTY_INBOX.body
                      : EMPTY[filter].body}
                </p>
              </div>
            ) : (
              visible.map((loop) => (
                <LoopRow
                  key={loop.id}
                  loop={loop}
                  selected={selected?.id === loop.id}
                  onSelect={() => {
                    setSelectedId(loop.id);
                    setShowDetail(true);
                  }}
                />
              ))
            )}
          </div>
        </section>

        <section className="detail">
          {selected ? (
            <Detail
              loop={selected}
              editing={editing}
              draftText={draftText}
              snoozeOpen={snoozeOpen}
              onBack={() => setShowDetail(false)}
              onDraftText={setDraftText}
              onEdit={() => setEditing(true)}
              onSaveDraft={() => {
                draftMessage(selected.id, draftText, "human");
                setEditing(false);
              }}
              onApprove={() => approveDraft(selected.id)}
              onSnooze={(until) => {
                snoozeLoop(selected.id, until);
                setSnoozeOpen(false);
              }}
              onToggleSnooze={() => setSnoozeOpen((v) => !v)}
              onClose={() => closeLoop(selected.id)}
            />
          ) : (
            <div className="detail-empty">
              <div className="empty">
                <h2>{loops.length === 0 ? EMPTY_INBOX.title : "Pick a loop."}</h2>
                <p>
                  {loops.length === 0
                    ? EMPTY_INBOX.body
                    : "The list is on the left. Today is the work. Everything else can wait."}
                </p>
              </div>
            </div>
          )}
        </section>
      </div>

      {composing && (
        <NewLoop
          onClose={() => setComposing(false)}
          onCreate={(input) => {
            const loop = addLoop(input);
            setSelectedId(loop.id);
            setFilter(isTodayLoop(loop) ? "today" : loop.status);
            setQuery("");
            setComposing(false);
            setShowDetail(true);
          }}
        />
      )}
    </div>
  );
}

function LoopRow({
  loop,
  selected,
  onSelect,
}: {
  loop: Loop;
  selected: boolean;
  onSelect: () => void;
}) {
  const overdue = !!loop.due && relativeDue(loop.due)?.includes("overdue") && loop.status !== "done";
  const due = relativeDue(loop.due);
  return (
    <button
      className={
        "row" +
        (selected ? " selected" : "") +
        (loop.draft ? " has-draft" : "") +
        (overdue ? " overdue" : "")
      }
      onClick={onSelect}
    >
      <span className="mark" />
      <span>
        <div className="title">{loop.title}</div>
        <div className="sub">
          <span>{loop.people.map((p) => p.name).join(" · ") || "No one yet"}</span>
        </div>
      </span>
      <span className="aside">
        {due && <span className={"due" + (overdue ? " overdue" : "")}>{due}</span>}
        {loop.draft ? (
          <span className="pill draft">Draft</span>
        ) : (
          <span className="pill">{loop.status}</span>
        )}
      </span>
    </button>
  );
}

function Detail({
  loop,
  editing,
  draftText,
  snoozeOpen,
  onBack,
  onDraftText,
  onEdit,
  onSaveDraft,
  onApprove,
  onSnooze,
  onToggleSnooze,
  onClose,
}: {
  loop: Loop;
  editing: boolean;
  draftText: string;
  snoozeOpen: boolean;
  onBack: () => void;
  onDraftText: (v: string) => void;
  onEdit: () => void;
  onSaveDraft: () => void;
  onApprove: () => void;
  onSnooze: (until: string) => void;
  onToggleSnooze: () => void;
  onClose: () => void;
}) {
  const overdue = !!loop.due && relativeDue(loop.due)?.includes("overdue") && loop.status !== "done";
  const due = relativeDue(loop.due);

  return (
    <>
      <div className="detail-scroll">
        <button className="back" onClick={onBack}>
          ← Inbox
        </button>
        <div className="kicker">
          <span className="pill">{loop.status}</span>
          {due && (
            <span className={"due" + (overdue ? " overdue" : "")} style={{ marginLeft: 10 }}>
              {due}
            </span>
          )}
        </div>
        <h2>{loop.title}</h2>
        {loop.people.length > 0 && (
          <div className="people">
            {loop.people.map((p) => (
              <span className="person" key={p.name}>
                {p.name}
                {p.role && <em>{p.role}</em>}
              </span>
            ))}
          </div>
        )}
        {loop.notes && <p className="notes">{loop.notes}</p>}

        {loop.draft && (
          <div className="composer">
            <div className="who">
              Draft from {loop.draft.createdBy === "agent" ? "the agent" : "you"} ·{" "}
              {formatWhen(loop.draft.createdAt)} · not sent
            </div>
            <textarea
              value={draftText}
              readOnly={!editing}
              onChange={(e) => onDraftText(e.target.value)}
            />
            <div className="bar">
              <span style={{ fontSize: 12, color: "var(--faint)" }}>
                {editing ? "Editing — save before you approve." : "Approve records completion. No email is sent."}
              </span>
              {editing ? (
                <button className="btn" disabled={!draftText.trim()} onClick={onSaveDraft}>
                  Save draft
                </button>
              ) : null}
            </div>
          </div>
        )}

        {!loop.draft && loop.status !== "done" && (
          <DraftBox
            key={loop.id}
            onSubmit={(body) => {
              draftMessage(loop.id, body, "human");
            }}
          />
        )}

        <p className="section-label">Timeline</p>
        <div className="timeline">
          {[...loop.events].reverse().map((ev, i) => (
            <div className="event" key={ev.ts + i}>
              <div className="when">{formatWhen(ev.ts)}</div>
              <div className="text">{ev.text}</div>
            </div>
          ))}
        </div>
      </div>

      {loop.status !== "done" && (
        <div className="actions">
          {loop.draft && (
            <button className="btn primary" disabled={editing} onClick={onApprove}>
              Approve
            </button>
          )}
          {loop.draft && (
            <button className="btn" onClick={onEdit}>
              Edit
            </button>
          )}
          <div className="snooze-pop">
            <button className="btn" onClick={onToggleSnooze}>
              Snooze
            </button>
            {snoozeOpen && (
              <div className="snooze-menu">
                <button onClick={() => onSnooze("1d")}>Tomorrow</button>
                <button onClick={() => onSnooze("3d")}>In 3 days</button>
                <button onClick={() => onSnooze("1w")}>Next week</button>
              </div>
            )}
          </div>
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      )}
    </>
  );
}

function DraftBox({ onSubmit }: { onSubmit: (body: string) => void }) {
  const [body, setBody] = useState("");
  return (
    <div className="composer">
      <div className="who">Write a draft — it will not send</div>
      <textarea
        value={body}
        placeholder="A short, human note."
        onChange={(e) => setBody(e.target.value)}
      />
      <div className="bar">
        <span style={{ fontSize: 12, color: "var(--faint)" }}>Saved as a pending draft.</span>
        <button
          className="btn"
          disabled={!body.trim()}
          onClick={() => {
            onSubmit(body);
            setBody("");
          }}
        >
          File draft
        </button>
      </div>
    </div>
  );
}

function NewLoop({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (input: {
    title: string;
    status?: LoopStatus;
    due?: string | null;
    people?: string[];
    notes?: string;
  }) => void;
}) {
  const [title, setTitle] = useState("");
  const [people, setPeople] = useState("");
  const [status, setStatus] = useState<LoopStatus>("owed");
  const [due, setDue] = useState("");
  const [notes, setNotes] = useState("");
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  return (
    <div className="modal-back" onClick={onClose}>
      <form
        className="modal"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (!title.trim()) return;
          onCreate({
            title: title.trim(),
            status,
            due: due || null,
            people: people
              .split(",")
              .map((p) => p.trim())
              .filter(Boolean),
            notes: notes.trim(),
          });
        }}
      >
        <h3>Open a loop</h3>
        <label className="field">
          <span>Title</span>
          <input
            ref={titleRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What still needs you"
          />
        </label>
        <label className="field">
          <span>People</span>
          <input
            value={people}
            onChange={(e) => setPeople(e.target.value)}
            placeholder="Comma-separated"
          />
        </label>
        <label className="field">
          <span>Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value as LoopStatus)}>
            <option value="owed">Owed</option>
            <option value="waiting">Waiting</option>
            <option value="draft">Draft</option>
          </select>
        </label>
        <label className="field">
          <span>Due</span>
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </label>
        <label className="field">
          <span>Notes</span>
          <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={!title.trim()}>
            Open
          </button>
        </div>
      </form>
    </div>
  );
}
