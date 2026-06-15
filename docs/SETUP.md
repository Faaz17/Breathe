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

`pnpm dev` runs Vite with HMR for the popup/options pages. Content scripts (Phase 1+)
need an extension reload after changes.

## Load the unpacked extension

1. Open `chrome://extensions` (Edge: `edge://extensions`).
2. Toggle **Developer mode** (top-right).
3. Click **Load unpacked** and pick **`extension/dist`**.
4. The Breathe icon (emerald square with a white dot) appears in the toolbar.
   Click it → the popup reads **"Hello Breathe"**.

### Reloading after changes

- **Popup / options:** rebuild (or `pnpm dev`), then reopen the popup.
- **Content script:** reload the extension card, then reload the meeting tab.
- **Service worker:** reload the extension card; the worker restarts.

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
