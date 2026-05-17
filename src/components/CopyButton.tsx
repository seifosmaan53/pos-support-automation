import { useState } from "react";
import { copyText } from "../services/clipboardService";
import { useAppStore } from "../services/appStore";
import { Icon } from "./Icon";

export function CopyButton({
  text,
  label = "Copy to Clipboard",
  className = "btn-primary",
  onCopied,
}: {
  text: string;
  label?: string;
  className?: string;
  onCopied?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [justCopied, setJustCopied] = useState(false);
  const setStatus = useAppStore((s) => s.setStatus);

  return (
    <button
      className={className}
      disabled={busy || !text.trim()}
      onClick={async () => {
        setBusy(true);
        try {
          await copyText(text);
          setStatus({ kind: "success", message: "Copied." });
          setJustCopied(true);
          window.setTimeout(() => setJustCopied(false), 1400);
          onCopied?.();
        } catch (e) {
          setStatus({
            kind: "error",
            message: `Copy failed: ${(e as Error).message}`,
          });
        } finally {
          setBusy(false);
        }
      }}
    >
      <Icon name={justCopied ? "check" : "copy"} className="h-4 w-4" />
      <span>{busy ? "Copying…" : justCopied ? "Copied" : label}</span>
    </button>
  );
}
