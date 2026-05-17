export interface TaxonomySuggestion {
  category: string;
  subCategory: string;
  item: string;
}

export interface TaxonomyInput {
  text: string;
  category: string;
  devices: string[];
  typeOfTransaction: string;
}

interface TaxonomyRule {
  match: (i: TaxonomyInput) => boolean;
  category: string;
  subCategory: string;
  item: string;
}

const TAXONOMY_RULES: TaxonomyRule[] = [
  {
    match: (i) => /verifone|pin\s*pad|chip\s*reader|card\s*reader/i.test(i.text),
    category: "IBM Registers",
    subCategory: "VeriFone / Pin Pad",
    item: "VeriFone",
  },
  {
    match: (i) => /inseego|router|modem|internet|wi[- ]?fi|com\s+services?/i.test(i.text),
    category: "Network / Internet",
    subCategory: "Store Internet",
    item: "Inseego",
  },
  {
    match: (i) => /lotus\s*notes|email/i.test(i.text),
    category: "Email",
    subCategory: "Lotus Notes",
    item: "Lotus Notes",
  },
  {
    match: (i) => /\b(att|at&t)\b|phone\s*line|telecom/i.test(i.text),
    category: "Phone / Telecom",
    subCategory: "Phone Line",
    item: "ATT",
  },
  {
    match: (i) => /\bbos\b|back\s*office/i.test(i.text),
    category: "BOS / Back Office",
    subCategory: "Back Office",
    item: "BOS",
  },
  {
    match: (i) => /wrong\s+(operator|employee)\s+id|operator\s+id/i.test(i.text),
    category: "IBM Registers",
    subCategory: "Operator ID / Employee ID",
    item: "Employee ID",
  },
  {
    match: (i) => /wisely\s+card/i.test(i.text),
    category: "IBM Registers",
    subCategory: "Wisely Card",
    item: "Wisely Card",
  },
  {
    match: (i) =>
      /\b(register|pos|cash\s*drawer|receipt|return|exchange|layaway|transaction|item\s+number|payment|no\s+sale|override|start\s+of\s+day|cache)\b/i.test(
        i.text,
      ) ||
      ["Return", "Exchange", "Layaway", "No Receipt Return", "Refund", "No Sale", "Override"].includes(
        i.typeOfTransaction,
      ),
    category: "IBM Registers",
    subCategory: "Register",
    item: "Register",
  },
  {
    match: (i) => /receipt\s*printer/i.test(i.text),
    category: "IBM Registers",
    subCategory: "Receipt Printer",
    item: "Receipt Printer",
  },
];

export function suggestTaxonomy(input: TaxonomyInput): TaxonomySuggestion {
  for (const rule of TAXONOMY_RULES) {
    if (rule.match(input)) {
      return { category: rule.category, subCategory: rule.subCategory, item: rule.item };
    }
  }
  return { category: input.category, subCategory: "", item: "" };
}

export interface QuestionInput {
  typeOfTransaction: string;
  category: string;
  issueText: string;
  missingStore: boolean;
  missingRegister: boolean;
  missingTransaction: boolean;
  missingItem: boolean;
  missingError: boolean;
  missingResolution: boolean;
  missingPayment: boolean;
  missingRequester: boolean;
  partNeeded?: boolean;
  partDeviceConfirmed?: boolean;
  existingTicketWithoutNumber?: boolean;
}

export function suggestQuestions(input: QuestionInput): string[] {
  const out: string[] = [];
  const t = input.issueText.toLowerCase();

  if (input.missingStore) out.push("What is the store number?");
  if (input.missingRequester) out.push("Who called or who should be contacted for follow-up?");

  const isTransactional =
    ["Return", "Exchange", "Layaway", "No Receipt Return", "Refund", "Sale"].includes(
      input.typeOfTransaction,
    ) || /\b(receipt|transaction|return|exchange|layaway|refund)\b/i.test(t);

  if (isTransactional) {
    if (input.missingRegister) out.push("What register number was used?");
    if (input.missingTransaction) out.push("What is the original transaction number?");
    if (input.missingItem) out.push("What is the item number or SKU?");
    if (input.missingPayment)
      out.push(
        "What payment type was used (cash, card, credit, Wisely card, gift card)?",
      );
    if (input.missingError && /\berror\b/i.test(t))
      out.push("What exact error message appeared on screen?");
    if (input.missingResolution) out.push("Was the refund completed successfully?");
  }

  if (/verifone|pin\s*pad|card\s*reader/i.test(t)) {
    out.push("Which register or pin pad is affected?");
    out.push("Is the issue affecting all card transactions or only one card?");
    if (input.missingResolution)
      out.push("Did the card transaction go through after troubleshooting?");
  }

  if (/internet|inseego|router|modem/i.test(t)) {
    out.push("Is the issue affecting all registers or only one?");
    out.push("Are the Inseego/modem lights normal?");
    if (input.missingResolution) out.push("Is the store fully back online?");
    out.push("Did the issue come back after restart?");
  }

  if (/receipt\s*printer/i.test(t)) {
    if (input.missingRegister)
      out.push("Which register is the receipt printer connected to?");
    if (input.missingError)
      out.push("What exact error is showing on the receipt printer?");
    out.push("Does the printer lose power when moved?");
    out.push("Were the cables reseated?");
    if (input.partNeeded)
      out.push("Should a replacement receipt printer be requested?");
  }

  if (/keyboard/i.test(t)) {
    if (input.missingRegister)
      out.push("Which register is the keyboard connected to?");
    out.push("Is the issue with typing, click, cable, or power?");
    out.push("Did a power drain fix it?");
    out.push("Is there already an open ticket for replacement?");
  }

  if (/\bbos\b|back\s*office/i.test(t)) {
    out.push("What screen or task was the user working on when it got stuck?");
    if (input.missingError) out.push("Was there an error message?");
    if (input.missingResolution) out.push("Can the user complete the task now?");
  }

  if (/lotus\s*notes|email|phone\s*line|\batt\b/i.test(t)) {
    out.push("How long has the issue been happening?");
    if (/phone\s*line|\batt\b/i.test(t))
      out.push("Was an ATT/vendor ticket number provided?");
    if (/lotus\s*notes|email/i.test(t))
      out.push("Are emails stuck for one user or the whole store?");
  }

  if (/wrong\s+(operator|employee)\s+id|operator\s+id|employee\s+id/i.test(t)) {
    out.push("What is the employee name?");
    out.push("What is the employee ID?");
    out.push("What is the operator ID?");
    out.push("Is the old profile deactivated?");
    if (input.missingResolution)
      out.push("Can the employee log in now?");
  }

  if (/\bpcf\b/i.test(t)) {
    out.push("What employee is missing in PCF?");
    out.push("Is the employee ID correct?");
    out.push("Was a new profile created?");
    out.push("Can the manager now see the employee?");
  }

  if (input.partNeeded && !input.partDeviceConfirmed) {
    out.push("Which exact device and register need replacement?");
  }
  if (input.existingTicketWithoutNumber) {
    out.push("What is the existing open ticket number?");
  }

  if (input.missingResolution && out.length < 3) {
    out.push("Was the issue resolved, pending, or escalated?");
  }

  return dedupe(out).slice(0, 10);
}

function dedupe<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}
