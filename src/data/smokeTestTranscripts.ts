/**
 * Phase 14 — preset smoke-test transcripts.
 *
 * These mirror the spec's Tests A–E and are intentionally written like real
 * support calls — turn-taking, hesitations, store-employee + tech-support
 * voices. They are the same shape the speaker detector + caller-name
 * detector expect to consume, so loading one into the transcript editor
 * exercises the full pipeline end-to-end.
 *
 * No store names are hard-coded as caller names — the spec's
 * caller-name-detector requirement says "detect by pattern, not by
 * memorizing names." These transcripts use real-sounding names so a human
 * tester can verify the detector picks them up via Q→A turns.
 */

export interface SmokeTestTranscript {
  id: "A" | "B" | "C" | "D" | "E";
  title: string;
  storeNumber: string;
  description: string;
  transcript: string;
  expects: string[];
}

export const SMOKE_TEST_TRANSCRIPTS: SmokeTestTranscript[] = [
  {
    id: "A",
    title: "Test A — Keyboard issue, power drain fix",
    storeNumber: "1518",
    description:
      "Store 1518, caller gives name, Register 2 keyboard not typing, mouse works, power drain performed, fixed, no replacement.",
    transcript: `Tech Support: Computer room, this is Seif. How can I help you?
Caller: Hi Seif, this is Maria from Store 1518.
Tech Support: Hi Maria. What's going on?
Caller: Our Register 2 keyboard is not typing. We can move the mouse, click on things, but no characters come through when we type.
Tech Support: Just Register 2, or all registers?
Caller: Just Register 2. Register 1 is fine.
Tech Support: Okay. Let's do a power drain. Shut Register 2 all the way down, unplug it from the wall, hold the power button for thirty seconds, then plug it back in and boot it.
Caller: One moment. Power button held… okay, plugging it back in… booting up now.
Tech Support: Once it boots, log in and try the keyboard.
Caller: Booting… logging in… I can type now. The keyboard is working.
Tech Support: Great, the power drain cleared it. No replacement needed. I'll close the ticket as resolved.
Caller: Thanks Seif.`,
    expects: [
      'storeNumber = "1518"',
      'callerName = "Maria" (pattern: "this is X from Store NNN")',
      'registerNumber = "2"',
      'device = "keyboard"',
      'steps include "power drain"',
      'result = "Resolved"',
      'partNeeded = false',
    ],
  },
  {
    id: "B",
    title: "Test B — Receipt printer hardware failure",
    storeNumber: "870",
    description:
      "Store 870, Register 1 receipt printer hardware failure, reboot/reseat tried, printer still loses power when moved, replacement needed.",
    transcript: `Tech Support: Computer room, can I get your name and store?
Caller: This is Jordan from Store 870. Our Register 1 receipt printer is acting up.
Tech Support: Acting up how?
Caller: It keeps losing power. If we bump the counter at all, the printer just dies and the lights go off.
Tech Support: Did you try reseating the power cable?
Caller: Yes, we reseated the power cable, reseated the data cable, rebooted the register, and reseated the USB. It still loses power when the counter is bumped.
Tech Support: That sounds like a hardware failure inside the printer. Power instability that's triggered by a small bump is not something we can fix by reseating.
Caller: Okay. So I need a replacement?
Tech Support: Yes — I'll open a part request for a replacement receipt printer for Register 1, Store 870. Once it arrives, swap it and let us know.
Caller: Got it. Thank you.`,
    expects: [
      'storeNumber = "870"',
      'callerName = "Jordan"',
      'registerNumber = "1"',
      'device = "receipt printer"',
      'partNeeded = true',
      'partRequest includes "replacement receipt printer"',
      'result = "Pending"  (replacement not yet installed)',
    ],
  },
  {
    id: "C",
    title: "Test C — Internet down, Inseego restart",
    storeNumber: "395",
    description:
      "Store 395 internet down, restart Inseego, confirm both registers back online.",
    transcript: `Tech Support: Tech support, how can I help?
Caller: This is Casey from Store 395. Our internet is down — both registers say no connection.
Tech Support: Both registers? Let's check the Inseego gateway. The Inseego is the small black box near the router. Power-cycle it: unplug it, count to thirty, plug it back in.
Caller: One moment… unplugged… plugging back in… lights are coming back on.
Tech Support: Give it about ninety seconds for it to reconnect to the cellular network. While we wait, are the registers showing any error?
Caller: They were showing "no connection." Let me check now — okay, Register 1 just came back online. Register 2 is reconnecting now too.
Tech Support: Both back online?
Caller: Yes, both. We're back in business.
Tech Support: Perfect. The Inseego just needed a power cycle. I'll mark this as resolved.`,
    expects: [
      'storeNumber = "395"',
      'callerName = "Casey"',
      'device includes "Inseego" or "internet"',
      'steps include "power cycle" or "restart Inseego"',
      'result = "Resolved"',
      'partNeeded = false',
    ],
  },
  {
    id: "D",
    title: "Test D — Return processed as exchange",
    storeNumber: "705",
    description:
      "Customer return accidentally processed as exchange, transaction number, item number, payment type, workaround performed.",
    transcript: `Tech Support: Tech support, this is Seif.
Caller: Hi Seif, this is Riley from Store 705. We have a transaction issue — a customer return was processed as an exchange by mistake.
Tech Support: Do you have the transaction number?
Caller: Yes, transaction 4837291. The item number was 7720045. Customer paid with a Wisely card originally.
Tech Support: Okay — a return processed as an exchange. The system thinks the customer took new merchandise. What did the customer actually do?
Caller: They just wanted to return the item and get their money back on the Wisely card. They didn't take any new merchandise.
Tech Support: Got it. We'll need to void the exchange leg and process a clean return. I'll walk you through it. Open the transaction in the backoffice tool — search for 4837291 — and then void the outgoing item line.
Caller: Voided.
Tech Support: Now process a fresh return for item 7720045 with refund to the original Wisely card.
Caller: Done. The customer is getting the refund confirmation now.
Tech Support: Great. I'll log this as a workaround applied, not a system bug.`,
    expects: [
      'storeNumber = "705"',
      'callerName = "Riley"',
      'transactionNumber = "4837291"',
      'itemNumber = "7720045"',
      'paymentType includes "Wisely"',
      'typeOfTransaction includes "return" or "exchange"',
      'result = "Resolved" or "Workaround Applied"',
    ],
  },
  {
    id: "E",
    title: "Test E — Wrong caller / wrong department",
    storeNumber: "—",
    description:
      "Caller reached wrong department, transferred or redirected. Should detect wrongCaller / transfer instead of fabricating a ticket.",
    transcript: `Tech Support: Computer room, can I help you?
Caller: Hi, this is Pat — I'm trying to reach payroll about my paycheck. I think I dialed the wrong number.
Tech Support: Yeah, this is the store tech support line, not payroll. Payroll is a different extension. Do you want the number?
Caller: Yes please.
Tech Support: It's extension 4400, or you can call HR directly at the number on your paystub.
Caller: Got it. Thanks for redirecting me. Sorry about the wrong department.
Tech Support: No problem. Have a good one.`,
    expects: [
      "wrongCaller = true",
      'transferDepartment includes "payroll" or "HR"',
      "no fabricated ticket — analyzer should flag this as a wrong-department call",
      "no part request",
    ],
  },
];

export function getSmokeTestTranscript(id: SmokeTestTranscript["id"]): SmokeTestTranscript | undefined {
  return SMOKE_TEST_TRANSCRIPTS.find((t) => t.id === id);
}
