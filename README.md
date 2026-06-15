# Breathe

A free, privacy-first browser extension that takes notes from online meetings — Google Meet, Zoom Web, Webex Web.

It captures the meeting tab's audio, transcribes it in the browser using the Web Speech API, and (on demand) summarises the transcript via a free Groq API call into structured notes: Decisions, Action Items, Open Questions.

## Why Breathe

Meeting note-taking tools are everywhere — but most charge per seat, require a separate desktop app or bot to join the call, or upload your audio to an unknown server. Breathe is built around three rules:

1. **Free** — no paid APIs, no subscriptions. Groq's free tier handles summarisation.
2. **Local-first** — transcripts live in your browser's IndexedDB. Nothing leaves your machine unless you click *Summarise*.
3. **Default-off** — recording never starts automatically. One click per meeting, with a clear consent prompt for participants.

## Tech stack

- Chrome / Edge browser extension (Manifest V3)
- Vite + TypeScript + React 19 + Tailwind CSS v4
- `chrome.tabCapture` for audio
- Web Speech API for real-time transcription (Whisper.wasm as a future upgrade)
- Groq free tier (Llama 3.1 8B Instant) for summarisation
- IndexedDB via `idb` for storage

Full architecture and rationale lives in [.claude/CLAUDE.md](.claude/CLAUDE.md).

## Status

Phase 0 scaffold (`.claude/` workspace + folder tree). Extension source has not been written yet.

See [.claude/PROJECT_NOTES.md](.claude/PROJECT_NOTES.md) for the live snapshot.

## Folder map

```
Breathe/
├── extension/       Chrome extension source (Phase 0+)
├── docs/            SETUP, ARCHITECTURE, LEGAL
├── brand/           logo, palette, screenshots
└── .claude/         Claude Code workspace (rules + agents + project brain)
```

## Legal note

Recording online meetings is legal in the UAE (one-party consent) but requires all-party consent in California, Germany, and other jurisdictions. Breathe ships with a consent banner + a one-click "notify chat" disclosure message. See [docs/LEGAL.md](docs/LEGAL.md) (to be written in Phase 6).
