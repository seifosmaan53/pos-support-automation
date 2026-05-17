// Quick smoke test for the analyzer + generator without a test framework.
// Run with: node scripts/test-analyzer.mjs (after `npm run build`).
//
// We import the bundled output indirectly by re-importing the source via tsx-style
// would require extra deps. Instead, this script duplicates the import path that
// the build resolves and uses an inline TS compilation step via esbuild, which is
// already a transitive dep of vite. Keep this file dependency-free of new packages.
import { build } from "esbuild";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cases = [
  {
    name: "Test Case 1 — receipt printer resolved",
    transcript:
      "Store 9 called because the receipt printer was not printing. I had them restart the POS, checked the USB cable, replaced the cable, and then we ran a test print. It worked after that. Issue resolved.",
    expectStore: "00009",
    expectCategory: "Receipt Printer",
    expectResult: "Resolved",
    expectStepsContain: ["restart", "cable", "test print"],
  },
  {
    name: "Test Case 2 — pin pad resolved",
    transcript:
      "Store 14 had a frozen pin pad. I told them to unplug the pin pad, restart the register, plug it back in, and test a card. The card went through.",
    expectStore: "00014",
    expectCategory: "Pin Pad",
    expectResult: "Resolved",
    expectStepsContain: ["unplug", "restart"],
  },
  {
    name: "Test Case 3 — internet escalated",
    transcript:
      "Store 22 internet is down. I checked modem lights with them and had them restart the modem and router, but it still did not come back online. I escalated it.",
    expectStore: "00022",
    expectCategory: "Internet",
    expectResult: "Escalated",
    expectStepsContain: ["modem", "restart"],
  },
  {
    name: "Test Case 4 — scanner follow-up",
    transcript:
      "Store 5 scanner is not reading barcodes. We cleaned the scanner glass and checked the USB connection. They still need to test it more.",
    expectStore: "00005",
    expectCategory: "Scanner",
    expectStepsContain: ["clean", "USB"],
  },
  {
    name: "Test Case 5 — ambiguous store number",
    transcript:
      "The printer issue from earlier, I think it was store maybe 8 or 18, not sure. Cable might be bad.",
    expectStore: "",
    expectMissingContains: "Store number was not captured.",
  },
  {
    // Real-world ASR-noisy call: "store" → "story", number on next line, the
    // word "keyboard" appears more often than "credit card machine" but the
    // device IS the credit-card machine. Steps are imperative-mood.
    name: "Test Case 6 — credit card glitch · ASR-noisy transcript",
    transcript: `What story are you calling for me? What story are you calling for?
 523. I have your name. Okay, I'm just reading it and tell me what happened again. Okay, does it give you something every time you swipe the card?
 You mean Torah? Yeah, tell me what Eric comes up with. It's on the credit card machine.
 Also, okay, this is a lot of spores here. I'm not mentioning that means you got to escape out of this transaction. You're going to have to read through it from the beginning again. But the only difference is this time, okay, so the problem is you're just going to have to do a slower. Do it. Wait one second between every key. Press on the keyboard and it's going to work as well.
 Every time you press a can, the keyboard just wait a second and then press the next one. Thank you.
 Yeah, so there's an extra number before the card gets
 swipe and gets taken. That's why it gets better. It's a glitch. I swear it's not really your fault.`,
    expectStore: "00523",
    expectDeviceType: "credit card machine",
    expectStepsContain: ["escaped out of the transaction", "wait one second"],
  },
];

const tmp = await mkdtemp(join(tmpdir(), "sta-test-"));
const outFile = join(tmp, "bundle.js");

await build({
  entryPoints: ["src/services/transcriptAnalyzer.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: outFile,
  logLevel: "error",
});

const { analyzeTranscript } = await import(outFile);

const genBuild = join(tmp, "gen.js");
await build({
  entryPoints: ["src/services/ticketGenerator.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: genBuild,
  logLevel: "error",
});

const { generateTicket } = await import(genBuild);

let passed = 0;
let failed = 0;

for (const c of cases) {
  const details = analyzeTranscript(c.transcript);
  const errors = [];

  if (c.expectStore !== undefined && details.storeNumber !== c.expectStore) {
    errors.push(`storeNumber expected "${c.expectStore}" got "${details.storeNumber}"`);
  }
  if (c.expectCategory !== undefined && details.category !== c.expectCategory) {
    errors.push(`category expected "${c.expectCategory}" got "${details.category}"`);
  }
  if (c.expectResult !== undefined && details.result !== c.expectResult) {
    errors.push(`result expected "${c.expectResult}" got "${details.result}"`);
  }
  if (c.expectDeviceType !== undefined && details.deviceType !== c.expectDeviceType) {
    errors.push(`deviceType expected "${c.expectDeviceType}" got "${details.deviceType}"`);
  }
  if (c.expectStepsContain) {
    for (const needle of c.expectStepsContain) {
      const found = details.steps.some((s) => s.toLowerCase().includes(needle.toLowerCase()));
      if (!found) errors.push(`steps missing fragment "${needle}" — got ${JSON.stringify(details.steps)}`);
    }
  }
  if (c.expectMissingContains) {
    const found = details.missingInfo.some((m) => m.includes(c.expectMissingContains));
    if (!found)
      errors.push(`missingInfo missing "${c.expectMissingContains}" — got ${JSON.stringify(details.missingInfo)}`);
  }

  const normal = generateTicket({ detailLevel: "Normal", details });
  console.log(`\n— ${c.name} —`);
  console.log(`storeNumber=${JSON.stringify(details.storeNumber)} category=${JSON.stringify(details.category)} result=${details.result}`);
  console.log(`steps=${JSON.stringify(details.steps)}`);
  console.log(`Normal output: ${normal}`);
  if (errors.length === 0) {
    console.log("✓ PASS");
    passed++;
  } else {
    console.log("✗ FAIL");
    for (const e of errors) console.log(`  - ${e}`);
    failed++;
  }
}

await rm(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
