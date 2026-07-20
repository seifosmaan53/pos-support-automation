export const DEFAULT_CATEGORIES = [
  "POS",
  "Receipt Printer",
  "Kitchen Printer",
  "Label Printer",
  "Pin Pad",
  "Scanner",
  "Cash Drawer",
  "Internet",
  "Router",
  "Modem",
  "Switch",
  "Wi-Fi",
  "Back Office Computer",
  "Register",
  "Scale",
  "Phone",
  "Camera",
  "DVR/NVR",
  "Login/User Account",
  "Software",
  "Hardware",
  "Power Issue",
  "Inventory System",
  "Payment Processing",
  "Other",
] as const;

export type CategoryName = (typeof DEFAULT_CATEGORIES)[number];

export interface CategoryRule {
  category: CategoryName;
  patterns: RegExp[];
}

export const CATEGORY_RULES: CategoryRule[] = [
  {
    category: "Internet",
    patterns: [
      /internet\s*(is\s*)?(down|out|offline)/i,
      /connection\s*(is\s*)?(down|out|offline|lost)/i,
      /no\s*internet/i,
      /\boffline\b/i,
    ],
  },
  { category: "Receipt Printer", patterns: [/receipt\s*printer/i, /receipt\s*roll/i] },
  { category: "Kitchen Printer", patterns: [/kitchen\s*printer/i, /kds/i] },
  { category: "Label Printer", patterns: [/label\s*printer/i] },
  {
    category: "Pin Pad",
    patterns: [/pin\s*pad/i, /pinpad/i, /card\s*reader/i, /chip\s*reader/i],
  },
  { category: "Scanner", patterns: [/scanner/i, /barcode/i] },
  { category: "Cash Drawer", patterns: [/cash\s*drawer/i, /\btill\b/i] },
  { category: "Router", patterns: [/router/i] },
  { category: "Modem", patterns: [/modem/i] },
  { category: "Switch", patterns: [/network\s*switch/i] },
  { category: "Wi-Fi", patterns: [/wi[- ]?fi/i, /wireless/i] },
  {
    category: "Back Office Computer",
    patterns: [/back\s*office/i, /office\s*pc/i, /office\s*computer/i],
  },
  { category: "Register", patterns: [/\bregister\b/i, /\btill\s*pc\b/i] },
  { category: "POS", patterns: [/\bpos\b/i, /point\s*of\s*sale/i, /terminal/i] },
  { category: "Scale", patterns: [/\bscale\b/i, /weighing/i] },
  { category: "Phone", patterns: [/\bphone\b/i, /handset/i] },
  { category: "Camera", patterns: [/camera/i] },
  { category: "DVR/NVR", patterns: [/\bdvr\b/i, /\bnvr\b/i] },
  {
    category: "Login/User Account",
    patterns: [
      /password/i,
      /can(?:'?t| ?not)\s*log\s*in/i,
      /login/i,
      /locked\s*out/i,
      /user\s*account/i,
    ],
  },
  { category: "Software", patterns: [/software/i, /application/i, /\bapp\b/i] },
  { category: "Hardware", patterns: [/hardware/i] },
  { category: "Power Issue", patterns: [/power\s*(out|off|issue)/i, /no\s*power/i] },
  { category: "Inventory System", patterns: [/inventory/i] },
  {
    category: "Payment Processing",
    patterns: [/payment\s*processing/i, /\bcard\s*decline/i, /transaction\s*fail/i],
  },
];
