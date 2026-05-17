import type { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { StatusBar } from "./StatusBar";
import { ReminderBanner } from "./ReminderBanner";

export function Layout({ children }: { children: ReactNode }) {
  // Re-key the page wrapper on route change so the page-enter animation
  // re-triggers without us having to wire it into every page individually.
  // Phase 16 — StartupWarningBanner used to mount here so every route saw
  // every warning. That was distracting on the work pages (New Ticket,
  // History, Form Helper). It now mounts only on HomePage, which is the
  // natural "morning check" spot, and the ReminderBanner still nags
  // route-wide because reminders are time-sensitive.
  const location = useLocation();
  return (
    <div className="flex h-full min-h-screen text-slate-900 dark:text-slate-100">
      <Sidebar />
      <main className="flex flex-1 flex-col overflow-hidden">
        <ReminderBanner />
        <div className="flex-1 overflow-y-auto px-8 py-8">
          <div key={location.pathname} className="page-enter mx-auto w-full max-w-6xl">
            {children}
          </div>
        </div>
        <StatusBar />
      </main>
    </div>
  );
}
