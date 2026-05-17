export async function copyText(text: string): Promise<void> {
  try {
    const tauri = await import("@tauri-apps/plugin-clipboard-manager");
    await tauri.writeText(text);
    return;
  } catch {
    // Fall through to browser clipboard (used in vite dev outside Tauri).
  }
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  throw new Error("Clipboard is not available in this environment.");
}
