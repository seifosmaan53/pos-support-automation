# Store Ticket Assistant

A **local-first, voice-first ticket form helper** for retail / POS IT support. Record the call (or paste the transcript), let local **whisper.cpp** turn audio into text, let the analyzer (rule-based or local LLM) extract structured fields, then land on a **Ticket Form Helper** page that gives you copy-ready values for every field of a ManageEngine / ServiceDesk-style ticket form — Subject, Description, Resolution, Category, Sub Category, Item, Transaction #, Type of Transaction, Payment Type, and more.

Everything runs on your machine. No cloud, no API keys, no telemetry.

---

## Why local-first?

- All transcripts, extracted details, and saved tickets stay on this machine.
- The app makes no outbound network requests by default.
- No accounts, no API keys, no cloud transcription, no cloud LLMs.
- The only network traffic possible is to your own `localhost` (Ollama or LM Studio), and only if you explicitly switch the AI provider away from the rule-based default.

## Features

| Area | What it does |
| --- | --- |
| **Capture** | In-app microphone recording with Pause / Resume / Stop / Cancel, in-browser WAV encoding (16 kHz mono PCM16), manual transcript paste/type as fallback. |
| **Transcribe** | Local whisper.cpp transcription via a Tauri command. Per-mic calibration (silence / speech / clipping thresholds). Test Whisper + Test Microphone + Calibrate Microphone buttons. |
| **Live Conversation** | Streams whisper chunks during the call, classifies each chunk (speech / silence / noise / unclear / hallucination), filters bracket artifacts and stock-filler hallucinations, surfaces missing-info prompts in real time. |
| **Analyze** | Rule-based extractor (no AI required) or local LLM (Ollama / LM Studio) with auto-fallback. Extracts store number, caller name, caller role, register, transaction #, item #, payment type, type of transaction, error message, date/time. |
| **Action / part detection** | Flags services restarted (COM / Pro / BOS), cache renamed, register power drain, manual reboot, cables reseated, connections confirmed, part-replacement detection (bad power port, broken click, bad cable), existing-ticket detection. |
| **Transcription correction layer** | Number-words to digits ("register one" → Register 1), brand corrections ("calm services" → COM services, "in see go" → Inseego, "very phone" → VeriFone). Editable in Settings. |
| **Ticket Form Helper** | Every ManageEngine field as an editable card with edit / copy / reset. Subject auto-formatter (`Store XXXXX - Issue`, Register-aware variants), Category / Sub Category / Item suggestion (VeriFone, Inseego, Lotus Notes, ATT, BOS, Wisely, PCF). |
| **Summary views** | Eight versions — Original Transcript / Cleaned Transcript / Original Summary / Short / Normal / Detailed / Technical / Management. Original transcript and original summary are always recoverable. |
| **Writing Style** | Tone (Simple / Professional / Technical / Manager-Friendly / Custom), opener style, resolution style, voice (active vs passive), custom instructions. |
| **Knowledge Base** | Editable stores, common problems, parts; informs Live Assist and Ask Next suggestions. |
| **Templates + Style Examples** | Reusable wording and "teach my voice" examples. |
| **History** | Searchable saved-ticket history with JSON / CSV export and audio-attached chips. |
| **Backup / Restore** | Export Backup + Audio to any folder; Verify Backup before relying on it; full restore from a backup file. |
| **Audio Repair Wizard** | Re-link orphan recordings, find unlinked files on disk, mark missing files. |
| **Reminders** | Per-ticket follow-up reminders with due-now banner on Home. |
| **System Health** | One page with audio, whisper, AI provider, and storage health checks. |
| **Progressive disclosure** | Daily / Advanced / Developer user modes — see the next section. |

## User modes

The app has three levels of UI complexity, chosen in **Settings → Basic → User Mode**.

- **Daily** (default) — minimum UI. Sidebar shows 8 items: Home, New Ticket, History, Reminders, Knowledge Base, Settings, System Health, Help. Settings has 3 tabs: Basic, Audio & Microphone, Transcription. New Ticket hides power-user toolbars and collapses the Live Assist panel.
- **Advanced** — adds the workflow chain in the sidebar (Transcript, Extracted, Form Helper, Generated Note), plus Intelligence, Writing Lab, Templates, Style Examples. Settings gains AI Provider, Ticket Fields, and Advanced tabs. New Ticket reveals the readability toolbar and Raw Chunk Debug.
- **Developer** — adds Smoke Test and Pilot Mode in the sidebar; adds a Developer tab in Settings with shortcuts to dev pages.

Switching modes is instant. Hidden pages still work if you type the URL — only the sidebar links are filtered.

## Tech stack

- **Tauri 2 + Rust** — desktop shell
- **React 18 + TypeScript + Vite** — frontend
- **Tailwind CSS** — styling
- **Zustand** — state
- **SQLite** via `tauri-plugin-sql` — ticket + audio metadata storage
- **whisper.cpp** — local transcription (not bundled; install separately)
- Optional: **Ollama** or **LM Studio** for local LLM extraction

## Prerequisites

