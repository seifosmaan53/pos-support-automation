import type { AppSettings } from "../types/settings";
import {
  EMPTY_DETAILS,
  EMPTY_EVIDENCE,
  type DetailLevel,
  type ExtractedDetails,
  type ExtractedEvidence,
  type TicketResult,
} from "../types/ticket";
import { analyzeTranscriptFull } from "./transcriptAnalyzer";
import { extractionPatternsStore } from "./extractionPatternsStore";
import type { CorrectionChange } from "./transcriptCorrector";
import { generateTicket } from "./ticketGenerator";
import { friendlyError, generateText } from "./ollamaService";
import { friendlyLMStudioError, generateLMStudio } from "./lmStudioService";
import { styleExamplesStore } from "./styleExamplesStore";
import {
  SYSTEM_PROMPT_ANALYZER,
  SYSTEM_PROMPT_GENERATOR,
  analyzerUserPrompt,
  generatorUserPrompt,
} from "../prompts/aiPrompts";

export type AISource = "ollama" | "lmstudio" | "rule-based";

export interface AIRunResult<T> {
  value: T;
  source: AISource;
  warning?: string;
  cleanedTranscript?: string;
  corrections?: CorrectionChange[];
}

const VALID_RESULTS: ReadonlySet<TicketResult> = new Set([
  "Resolved",
  "Escalated",
  "Transferred",
  "WrongCaller",
  "Pending",
  "PartsNeeded",
  "FollowUpRequired",
  "Monitoring",
  "StoreDidNotAnswer",
  "WaitingOnStore",
  "WaitingOnVendor",
  "CouldNotReproduce",
  "ResultNotConfirmed",
]);

export async function analyzeWithAI(
  transcript: string,
  settings: AppSettings,
): Promise<AIRunResult<ExtractedDetails>> {
  // Phase 10B+C — pull active user / learned patterns from the store and
  // pass them through. Hits get logged so Settings can show usage stats.
  const customPatterns = extractionPatternsStore.active();
  const ruleResult = analyzeTranscriptFull(transcript, {
    correctionDictionary: settings.correctionDictionary,
    enableTranscriptCorrection: settings.enableTranscriptCorrection,
    enableNumberWordNormalization: settings.enableNumberWordNormalization,
    customPatterns,
    onPatternHit: (id) => extractionPatternsStore.recordHit(id),
  });

  if (settings.aiProvider === "rule-based") {
    return {
      value: ruleResult.details,
      source: "rule-based",
      cleanedTranscript: ruleResult.cleanedTranscript,
      corrections: ruleResult.corrections,
    };
  }

  const promptText = analyzerUserPrompt(ruleResult.cleanedTranscript || transcript);

  if (settings.aiProvider === "ollama") {
    try {
      const raw = await generateText({
        endpoint: settings.ollamaEndpoint,
        model: settings.ollamaModel,
        system: SYSTEM_PROMPT_ANALYZER,
        prompt: promptText,
        temperature: settings.temperature,
        format: "json",
        timeoutMs: settings.timeoutMs,
      });
      const aiParsed = parseAIDetails(raw);
      const merged = mergeDetails(ruleResult.details, aiParsed);
      return {
        value: merged,
        source: "ollama",
        cleanedTranscript: ruleResult.cleanedTranscript,
        corrections: ruleResult.corrections,
      };
    } catch (e) {
      if (settings.fallbackToRuleBased) {
        return {
          value: ruleResult.details,
          source: "rule-based",
          cleanedTranscript: ruleResult.cleanedTranscript,
          corrections: ruleResult.corrections,
          warning: `Local AI analysis failed (${friendlyError(e)}). Used rule-based extraction instead.`,
        };
      }
      throw new Error(friendlyError(e));
    }
  }

  // LM Studio (OpenAI-compatible)
  try {
    const raw = await generateLMStudio({
      endpoint: settings.lmStudioEndpoint,
      system: SYSTEM_PROMPT_ANALYZER,
      prompt: promptText,
      temperature: settings.temperature,
      maxTokens: settings.maxTokens,
      format: "json",
      timeoutMs: settings.timeoutMs,
    });
    const aiParsed = parseAIDetails(raw);
    const merged = mergeDetails(ruleResult.details, aiParsed);
    return {
      value: merged,
      source: "lmstudio",
      cleanedTranscript: ruleResult.cleanedTranscript,
      corrections: ruleResult.corrections,
    };
  } catch (e) {
    if (settings.fallbackToRuleBased) {
      return {
        value: ruleResult.details,
        source: "rule-based",
        cleanedTranscript: ruleResult.cleanedTranscript,
        corrections: ruleResult.corrections,
        warning: `LM Studio is not reachable (${friendlyLMStudioError(e)}). Rule-based mode was used.`,
      };
    }
    throw new Error(friendlyLMStudioError(e));
  }
}

