import { NavLink } from "react-router-dom";
import { Icon, type IconName } from "./Icon";
import { useAppStore } from "../services/appStore";
import { USER_MODE_RANK, type UserMode } from "../types/settings";

interface NavItem {
  to: string;
  label: string;
  desc: string;
  icon: IconName;
  /**
   * Phase 17A — minimum user mode at which this item appears in the sidebar.
   * Omitted = visible in every mode (daily, advanced, developer). The page
   * route itself stays mounted at all modes; only the sidebar link is gated.
   */
  minMode?: UserMode;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

/**
 * Phase 11D — sidebar grouped into MAIN / WORKFLOW / TOOLS / SYSTEM.
 * Phase 17A — items carry an optional `minMode`; we filter by the user's
 * current mode before render. Empty groups collapse so Daily Mode doesn't
 * show a "Workflow" header with nothing under it.
 *
 * MAIN is the three entry points that 90% of sessions start from. WORKFLOW
 * is the chain of pages New Ticket flows through — visible in Advanced+
 * (Daily users reach those pages through the New Ticket flow itself).
 * TOOLS is curated knowledge work (KB always; Intelligence/Writing
 * Lab/Templates/Style Examples in Advanced+). SYSTEM is configuration and
 * diagnostics — Smoke Test + Pilot Mode are Developer-only.
 */
const GROUPS: NavGroup[] = [
  {
    title: "Main",
    items: [
      { to: "/", label: "Home", desc: "Daily start page", icon: "shield" },
      { to: "/voice", label: "New Ticket", desc: "Record or paste", icon: "mic" },
      { to: "/history", label: "History", desc: "Saved tickets", icon: "clock" },
      { to: "/reminders", label: "Reminders", desc: "Follow-ups", icon: "bell" },
    ],
  },
  {
    title: "Workflow",
    items: [
      { to: "/transcript", label: "Transcript", desc: "Review & edit speakers", icon: "quote", minMode: "advanced" },
      { to: "/details", label: "Extracted", desc: "Structured fields", icon: "list", minMode: "advanced" },
      { to: "/form", label: "Form Helper", desc: "Copy into ticket system", icon: "copy", minMode: "advanced" },
      { to: "/ticket", label: "Generated Note", desc: "Single-paragraph note", icon: "doc", minMode: "advanced" },
    ],
  },
  {
    title: "Tools",
    items: [
      { to: "/knowledge", label: "Knowledge Base", desc: "Stores & parts", icon: "book" },
      { to: "/intelligence", label: "Intelligence", desc: "Patterns & suggestions", icon: "chart", minMode: "advanced" },
      { to: "/writing-lab", label: "Writing Lab", desc: "Preview & QA generated text", icon: "sparkle", minMode: "advanced" },
      { to: "/templates", label: "Templates", desc: "Reusable wording", icon: "doc", minMode: "advanced" },
      { to: "/style-examples", label: "Style Examples", desc: "Teach my voice", icon: "sparkle", minMode: "advanced" },
    ],
  },
  {
    title: "System",
    items: [
      { to: "/settings", label: "Settings", desc: "Configuration", icon: "cog" },
      { to: "/system", label: "System Health", desc: "Status & self-tests", icon: "shield" },
      { to: "/smoke-test", label: "Smoke Test", desc: "End-to-end checks", icon: "list", minMode: "developer" },
      { to: "/pilot", label: "Pilot Mode", desc: "Real-world tuning", icon: "chart", minMode: "developer" },
      { to: "/help", label: "Help", desc: "Setup guide", icon: "info" },
    ],
  },
];

function filterGroups(groups: NavGroup[], mode: UserMode): NavGroup[] {
  const currentRank = USER_MODE_RANK[mode];
  return groups
    .map((g) => ({
      ...g,
      items: g.items.filter((i) => USER_MODE_RANK[i.minMode ?? "daily"] <= currentRank),
    }))
    .filter((g) => g.items.length > 0);
}

export function Sidebar() {
  const userMode = useAppStore((s) => s.settings.userMode);
  const groups = filterGroups(GROUPS, userMode);
  return (
    <aside className="flex w-64 flex-col border-r border-slate-200/80 bg-white/70 backdrop-blur-md dark:border-slate-800/80 dark:bg-slate-900/60">
      <div className="px-5 py-5">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-brand-600 text-white shadow-sm shadow-brand-900/20">
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden>
              <path d="M10 2a3 3 0 00-3 3v4a3 3 0 006 0V5a3 3 0 00-3-3z" />
              <path d="M5 9a1 1 0 112 0 3 3 0 006 0 1 1 0 112 0 5 5 0 01-4 4.9V16h2a1 1 0 110 2H7a1 1 0 110-2h2v-2.1A5 5 0 015 9z" />
            </svg>
          </span>
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              Local · Voice-first
            </div>
            <div className="text-[15px] font-semibold leading-tight">Store Ticket Assistant</div>
          </div>
        </div>
      </div>

      <nav className="flex flex-1 flex-col overflow-y-auto px-2 pb-2">
        {groups.map((group) => (
          <div key={group.title}>
            <div className="nav-section">{group.title}</div>
            <div className="flex flex-col gap-0.5">
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    `group relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-all duration-150 ${
                      isActive
                        ? "bg-brand-50 text-brand-800 dark:bg-brand-900/30 dark:text-brand-100"
                        : "text-slate-700 hover:bg-slate-100 hover:translate-x-0.5 dark:text-slate-300 dark:hover:bg-slate-800/60"
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive && (
                        <span className="absolute left-0 top-2 h-[calc(100%-1rem)] w-0.5 rounded-r-full bg-brand-600 dark:bg-brand-400" />
                      )}
                      <span
                        className={`flex h-7 w-7 flex-none items-center justify-center rounded-md transition-colors ${
                          isActive
                            ? "bg-brand-600/15 text-brand-700 dark:bg-brand-400/20 dark:text-brand-200"
                            : "text-slate-500 group-hover:bg-slate-200/70 group-hover:text-slate-700 dark:text-slate-400 dark:group-hover:bg-slate-700/60 dark:group-hover:text-slate-200"
                        }`}
                      >
                        <Icon name={item.icon} className="h-3.5 w-3.5" />
                      </span>
                      <span className="flex min-w-0 flex-col">
                        <span className={`font-medium leading-tight ${isActive ? "" : "group-hover:text-slate-900 dark:group-hover:text-slate-100"}`}>
                          {item.label}
                        </span>
                        <span className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                          {item.desc}
                        </span>
                      </span>
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-slate-200/80 px-4 py-3 text-[11px] leading-tight text-slate-500 dark:border-slate-800/80">
        {userMode !== "daily" && (
          <div className="mb-1.5 inline-flex items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            <Icon name="cog" className="h-3 w-3" />
            {userMode === "advanced" ? "Advanced Mode" : "Developer Mode"}
          </div>
        )}
        <div>Local-only · Mic + whisper.cpp + optional Ollama. Nothing leaves the machine.</div>
      </div>
    </aside>
  );
}