- Node.js 18 or newer
- Rust toolchain (`rustup`) — required for Tauri compiles (`tauri:dev` and `tauri:build`); not required for the Vite browser preview
- macOS, Windows, or Linux

On macOS:

```bash
xcode-select --install
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

On Windows: install [rustup](https://rustup.rs/) and the Microsoft C++ Build Tools.

On Linux: install [rustup](https://rustup.rs/) plus the Tauri Linux dependencies listed in the [Tauri prerequisites guide](https://tauri.app/start/prerequisites/).

## Install

```bash
git clone <this repo>
cd store-ticket-assistant
npm install
```

## Run in development

Two ways:

**Vite-only (browser preview, no native window):**

```bash
npm run dev
```

Fast for UI iteration. Some Tauri-only features (file dialogs, Rust commands) are stubbed.

**Tauri desktop app (full app):**

```bash
npm run tauri:dev
```

Starts Vite, then opens the native window. The first run compiles Rust dependencies — give it 1–3 minutes.

## Build a desktop binary

```bash
npm run tauri:build
```

Outputs land in `src-tauri/target/release/bundle/`:

- macOS: `bundle/macos/Store Ticket Assistant.app` and `bundle/dmg/Store Ticket Assistant_0.1.0_aarch64.dmg`
- Windows: `bundle/msi/...msi`
- Linux: `bundle/deb/...deb` and `bundle/appimage/...AppImage`

Drag the `.app` (macOS) or run the installer to put it in Applications.

## Workflow

1. **New Ticket** — click ● Record (or Pause/Resume), then ■ Stop. Or paste/type call notes.
2. Click **Transcribe** to run whisper.cpp on the recording.
3. Edit the transcript on **Transcript Review** if anything looks off.
4. Click **Analyze Transcript** — extraction runs locally.
5. Land on **Ticket Form Helper**:
   - Pick a summary version (Original / Clean / Short / Normal / Detailed / Technical / Management).
   - Each ticket-system field is a card with edit, copy, and reset.
   - Yellow badges mark fields that need a human check.
   - Missing info warnings + Suggested questions appear inline.
   - **Copy Subject / Description / Resolution / All Fields / Full Ticket** to dump values into your ticket system.
6. Click **Save Ticket** to keep a local copy in History.

Original transcript and clean original summary are always recoverable via the version selector — analysis never destroys them.

## Where data is stored

| Kind | Location (macOS) |
| --- | --- |
| Saved tickets | SQLite database in the app data directory |
| Audio recordings | `~/Library/Application Support/app.local.storeticketassistant/audio/` |
| Settings | App data dir + localStorage shadow |
| Backups | Wherever you point Export Backup + Audio |
| Whisper model files | Wherever you point Settings → Transcription |

To wipe everything: **Settings → Basic → Privacy → Clear all tickets** and **Reset settings**.

## Backup & restore

**Settings → Advanced → Storage & Migration:**

- **Export Backup + Audio** — writes `<name>.json` (tickets + settings) and an `audio/` subfolder to a destination of your choice.
- **Verify Backup** — re-reads a backup file and reports counts so you know it's valid before relying on it.
- **Restore Backup** — pick a `.json` file; the app shows what it will restore and asks confirm.

Recommended cadence: weekly, plus any day you closed important tickets.

## Configuring whisper.cpp (local transcription)

### 1. Build whisper.cpp

```bash
git clone https://github.com/ggerganov/whisper.cpp
cd whisper.cpp
cmake -B build
cmake --build build --config Release
```

The CLI binary lands at `build/bin/whisper-cli` (older builds also produce a `main` binary at the project root — either works).

### 2. Download a ggml model

```bash
bash ./models/download-ggml-model.sh medium.en   # ~1.5 GB, recommended
# or:
bash ./models/download-ggml-model.sh base.en     # ~140 MB, fastest
bash ./models/download-ggml-model.sh small.en    # ~470 MB, balanced
bash ./models/download-ggml-model.sh large-v3    # ~3 GB, best quality / slowest
```

### 3. Point the app at it

In the app, **Settings → Transcription**:

1. **whisper.cpp executable path** — e.g. `/Users/you/whisper.cpp/build/bin/whisper-cli`.
2. **Whisper model path** — e.g. `/Users/you/whisper.cpp/models/ggml-medium.en.bin`.
3. **Language** — `en` (or `auto` to let whisper detect).
4. **Threads** — typically the number of physical CPU cores (4–8 is a good default).
5. Click **Test Whisper**. Expected: `Executable and model both ready (1500 MB) — whisper-cli ...`.

### Audio retention

Two checkboxes in Settings → Audio & Microphone control what happens to the recorded WAV:

- **Save audio recordings permanently to disk** — *on by default for normal use.* When off, the WAV is deleted automatically after transcription.
- **Delete audio after transcription completes** — privacy-first mode if you'd rather not keep recordings.

### macOS microphone permission

macOS requires `NSMicrophoneUsageDescription` in the app bundle's `Info.plist` for the permission prompt to appear. `src-tauri/Info.plist` is set up. If the prompt doesn't appear:

- Quit the app fully.
- Re-run `npm run tauri:dev`.
- If still nothing, open **System Settings → Privacy & Security → Microphone** and add/enable Store Ticket Assistant manually.

## Configuring Ollama (optional, local AI)

AI is opt-in. With the default Rule-based provider, the app works without any LLM.

### 1. Install Ollama

```bash
# macOS / Linux
curl -fsSL https://ollama.com/install.sh | sh
```

On Windows, download from [ollama.com/download](https://ollama.com/download).

### 2. Pull a model

```bash
ollama pull llama3.1:8b      # default; ~5 GB, runs on 8 GB+ RAM
ollama pull llama3.2:3b      # ~2 GB, faster but less precise
ollama pull llama3.1:70b     # 40 GB+, needs ~64 GB RAM or a beefy GPU
```

### 3. Start the Ollama server

```bash
ollama serve
```

On macOS, the menu-bar app starts the server automatically.

### 4. Switch the app to Ollama

**Settings → AI Provider** (Advanced mode):

1. Set **Provider** to `Ollama (local AI)`.
2. Confirm the endpoint (default `http://localhost:11434`) and model (default `llama3.1:8b`).
3. Click **Test Connection** — expect `Connected in N ms. Model "..." is installed.`
4. Keep **Fall back to rule-based mode if Ollama fails** checked.

