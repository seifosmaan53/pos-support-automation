import { useEffect } from "react";
import { Layout } from "./components/Layout";
import { ConfirmProvider } from "./components/ConfirmDialog";
import { AppRoutes } from "./routes/AppRoutes";
import { useAppStore } from "./services/appStore";
import { STORAGE_WRITE_FAILED_EVENT } from "./services/databaseService";

export default function App() {
  const theme = useAppStore((s) => s.settings.theme);

  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      const useDark = theme === "dark" || (theme === "system" && prefersDark);
      root.classList.toggle("dark", useDark);
    };
    apply();
    const m = window.matchMedia("(prefers-color-scheme: dark)");
    m.addEventListener("change", apply);
    return () => m.removeEventListener("change", apply);
  }, [theme]);

  useEffect(() => {
    function onWriteFailed(ev: Event) {
      const d = (ev as CustomEvent<{ op?: string; message?: string }>).detail;
      const msg = d?.message ?? "unknown error";
      useAppStore.getState().setStatus({
        kind: "error",
        message: `Could not save to the database (${msg}). Fix the issue before closing the app; changes exist in memory until they persist.`,
      });
    }
    window.addEventListener(STORAGE_WRITE_FAILED_EVENT, onWriteFailed);
    return () => window.removeEventListener(STORAGE_WRITE_FAILED_EVENT, onWriteFailed);
  }, []);

  return (
    <ConfirmProvider>
      <Layout>
        <AppRoutes />
      </Layout>
    </ConfirmProvider>
  );
}
