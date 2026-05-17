import { useNavigate } from "react-router-dom";
import { useAppStore } from "../services/appStore";
import { DEFAULT_CATEGORIES } from "../data/defaultCategories";
import { TICKET_RESULTS, type TicketResult } from "../types/ticket";
import { ListEditor } from "../components/ListEditor";
import { WarningBox } from "../components/WarningBox";
import { EmptyState } from "../components/EmptyState";

export function ExtractedDetailsPage() {
  const details = useAppStore((s) => s.details);
  const patch = useAppStore((s) => s.patchDetails);
  const stage = useAppStore((s) => s.stage);
  const regenerate = useAppStore((s) => s.regenerateFromDetails);
  const navigate = useNavigate();

  const hasAnalysis = stage === "details" || stage === "form" || stage === "ticket";

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <header>
        <h1 className="page-title">Extracted Details</h1>
        <p className="page-subtitle">
          The analyzer fills these from the transcript. Edit anything wrong — every change updates
          the Ticket Form Helper and the summaries automatically.
        </p>
      </header>

      {!hasAnalysis && (
        <EmptyState
          icon="list"
          title="Nothing extracted yet"
          description="Drop a transcript on Voice Ticket and click Analyze — the extracted fields land here for review and editing."
          cta={{ label: "Go to Voice Ticket", to: "/voice" }}
        />
      )}

      {details.missingInfo.length > 0 && (
        <WarningBox tone="danger" title="Missing information">
          <ul className="list-disc pl-5">
            {details.missingInfo.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </WarningBox>
      )}

      {details.confidenceNotes.length > 0 && (
        <WarningBox tone="warning" title="Confidence notes">
          <ul className="list-disc pl-5">
            {details.confidenceNotes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </WarningBox>
      )}

      <section className="card space-y-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Store Number">
            <input
              className="input"
              value={details.storeNumber}
              onChange={(e) => patch({ storeNumber: e.target.value })}
              placeholder="e.g. 01053"
            />
          </Field>

          <Field label="Caller Name">
            <input
              className="input"
              value={details.callerName}
              onChange={(e) => patch({ callerName: e.target.value })}
              placeholder="e.g. Keyana"
            />
          </Field>

          <Field label="Caller Role">
            <input
              className="input"
              value={details.callerRole}
              onChange={(e) => patch({ callerRole: e.target.value })}
              placeholder="e.g. Store Manager"
            />
          </Field>

          <Field label="Register Number">
            <input
              className="input"
              value={details.registerNumber}
              onChange={(e) => patch({ registerNumber: e.target.value })}
              placeholder="e.g. 3"
            />
          </Field>

          <Field label="Device Type">
            <input
              className="input"
              value={details.deviceType}
              onChange={(e) => patch({ deviceType: e.target.value })}
              placeholder="e.g. receipt printer, keyboard, VeriFone"
            />
          </Field>

          <Field label="Date/Time of Issue">
            <input
              className="input"
              value={details.dateTimeOfIssue}
              onChange={(e) => patch({ dateTimeOfIssue: e.target.value })}
              placeholder="e.g. Apr 22, 2026 06:00 AM"
            />
          </Field>

          <Field label="Contact Name">
            <input
              className="input"
              value={details.contactName}
              onChange={(e) => patch({ contactName: e.target.value })}
              placeholder="Optional"
            />
          </Field>

          <Field label="Requester Name">
            <input
              className="input"
              value={details.requesterName}
              onChange={(e) => patch({ requesterName: e.target.value })}
              placeholder="Who called"
            />
          </Field>

          <Field label="Employee ID">
            <input
              className="input"
              value={details.employeeId}
              onChange={(e) => patch({ employeeId: e.target.value })}
              placeholder="Optional"
            />
          </Field>

          <Field label="Operator ID">
            <input
              className="input"
              value={details.operatorId}
              onChange={(e) => patch({ operatorId: e.target.value })}
              placeholder="Optional"
            />
          </Field>

          <Field label="Category">
            <select
              className="input"
              value={details.category}
              onChange={(e) => patch({ category: e.target.value })}
            >
              <option value="">— Select —</option>
              {DEFAULT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
              {!DEFAULT_CATEGORIES.includes(details.category as typeof DEFAULT_CATEGORIES[number]) &&
                details.category && (
                  <option value={details.category}>{details.category}</option>
                )}
            </select>
          </Field>

          <Field label="Sub Category">
            <input
              className="input"
              value={details.subCategory}
              onChange={(e) => patch({ subCategory: e.target.value })}
              placeholder="e.g. VeriFone / Pin Pad"
            />
          </Field>

          <Field label="Item">
            <input
              className="input"
              value={details.item}
              onChange={(e) => patch({ item: e.target.value })}
              placeholder="e.g. Register"
            />
          </Field>

          <Field label="Transaction #">
            <input
              className="input"
              value={details.transactionNumber}
              onChange={(e) => patch({ transactionNumber: e.target.value })}
            />
          </Field>

          <Field label="Item #">
            <input
              className="input"
              value={details.itemNumber}
              onChange={(e) => patch({ itemNumber: e.target.value })}
            />
          </Field>

          <Field label="Type of Transaction">
            <select
              className="input"
              value={details.typeOfTransaction}
              onChange={(e) => patch({ typeOfTransaction: e.target.value })}
            >
              <option value="">—</option>
              <option>Return</option>
              <option>Exchange</option>
              <option>Layaway</option>
              <option>No Receipt Return</option>
              <option>Sale</option>
              <option>No Sale</option>
              <option>Refund</option>
              <option>Override</option>
              <option>Credit</option>
              <option>Payment</option>
            </select>
          </Field>

          <Field label="Payment Type">
            <select
              className="input"
              value={details.paymentType}
              onChange={(e) => patch({ paymentType: e.target.value })}
            >
              <option value="">—</option>
              <option>Card</option>
              <option>Cash</option>
              <option>Credit</option>
              <option>Wisely Card</option>
              <option>Gift Card</option>
              <option>Check</option>
            </select>
          </Field>

          <Field label="Result">
            <select
              className="input"
              value={details.result}
              onChange={(e) => patch({ result: e.target.value as TicketResult })}
            >
              {TICKET_RESULTS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Main Issue">
          <textarea
            className="input"
            rows={2}
            value={details.issue}
            onChange={(e) => patch({ issue: e.target.value })}
            placeholder="e.g. receipt printer was not printing"
          />
        </Field>

        <Field label="Error Message">
          <input
            className="input"
            value={details.errorMessage}
            onChange={(e) => patch({ errorMessage: e.target.value })}
            placeholder='e.g. "No items available for refund on this receipt."'
          />
        </Field>

        <Field label="Confirmation Method">
          <input
            className="input"
            value={details.confirmationMethod}
            onChange={(e) => patch({ confirmationMethod: e.target.value })}
            placeholder="e.g. Successful test print"
          />
        </Field>

        <ListEditor
          label="Troubleshooting Steps"
          values={details.steps}
          onChange={(steps) => patch({ steps })}
          placeholder="Add a step (e.g. restarted POS)"
        />

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <ListEditor
            label="Devices"
            values={details.devices}
            onChange={(devices) => patch({ devices })}
            placeholder="e.g. POS, register"
          />
          <ListEditor
            label="Parts"
            values={details.parts}
            onChange={(parts) => patch({ parts })}
            placeholder="e.g. USB cable"
          />
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={details.escalationNeeded}
              onChange={(e) => patch({ escalationNeeded: e.target.checked })}
            />
            Escalation needed
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={details.followUpNeeded}
              onChange={(e) => patch({ followUpNeeded: e.target.checked })}
            />
            Follow-up needed
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={details.partNeeded}
              onChange={(e) => patch({ partNeeded: e.target.checked })}
            />
            Replacement / part needed
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={details.existingTicketMentioned}
              onChange={(e) => patch({ existingTicketMentioned: e.target.checked })}
            />
            Existing ticket already open
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={details.cacheRenamed}
              onChange={(e) => patch({ cacheRenamed: e.target.checked })}
            />
            Cache renamed
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={details.powerDrainPerformed}
              onChange={(e) => patch({ powerDrainPerformed: e.target.checked })}
            />
            Register power drain performed
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={details.manualRebootPerformed}
              onChange={(e) => patch({ manualRebootPerformed: e.target.checked })}
            />
            Manually rebooted
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={details.cablesReseated}
              onChange={(e) => patch({ cablesReseated: e.target.checked })}
            />
            Cables reseated
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={details.connectionsConfirmed}
              onChange={(e) => patch({ connectionsConfirmed: e.target.checked })}
            />
            Connections confirmed
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={details.wrongCaller}
              onChange={(e) => patch({ wrongCaller: e.target.checked })}
            />
            Wrong caller / wrong department
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={details.transferNeeded}
              onChange={(e) => patch({ transferNeeded: e.target.checked })}
            />
            Caller transferred to another team
          </label>
        </div>

        {(details.wrongCaller || details.transferNeeded) && (
          <Field label="Transfer Department (where the caller was sent)">
            <input
              className="input"
              value={details.transferDepartment}
              onChange={(e) => patch({ transferDepartment: e.target.value })}
              placeholder="e.g. Loss Prevention, HR, Network Operations"
            />
          </Field>
        )}

        {(details.partNeeded || details.replacementReason) && (
          <Field label="Replacement Reason">
            <input
              className="input"
              value={details.replacementReason}
              onChange={(e) => patch({ replacementReason: e.target.value })}
              placeholder="e.g. Bad power port, Loses power when moved"
            />
          </Field>
        )}

        {details.existingTicketMentioned && (
          <Field label="Existing Ticket Details">
            <input
              className="input"
              value={details.existingTicketDetails}
              onChange={(e) => patch({ existingTicketDetails: e.target.value })}
              placeholder="e.g. ticket open for keyboard cable replacement"
            />
          </Field>
        )}

        {(/phone\s*line|\batt\b/i.test(details.issue) || details.vendorTicketNumber) && (
          <Field label="Vendor / ATT Ticket Number">
            <input
              className="input"
              value={details.vendorTicketNumber}
              onChange={(e) => patch({ vendorTicketNumber: e.target.value })}
              placeholder="Optional"
            />
          </Field>
        )}

        <Field label="Notes (internal — not added unless you copy them)">
          <textarea
            className="input"
            rows={3}
            value={details.notes}
            onChange={(e) => patch({ notes: e.target.value })}
          />
        </Field>

        <ListEditor
          label="Suggested Questions for Next Call"
          values={details.suggestedQuestions}
          onChange={(suggestedQuestions) => patch({ suggestedQuestions })}
          placeholder="Add a question to ask"
        />

        <div className="flex flex-wrap gap-2">
          <button
            className="btn-primary"
            onClick={() => {
              regenerate();
              navigate("/form");
            }}
          >
            Open Ticket Form Helper
          </button>
          <button className="btn-secondary" onClick={() => navigate("/transcript")}>
            Back to Transcript
          </button>
        </div>
      </section>
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
