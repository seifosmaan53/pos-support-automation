import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { knowledgeStore } from "../services/knowledgeStore";
import { ticketStore } from "../services/databaseService";
import { useAppStore } from "../services/appStore";
import { ListEditor } from "../components/ListEditor";
import { WarningBox } from "../components/WarningBox";
import { EmptyState } from "../components/EmptyState";
import { formatDateTime } from "../utils/formatDate";
import {
  KNOWLEDGE_TYPES,
  defaultContentForType,
  labelForKnowledgeType,
  type AnyKnowledgeItem,
  type KnowledgeContentByType,
  type KnowledgeItemType,
} from "../types/knowledge";
import { useConfirm } from "../components/ConfirmDialog";

type Filter = "all" | KnowledgeItemType;

/**
 * Phase 7 Knowledge Base page.
 *
 * Functionality:
 *   • List + filter (by type, by category/device search query)
 *   • Add / Edit / Delete (per-type editor)
 *   • View related tickets (heuristic: relatedTicketIds + matching category/device)
 *   • Save from ticket — accepts ?prefill={type}&ticketId={id} so other
 *     pages can deep-link into the editor with the current ticket already
 *     captured into a draft.
 */
export function KnowledgeBasePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [refreshTick, setRefresh] = useState(0);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<AnyKnowledgeItem | null>(null);

  const items = useMemo(() => {
    const raw = knowledgeStore.list();
    return raw.filter((i) => {
      if (filter !== "all" && i.type !== filter) return false;
      if (query.trim()) {
        const q = query.trim().toLowerCase();
        if (!i.title.toLowerCase().includes(q)) {
          try {
            if (!JSON.stringify(i.content).toLowerCase().includes(q)) return false;
          } catch {
            return false;
          }
        }
      }
      return true;
    });
  }, [refreshTick, filter, query]);

  const counts = useMemo(() => {
    const all = knowledgeStore.list();
    const map: Record<string, number> = { all: all.length };
    for (const t of KNOWLEDGE_TYPES) map[t.value] = 0;
    for (const i of all) map[i.type] = (map[i.type] ?? 0) + 1;
    return map;
  }, [refreshTick]);

  const createKnowledgeFromTicket = useAppStore((s) => s.createKnowledgeFromTicket);
  const setStatus = useAppStore((s) => s.setStatus);
  const askConfirm = useConfirm();

  // Honor ?prefill=<type>&ticketId=<id> from the cross-page "Add to KB" buttons.
  useEffect(() => {
    const prefill = searchParams.get("prefill");
    if (!prefill) return;
    const type = KNOWLEDGE_TYPES.find((t) => t.value === prefill)?.value;
    if (!type) {
      setSearchParams({}, { replace: true });
      return;
    }
    const ticketId = searchParams.get("ticketId") ?? undefined;
    const item = createKnowledgeFromTicket({ type, ticketId });
    if (item) {
      setRefresh((n) => n + 1);
      setEditingId(item.id);
      setDraft(item as AnyKnowledgeItem);
    }
    setSearchParams({}, { replace: true });
    // We intentionally only run this on first mount with the prefill param.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function startNew(type: KnowledgeItemType) {
    setEditingId(null);
    const fresh: AnyKnowledgeItem = {
      id: "",
      type,
      title: "",
      content: defaultContentForType(type),
      createdAt: "",
      updatedAt: "",
    } as AnyKnowledgeItem;
    setDraft(fresh);
  }

  function startEdit(item: AnyKnowledgeItem) {
    setEditingId(item.id);
    // Deep-clone so the editor can't mutate the cached row.
    setDraft({
      ...item,
      content: { ...(item.content as object) } as AnyKnowledgeItem["content"],
    } as AnyKnowledgeItem);
  }

  function cancelEdit() {
    setDraft(null);
    setEditingId(null);
  }

  function saveDraft() {
    if (!draft) return;
    if (!draft.title.trim()) {
      setStatus({
        kind: "warning",
        message: "Knowledge item needs a title before it can be saved.",
      });
      return;
    }
    if (editingId) {
      knowledgeStore.update(editingId, {
        title: draft.title,
        content: draft.content as Partial<typeof draft.content>,
      });
      setStatus({ kind: "success", message: "Knowledge item updated." });
    } else {
      knowledgeStore.create({
        type: draft.type,
        title: draft.title,
        content: draft.content,
      });
      setStatus({ kind: "success", message: "Knowledge item saved." });
    }
    setRefresh((n) => n + 1);
    setDraft(null);
    setEditingId(null);
  }

  async function remove(id: string) {
    const ok = await askConfirm({
      title: "Delete this knowledge item?",
      message: "It will be removed from the knowledge base. This cannot be undone.",
      destructive: true,
    });
    if (!ok) return;
    knowledgeStore.remove(id);
    if (editingId === id) cancelEdit();
    setRefresh((n) => n + 1);
    setStatus({ kind: "info", message: "Knowledge item deleted." });
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="page-title">Knowledge Base</h1>
          <p className="page-subtitle">
            User-authored facts, troubleshooting guides, part-request rules,
            escalation rules, and store/device notes. Knowledge assists ticket
            generation but never invents facts that aren't in the transcript.
          </p>
        </div>
        <button className="btn-secondary" onClick={() => navigate("/voice")}>
          Back to Voice Ticket
        </button>
      </header>

      <section className="card space-y-3">
        <h2 className="text-base font-semibold">Add Knowledge Item</h2>
        <p className="text-xs text-slate-500">
          Pick a type to start a new entry. Use the inline form below to edit.
        </p>
        <div className="flex flex-wrap gap-2">
          {KNOWLEDGE_TYPES.map((t) => (
            <button
              key={t.value}
              className="btn-secondary text-xs"
              onClick={() => startNew(t.value)}
              title={t.hint}
            >
              + {t.label}
            </button>
          ))}
        </div>
      </section>

      {draft && (
        <KnowledgeEditor
          draft={draft}
          editingId={editingId}
          onChange={(next) => setDraft(next)}
          onSave={saveDraft}
          onCancel={cancelEdit}
        />
      )}

      <section className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold">Items ({counts.all})</h2>
          <input
            className="input ml-auto w-64 text-xs"
            placeholder="Search title or content…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <FilterPill
            label={`All (${counts.all})`}
            active={filter === "all"}
            onClick={() => setFilter("all")}
          />
          {KNOWLEDGE_TYPES.map((t) => (
            <FilterPill
              key={t.value}
              label={`${t.label} (${counts[t.value] ?? 0})`}
              active={filter === t.value}
              onClick={() => setFilter(t.value)}
            />
          ))}
        </div>

        {items.length === 0 ? (
          <EmptyState
            icon="book"
            title="No knowledge items match"
            description="Add an item with the form above, or click 'Add to Knowledge Base' from a ticket on Form Helper to capture troubleshooting steps and store-specific facts."
          />
        ) : (
          <ul className="space-y-2">
            {items.map((item) => (
              <KnowledgeRow
                key={item.id}
                item={item}
                onEdit={() => startEdit(item)}
                onRemove={() => remove(item.id)}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function FilterPill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
        active
          ? "bg-slate-700 text-white dark:bg-slate-200 dark:text-slate-900"
          : "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200"
      }`}
    >
      {label}
    </button>
  );
}

function KnowledgeRow({
  item,
  onEdit,
  onRemove,
}: {
  item: AnyKnowledgeItem;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const [showRelated, setShowRelated] = useState(false);
  const relatedIds = (item.content as { relatedTicketIds?: string[] }).relatedTicketIds ?? [];
  const relatedTickets = useMemo(
    () => relatedIds.map((id) => ticketStore.get(id)).filter(Boolean),
    [relatedIds],
  );
  const summary = describeContent(item);

  return (
    <li className="rounded-md border border-slate-200 p-3 text-sm dark:border-slate-700">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-baseline gap-2">
            <h3 className="font-semibold">{item.title}</h3>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-200">
              {labelForKnowledgeType(item.type)}
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-500">{summary}</p>
        </div>
        <span className="text-[11px] text-slate-500">
          Updated {formatDateTime(item.updatedAt)}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <button className="btn-secondary text-xs" onClick={onEdit}>
          Edit
        </button>
        {relatedIds.length > 0 && (
          <button
            className="btn-ghost text-xs"
            onClick={() => setShowRelated((v) => !v)}
          >
            {showRelated
              ? "Hide Related Tickets"
              : `View Related Tickets (${relatedIds.length})`}
          </button>
        )}
        <button
          className="btn-ghost text-xs text-red-600 hover:underline dark:text-red-300"
          onClick={onRemove}
        >
          Delete
        </button>
      </div>
      {showRelated && relatedTickets.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs">
          {relatedTickets.map(
            (t) =>
              t && (
                <li
                  key={t.id}
                  className="rounded border border-slate-200 px-2 py-1 dark:border-slate-700"
                >
                  <span className="font-medium">
                    {t.ticketFields?.subject || "(no subject)"}
                  </span>
                  {t.details.storeNumber && (
                    <span className="text-slate-500">
                      {" · Store "}
                      {t.details.storeNumber}
                    </span>
                  )}
                  <span className="text-slate-500">
                    {" · "}
                    {formatDateTime(t.createdAt)}
                  </span>
                </li>
              ),
          )}
        </ul>
      )}
    </li>
  );
}

/** Short one-line summary of an item's content for the list view. */
function describeContent(item: AnyKnowledgeItem): string {
  switch (item.type) {
    case "common_problem":
      return [
        item.content.category && `Category: ${item.content.category}`,
        item.content.deviceType && `Device: ${item.content.deviceType}`,
        `${item.content.symptoms.length} symptom(s)`,
        `${item.content.troubleshootingSteps.length} step(s)`,
      ]
        .filter(Boolean)
        .join(" · ");
    case "troubleshooting_guide":
      return [
        item.content.category && `Category: ${item.content.category}`,
        item.content.deviceType && `Device: ${item.content.deviceType}`,
        `${item.content.steps.length} step(s)`,
        `${item.content.questions.length} question(s)`,
      ]
        .filter(Boolean)
        .join(" · ");
    case "part_request_rule":
      return [
        item.content.deviceType && `Device: ${item.content.deviceType}`,
        item.content.partLabel && `Part: ${item.content.partLabel}`,
        `${item.content.triggerPhrases.length} trigger(s)`,
      ]
        .filter(Boolean)
        .join(" · ");
    case "escalation_rule":
      return [
        item.content.escalateTo && `Escalate to: ${item.content.escalateTo}`,
        `${item.content.triggerPhrases.length} trigger(s)`,
      ]
        .filter(Boolean)
        .join(" · ");
    case "store_note":
      return `Store ${item.content.storeNumber || "—"}`;
    case "device_note":
      return [
        item.content.deviceType,
        `${item.content.knownIssues.length} known issue(s)`,
      ]
        .filter(Boolean)
        .join(" · ");
    case "category_mapping":
      return [
        item.content.category,
        item.content.subCategory,
        item.content.item,
      ]
        .filter(Boolean)
        .join(" → ");
    case "correction_rule":
      return `${item.content.detected || "?"} → ${item.content.corrected || "?"}`;
  }
}

// ── Editor ─────────────────────────────────────────────────────────────

function KnowledgeEditor({
  draft,
  editingId,
  onChange,
  onSave,
  onCancel,
}: {
  draft: AnyKnowledgeItem;
  editingId: string | null;
  onChange: (next: AnyKnowledgeItem) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  function setTitle(title: string) {
    onChange({ ...draft, title } as AnyKnowledgeItem);
  }
  function setContent(patch: Partial<AnyKnowledgeItem["content"]>) {
    onChange({
      ...draft,
      content: { ...(draft.content as object), ...patch },
    } as AnyKnowledgeItem);
  }

  return (
    <section className="card space-y-3 border-emerald-300 dark:border-emerald-700">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">
            {editingId ? "Edit Knowledge Item" : "New Knowledge Item"}
          </h2>
          <p className="text-xs text-slate-500">
            Type:{" "}
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-200">
              {labelForKnowledgeType(draft.type)}
            </span>
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn-primary text-xs" onClick={onSave}>
            Save
          </button>
          <button className="btn-ghost text-xs" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </header>

      <label className="block text-xs">
        Title
        <input
          className="input mt-1 w-full"
          value={draft.title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Eg. Register cache rename after start of day"
        />
      </label>

      <ContentEditor draft={draft} setContent={setContent} />
    </section>
  );
}

function ContentEditor({
  draft,
  setContent,
}: {
  draft: AnyKnowledgeItem;
  setContent: (patch: Partial<AnyKnowledgeItem["content"]>) => void;
}) {
  switch (draft.type) {
    case "common_problem":
      return (
        <CommonProblemEditor
          content={draft.content}
          set={setContent as (p: Partial<KnowledgeContentByType["common_problem"]>) => void}
        />
      );
    case "troubleshooting_guide":
      return (
        <TroubleshootingGuideEditor
          content={draft.content}
          set={setContent as (p: Partial<KnowledgeContentByType["troubleshooting_guide"]>) => void}
        />
      );
    case "part_request_rule":
      return (
        <PartRequestRuleEditor
          content={draft.content}
          set={setContent as (p: Partial<KnowledgeContentByType["part_request_rule"]>) => void}
        />
      );
    case "escalation_rule":
      return (
        <EscalationRuleEditor
          content={draft.content}
          set={setContent as (p: Partial<KnowledgeContentByType["escalation_rule"]>) => void}
        />
      );
    case "store_note":
      return (
        <StoreNoteEditor
          content={draft.content}
          set={setContent as (p: Partial<KnowledgeContentByType["store_note"]>) => void}
        />
      );
    case "device_note":
      return (
        <DeviceNoteEditor
          content={draft.content}
          set={setContent as (p: Partial<KnowledgeContentByType["device_note"]>) => void}
        />
      );
    case "category_mapping":
      return (
        <CategoryMappingEditor
          content={draft.content}
          set={setContent as (p: Partial<KnowledgeContentByType["category_mapping"]>) => void}
        />
      );
    case "correction_rule":
      return (
        <CorrectionRuleEditor
          content={draft.content}
          set={setContent as (p: Partial<KnowledgeContentByType["correction_rule"]>) => void}
        />
      );
  }
}

function FieldRow({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 gap-2 md:grid-cols-2">{children}</div>;
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block text-xs">
      {label}
      <input
        className="input mt-1 w-full"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
}

function TextArea({
  label,
  value,
  onChange,
  placeholder,
  rows = 3,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <label className="block text-xs">
      {label}
      <textarea
        className="input mt-1 w-full"
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
}

function CommonProblemEditor({
  content,
  set,
}: {
  content: KnowledgeContentByType["common_problem"];
  set: (p: Partial<KnowledgeContentByType["common_problem"]>) => void;
}) {
  return (
    <div className="space-y-2">
      <FieldRow>
        <TextField label="Category" value={content.category ?? ""} onChange={(v) => set({ category: v })} />
        <TextField label="Device Type" value={content.deviceType ?? ""} onChange={(v) => set({ deviceType: v })} />
      </FieldRow>
      <ListEditor label="Symptoms" values={content.symptoms} onChange={(v) => set({ symptoms: v })} placeholder="Eg. Registers display 'store closed'" />
      <ListEditor label="Troubleshooting Steps" values={content.troubleshootingSteps} onChange={(v) => set({ troubleshootingSteps: v })} placeholder="Eg. Rename cache on affected registers" />
      <TextArea label="Likely Resolution" value={content.likelyResolution} onChange={(v) => set({ likelyResolution: v })} placeholder="Eg. Cache rename + restart Pro/COM services" />
      <ListEditor label="Warnings" values={content.warnings} onChange={(v) => set({ warnings: v })} placeholder="Eg. Confirm exact error message" />
      <ListEditor label="Keywords (used for relevance scoring)" values={content.keywords} onChange={(v) => set({ keywords: v })} placeholder="Eg. cache, store closed" />
    </div>
  );
}

function TroubleshootingGuideEditor({
  content,
  set,
}: {
  content: KnowledgeContentByType["troubleshooting_guide"];
  set: (p: Partial<KnowledgeContentByType["troubleshooting_guide"]>) => void;
}) {
  return (
    <div className="space-y-2">
      <FieldRow>
        <TextField label="Category" value={content.category ?? ""} onChange={(v) => set({ category: v })} />
        <TextField label="Device Type" value={content.deviceType ?? ""} onChange={(v) => set({ deviceType: v })} />
      </FieldRow>
      <TextArea label="Issue (paragraph)" value={content.issue} onChange={(v) => set({ issue: v })} placeholder="Eg. Registers show 'store closed' after start of day." />
      <ListEditor label="Symptoms" values={content.symptoms} onChange={(v) => set({ symptoms: v })} />
      <ListEditor label="Steps" values={content.steps} onChange={(v) => set({ steps: v })} placeholder="Eg. Rename cache on affected registers" />
      <ListEditor label="Warnings" values={content.warnings} onChange={(v) => set({ warnings: v })} />
      <ListEditor label="Suggested Questions" values={content.questions} onChange={(v) => set({ questions: v })} placeholder="Eg. Which register is affected?" />
      <ListEditor label="Keywords (relevance scoring)" values={content.keywords} onChange={(v) => set({ keywords: v })} />
    </div>
  );
}

function PartRequestRuleEditor({
  content,
  set,
}: {
  content: KnowledgeContentByType["part_request_rule"];
  set: (p: Partial<KnowledgeContentByType["part_request_rule"]>) => void;
}) {
  return (
    <div className="space-y-2">
      <FieldRow>
        <TextField label="Device Type" value={content.deviceType ?? ""} onChange={(v) => set({ deviceType: v })} placeholder="Eg. Receipt Printer" />
        <TextField label="Category" value={content.category ?? ""} onChange={(v) => set({ category: v })} placeholder="Eg. IBM Registers" />
      </FieldRow>
      <ListEditor label="Trigger Phrases (any-match)" values={content.triggerPhrases} onChange={(v) => set({ triggerPhrases: v })} placeholder="Eg. printer loses power when moved" />
      <ListEditor label="Exclude Phrases (suppress when present)" values={content.excludePhrases} onChange={(v) => set({ excludePhrases: v })} placeholder="Eg. fixed by power drain" />
      <TextField label="Part Label" value={content.partLabel} onChange={(v) => set({ partLabel: v })} placeholder="Eg. replacement receipt printer" />
      <TextArea label="Reason" value={content.reason} onChange={(v) => set({ reason: v })} placeholder="Eg. Hardware power port confirmed bad after troubleshooting." />
    </div>
  );
}

function EscalationRuleEditor({
  content,
  set,
}: {
  content: KnowledgeContentByType["escalation_rule"];
  set: (p: Partial<KnowledgeContentByType["escalation_rule"]>) => void;
}) {
  return (
    <div className="space-y-2">
      <FieldRow>
        <TextField label="Category" value={content.category ?? ""} onChange={(v) => set({ category: v })} />
        <TextField label="Device Type" value={content.deviceType ?? ""} onChange={(v) => set({ deviceType: v })} />
      </FieldRow>
      <ListEditor label="Trigger Phrases" values={content.triggerPhrases} onChange={(v) => set({ triggerPhrases: v })} placeholder="Eg. VeriFone still failing after restart" />
      <TextField label="Escalate To" value={content.escalateTo} onChange={(v) => set({ escalateTo: v })} placeholder="Eg. Vendor (VeriFone)" />
      <TextArea label="Reason" value={content.reason} onChange={(v) => set({ reason: v })} />
    </div>
  );
}

function StoreNoteEditor({
  content,
  set,
}: {
  content: KnowledgeContentByType["store_note"];
  set: (p: Partial<KnowledgeContentByType["store_note"]>) => void;
}) {
  return (
    <div className="space-y-2">
      <FieldRow>
        <TextField label="Store Number" value={content.storeNumber} onChange={(v) => set({ storeNumber: v })} />
        <TextField label="Region" value={content.region ?? ""} onChange={(v) => set({ region: v })} />
        <TextField label="Manager" value={content.manager ?? ""} onChange={(v) => set({ manager: v })} />
      </FieldRow>
      <TextArea label="Notes" value={content.notes} onChange={(v) => set({ notes: v })} rows={4} />
    </div>
  );
}

function DeviceNoteEditor({
  content,
  set,
}: {
  content: KnowledgeContentByType["device_note"];
  set: (p: Partial<KnowledgeContentByType["device_note"]>) => void;
}) {
  return (
    <div className="space-y-2">
      <FieldRow>
        <TextField label="Device Type" value={content.deviceType} onChange={(v) => set({ deviceType: v })} />
        <TextField label="Device Model" value={content.deviceModel ?? ""} onChange={(v) => set({ deviceModel: v })} />
      </FieldRow>
      <TextArea label="Notes" value={content.notes} onChange={(v) => set({ notes: v })} rows={3} />
      <ListEditor label="Known Issues" values={content.knownIssues} onChange={(v) => set({ knownIssues: v })} />
    </div>
  );
}

function CategoryMappingEditor({
  content,
  set,
}: {
  content: KnowledgeContentByType["category_mapping"];
  set: (p: Partial<KnowledgeContentByType["category_mapping"]>) => void;
}) {
  return (
    <div className="space-y-2">
      <ListEditor label="Trigger Keywords" values={content.triggerKeywords} onChange={(v) => set({ triggerKeywords: v })} placeholder="Eg. wisely card" />
      <FieldRow>
        <TextField label="Category" value={content.category} onChange={(v) => set({ category: v })} />
        <TextField label="Sub Category" value={content.subCategory} onChange={(v) => set({ subCategory: v })} />
        <TextField label="Item" value={content.item} onChange={(v) => set({ item: v })} />
      </FieldRow>
    </div>
  );
}

function CorrectionRuleEditor({
  content,
  set,
}: {
  content: KnowledgeContentByType["correction_rule"];
  set: (p: Partial<KnowledgeContentByType["correction_rule"]>) => void;
}) {
  return (
    <div className="space-y-2">
      <FieldRow>
        <TextField label="Detected (misheard)" value={content.detected} onChange={(v) => set({ detected: v })} placeholder="Eg. story" />
        <TextField label="Corrected" value={content.corrected} onChange={(v) => set({ corrected: v })} placeholder="Eg. store" />
      </FieldRow>
      <TextArea label="Notes" value={content.notes} onChange={(v) => set({ notes: v })} />
    </div>
  );
}
