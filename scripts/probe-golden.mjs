// One-off probe: dump current ticket-generator output for each Phase 10D
// golden case, so we can inline the exact strings as test expectations.
// Not committed long-term — once goldens are stable, this is for regenerating
// expectations after intentional generator changes.
//
// Run: node scripts/probe-golden.mjs
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmp = await mkdtemp(join(tmpdir(), "sta-probe-"));

async function bundle(entry) {
  const out = join(tmp, entry.replace(/[\/.]/g, "_") + ".js");
  await build({
    entryPoints: [entry],
    bundle: true,
    format: "esm",
    platform: "node",
    outfile: out,
    logLevel: "error",
  });
  return out;
}

const genFile = await bundle("src/services/ticketGenerator.ts");
const fieldsFile = await bundle("src/services/ticketFieldGenerator.ts");
const typesFile = await bundle("src/types/ticket.ts");
const settingsFile = await bundle("src/types/settings.ts");

const { generateTicket } = await import(genFile);
const { buildSubject, buildDescription, buildResolution, buildPartRequest } =
  await import(fieldsFile);
const { EMPTY_DETAILS } = await import(typesFile);
const { DEFAULT_WRITING_STYLE } = await import(settingsFile);

const PASSIVE = { ...DEFAULT_WRITING_STYLE, voice: "passive" };

const cases = [
  {
    id: "store-523-credit-card",
    name: "Store 523 — credit card machine issue (Berry)",
    details: {
      callerName: "Berry",
      storeNumber: "523",
      issue: "Credit card machine issue",
      steps: [
        "escaped out of the transaction",
        "re-entered the transaction from the beginning",
        "advised store to wait one second between key presses",
      ],
      result: "Resolved",
    },
  },
  {
    id: "store-521-keyboard-power-drain",
    name: "Store 521 — Register 2 keyboard power drain",
    details: {
      storeNumber: "521",
      registerNumber: "2",
      issue: "keyboard issue",
      deviceType: "keyboard",
      powerDrainPerformed: true,
      cablesReseated: true,
      confirmationMethod: "Keyboard confirmed working",
      result: "Resolved",
    },
  },
  {
    id: "store-1378-printer-hardware-failure",
    name: "Store 1378 — Register 3 receipt printer hardware failure",
    details: {
      storeNumber: "1378",
      registerNumber: "3",
      issue: "receipt printer hardware failure",
      deviceType: "receipt printer",
      errorMessage: "hardware failure",
      partNeeded: true,
      parts: ["receipt printer"],
      replacementReason: "hardware failure persisted after troubleshooting",
      result: "PartsNeeded",
    },
  },
  {
    id: "store-657-store-closed",
    name: "Store 657 — store closed message after start of day",
    details: {
      storeNumber: "657",
      issue: 'the registers were displaying "store closed" after start of day',
      cacheRenamed: true,
      affectedRegisters: ["both registers"],
      confirmationMethod: "Both registers back online",
      result: "Resolved",
    },
  },
  {
    id: "store-395-internet-down",
    name: "Store 395 — internet down / Inseego restart",
    details: {
      storeNumber: "395",
      issue: "internet down",
      devices: ["Inseego"],
      manualRebootPerformed: true,
      confirmationMethod: "Connection restored",
      result: "Resolved",
    },
  },
  {
    id: "receipt-printer-replacement",
    name: "Receipt printer replacement request",
    details: {
      storeNumber: "204",
      registerNumber: "1",
      issue: "receipt printer not printing after troubleshooting",
      deviceType: "receipt printer",
      cablesReseated: true,
      manualRebootPerformed: true,
      partNeeded: true,
      parts: ["receipt printer"],
      replacementReason: "printer still did not print after reseating cables and rebooting",
      result: "PartsNeeded",
    },
  },
  {
    id: "return-as-exchange",
    name: "Return processed as exchange",
    details: {
      storeNumber: "812",
      issue: "return processed as exchange in error",
      typeOfTransaction: "Return",
      transactionNumber: "112233",
      itemNumber: "44556",
      paymentType: "Card",
      steps: ["reviewed the transaction", "voided the exchange and re-rang the return"],
      confirmationMethod: "Confirmed back to normal",
      result: "Resolved",
    },
  },
  {
    id: "layaway-return-error",
    name: "Layaway return error",
    details: {
      storeNumber: "311",
      issue: "layaway return error",
      typeOfTransaction: "Layaway",
      transactionNumber: "778899",
      errorMessage: "layaway not found",
      steps: ["verified the layaway in the system", "advised store to retry the return"],
      result: "FollowUpRequired",
      followUpNeeded: true,
      storeWasAdvised: "call back if the error persists",
    },
  },
  {
    id: "bos-stuck-add-employee",
    name: "BOS stuck while adding employee",
    details: {
      storeNumber: "118",
      issue: "BOS stuck while adding a new employee",
      systems: ["BOS"],
      employeeName: "Jane Doe",
      steps: ["had the manager log out and back in", "cleared browser cache"],
      result: "Pending",
    },
  },
  {
    id: "wrong-operator-id",
    name: "Wrong operator ID / wrong employee ID",
    details: {
      storeNumber: "402",
      issue: "wrong operator ID assigned to a transaction",
      employeeId: "EMP-44",
      operatorId: "OP-09",
      steps: ["verified the operator ID in PCF", "corrected the operator ID on the transaction"],
      confirmationMethod: "Confirmed back to normal",
      result: "Resolved",
    },
  },
  {
    id: "verifone-issue",
    name: "VeriFone issue",
    details: {
      storeNumber: "907",
      registerNumber: "2",
      issue: "VeriFone not responding on Register 2",
      deviceType: "VeriFone",
      cablesReseated: true,
      manualRebootPerformed: true,
      confirmationMethod: "Successful card transaction",
      result: "Resolved",
    },
  },
  {
    id: "gift-card-refund",
    name: "Gift card refund issue",
    details: {
      storeNumber: "555",
      issue: "gift card refund failed at the register",
      typeOfTransaction: "Refund",
      paymentType: "Gift Card",
      transactionNumber: "GC-991122",
      errorMessage: "card declined",
      steps: ["verified the gift card balance", "advised store to retry the refund"],
      result: "Pending",
      followUpNeeded: true,
    },
  },
];

function detailsOf(over) {
  return { ...EMPTY_DETAILS, ...over };
}

const STYLES = {
  default: DEFAULT_WRITING_STYLE,
  passive: PASSIVE,
};

const out = {};

for (const c of cases) {
  const d = detailsOf(c.details);
  const desc = buildDescription(d, STYLES.passive);
  const res = buildResolution(d, STYLES.default);
  const subject = buildSubject(d);
  const part = buildPartRequest(d);

  const short = generateTicket({ detailLevel: "Short", details: d });
  const normal = generateTicket({ detailLevel: "Normal", details: d });
  const detailed = generateTicket({ detailLevel: "Detailed", details: d });
  const technical = generateTicket({ detailLevel: "Technical", details: d });
  const management = generateTicket({ detailLevel: "ManagementSummary", details: d });

  out[c.id] = {
    name: c.name,
    subject,
    description: desc,
    resolution: res,
    short,
    normal,
    detailed,
    technical,
    management,
    partRequest: part,
  };
}

console.log(JSON.stringify(out, null, 2));
await rm(tmp, { recursive: true, force: true });