export async function generateWithAI(
  details: ExtractedDetails,
  detailLevel: DetailLevel,
  settings: AppSettings,
): Promise<AIRunResult<string>> {
  if (settings.aiProvider === "rule-based") {
    return { value: generateTicket({ detailLevel, details }), source: "rule-based" };
  }

  // Pick up to 2 saved style examples scored on category/device/result/issue.
  // The Phase 4 scoring upgrade considers full ExtractedDetails so the
  // examples actually match the call type, not just transcript word overlap.
  const examples = styleExamplesStore.pickRelevant(details, 2);
  const examplesBlock = renderExamplesBlock(examples);
  const userPrompt =
    examplesBlock +
    (examplesBlock ? "\n\n" : "") +
    generatorUserPrompt(details, detailLevel, settings.writingStyle);

  if (settings.aiProvider === "ollama") {
    try {
      const raw = await generateText({
        endpoint: settings.ollamaEndpoint,
        model: settings.ollamaModel,
        system: SYSTEM_PROMPT_GENERATOR,
        prompt: userPrompt,
        temperature: settings.temperature,
        timeoutMs: settings.timeoutMs,
      });
      const cleaned = stripCodeFences(raw).trim();
      if (!cleaned) throw new Error("Ollama returned empty text.");
      return { value: cleaned, source: "ollama" };
    } catch (e) {
      if (settings.fallbackToRuleBased) {
        return {
          value: generateTicket({ detailLevel, details }),
          source: "rule-based",
          warning: `Local AI generation failed (${friendlyError(e)}). Used rule-based template instead.`,
        };
      }
      throw new Error(friendlyError(e));
    }
  }

  // LM Studio
  try {
    const raw = await generateLMStudio({
      endpoint: settings.lmStudioEndpoint,
      system: SYSTEM_PROMPT_GENERATOR,
      prompt: userPrompt,
      temperature: settings.temperature,
      maxTokens: settings.maxTokens,
      timeoutMs: settings.timeoutMs,
    });
    const cleaned = stripCodeFences(raw).trim();
    if (!cleaned) throw new Error("LM Studio returned empty text.");
    return { value: cleaned, source: "lmstudio" };
  } catch (e) {
    if (settings.fallbackToRuleBased) {
      return {
        value: generateTicket({ detailLevel, details }),
        source: "rule-based",
        warning: `LM Studio is not reachable (${friendlyLMStudioError(e)}). Rule-based mode was used.`,
      };
    }
    throw new Error(friendlyLMStudioError(e));
  }
}

function renderExamplesBlock(
  examples: ReturnType<typeof styleExamplesStore.pickRelevant>,
): string {
  if (!examples || examples.length === 0) return "";
  const blocks = examples.map((ex, i) => {
    const parts: string[] = [];
    parts.push(`Example ${i + 1}: ${ex.title}`);
    if (ex.rawInput) parts.push(`Notes: ${ex.rawInput}`);
    if (ex.idealSubject) parts.push(`Ideal subject: ${ex.idealSubject}`);
    if (ex.idealDescription) parts.push(`Ideal description: ${ex.idealDescription}`);
    if (ex.idealResolution) parts.push(`Ideal resolution: ${ex.idealResolution}`);
    if (ex.idealPartRequest) parts.push(`Ideal part request: ${ex.idealPartRequest}`);
    return parts.join("\n");
  });
  return [
    "Style examples (match this voice and structure; do NOT copy facts):",
    ...blocks,
  ].join("\n\n");
}

