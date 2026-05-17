export function HelpPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <header>
        <h1 className="page-title">Help & Setup Guide</h1>
        <p className="page-subtitle">
          Everything you need to use Store Ticket Assistant offline.
        </p>
      </header>

      <section className="card space-y-2 text-sm">
        <h2 className="text-base font-semibold">Workflow</h2>
        <ol className="list-decimal space-y-1 pl-5 text-slate-700 dark:text-slate-300">
          <li>Open <strong>Voice Ticket</strong>. Click Record or paste call notes.</li>
          <li>(Optional) Click Pause/Resume during the call. Click Stop when finished.</li>
          <li>Click <strong>Transcribe</strong> to run whisper.cpp locally.</li>
          <li>Edit the transcript on <strong>Transcript Review</strong> if anything looks off.</li>
          <li>Click <strong>Analyze Transcript</strong>.</li>
          <li>Land on <strong>Ticket Form Helper</strong>: edit fields and click Copy on each one.</li>
          <li>Paste each value into your ticket system. Click Save Ticket to keep a local copy.</li>
        </ol>
      </section>

      <section className="card space-y-2 text-sm">
        <h2 className="text-base font-semibold">What works locally</h2>
        <ul className="list-disc space-y-1 pl-5 text-slate-700 dark:text-slate-300">
          <li>Microphone recording with pause/resume.</li>
          <li>whisper.cpp local transcription (configure paths in Settings).</li>
          <li>Sharper rule-based extraction: caller name (Keyana, Randa), caller role (manager, store manager), register number, services restarted (COM/Pro/BOS), action flags (cache renamed, register power drain, manual reboot, cables reseated, connections confirmed), parts/replacement detection, existing-ticket detection.</li>
          <li>Transcription correction layer: number-words become digits ("register one" → Register 1), brand corrections ("calm services" → COM services, "very phone" → VeriFone, "in see go" → Inseego). Editable in Settings → Voice Accuracy &amp; Corrections.</li>
          <li>Optional Ollama integration for sharper extraction (with rule-based fallback).</li>
          <li>Two-step pipeline: structured JSON extraction → ticket field generation. Original transcript and original summary are preserved at all times.</li>
          <li>Eight summary versions: Original Transcript / Cleaned Transcript / Original Summary / Short / Normal / Detailed / Technical / Management.</li>
          <li>Auto-generated Part Request when replacement is needed.</li>
          <li>Captured-detail chips and graceful missing-info warnings.</li>
          <li>Suggested questions for the next call, tailored to the issue type.</li>
          <li>Configurable writing style: tone, opener style, resolution style, voice, custom instructions.</li>
          <li>Per-field copy buttons for every ManageEngine-style ticket field.</li>
          <li>Local history with JSON/CSV export (includes part request).</li>
        </ul>
      </section>

      <section className="card space-y-2 text-sm">
        <h2 className="text-base font-semibold">Writing Style</h2>
        <p>
          Settings → Writing Style controls how the assistant writes the description and
          resolution. You can choose the tone (Simple, Professional, Technical, Manager-Friendly,
          Custom), the opener style ("Store called about…", "Store reported…", "Store contacted
          support regarding…", first-person), the resolution style (concise vs detailed), and the
          voice (active first-person vs passive). Add freeform instructions in the Custom
          instructions box; they are passed to the local AI when generating notes.
        </p>
      </section>

      <section className="card space-y-2 text-sm">
        <h2 className="text-base font-semibold">Part Requests</h2>
        <p>
          When the transcript mentions replacement, "send a new", "ticket will be opened to
          replace", or hardware-failure persistence, the assistant flags <code>partNeeded</code>{" "}
          and generates a copyable Part Request. The Part Request card appears on the Ticket Form
          Helper with its own Copy and Regenerate buttons. If the device or store is unclear, the
          warning system tells you what to confirm before submitting.
        </p>
      </section>

      <section className="card space-y-2 text-sm">
        <h2 className="text-base font-semibold">Configuring whisper.cpp</h2>
        <ol className="list-decimal space-y-1 pl-5 text-slate-700 dark:text-slate-300">
          <li>
            Install whisper.cpp:{" "}
            <code>brew install whisper-cpp</code> on macOS, or build from source.
          </li>
          <li>
            Download a model (e.g. <code>ggml-base.en.bin</code>) from the whisper.cpp releases.
          </li>
          <li>
            In <strong>Settings → Local Transcription</strong>, set the executable path
            (e.g. <code>/usr/local/bin/whisper-cli</code>) and the model path. Click{" "}
            <strong>Test Whisper</strong>.
          </li>
        </ol>
      </section>

      <section className="card space-y-2 text-sm">
        <h2 className="text-base font-semibold">Optional: local AI with Ollama</h2>
        <ol className="list-decimal space-y-1 pl-5 text-slate-700 dark:text-slate-300">
          <li>Install Ollama and run <code>ollama serve</code>.</li>
          <li>Pull a model: <code>ollama pull llama3.1:8b</code>.</li>
          <li>
            In <strong>Settings → Local AI</strong>, switch provider to Ollama and click{" "}
            <strong>Test Connection</strong>.
          </li>
          <li>
            Keep <em>Fall back to rule-based</em> on so the app stays usable if Ollama is offline.
          </li>
        </ol>
      </section>

      <section className="card space-y-2 text-sm">
        <h2 className="text-base font-semibold">Privacy</h2>
        <p>
          The app makes no cloud calls. All transcripts, audio, extracted details, summaries, and
          saved tickets live on this machine only. Use Settings → Privacy to clear history or
          tighten the local-only lock.
        </p>
      </section>

      <section className="card space-y-2 text-sm">
        <h2 className="text-base font-semibold">Speaker detection &amp; corrections</h2>
        <p>
          On the Transcript Review page, expand <strong>Speakers</strong> to see segments
          labeled <em>Tech Support</em>, <em>Store Employee</em>, or <em>Unknown</em>. Use the
          dropdown on each segment to correct any wrong label. Click <strong>Re-run
          Extraction with Speaker Corrections</strong> to re-analyze with the corrections
          applied. The store-employee voice is treated as the source of facts (store #, error,
          register #), and tech-support voice is treated as the source of troubleshooting
          steps.
        </p>
      </section>

      <section className="card space-y-2 text-sm">
        <h2 className="text-base font-semibold">Self-review &amp; confidence</h2>
        <p>
          The Ticket Form Helper shows a self-review banner with overall confidence and
          per-field scores (high / review recommended / low / missing). Flags include
          things like "store number not found in transcript" or "step attributed to the
          store employee — confirm." Click <strong>Re-run Self-Review</strong> after edits.
        </p>
      </section>

      <section className="card space-y-2 text-sm">
        <h2 className="text-base font-semibold">LM Studio</h2>
        <p>
          LM Studio works just like Ollama: install LM Studio, load a model, start the
          local server (default <code>http://localhost:1234/v1</code>), then in
          <strong> Settings → AI Provider</strong> pick <em>LM Studio</em> and click
          <strong> Test LM Studio Connection</strong>. The same fallback to rule-based mode
          applies if the server is unavailable.
        </p>
      </section>

      <section className="card space-y-2 text-sm">
        <h2 className="text-base font-semibold">Style Examples</h2>
        <p>
          On <strong>Style Examples</strong>, save 3–5 ideal tickets in your phrasing. When
          generating, the assistant picks up to two of the most relevant examples (by
          keyword overlap) and includes them in the prompt. Use <strong>Save Current
          Ticket as Style Example</strong> to capture a freshly-edited ticket as a template.
        </p>
      </section>

      <section className="card space-y-2 text-sm">
        <h2 className="text-base font-semibold">Reminders</h2>
        <p>
          Use <strong>Reminders</strong> for follow-ups: store callbacks, ATT line checks,
          replacement-arrival confirmations. Click <strong>Create Follow-up from Current
          Ticket</strong> to seed a reminder with the current store + issue. Reminders stay
          on this machine.
        </p>
      </section>

      <section className="card space-y-2 text-sm">
        <h2 className="text-base font-semibold">Ticket Intelligence</h2>
        <p>
          <strong>Intelligence</strong> aggregates your saved ticket history into top
          categories, stores, devices, resolutions, and most-requested parts. After ~10–20
          saved tickets, it also offers <em>Suggested Solutions Based on Past Tickets</em>
          for the current call.
        </p>
      </section>

      <section className="card space-y-2 text-sm">
        <h2 className="text-base font-semibold">Run Extraction Self-Tests</h2>
        <p>
          On <strong>System Check</strong>, click <strong>Run Self-Tests</strong> to run the
          11 canonical transcripts through the analyzer and ticket builder. The summary
          shows pass/fail per transcript and per field — use this any time you tune the
          extractor.
        </p>
      </section>

      <section className="card space-y-2 text-sm">
        <h2 className="text-base font-semibold">Keyboard shortcuts</h2>
        <ul className="space-y-1.5 text-slate-700 dark:text-slate-300">
          <li className="flex items-center gap-3"><span className="inline-flex gap-1"><kbd>Cmd</kbd>/<kbd>Ctrl</kbd>+<kbd>R</kbd></span> Start or stop recording</li>
          <li className="flex items-center gap-3"><span className="inline-flex gap-1"><kbd>Cmd</kbd>/<kbd>Ctrl</kbd>+<kbd>Enter</kbd></span> Analyze transcript</li>
          <li className="flex items-center gap-3"><span className="inline-flex gap-1"><kbd>Cmd</kbd>/<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>C</kbd></span> Copy full ticket</li>
          <li className="flex items-center gap-3"><span className="inline-flex gap-1"><kbd>Cmd</kbd>/<kbd>Ctrl</kbd>+<kbd>S</kbd></span> Save ticket</li>
          <li className="flex items-center gap-3"><span className="inline-flex gap-1"><kbd>Cmd</kbd>/<kbd>Ctrl</kbd>+<kbd>N</kbd></span> New ticket</li>
          <li className="flex items-center gap-3"><span className="inline-flex gap-1"><kbd>Cmd</kbd>/<kbd>Ctrl</kbd>+<kbd>B</kbd></span> Back to previous step</li>
          <li className="flex items-center gap-3"><span className="inline-flex gap-1"><kbd>Esc</kbd></span> Cancel current modal/action</li>
        </ul>
        <p className="text-xs text-slate-500">
          Shortcuts are suppressed while typing in inputs and textareas (except <kbd>Esc</kbd>).
        </p>
      </section>

      <section className="card space-y-2 text-sm">
        <h2 className="text-base font-semibold">Recording a call</h2>
        <ol className="list-decimal space-y-1 pl-5 text-slate-700 dark:text-slate-300">
          <li>Open <strong>New Ticket</strong>.</li>
          <li>Click <strong>Record</strong>. The Audio Status card flips from <em>No recording</em> to <em>Recording</em>.</li>
          <li>(Optional) Click <strong>Pause</strong> / <strong>Resume</strong> as the call goes.</li>
          <li>Click <strong>Stop</strong>. The recording auto-encodes and is saved to disk in the desktop app.</li>
          <li>Click <strong>Transcribe</strong> to run whisper.cpp on the recording.</li>
        </ol>
      </section>

      <section className="card space-y-2 text-sm">
        <h2 className="text-base font-semibold">Attaching audio to a ticket</h2>
        <p className="text-slate-700 dark:text-slate-300">
          When you Save a ticket, any fresh recording auto-attaches via the
          SQLite <code>audio_files</code> table. The Audio Status card flips
          to <em>Attached</em>. If you try to Save without an attached
          recording, the app prompts you to choose: <em>Save and Attach
          Recording</em>, <em>Save Without Recording</em>, or <em>Cancel</em>.
        </p>
        <p className="text-slate-700 dark:text-slate-300">
          To attach an existing file from disk (a recording made elsewhere,
          for example), click <strong>Attach Existing Recording</strong>{" "}
          on the Audio Status card. Supported formats: WAV, MP3, M4A, WEBM,
          OGG. The original file is copied (not moved) into the app's audio
          folder, so the source file stays intact.
        </p>
      </section>

      <section className="card space-y-2 text-sm">
        <h2 className="text-base font-semibold">Re-transcribing</h2>
        <p className="text-slate-700 dark:text-slate-300">
          Click <strong>Re-transcribe</strong> on the Audio Status card to
          run whisper.cpp again against the attached recording. A new
          <code> TranscriptVersion</code> is appended; previous versions are
          never overwritten. Use the version selector on the Transcript
          Review page to flip between versions.
        </p>
      </section>

      <section className="card space-y-2 text-sm">
        <h2 className="text-base font-semibold">Copy Mode</h2>
        <p className="text-slate-700 dark:text-slate-300">
          On the <strong>Ticket Form Helper</strong> page, each field has its
          own Copy button. Once you copy a field, it's marked as completed
          and the next one is highlighted, so you can move down the list
          without losing your place. Settings → Copy Mode tunes the order of
          fields and the highlight behavior.
        </p>
      </section>

      <section className="card space-y-2 text-sm">
        <h2 className="text-base font-semibold">Running self-tests</h2>
        <p className="text-slate-700 dark:text-slate-300">
          Open <strong>System Health</strong> and click <strong>Run
          Extraction Self-Tests</strong> to run the canonical transcripts
          through the analyzer. Click <strong>Run Writing Tests</strong> to
          run the writing-layer self-checks. Both report pass/fail counts in
          a banner and an expandable details panel.
        </p>
      </section>

      <section className="card space-y-2 text-sm">
        <h2 className="text-base font-semibold">Backing up your data</h2>
        <ol className="list-decimal space-y-1 pl-5 text-slate-700 dark:text-slate-300">
          <li>Open <strong>System Health</strong>.</li>
          <li>
            Click <strong>Export Full Backup</strong>. A native save dialog
            opens; pick a destination (USB drive, sibling folder, etc.).
          </li>
          <li>
            (Optional) <strong>Export Backup + Audio</strong> writes a sibling
            <code>/audio</code> folder next to the JSON containing the active
            WAV files. Skip this if you only need ticket data.
          </li>
          <li>
            <strong>Export Settings</strong> writes a separate, smaller file
            with just configuration — useful for syncing settings across
            machines.
          </li>
        </ol>
        <p className="text-slate-700 dark:text-slate-300">
          Backups include: tickets, audio metadata, reminders, knowledge,
          style examples, extraction patterns, and settings. Audio file
          bytes are only included when you choose <em>Export Backup + Audio</em>.
        </p>
      </section>

      <section className="card space-y-2 text-sm">
        <h2 className="text-base font-semibold">Restoring from a backup</h2>
        <ol className="list-decimal space-y-1 pl-5 text-slate-700 dark:text-slate-300">
          <li>Open <strong>System Health</strong>.</li>
          <li>Click <strong>Import / Restore Backup</strong>.</li>
          <li>Pick the backup JSON file.</li>
          <li>
            Review the preview — number of tickets, reminders, etc. — and
            choose <strong>Merge</strong> (keep existing rows, add new) or{" "}
            <strong>Replace</strong> (clear and reload).
          </li>
          <li>
            A pre-restore safety backup is written automatically next to the
            file you imported, so you can roll back if something looks wrong.
          </li>
        </ol>
      </section>

      <section className="card space-y-2 text-sm">
        <h2 className="text-base font-semibold">Moving to another computer</h2>
        <ol className="list-decimal space-y-1 pl-5 text-slate-700 dark:text-slate-300">
          <li>
            On the <em>source</em>: System Health → <strong>Export Backup +
            Audio</strong>. Save to a USB drive.
          </li>
          <li>Install Store Ticket Assistant on the destination machine.</li>
          <li>
            On the <em>destination</em>: System Health → <strong>Import /
            Restore Backup</strong>. Pick the backup file from the USB drive
            and choose <strong>Replace</strong>.
          </li>
          <li>
            Re-set whisper.cpp + AI provider paths in Settings if they live
            in different locations on the new machine.
          </li>
        </ol>
      </section>

      <section className="card space-y-2 text-sm">
        <h2 className="text-base font-semibold">What is stored locally</h2>
        <p className="text-slate-700 dark:text-slate-300">
          Every ticket, transcript, audio recording, extracted detail,
          reminder, knowledge item, style example, and setting lives on this
          machine. There are no cloud syncs and no telemetry. Data lives
          under your OS app-data folder for Store Ticket Assistant
          (<code>~/Library/Application Support</code> on macOS,{" "}
          <code>%APPDATA%</code> on Windows). System Health shows the exact
          paths under <em>Portable Setup</em>.
        </p>
      </section>

      <section className="card space-y-2 text-sm">
        <h2 className="text-base font-semibold">What requires whisper.cpp</h2>
        <p className="text-slate-700 dark:text-slate-300">
          Local transcription of recorded audio requires whisper.cpp to be
          installed and configured under Settings → Local Transcription.
          Pasted-in transcripts, live transcripts already produced elsewhere,
          and rule-based extraction all work without whisper.cpp.
        </p>
      </section>

      <section className="card space-y-2 text-sm">
        <h2 className="text-base font-semibold">What requires Ollama or LM Studio</h2>
        <p className="text-slate-700 dark:text-slate-300">
          AI-assisted extraction and ticket writing only run when an AI
          provider is selected in Settings → AI Provider <em>and</em>
          reachable. With the default <em>rule-based</em> provider, every
          analysis still works — the rules cover the canonical transcripts
          and the regression suite. AI providers are an upgrade, not a
          requirement.
        </p>
      </section>

      <section className="card space-y-2 text-sm">
        <h2 className="text-base font-semibold">How to build the macOS app</h2>
        <h3 className="text-sm font-semibold">Prerequisites</h3>
        <ul className="list-disc space-y-1 pl-5 text-slate-700 dark:text-slate-300">
          <li>macOS 11+ (Big Sur or later).</li>
          <li>
            Xcode Command Line Tools:{" "}
            <code>xcode-select --install</code>
          </li>
          <li>Node.js 18 or later.</li>
          <li>
            Rust toolchain (Tauri auto-detects):{" "}
            <code>curl https://sh.rustup.rs -sSf | sh</code>
          </li>
        </ul>

        <h3 className="text-sm font-semibold">Development run</h3>
        <pre className="rounded bg-slate-100 p-2 text-xs leading-relaxed dark:bg-slate-900">
{`npm install
npm run tauri:dev`}
        </pre>

        <h3 className="text-sm font-semibold">Production build</h3>
        <pre className="rounded bg-slate-100 p-2 text-xs leading-relaxed dark:bg-slate-900">
{`npm install
npm run tauri:build      # or: npm run build:app`}
        </pre>
        <p className="text-slate-700 dark:text-slate-300">
          Verified output on Apple silicon (aarch64):
        </p>
        <ul className="list-disc space-y-1 pl-5 text-slate-700 dark:text-slate-300">
          <li>
            <code>src-tauri/target/release/bundle/macos/Store Ticket Assistant.app</code>{" "}
            (~20 MB)
          </li>
          <li>
            <code>
              src-tauri/target/release/bundle/dmg/Store Ticket Assistant_0.1.0_aarch64.dmg
            </code>{" "}
            (~8 MB)
          </li>
        </ul>
        <p className="text-slate-700 dark:text-slate-300">
          On Intel Macs the dmg filename ends in <code>_x86_64</code>{" "}
          instead. First clean build on a fresh machine takes ~3 minutes
          (Rust release compile).
        </p>

        <h3 className="text-sm font-semibold">How to open the built app</h3>
        <p className="text-slate-700 dark:text-slate-300">
          Open the <code>.dmg</code>, drag the <code>.app</code> into{" "}
          <code>/Applications</code>, and launch it from Spotlight or
          Launchpad. Or, double-click the <code>.app</code> directly out of
          the bundle folder.
        </p>

        <h3 className="text-sm font-semibold">If macOS blocks an unsigned app</h3>
        <p className="text-slate-700 dark:text-slate-300">
          This build is not signed with an Apple Developer ID, so macOS
          Gatekeeper will refuse it by default. To open it anyway:
        </p>
        <ol className="list-decimal space-y-1 pl-5 text-slate-700 dark:text-slate-300">
          <li>
            Right-click <strong>Store Ticket Assistant.app</strong> →{" "}
            <strong>Open</strong>. Gatekeeper shows a warning with an{" "}
            <strong>Open</strong> button.
          </li>
          <li>
            Or run from Terminal:{" "}
            <code>xattr -dr com.apple.quarantine "/Applications/Store Ticket Assistant.app"</code>
          </li>
          <li>
            Or: System Settings → Privacy &amp; Security → scroll to "Store
            Ticket Assistant was blocked" → <strong>Open Anyway</strong>.
          </li>
        </ol>

        <h3 className="text-sm font-semibold">Keeping data safe before updating</h3>
        <p className="text-slate-700 dark:text-slate-300">
          The new build installs alongside or on top of your old one but
          your data folder is <em>not</em> touched. Even so:
        </p>
        <ol className="list-decimal space-y-1 pl-5 text-slate-700 dark:text-slate-300">
          <li>
            Open System Health → <strong>Export Backup + Audio</strong>{" "}
            before installing the update.
          </li>
          <li>Click <strong>Verify Backup</strong> against the file you just exported.</li>
          <li>Close the running app.</li>
          <li>Drag the new <code>.app</code> into <code>/Applications</code>.</li>
          <li>Open the new build, run System Health, confirm ticket / audio counts match.</li>
        </ol>
      </section>

      <section className="card space-y-2 text-sm">
        <h2 className="text-base font-semibold">How to build the Windows app</h2>
        <p className="text-slate-700 dark:text-slate-300 font-semibold">
          Build Windows on Windows. Cross-build from macOS to Windows is not
          a supported Tauri 2 workflow — the installer toolchain (WiX / MSI)
          requires native Windows tools.
        </p>
        <h3 className="text-sm font-semibold">On a Windows 10/11 machine</h3>
        <ol className="list-decimal space-y-1 pl-5 text-slate-700 dark:text-slate-300">
          <li>
            Install Node.js 18+ from{" "}
            <code>nodejs.org</code> (LTS recommended).
          </li>
          <li>
            Install the Rust toolchain via{" "}
            <code>rustup-init.exe</code> from <code>rustup.rs</code>.
          </li>
          <li>
            Install Tauri prerequisites: Microsoft C++ Build Tools (via
            Visual Studio Installer → "Desktop development with C++"), and
            WebView2 (already on Windows 11; on Windows 10 install from
            Microsoft's Edge WebView2 page).
          </li>
          <li>
            Copy the project folder onto the Windows machine (USB, git
            clone, or zip).
          </li>
          <li>
            From a terminal in the project folder:
            <pre className="mt-1 rounded bg-slate-100 p-2 text-xs leading-relaxed dark:bg-slate-900">
{`npm install
npm run tauri:build`}
            </pre>
          </li>
          <li>
            Bundle output:{" "}
            <code>src-tauri\target\release\bundle\msi\&lt;app&gt;.msi</code>{" "}
            and the bare <code>.exe</code> alongside it.
          </li>
        </ol>
        <p className="text-slate-700 dark:text-slate-300">
          The CI alternative is a GitHub Actions runner with{" "}
          <code>windows-latest</code>; the same{" "}
          <code>npm run tauri:build</code> command works there.
        </p>
      </section>

      <section className="card space-y-2 text-sm">
        <h2 className="text-base font-semibold">Portable / External SSD setup</h2>
        <p className="text-slate-700 dark:text-slate-300">
          The cleanest way to use the app across multiple machines (or as a
          recovery kit on a flash drive) is to ship the installer alongside
          your data backup. The app itself is not designed to run from an
          external drive — but its data can be shuttled safely.
        </p>

        <h3 className="text-sm font-semibold">What to put on the flash drive / external SSD</h3>
        <ul className="list-disc space-y-1 pl-5 text-slate-700 dark:text-slate-300">
          <li>The built app for the destination OS — <code>.dmg</code> on macOS, <code>.msi</code> on Windows.</li>
          <li>
            The full backup JSON (and the sibling <code>/audio</code>{" "}
            folder if you used <em>Export Backup + Audio</em>).
          </li>
          <li>The whisper.cpp executable + <code>.ggml</code> model.</li>
          <li>The Portable Mode Checklist Markdown.</li>
          <li>The Portable Instructions Markdown (richer — includes paths + restore steps).</li>
        </ul>

        <h3 className="text-sm font-semibold">Generating the Portable Instructions Markdown</h3>
        <p className="text-slate-700 dark:text-slate-300">
          On System Health → Release Build section, click{" "}
          <strong>Export Portable Instructions</strong>. The file you save
          embeds: the current source-machine paths, where the destination
          machine will keep data, the restore walk-through, and the
          checklist.
        </p>

        <h3 className="text-sm font-semibold">Where data lives on each OS</h3>
        <ul className="list-disc space-y-1 pl-5 text-slate-700 dark:text-slate-300">
          <li>
            macOS:{" "}
            <code>~/Library/Application Support/store-ticket-assistant</code>
          </li>
          <li>
            Windows:{" "}
            <code>%APPDATA%\store-ticket-assistant</code>
          </li>
          <li>
            Linux:{" "}
            <code>~/.local/share/store-ticket-assistant</code>
          </li>
        </ul>

        <h3 className="text-sm font-semibold">How to restore on another computer</h3>
        <ol className="list-decimal space-y-1 pl-5 text-slate-700 dark:text-slate-300">
          <li>Install the app from the bundled installer.</li>
          <li>Launch once and complete (or skip) the first-run setup wizard.</li>
          <li>
            System Health → <strong>Verify Backup</strong>, pick the backup
            JSON from the flash drive.
          </li>
          <li>
            If Verify says "valid", System Health →{" "}
            <strong>Import / Restore Backup</strong>, pick the same file,
            choose <em>Replace current data</em> on a clean install.
          </li>
          <li>
            Re-set whisper.cpp paths in Settings to match where whisper
            lives on the new machine.
          </li>
          <li>
            System Health → <strong>Run Health Check</strong> — confirm
            counts match what the backup advertised.
          </li>
          <li>
            System Health → Portable Setup →{" "}
            <strong>Verify Portable Setup</strong>. Every checklist item
            should be green before you rely on the install.
          </li>
        </ol>
      </section>

      <section className="card space-y-2 text-sm">
        <h2 className="text-base font-semibold">Upgrade / migration safety</h2>
        <p className="text-amber-700 dark:text-amber-300">
          <strong>Do not delete the Application Support data folder unless
          you have a verified backup.</strong> Removing it on the source
          machine before a successful restore on the destination loses
          tickets, audio metadata, knowledge items, and settings
          irrecoverably.
        </p>
        <h3 className="text-sm font-semibold">Before installing a new build</h3>
        <ol className="list-decimal space-y-1 pl-5 text-slate-700 dark:text-slate-300">
          <li>System Health → <strong>Export Backup + Audio</strong>.</li>
          <li>System Health → <strong>Verify Backup</strong> against the file you just exported.</li>
          <li>Close the app.</li>
          <li>Install / open the new build.</li>
          <li>System Health → <strong>Run Health Check</strong>.</li>
          <li>
            Confirm <strong>ticket count</strong> matches the backup's
            count (visible on the Verify Backup panel).
          </li>
          <li>
            Confirm <strong>audio count</strong> matches: open
            <strong> Repair Audio Records</strong> and check the active-row
            count.
          </li>
          <li>
            (Optional) Run the <strong>Smoke Test</strong> if anything
            looks off.
          </li>
        </ol>
      </section>

      <section className="card space-y-2 text-sm">
        <h2 className="text-base font-semibold">npm scripts cheatsheet</h2>
        <ul className="list-disc space-y-1 pl-5 text-slate-700 dark:text-slate-300">
          <li>
            <code>npm run tauri:dev</code> — live desktop dev server.
          </li>
          <li>
            <code>npm run tauri:build</code> / <code>npm run build:app</code> — production bundle.
          </li>
          <li>
            <code>npm run check:all</code> /{" "}
            <code>npm run test:all</code> — tsc + vitest + analyzer +
            self-tests in sequence. A green run is the prerequisite for a
            release build.
          </li>
          <li>
            <code>npm run build</code> — Vite-only web bundle (used by
            <code>tauri:build</code>; rarely useful on its own).
          </li>
        </ul>
      </section>

      <section className="card space-y-2 text-sm">
        <h2 className="text-base font-semibold">Roadmap</h2>
        <ul className="list-disc space-y-1 pl-5 text-slate-700 dark:text-slate-300">
          <li>Real-time analysis while recording (streaming whisper).</li>
          <li>Full-text search across saved transcripts.</li>
          <li>Auto-link orphaned recordings to a draft ticket on launch.</li>
        </ul>
      </section>

      <section className="card space-y-2 text-sm">
        <h2 className="text-base font-semibold">Workplace recording reminder</h2>
        <p>
          Only record calls if you have permission from your company and follow all applicable
          laws and workplace policies.
        </p>
      </section>
    </div>
  );
}