If Ollama isn't running when the app needs it, the fallback engages automatically — the workflow continues with the rule-based template.

## LM Studio (optional, alternative local AI)

LM Studio exposes an OpenAI-compatible local API on port 1234 by default. Open LM Studio → Local Server → Start, then **Settings → AI Provider → LM Studio**. Same fall-back behavior as Ollama.

## Sample transcripts to try

Paste any of these on the **New Ticket** page and click **Analyze Transcript**:

1. **Layaway return error** — *"Store 01053 — Apr 22, 2026 06:00 AM. The store called about a layaway that was finalized, and the customer wanted to return an item, but it keeps giving us an error every time we scan the receipt..."* — exercises store number, register, transaction context, error message, and resolution wording.
2. **Internet instability** — *"The internet was not stable at the store; we restarted the Inseego and the COM services, and it's back to normal."* — exercises Inseego / COM service detection, "back to normal" → Resolved.
3. **BOS stuck** — *"BOS was stuck when she was adding an employee; I restarted the services and told her to try again."* — exercises BOS taxonomy.
4. **Resolved (printer)** — *"Store 9 called because the receipt printer was not printing. I had them restart the POS, checked the USB cable, replaced the cable, and then we ran a test print. It worked after that. Issue resolved."*
5. **Ambiguous (intentionally)** — *"The printer issue from earlier, I think it was store maybe 8 or 18, not sure. Cable might be bad."* — the analyzer refuses to commit to a store number and flags it as missing.

## Privacy & legal

- The app makes **no outbound network requests by default**. The only network call possible is to a local LLM (`http://localhost:11434` for Ollama or `http://localhost:1234` for LM Studio), and only when you explicitly switch the AI provider in Settings.
- Tauri capabilities scope HTTP access to `localhost` ports for those two services. The webview cannot reach any other URL.
- No accounts, no API keys, no telemetry.
- Microphone capture requires explicit OS permission. Only record calls if you have permission from your company and you follow all applicable laws and workplace policies.

## Common issues

- **`tauri:dev` is slow on first run** — Rust crates are compiling. Subsequent runs are fast.
- **Clipboard copy does nothing in Vite-only mode** — switch to `npm run tauri:dev` or use a Chromium-based browser.
- **Generated ticket says "Result not confirmed"** — by design. The analyzer refuses to commit to "Resolved" without explicit transcript wording. Override it on Extracted Details if needed.
- **Test Connection says "Could not reach Ollama"** — make sure `ollama serve` is running. Try `curl http://localhost:11434/api/tags`.
- **Test Connection says "model not found"** — run `ollama pull <model-name>`.
- **Browser preview blocks Ollama (CORS)** — restart Ollama with `OLLAMA_ORIGINS='*' ollama serve`, or use `npm run tauri:dev`.
- **Audio missing on a saved ticket** — open System Health → Audio Repair Wizard; re-link or mark missing.

## Hardware expectations

- **Rule-based mode** runs on anything that can run a Tauri app.
- **Ollama** (optional): 8 GB RAM minimum for 7B / 8B models; 16 GB+ recommended.
- **whisper.cpp**: `tiny.en` and `base.en` run on most laptops; `small.en` and `medium.en` benefit from 4+ physical CPU cores; `large-v3` benefits from 8+ cores or Apple Silicon.

### Approximate transcription speed (Apple Silicon, single recording)

| Model | RAM needed | Real-time factor |
| --- | --- | --- |
| `tiny.en` | ~1 GB | 10–20× faster than realtime |
| `base.en` | ~1 GB | 5–10× |
| `small.en` | ~2 GB | 2–4× |
| `medium.en` | ~5 GB | 1–2× |
| `large-v3` | ~10 GB | 0.5–1× |

## Testing

```bash
npm run check:all
```

Runs TypeScript, the Vitest suite (24 files / 277 tests), the analyzer self-tests, and the writing-regression suite. CI / pre-release gate.

## License

MIT — see [LICENSE](LICENSE).
