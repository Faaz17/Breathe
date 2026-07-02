# Setup — Breathe

Local development for the Breathe browser extension (Chrome / Edge, MV3).

## Prerequisites

- **Node 20+** (developed on Node 24).
- **pnpm** (`npm i -g pnpm`).

## Install & build

```bash
cd extension
pnpm install        # first run approves esbuild's build script via pnpm-workspace.yaml
pnpm build          # type-checks (tsc -b) then bundles to extension/dist
```

`pnpm dev` runs Vite with HMR for the popup/options pages. The content script and
service worker need a rebuild (`pnpm build`) + extension reload after changes.

> **Note:** the build is two Vite passes — the content script is bundled as a
> self-contained classic IIFE and registered at runtime via `chrome.scripting`,
> because Google Meet's `strict-dynamic` CSP blocks the normal module loader.
> `pnpm dev` alone does not rebuild `content.js`; use `pnpm build` to test it.

## Load the unpacked extension

1. Open `chrome://extensions` (Edge: `edge://extensions`).
2. Toggle **Developer mode** (top-right).
3. Click **Load unpacked** and pick **`extension/dist`**.
4. The Breathe icon (emerald square) appears in the toolbar. Open a meeting tab
   (Google Meet / Zoom web / Webex web) and the side panel injects.

### Reloading after changes

- **Popup / options:** rebuild (or `pnpm dev`), then reopen the popup.
- **Content script:** reload the extension card, **then reload the meeting tab**
  (registration only injects into tabs opened after the reload).
- **Service worker:** reload the extension card; the worker restarts.

## First-run notes

- The first recording downloads the Whisper model (default **small.en**, ~970 MB;
  or **base.en**, ~290 MB, selectable in Options). Cached in the browser after.
- Summaries need a free Groq API key (Options → paste key from
  [console.groq.com/keys](https://console.groq.com/keys)).
- Diagnostics: the service-worker console has a `breatheDiag()` helper that dumps
  a ring buffer of recording lifecycle events.

## Toolchain (pinned, stable matrix)

| Tool | Version | Notes |
|---|---|---|
| Vite | ^7.3.5 | Stable line (not the new Vite 8 / Rolldown) |
| `@crxjs/vite-plugin` | ^2.6.1 | MV3 manifest generation + HMR |
| `@vitejs/plugin-react` | ^5.2.0 | React Fast Refresh |
| React | ^19.2 | |
| Tailwind CSS | ^4.3 | via `@tailwindcss/vite`; tokens in `src/styles/global.css` |
| TypeScript | ^5.9 | strict + `noUncheckedIndexedAccess` + `noImplicitOverride` |

## Icons

Toolbar icons are generated (no design tool needed):

```bash
pnpm icons    # writes public/icons/icon-{16,32,48,128}.png
```

Source: `scripts/gen-icons.mjs` (a from-scratch PNG encoder, no image-lib dependency).
