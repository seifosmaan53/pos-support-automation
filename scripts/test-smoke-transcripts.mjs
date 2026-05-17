// Phase 14 smoke-test runner — drives the five preset transcripts through
// the analyzer + ticket builder and prints what was extracted for each.
//
// Run with: node scripts/test-smoke-transcripts.mjs
//
// This is the programmatic counterpart to the "Load & review" button on
// the Smoke Test page. It exercises the extraction path end-to-end so a
// human can scan the output for surprises before the manual UI test.
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmp = await mkdtemp(join(tmpdir(), "sta-smoke-"));

async function bundle(entry, outName) {
  const out = join(tmp, outName);
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

const analyzerOut = await bundle("src/services/transcriptAnalyzer.ts", "analyzer.js");
const fieldsOut = await bundle("src/services/ticketFieldGenerator.ts", "fields.js");
const summariesOut = await bundle("src/services/summaryGenerator.ts", "summaries.js");
const transcriptsOut = await bundle("src/data/smokeTestTranscripts.ts", "transcripts.js");

const { analyzeTranscript } = await import(analyzerOut);
const { generateTicketFields } = await import(fieldsOut);
const { generateAllSummaries } = await import(summariesOut);
const { SMOKE_TEST_TRANSCRIPTS } = await import(transcriptsOut);

// Minimal writing style — matches DEFAULT_WRITING_STYLE shape.
const writingStyle = {
  tone: "Professional",
  detailLevel: "Normal",
  openerStyle: "called-reporting",
  resolutionStyle: "concise",
  voice: "active-first-person",
  customInstructions: "",
};

function checkContains(label, haystack, needle, errors) {
  const hay = String(haystack ?? "").toLowerCase();
  if (!hay.includes(needle.toLowerCase())) {
    errors.push(`${label}: expected to contain "${needle}", got "${haystack}"`);
  }
}

function checkEqual(label, actual, expected, errors) {
  if (String(actual ?? "") !== String(expected)) {
    errors.push(`${label}: expected "${expected}", got "${actual}"`);
  }
}

let passed = 0;
let failed = 0;

for (const t of SMOKE_TEST_TRANSCRIPTS) {
  const details = analyzeTranscript(t.transcript);
  const fields = generateTicketFields({ details, technicianName: "Seif", writingStyle });
  const summaries = generateAllSummaries({
    transcript: t.transcript,
    details,
    cleanedTranscript: t.transcript,
    writingStyle,
  });

  const errors = [];

  // Per-transcript checks based on the spec's expectations.
  switch (t.id) {
    case "A":
      checkContains("storeNumber", details.storeNumber, "1518", errors);
      checkContains("device", `${details.deviceType} ${details.item} ${fields.description}`, "keyboard", errors);
      // Caller name detector should fire on "this is Maria from Store 1518".
      checkContains("callerName", details.callerName, "Maria", errors);
      // Should resolve.
      if (details.result !== "Resolved" && details.result !== "Resolved with workaround") {
        errors.push(`result: expected resolved-like, got "${details.result}"`);
      }
      if (details.partNeeded) errors.push(`partNeeded should be false, got true`);
      break;
    case "B":
      checkContains("storeNumber", details.storeNumber, "870", errors);
      checkContains("device", `${details.deviceType} ${details.item} ${fields.description}`, "receipt printer", errors);
      if (!details.partNeeded) errors.push(`partNeeded should be true (hardware failure)`);
      break;
    case "C":
      checkContains("storeNumber", details.storeNumber, "395", errors);
      // Either Inseego or internet should be referenced somewhere.
      checkContains(
        "internet/Inseego",
        `${details.deviceType} ${details.item} ${fields.description}`,
        "inseego",
        errors,
      );
      break;
    case "D":
      checkContains("storeNumber", details.storeNumber, "705", errors);
      checkContains("transactionNumber", details.transactionNumber, "4837291", errors);
      checkContains("itemNumber", details.itemNumber, "7720045", errors);
      checkContains(
        "paymentType",
        `${details.paymentType} ${fields.description}`,
        "wisely",
        errors,
      );
      break;
    case "E":
      // Wrong-caller — shouldn't fabricate a real ticket; should flag wrongCaller.
      if (!details.wrongCaller) {
        errors.push(`wrongCaller expected true, got ${details.wrongCaller}`);
      }
      if (details.partNeeded) errors.push(`partNeeded should be false for a wrong-call`);
      break;
    default:
      errors.push(`unknown transcript id ${t.id}`);
  }

  console.log(`\n— ${t.title} —`);
  console.log(
    `storeNumber=${JSON.stringify(details.storeNumber)} ` +
      `callerName=${JSON.stringify(details.callerName)} ` +
      `register=${JSON.stringify(details.registerNumber)} ` +
      `device=${JSON.stringify(details.deviceType)} ` +
      `result=${JSON.stringify(details.result)} ` +
      `partNeeded=${details.partNeeded}`,
  );
  console.log(`subject: ${fields.subject}`);
  console.log(`description: ${fields.description.slice(0, 220)}${fields.description.length > 220 ? "…" : ""}`);
  console.log(`resolution: ${fields.resolution.slice(0, 220)}${fields.resolution.length > 220 ? "…" : ""}`);
  console.log(`partRequest: ${fields.partRequest || "(none)"}`);
  console.log(`normal summary: ${summaries.normal?.slice(0, 220) || "(none)"}`);

  if (errors.length === 0) {
    console.log("✓ PASS");
    passed += 1;
  } else {
    console.log("✗ FAIL");
    for (const e of errors) console.log(`  - ${e}`);
    failed += 1;
  }
}

await rm(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed of ${SMOKE_TEST_TRANSCRIPTS.length}.`);
process.exit(failed === 0 ? 0 : 1);
