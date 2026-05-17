import type { TicketResult } from "../types/ticket";

export function resultSentence(result: TicketResult): string {
  switch (result) {
    case "Resolved":
      return "Issue resolved.";
    case "Escalated":
      return "Issue was escalated for further review.";
    case "Transferred":
      return "Caller was transferred to the appropriate department.";
    case "WrongCaller":
      return "Caller reached the wrong department and was redirected.";
    case "Pending":
      return "Issue is currently pending.";
    case "PartsNeeded":
      return "Issue requires replacement parts.";
    case "FollowUpRequired":
      return "Follow-up is required.";
    case "Monitoring":
      return "Issue is being monitored.";
    case "StoreDidNotAnswer":
      return "Store did not answer.";
    case "WaitingOnStore":
      return "Waiting on store response.";
    case "WaitingOnVendor":
      return "Waiting on vendor response.";
    case "CouldNotReproduce":
      return "Issue could not be reproduced.";
    case "ResultNotConfirmed":
      return "Result not confirmed.";
  }
}

export function resultLabel(result: TicketResult): string {
  return resultSentence(result).replace(/\.$/, "");
}
