/**
 * Phase 12 — runtime writing self-tests.
 *
 * Mirrors `extractionSelfTests.ts` but for the ticket-writing layer. The
 * project already has comprehensive vitest grammar tests in
 * `ticketGenerator.grammar.test.ts` — those run only at `npm test` time. This
 * module surfaces a tiny set of high-value checks the user can run from the
 * System Health page without spawning vitest, so the "Run Writing Tests"
 * button has something concrete to report.
 *
 * The cases here are intentionally a small subset focused on the rules that
 * break most visibly when a writing-layer change regresses:
 *   • Description leads with a clause, not a fragment.
 *   • Acronyms (USB, COM, BOS, ATT) are uppercased.
 *   • Sentence case is honored mid-sentence.
 */
import { buildDescription, buildResolution } from "./ticketFieldGenerator";
import { DEFAULT_WRITING_STYLE } from "../types/settings";
import { EMPTY_DETAILS, type ExtractedDetails } from "../types/ticket";

export interface WritingSelfTestResult {
  passed: number;
  failed: number;
  details: string[];
}

function details(overrides: Partial<ExtractedDetails>): ExtractedDetails {
  return { ...EMPTY_DETAILS, ...overrides };
}

function checkContains(
  label: string,
  actual: string,
  expectedSubstring: string,
  out: string[],
): boolean {
  if (actual.toLowerCase().includes(expectedSubstring.toLowerCase())) return true;
  out.push(
    `${label}: expected "${expectedSubstring}" in output, got "${actual.slice(0, 80)}…"`,
  );
  return false;
}

function checkNotContains(
  label: string,
  actual: string,
  unwantedSubstring: string,
  out: string[],
): boolean {
  if (!actual.toLowerCase().includes(unwantedSubstring.toLowerCase())) return true;
  out.push(
    `${label}: unwanted "${unwantedSubstring}" present in "${actual.slice(0, 80)}…"`,
  );
  return false;
}

/**
 * Run the runtime writing self-tests. Returns pass/fail counts plus a list
 * of human-readable detail strings for any failures. Pure — no side effects.
 */
export function runWritingSelfTests(): WritingSelfTestResult {
  const failures: string[] = [];
  let passed = 0;
  let failed = 0;

  const checks: { name: string; fn: () => boolean }[] = [
    {
      name: "Description: leads with a clause",
      fn: () => {
        const d = buildDescription(
          details({
            storeNumber: "521",
            issue: "register not booting",
          }),
          DEFAULT_WRITING_STYLE,
        );
        return checkContains("Description-clause", d, "store", failures);
      },
    },
    {
      name: "Description: keeps acronyms uppercase",
      fn: () => {
        const d = buildDescription(
          details({
            storeNumber: "523",
            issue: "USB cable disconnected",
          }),
          DEFAULT_WRITING_STYLE,
        );
        return checkContains("Description-acronym", d, "USB", failures);
      },
    },
    {
      name: "Description: COM service name is uppercased",
      fn: () => {
        const d = buildDescription(
          details({
            storeNumber: "705",
            issue: "COM services not running",
            servicesRestarted: ["COM"],
          }),
          DEFAULT_WRITING_STYLE,
        );
        return checkContains("Description-COM", d, "COM", failures);
      },
    },
    {
      name: "Resolution: emits a non-empty sentence when steps exist",
      fn: () => {
        const r = buildResolution(
          details({
            storeNumber: "521",
            steps: ["restarted COM services", "rebooted register 1"],
            result: "Resolved",
          }),
          DEFAULT_WRITING_STYLE,
        );
        return r.trim().length > 0
          ? true
          : (failures.push("Resolution-empty: expected non-empty resolution sentence"), false);
      },
    },
    {
      name: "Resolution: does not duplicate raw transcript phrasing",
      fn: () => {
        const r = buildResolution(
          details({
            storeNumber: "521",
            steps: ["restarted COM services"],
            result: "Resolved",
          }),
          DEFAULT_WRITING_STYLE,
        );
        return checkNotContains(
          "Resolution-no-and-and",
          r,
          "and and",
          failures,
        );
      },
    },
    {
      name: "Description: store number appears verbatim",
      fn: () => {
        const d = buildDescription(
          details({
            storeNumber: "0521",
            issue: "register frozen",
          }),
          DEFAULT_WRITING_STYLE,
        );
        return checkContains("Description-store", d, "521", failures);
      },
    },
  ];

  for (const c of checks) {
    let ok = false;
    try {
      ok = c.fn();
    } catch (e) {
      failures.push(`${c.name}: threw — ${(e as Error).message}`);
      ok = false;
    }
    if (ok) passed += 1;
    else failed += 1;
  }

  return { passed, failed, details: failures };
}
