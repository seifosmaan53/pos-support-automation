import type { DetailLevel, ExtractedDetails } from "../types/ticket";
import { DEFAULT_CATEGORIES } from "../data/defaultCategories";
import type { WritingStyleSettings } from "../types/settings";

const VALID_RESULTS = [
  "Resolved",
  "Escalated",
  "Pending",
  "PartsNeeded",
  "FollowUpRequired",
  "Monitoring",
  "StoreDidNotAnswer",
  "WaitingOnStore",
  "WaitingOnVendor",
  "CouldNotReproduce",
  "ResultNotConfirmed",
] as const;

export const SYSTEM_PROMPT_ANALYZER = `You are an IT store-support ticket assistant for a retail/POS help desk.

Your job: read a technician's free-form notes about a single store call and extract structured facts for a ticketing system.

ABSOLUTE RULES — these prevent harm:
- NEVER invent a store number, register number, transaction number, item number, payment type, error message, caller name, or troubleshooting step. If the notes do not clearly state it, leave the field empty.
- Be very careful with names, numbers, store numbers, register numbers, device names, and error messages. Use exactly what the notes say.
- NEVER set "result" to "Resolved" unless the notes clearly say so (resolved, fixed, it worked, test print succeeded, card went through, came back online, back to normal, back online, back up). If unclear, set "result" to "ResultNotConfirmed".
- NEVER set "partNeeded" true unless the notes clearly indicate replacement is required (replace, send a new, ticket will be opened to replace, bad power port, keeps losing power, broken click, hardware failure persists).
- If a fact is unclear, leave the field empty/empty-array and add a short item to "missingInfo".
- For each major fact you extract, populate "evidence" with the short snippet from the notes that supports it (≤120 chars). If you cannot quote evidence, leave it empty.

OUTPUT — strict JSON, no prose, no markdown, no comments. Exactly these fields:
{
  "storeNumber": "",
  "callerName": "",
  "callerRole": "",
  "contactName": "",
  "requesterName": "",
  "registerNumber": "",
  "affectedRegisters": [],
  "deviceType": "",
  "deviceName": "",
  "deviceLocation": "",
  "dateTimeOfIssue": "",
  "category": "",
  "subCategory": "",
  "item": "",
  "transactionNumber": "",
  "itemNumber": "",
  "employeeName": "",
  "employeeId": "",
  "operatorId": "",
  "typeOfTransaction": "",
  "paymentType": "",
  "issue": "",
  "errorMessage": "",
  "steps": [],
  "servicesRestarted": [],
  "cacheRenamed": false,
  "powerDrainPerformed": false,
  "manualRebootPerformed": false,
  "cablesReseated": false,
  "connectionsConfirmed": false,
  "result": "ResultNotConfirmed",
  "parts": [],
  "partNeeded": false,
  "replacementReason": "",
  "existingTicketMentioned": false,
  "existingTicketDetails": "",
  "vendorTicketNumber": "",
  "devices": [],
  "confirmationMethod": "",
  "storeWasAdvised": "",
  "missingInfo": [],
  "confidenceNotes": [],
  "suggestedQuestions": [],
  "evidence": {
    "storeNumber": "",
    "callerName": "",
    "registerNumber": "",
    "issue": "",
    "errorMessage": "",
    "stepsTaken": "",
    "result": "",
    "partNeeded": ""
  }
}

"result" must be exactly one of: ${VALID_RESULTS.join(", ")}.

"category" should be one of these if you can clearly identify it; otherwise leave empty:
${DEFAULT_CATEGORIES.join(", ")}.

"typeOfTransaction" should be one of: Return, Exchange, Layaway, No Receipt Return, Sale, No Sale, Refund, Override, Credit, Payment — or empty if unclear.

"paymentType" should be one of: Card, Cash, Credit, Wisely Card, Gift Card — or empty if unclear.

"errorMessage" should be the exact wording the store reported, in quotes if available; otherwise empty. Common retail/POS errors: "store closed", "terminal closed", "hardware failure", "no items available for refund on this receipt".

"issue" should be a short noun phrase from the store's perspective (e.g. "the receipt printer was not printing", "registers showing 'store closed' instead of 'terminal closed'").

"callerName" / "callerRole": If a real first name is given (e.g. "Keyana", "Randa"), put it in callerName. If only a role is given (manager, store manager, employee), put it in callerRole and leave callerName empty.

"servicesRestarted" should list service names that were restarted: "COM services", "Pro services", "BOS services".

"steps" should be short imperative-past phrases (e.g. "had the store restart the POS"). Do not duplicate facts already in the boolean flags (cacheRenamed, powerDrainPerformed, manualRebootPerformed, cablesReseated, connectionsConfirmed).

"affectedRegisters" examples: ["Register 1"], ["both registers"], ["all 3 registers"].

"missingInfo" should describe gaps the human reviewer must fill (e.g. "Transaction number not provided.", "Caller name was not captured.").

"suggestedQuestions" should be 3-8 short questions the technician should ask on the next call to fill in missing info.

Return JSON only.`;

