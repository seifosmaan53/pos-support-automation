import { useMemo, useState } from "react";
import { styleExamplesStore } from "../services/styleExamplesStore";
import { useAppStore } from "../services/appStore";
import { EmptyState } from "../components/EmptyState";
import { formatDateTime } from "../utils/formatDate";
import type { StyleExample } from "../types/styleExample";
import { useConfirm } from "../components/ConfirmDialog";

const EMPTY_DRAFT: StyleExample = {
  id: "",
  title: "",
  rawInput: "",
  idealSubject: "",
  idealDescription: "",
  idealResolution: "",
  idealPartRequest: "",
  notes: "",
  createdAt: "",
  updatedAt: "",
};

export function StyleExamplesPage() {
  const [_refresh, setRefresh] = useState(0);
  const [draft, setDraft] = useState<StyleExample>({ ...EMPTY_DRAFT });
  const [editingId, setEditingId] = useState<string | null>(null);
  const setStatus = useAppStore((s) => s.setStatus);
  const ticketFields = useAppStore((s) => s.ticketFields);
  const transcript = useAppStore((s) => s.transcript);
  const askConfirm = useConfirm();

  const examples = useMemo(() => styleExamplesStore.list(), [_refresh]);

  function save() {
    const title = draft.title.trim();
    if (!title) {
      setStatus({ kind: "warning", message: "Style example needs a title." });
      return;
    }
    styleExamplesStore.upsert({ ...draft, id: editingId ?? undefined });
    setRefresh((n) => n + 1);
    setDraft({ ...EMPTY_DRAFT });
    setEditingId(null);
    setStatus({ kind: "success", message: "Style example saved." });
  }

  function startEdit(ex: StyleExample) {
    setDraft({ ...ex });
    setEditingId(ex.id);
  }

  function cancelEdit() {
    setDraft({ ...EMPTY_DRAFT });
    setEditingId(null);
  }

  async function remove(id: string) {
    const ok = await askConfirm({
      title: "Delete this style example?",
      message: "It will be removed from the AI's writing-style training set.",
      destructive: true,
    });
    if (!ok) return;
    styleExamplesStore.remove(id);
    if (editingId === id) cancelEdit();
    setRefresh((n) => n + 1);
  }

  function captureCurrentTicket() {
    if (!ticketFields.subject && !ticketFields.description) {
      setStatus({
        kind: "warning",
        message: "Generate a ticket on the Ticket Form Helper first.",
      });
      return;
    }
    setDraft({
      ...EMPTY_DRAFT,
      title: ticketFields.subject || "Style example",
      rawInput: transcript,
      idealSubject: ticketFields.subject,
      idealDescription: ticketFields.description,
      idealResolution: ticketFields.resolution,
      idealPartRequest: ticketFields.partRequest,
      notes: "",
    });
    setEditingId(null);
    setStatus({
      kind: "info",
      message:
        "Loaded the current ticket as a style example draft. Review and click Save.",
    });
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <header>
        <h1 className="page-title">Style Examples</h1>
        <p className="page-subtitle">
          Teach the assistant your phrasing. Up to two of the most relevant examples
          are passed to the local AI when generating tickets.
        </p>
      </header>

      <section className="card space-y-3">
        <h2 className="text-base font-semibold">
          {editingId ? "Edit Style Example" : "Add Style Example"}
        </h2>
        <Field label="Title">
          <input
            className="input"
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            placeholder="e.g. Internet down — Inseego restart"
          />
        </Field>
        <Field label="Raw note / transcript">
          <textarea
            className="input"
            rows={4}
            value={draft.rawInput}
            onChange={(e) => setDraft({ ...draft, rawInput: e.target.value })}
            placeholder="Paste a representative call note or transcript fragment."
          />
        </Field>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Ideal Subject">
            <input
              className="input"
              value={draft.idealSubject}
              onChange={(e) => setDraft({ ...draft, idealSubject: e.target.value })}
              placeholder="Store XXXXX - Internet down"
            />
          </Field>
          <Field label="Ideal Part Request">
            <input
              className="input"
              value={draft.idealPartRequest}
              onChange={(e) => setDraft({ ...draft, idealPartRequest: e.target.value })}
            />
          </Field>
        </div>
        <Field label="Ideal Description">
          <textarea
            className="input"
            rows={3}
            value={draft.idealDescription}
            onChange={(e) => setDraft({ ...draft, idealDescription: e.target.value })}
            placeholder="Store called reporting that the internet was down on both registers…"
          />
        </Field>
        <Field label="Ideal Resolution">
          <textarea
            className="input"
            rows={3}
            value={draft.idealResolution}
            onChange={(e) => setDraft({ ...draft, idealResolution: e.target.value })}
            placeholder="I restarted the Inseego and confirmed both registers came back online."
          />
        </Field>
        <Field label="Notes (optional)">
          <input
            className="input"
            value={draft.notes}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
          />
        </Field>
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary" onClick={save}>
            {editingId ? "Save Changes" : "Add Style Example"}
          </button>
          {editingId && (
            <button className="btn-ghost" onClick={cancelEdit}>
              Cancel
            </button>
          )}
          <button className="btn-secondary" onClick={captureCurrentTicket}>
            Save Current Ticket as Style Example
          </button>
        </div>
      </section>

      {examples.length === 0 ? (
        <EmptyState
          icon="sparkle"
          title="No style examples yet"
          description="Add one with the form above, or open Form Helper after a real ticket and click Save Current Ticket as Style Example. Up to two are passed to the AI when generating new tickets."
          cta={{ label: "Capture current ticket", onClick: captureCurrentTicket }}
        />
      ) : (
        <section className="space-y-2">
          {examples.map((ex) => (
            <div key={ex.id} className="card flex flex-col gap-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{ex.title}</span>
                <span className="ml-auto text-xs text-slate-500">
                  Updated {formatDateTime(ex.updatedAt)}
                </span>
              </div>
              {ex.idealSubject && (
                <div>
                  <span className="text-xs font-medium text-slate-500">Subject:</span>{" "}
                  <span className="text-slate-700 dark:text-slate-200">{ex.idealSubject}</span>
                </div>
              )}
              {ex.idealDescription && (
                <div className="text-slate-700 dark:text-slate-200">
                  <span className="text-xs font-medium text-slate-500">Description:</span>{" "}
                  {ex.idealDescription}
                </div>
              )}
              {ex.idealResolution && (
                <div className="text-slate-700 dark:text-slate-200">
                  <span className="text-xs font-medium text-slate-500">Resolution:</span>{" "}
                  {ex.idealResolution}
                </div>
              )}
              <div className="flex flex-wrap gap-2 pt-1">
                <button className="btn-secondary" onClick={() => startEdit(ex)}>
                  Edit
                </button>
                <button className="btn-danger ml-auto" onClick={() => remove(ex.id)}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label mb-1">{label}</label>
      {children}
    </div>
  );
}
