import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { isSetupCompleted } from "../services/setupState";

/**
 * Phase 13 — once-per-install redirect to /setup.
 *
 * Mounted at the top of AppRoutes. Checks localStorage on first render; if
 * the setup wizard has never been completed (or skipped), redirects to
 * /setup. Idempotent — subsequent renders are no-ops because the flag is
 * set the moment the user hits Skip or Finish.
 *
 * We deliberately do not block the route — the user can always navigate
 * back to / via the sidebar, even mid-setup. That matters because if they
 * came in from a Quick Action link, taking away their navigation context
 * would feel hostile.
 */
export function FirstRunRedirect() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (isSetupCompleted()) return;
    if (location.pathname.startsWith("/setup")) return;
    if (location.pathname.startsWith("/system")) return; // power-user escape
    navigate("/setup", { replace: true });
    // Run once on mount — re-running on every location change would fight
    // the user navigating out of /setup deliberately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