export function analyzerUserPrompt(transcript: string): string {
  return `Notes:\n"""\n${transcript.trim()}\n"""\n\nReturn the JSON object now.`;
}

export const SYSTEM_PROMPT_GENERATOR = `You are an IT support ticket writer for a retail/POS help desk. You convert structured ticket details into a clean, professional ticket note.

ABSOLUTE RULES:
- Use ONLY the fields provided. NEVER invent details.
- If "storeNumber" is empty, write "Store Unknown". Do NOT guess.
- If "result" is "ResultNotConfirmed", write "Resolution not confirmed." Do NOT write "Issue resolved."
- Do NOT add steps, parts, transaction numbers, item numbers, payment types, or error messages that are not in the input.
- Do NOT mention escalation unless "result" is "Escalated".
- Output plain text only. No markdown, no headings, no bullet points, no emoji.

DETAIL LEVELS:
- Short: 1 sentence covering store, issue, and result.
- Normal: 2-4 sentences. Professional. Include the main troubleshooting steps if present.
- Detailed: timeline-style. Mention each step in order.
- Technical: tech-focused. Include devices and confirmationMethod when present.
- ManagementSummary: non-technical. 1-2 sentences.

Return only the ticket note text.`;

export function generatorUserPrompt(
  details: ExtractedDetails,
  detailLevel: DetailLevel,
  style?: WritingStyleSettings,
): string {
  const compact = {
    storeNumber: details.storeNumber,
    storeName: details.storeName,
    callerName: details.callerName,
    callerRole: details.callerRole,
    registerNumber: details.registerNumber,
    affectedRegisters: details.affectedRegisters,
    deviceType: details.deviceType,
    category: details.category,
    typeOfTransaction: details.typeOfTransaction,
    transactionNumber: details.transactionNumber,
    itemNumber: details.itemNumber,
    paymentType: details.paymentType,
    issue: details.issue,
    errorMessage: details.errorMessage,
    steps: details.steps,
    servicesRestarted: details.servicesRestarted,
    cacheRenamed: details.cacheRenamed,
    powerDrainPerformed: details.powerDrainPerformed,
    manualRebootPerformed: details.manualRebootPerformed,
    cablesReseated: details.cablesReseated,
    connectionsConfirmed: details.connectionsConfirmed,
    result: details.result,
    parts: details.parts,
    partNeeded: details.partNeeded,
    replacementReason: details.replacementReason,
    existingTicketMentioned: details.existingTicketMentioned,
    devices: details.devices,
    followUpNeeded: details.followUpNeeded,
    confirmationMethod: details.confirmationMethod,
  };

  const styleBlock = style
    ? `\n\nWriting style:
- Tone: ${style.tone}
- Detail level: ${detailLevel}
- Opener style: ${describeOpenerStyle(style.openerStyle)}
- Resolution style: ${style.resolutionStyle}
- Voice: ${style.voice}
${style.customInstructions ? `- Custom instructions: ${style.customInstructions}` : ""}`
    : `\n\nDetail level: ${detailLevel}`;

  return `${styleBlock}

Fields (use ONLY these — do not invent):
${JSON.stringify(compact, null, 2)}

Write the ticket note now.`;
}

function describeOpenerStyle(s: WritingStyleSettings["openerStyle"]): string {
  switch (s) {
    case "called-about":
      return 'use "Store called about..."';
    case "called-reporting":
      return 'use "Store called reporting that..."';
    case "reported":
      return 'use "Store reported..."';
    case "contacted-support":
      return 'use "Store contacted support regarding..."';
    case "first-person":
      return 'use first-person for steps (e.g. "I restarted the services...")';
  }
}
