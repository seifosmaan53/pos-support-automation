// Runs the 12-case canonical self-test suite (services/extractionSelfTests.ts).
// Usage: node scripts/test-self-tests.mjs
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmp = await mkdtemp(join(tmpdir(), "sta-self-tests-"));
const outFile = join(tmp, "bundle.js");

await build({
  entryPoints: ["src/services/extractionSelfTests.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: outFile,
  logLevel: "error",
});

const { runAllSelfTests } = await import(outFile);
const summary = runAllSelfTests();

let store521 = null;
for (const r of summary.results) {
  const flag = r.passed ? "✓" : "✗";
  console.log(
    `${flag} ${r.test.id} — ${r.test.name} (${r.passCount}/${r.fieldChecks.length})`,
  );
  if (!r.passed) {
    for (const c of r.fieldChecks.filter((c) => !c.ok)) {
      console.log(`    field=${c.field}\n      expected: ${c.expected}\n      actual:   ${c.actual}`);
    }
  }
  if (r.test.id === "test-12") store521 = r;
}

console.log(
  `\n${summary.passedTests}/${summary.totalTests} cases passed; ${summary.totalFieldChecks - summary.failedFieldChecks}/${summary.totalFieldChecks} field checks passed.`,
);

if (store521) {
  console.log(
    `\nStore 521 (test-12): ${store521.passed ? "PASS" : "FAIL"} — ${store521.passCount}/${store521.fieldChecks.length} fields.`,
  );
}

await rm(tmp, { recursive: true, force: true });
process.exit(summary.failedTests === 0 ? 0 : 1);
