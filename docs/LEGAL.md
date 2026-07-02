# Breathe — Privacy Policy

_Last updated: 2 July 2026_

Breathe is a browser extension that takes notes from online meetings (Google Meet,
Zoom on the web, Webex on the web). It is built privacy-first: your meeting audio and
transcripts stay on your machine, and the extension makes no outbound network request
except the ones described below — both of which you control.

## The short version

- **Recording is off by default.** Nothing is captured until you click **Start** for a
  specific meeting.
- **Audio never leaves your machine.** Tab audio — and your microphone, if you enable
  mic capture in settings — is captured and transcribed entirely inside your browser.
  Breathe does not record, store, or upload the audio.
- **Transcripts are stored locally only**, in your browser's IndexedDB. They are never
  sent to us — we don't run a server, and there is nothing for us to receive.
- **There is no analytics, telemetry, tracking, or advertising** of any kind.
- **You stay in control of deletion.** Notes auto-delete after a retention period you
  set (default 30 days), and you can delete any session manually at any time.

## What data Breathe handles

| Data | Where it lives | Leaves your machine? |
|---|---|---|
| Meeting tab audio | In memory while recording, then discarded | No — never stored or sent |
| Your microphone audio (optional, enabled in settings) | In memory while recording, then discarded | No — never stored or sent |
| Transcript text | Your browser's IndexedDB | No |
| Session metadata (title, platform, timestamps) | Your browser's IndexedDB | No |
| Summaries | Your browser's IndexedDB | Sent to Groq **only** when you click Summarise (see below) |
| Settings (incl. your Groq API key) | Your browser's local storage | No |

Breathe requests only the permissions it needs: capturing the meeting tab's audio,
local storage, access scoped to the three supported meeting domains, and — only if you
enable mic capture — access to your microphone, requested explicitly in Breathe's
settings and revocable at any time in Chrome's site settings. It never requests access
to your browsing across the web.

## The two times data touches the network

Breathe is local-first, but two operations involve the network. Both are clearly
attributable and, for summaries, explicitly initiated by you.

### 1. One-time transcription-model download

The first time you record, Breathe downloads an open-source speech-to-text model
(OpenAI Whisper, via Hugging Face) so it can transcribe **on your machine**. This is a
one-time download of model files from Hugging Face's servers, cached in your browser
afterwards. No audio or transcript is sent during this download — it only fetches the
model weights. After it's cached, transcription works fully offline.

### 2. Summarisation (only when you click Summarise)

Summaries are the **only** time your meeting content is sent off your machine, and only
when you press **Summarise** (or opt in to auto-summarise on stop). When you do, the
transcript text is sent to [Groq](https://groq.com)'s API using **your own** API key to
generate the summary, which is returned and stored locally.

- Breathe does not bundle or share an API key — you provide your own.
- Groq's handling of that request is governed by
  [Groq's privacy policy](https://groq.com/privacy-policy/) and terms.
- If you never click Summarise (and don't enable auto-summarise), no transcript content
  ever leaves your browser.

## Consent and disclosure

Recording other people may be subject to laws in your jurisdiction. Breathe shows a
notice in each meeting and provides a one-click **Notify chat** button that posts a
short disclosure to the meeting so participants are aware notes are being taken. You are
responsible for obtaining any consent your local laws require.

## Data retention and deletion

- Sessions older than your configured retention period (default 30 days) are deleted
  automatically when the extension starts.
- You can delete any individual session from the notes view at any time.
- Uninstalling the extension removes all locally stored data.

## Children

Breathe is not directed at children and does not knowingly process data from children.

## Changes to this policy

If this policy changes, the "Last updated" date above will change and the revised policy
will be published in this repository.

## Contact

Questions about privacy: **faazali1990@gmail.com**.
