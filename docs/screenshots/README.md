# Screenshots

Drop screenshot files here with these exact filenames so the main `README.md`
renders them automatically:

| Filename | What to capture |
| --- | --- |
| `01-home-daily.png` | Home page in Daily Mode — clean sidebar (8 items), Home tiles, no banners. |
| `02-new-ticket-recording.png` | New Ticket page mid-recording. Show the elapsed timer, audio level meter, and Live Conversation populating. |
| `03-live-conversation.png` | Live Conversation panel after a 1–2 minute call. Show Q→A turn-taking, the calibration chip, captured-detail chips. |
| `04-ticket-form-helper.png` | Ticket Form Helper with all fields populated. Show one field expanded with the Copy button. |
| `05-copy-mode.png` | Copy Mode walkthrough on the second or third field. |
| `06-settings-daily.png` | Settings page in Daily Mode — three tabs (Basic, Audio & Microphone, Transcription). |
| `07-settings-advanced.png` | Settings page in Advanced Mode — six tabs visible. |
| `08-history.png` | History page with a few saved tickets, search bar, audio-attached chip on at least one row. |

## How to capture cleanly

1. Resize the window to a sensible portfolio size — `1280 × 820` (the app's default) or `1440 × 900` if you have a larger display.
2. Switch to Daily Mode for the user-facing screenshots so the UI looks calm.
3. Use macOS `Cmd + Shift + 4`, drag the area, then drop the file in this folder with the filename above.
4. PNGs are preferred over JPGs. The README's `<img>` tags reference these paths directly.

## Optional: animated demo

If you want a GIF demo, capture with `Cmd + Shift + 5` → "Record Selected Portion", save as `.mov`, then convert with `ffmpeg`:

```bash
ffmpeg -i demo.mov -vf "fps=12,scale=1024:-1" -loop 0 docs/screenshots/00-demo.gif
```

The main README has a placeholder for `00-demo.gif` at the top of the "Demo" section.
