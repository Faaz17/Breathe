<div align="center">

# 🌬️ Breathe

**Free, privacy-first meeting notes, right in your browser.**

Breathe captures your meeting tab's audio, transcribes it **on your own machine** with a local Whisper model, and summarises the transcript into Decisions, Action Items, and Open Questions only when you ask, using your own free Groq API key.

Works with **Google Meet**, **Zoom** (web), and **Webex** (web) on **Chrome** and **Edge**.

</div>

---

## Why Breathe?

Most meeting-notes tools charge per seat, add a bot to your call, or upload your audio to someone else's server. Breathe is built on three rules:

- **🆓 Free.** No subscriptions, no paid APIs. Summaries use Groq's free tier with a key you provide.
- **🔒 Local-first.** Audio is transcribed inside your browser and never leaves your machine. Transcripts live in your browser's local database. The *only* time anything goes online is the one-time model download and the Summarise button (which you press).
- **⏹️ Default-off.** Nothing records until you click **Start**, once per meeting. A consent banner and one-click "notify chat" help you disclose to participants.

## Features

- 🎙️ **Live transcription** of the whole meeting, running locally (OpenAI Whisper via WebGPU, no cloud speech service).
- 🗣️ **Captures your voice too.** Meeting tab audio only hears *other* people, so Breathe optionally mixes in your microphone and automatically stops transcribing it the moment you mute yourself in the meeting.
- 🧠 **On-demand summaries** into Decisions / Action Items / Open Questions (Groq, your key).
- 💾 **Session history** with Markdown export.
- 🛡️ **Consent UX:** a per-meeting banner and a one-click disclosure message for the chat.
- ♿ Keyboard-navigable, screen-reader-friendly, respects reduced-motion.

---

## Install

Breathe isn't on the Chrome Web Store, so you load it as an unpacked extension. Two ways:

### Option A: Download the ready-made build (easiest)

1. Go to the [**Releases**](../../releases) page and download `breathe-extension-vX.Y.Z.zip` from the latest release.
2. **Unzip** it somewhere you'll keep it (don't delete the folder afterwards; Chrome loads the extension from it).
3. Open your browser's extensions page:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
4. Turn on **Developer mode** (top-right toggle).
5. Click **Load unpacked** and select the **unzipped folder** (the one containing `manifest.json`).
6. The Breathe icon (an emerald square) appears in your toolbar. 🎉

### Option B: Build from source

Requires [Node.js 20+](https://nodejs.org) and [pnpm](https://pnpm.io) (`npm i -g pnpm`).

```bash
git clone https://github.com/Faaz17/Breathe.git
cd Breathe/extension
pnpm install
pnpm build      # outputs to extension/dist
```

Then load **`extension/dist`** via **Load unpacked** (steps 3-6 above).

> **Heads up:** the first build downloads a few hundred MB of dependencies, and the first *recording* downloads the Whisper model (see below). Both are one-time.

---

## First run

1. **Join a meeting** in Google Meet, Zoom (web), or Webex (web).
   > If the Breathe side panel doesn't appear, **reload the meeting tab once**; the extension only injects into tabs opened *after* it was installed.
2. Click the **Breathe toolbar icon → Start recording**. (Recording must start from the toolbar; browsers block tab capture started from inside the page.)
3. **First time only:** Breathe downloads the transcription model. The default (**Whisper Small**, best accuracy) is a **~970 MB one-time download**, cached forever after. You can switch to the lighter **Whisper Base** (~290 MB) in Settings. A GPU is recommended; on machines without WebGPU, Breathe automatically uses the lighter model.
4. Watch the transcript build in the side panel. Everything is saved locally as you go.
5. Click **Stop**, then **Summarise** to generate notes.

### Getting summaries (optional, free)

Summaries need a free Groq API key:

1. Get one at [console.groq.com/keys](https://console.groq.com/keys) (sign in with Google/GitHub).
2. Right-click the Breathe icon → **Options** → paste the key → **Save** (approve the one-time permission prompt).

Without a key, transcription and history still work fully; you just won't get AI summaries.

### Your microphone (optional, on by default)

So your own words make it into the notes, Breathe mixes in your microphone (transcribed **locally**, never recorded or uploaded). It follows the meeting's mute button: mute yourself in Meet/Zoom/Webex and Breathe stops transcribing you (the panel shows `· mic muted`). You can turn mic capture off entirely in **Options**. The first time it's enabled, your browser asks for microphone permission on the Options page.

---

## Privacy

Breathe is local-first. There are exactly **two** times anything touches the network, and both are clearly attributable:

1. **One-time model download:** open-source Whisper weights from Hugging Face so transcription can run on your machine. No audio or transcript is sent.
2. **Summarise:** only when you click it (or opt into auto-summarise on stop), your transcript text is sent to Groq using *your* key to generate the summary.

Your audio, microphone, and transcripts never leave your browser otherwise. There's no analytics, telemetry, or tracking. Full details: [docs/LEGAL.md](docs/LEGAL.md).

### Permissions, and why

| Permission | Why |
|---|---|
| `tabCapture` | Capture the meeting tab's audio to transcribe it |
| `offscreen` | Run the local Whisper model + audio playback off the page |
| `storage` | Save your settings and session history locally |
| `scripting`, `activeTab` | Inject the side panel into meeting tabs |
| `alarms` | A watchdog that keeps recording alive through long meetings |
| Meeting sites only | Host access is limited to `meet.google.com`, `*.zoom.us/wc/*`, `*.webex.com`, and never all sites |
| `api.groq.com` | Requested **only** when you first save a Groq key, for summaries |

---

## ⚖️ A note on consent

Recording other people may require their consent depending on where you (and they) are; one-party consent applies in some places, all-party consent in others (e.g. California, much of the EU). Breathe shows a consent banner in every meeting and gives you a one-click button to post a disclosure to the chat. **You are responsible for obtaining any consent your local laws require.**

---

## Requirements

- **Chrome or Edge** (any recent Chromium browser). Firefox is not supported (different extension APIs).
- A **GPU with WebGPU** is recommended for the best transcription speed/accuracy; Breathe falls back to a lighter CPU model automatically.
- ~1 GB free disk for the model cache (or ~290 MB with the lighter model).

## Troubleshooting

- **No side panel in the meeting?** Reload the meeting tab (the extension injects into tabs opened after install). Make sure the extension is enabled on the extensions page.
- **"Start" does nothing / errors?** Start from the **toolbar icon**, not from inside the page; browsers block tab capture otherwise.
- **Transcription never starts / model won't load?** Check your internet for the one-time download; the panel shows a download percentage. On a machine without WebGPU it uses the smaller model automatically.
- **Summarise says "rejected" or asks for a key?** Add/refresh your Groq key in Options.
- **Something's stuck?** Open the extensions page → Breathe → **service worker** console and run `breatheDiag()` for a diagnostic log.

## Development

Local dev setup, the toolchain matrix, and the reload workflow are in [docs/SETUP.md](docs/SETUP.md).

```bash
cd extension
pnpm install
pnpm dev     # Vite HMR for popup/options; content scripts need a rebuild + reload
pnpm build   # production build → extension/dist
```

## License

[MIT](LICENSE) © Faaz Ali Sayyed. Free to use, modify, and share.