/** Merges rule-based extraction with parsed AI JSON. Exported for Vitest regression coverage. */
export function mergeDetails(rule: ExtractedDetails, ai: ExtractedDetails): ExtractedDetails {
  const pickStr = (a: string, b: string) => (a && a.trim() ? a : b);
  const pickArr = (a: string[], b: string[]) => (a && a.length > 0 ? a : b);
  const pickBool = (a: boolean, b: boolean) => a || b;

  const evidence: ExtractedEvidence = {
    storeNumber: pickStr(ai.evidence.storeNumber, rule.evidence.storeNumber),
    callerName: pickStr(ai.evidence.callerName, rule.evidence.callerName),
    registerNumber: pickStr(ai.evidence.registerNumber, rule.evidence.registerNumber),
    issue: pickStr(ai.evidence.issue, rule.evidence.issue),
    errorMessage: pickStr(ai.evidence.errorMessage, rule.evidence.errorMessage),
    stepsTaken: pickStr(ai.evidence.stepsTaken, rule.evidence.stepsTaken),
    result: pickStr(ai.evidence.result, rule.evidence.result),
    partNeeded: pickStr(ai.evidence.partNeeded, rule.evidence.partNeeded),
  };

  const mergedResult: TicketResult =
    VALID_RESULTS.has(ai.result) && ai.result !== "ResultNotConfirmed"
      ? ai.result
      : rule.result;

  return {
    ...rule,
    ...ai,
    storeNumber: pickStr(ai.storeNumber, rule.storeNumber),
    callerName: pickStr(ai.callerName, rule.callerName),
    callerRole: pickStr(ai.callerRole, rule.callerRole),
    contactName: pickStr(ai.contactName, rule.contactName),
    requesterName: pickStr(ai.requesterName, rule.requesterName),
    registerNumber: pickStr(ai.registerNumber, rule.registerNumber),
    affectedRegisters: pickArr(ai.affectedRegisters, rule.affectedRegisters),
    deviceType: pickStr(ai.deviceType, rule.deviceType),
    deviceName: pickStr(ai.deviceName, rule.deviceName),
    deviceLocation: pickStr(ai.deviceLocation, rule.deviceLocation),
    transactionNumber: pickStr(ai.transactionNumber, rule.transactionNumber),
    itemNumber: pickStr(ai.itemNumber, rule.itemNumber),
    employeeName: pickStr(ai.employeeName, rule.employeeName),
    employeeId: pickStr(ai.employeeId, rule.employeeId),
    operatorId: pickStr(ai.operatorId, rule.operatorId),
    typeOfTransaction: pickStr(ai.typeOfTransaction, rule.typeOfTransaction),
    paymentType: pickStr(ai.paymentType, rule.paymentType),
    errorMessage: pickStr(ai.errorMessage, rule.errorMessage),
    dateTimeOfIssue: pickStr(ai.dateTimeOfIssue, rule.dateTimeOfIssue),
    issue: pickStr(ai.issue, rule.issue),
    category: pickStr(ai.category, rule.category),
    subCategory: pickStr(ai.subCategory, rule.subCategory),
    item: pickStr(ai.item, rule.item),
    confirmationMethod: pickStr(ai.confirmationMethod, rule.confirmationMethod),
    storeWasAdvised: pickStr(ai.storeWasAdvised, rule.storeWasAdvised),
    vendorTicketNumber: pickStr(ai.vendorTicketNumber, rule.vendorTicketNumber),
    replacementReason: pickStr(ai.replacementReason, rule.replacementReason),
    existingTicketDetails: pickStr(ai.existingTicketDetails, rule.existingTicketDetails),
    steps: pickArr(ai.steps, rule.steps),
    servicesRestarted: pickArr(ai.servicesRestarted, rule.servicesRestarted),
    parts: pickArr(ai.parts, rule.parts),
    devices: pickArr(ai.devices, rule.devices),
    suggestedQuestions: pickArr(ai.suggestedQuestions, rule.suggestedQuestions),
    cacheRenamed: pickBool(ai.cacheRenamed, rule.cacheRenamed),
    powerDrainPerformed: pickBool(ai.powerDrainPerformed, rule.powerDrainPerformed),
    manualRebootPerformed: pickBool(ai.manualRebootPerformed, rule.manualRebootPerformed),
    cablesReseated: pickBool(ai.cablesReseated, rule.cablesReseated),
    connectionsConfirmed: pickBool(ai.connectionsConfirmed, rule.connectionsConfirmed),
    partNeeded: pickBool(ai.partNeeded, rule.partNeeded),
    wrongCaller: pickBool(ai.wrongCaller, rule.wrongCaller),
    transferNeeded: pickBool(ai.transferNeeded, rule.transferNeeded),
    transferDepartment: pickStr(ai.transferDepartment, rule.transferDepartment),
    existingTicketMentioned: pickBool(ai.existingTicketMentioned, rule.existingTicketMentioned),
    missingInfo: dedupe([...(rule.missingInfo || []), ...(ai.missingInfo || [])]),
    confidenceNotes: dedupe([
      ...(rule.confidenceNotes || []),
      ...(ai.confidenceNotes || []),
    ]),
    result: mergedResult,
    // Keep booleans aligned with mergedResult — not independent OR of rule vs AI.
    isResolved: mergedResult === "Resolved",
    isPending: mergedResult === "Pending",
    isEscalated: mergedResult === "Escalated",
    evidence,
  };
}

function parseAIDetails(raw: string): ExtractedDetails {
  const obj = parseJsonLoose(raw) as Record<string, unknown>;
  const safeString = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
  const safeBool = (v: unknown): boolean => v === true;
  const stringArray = (v: unknown): string[] =>
    Array.isArray(v)
      ? v
          .filter((x): x is string => typeof x === "string")
          .map((x) => x.trim())
          .filter(Boolean)
      : [];

  const rawResult = safeString(obj?.result) as TicketResult;
  const result: TicketResult = VALID_RESULTS.has(rawResult) ? rawResult : "ResultNotConfirmed";

  const evObj = (obj?.evidence ?? {}) as Record<string, unknown>;
  const evidence: ExtractedEvidence = {
    ...EMPTY_EVIDENCE,
    storeNumber: safeString(evObj?.storeNumber),
    callerName: safeString(evObj?.callerName),
    registerNumber: safeString(evObj?.registerNumber),
    issue: safeString(evObj?.issue),
    errorMessage: safeString(evObj?.errorMessage),
    stepsTaken: safeString(evObj?.stepsTaken),
    result: safeString(evObj?.result),
    partNeeded: safeString(evObj?.partNeeded),
  };

  return {
    ...EMPTY_DETAILS,
    storeNumber: safeString(obj?.storeNumber),
    storeName: "",
    callerName: safeString(obj?.callerName),
    callerRole: safeString(obj?.callerRole),
    contactName: safeString(obj?.contactName),
    requesterName: safeString(obj?.requesterName),
    registerNumber: safeString(obj?.registerNumber),
    affectedRegisters: stringArray(obj?.affectedRegisters),
    deviceType: safeString(obj?.deviceType),
    deviceName: safeString(obj?.deviceName),
    deviceLocation: safeString(obj?.deviceLocation),
    dateTimeOfIssue: safeString(obj?.dateTimeOfIssue),
    category: safeString(obj?.category),
    subCategory: safeString(obj?.subCategory),
    item: safeString(obj?.item),
    transactionNumber: safeString(obj?.transactionNumber),
    itemNumber: safeString(obj?.itemNumber),
    employeeName: safeString(obj?.employeeName),
    employeeId: safeString(obj?.employeeId),
    operatorId: safeString(obj?.operatorId),
    typeOfTransaction: safeString(obj?.typeOfTransaction),
    paymentType: safeString(obj?.paymentType),
    issue: safeString(obj?.issue),
    symptoms: [],
    errorMessage: safeString(obj?.errorMessage),
    steps: stringArray(obj?.steps),
    servicesRestarted: stringArray(obj?.servicesRestarted),
    cacheRenamed: safeBool(obj?.cacheRenamed),
    powerDrainPerformed: safeBool(obj?.powerDrainPerformed),
    manualRebootPerformed: safeBool(obj?.manualRebootPerformed),
    cablesReseated: safeBool(obj?.cablesReseated),
    connectionsConfirmed: safeBool(obj?.connectionsConfirmed),
    result,
    isResolved: result === "Resolved",
    isPending: result === "Pending",
    isEscalated: result === "Escalated",
    parts: stringArray(obj?.parts),
    partNeeded: safeBool(obj?.partNeeded),
    partRequest: "",
    replacementReason: safeString(obj?.replacementReason),
    existingTicketMentioned: safeBool(obj?.existingTicketMentioned),
    existingTicketDetails: safeString(obj?.existingTicketDetails),
    vendorTicketNumber: safeString(obj?.vendorTicketNumber),
    devices: stringArray(obj?.devices),
    systems: [],
    escalationNeeded: result === "Escalated",
    followUpNeeded: result === "FollowUpRequired",
    wrongCaller: safeBool(obj?.wrongCaller) || result === "WrongCaller",
    transferNeeded: safeBool(obj?.transferNeeded) || result === "Transferred",
    transferDepartment: safeString(obj?.transferDepartment),
    storeWasAdvised: safeString(obj?.storeWasAdvised),
    caller: "",
    technicianAction: "",
    confirmationMethod: safeString(obj?.confirmationMethod),
    notes: "",
    confidenceNotes: stringArray(obj?.confidenceNotes),
    missingInfo: stringArray(obj?.missingInfo),
    suggestedQuestions: stringArray(obj?.suggestedQuestions),
    evidence,
  };
}

function parseJsonLoose(raw: string): unknown {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const stripped = stripCodeFences(trimmed);
    try {
      return JSON.parse(stripped);
    } catch {
      const start = stripped.indexOf("{");
      const end = stripped.lastIndexOf("}");
      if (start >= 0 && end > start) {
        return JSON.parse(stripped.slice(start, end + 1));
      }
      throw new Error("Local AI did not return valid JSON.");
    }
  }
}

function stripCodeFences(s: string): string {
  return s.replace(/^```(?:json|text)?\s*/i, "").replace(/```\s*$/i, "");
}

function dedupe<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}
