import { defineManifest } from '@crxjs/vite-plugin';

// MV3 manifest. Permissions are kept to the documented minimum (tech_defaults.md):
// tabCapture (audio), storage (settings + session metadata), activeTab (gentle,
// paired with user gestures), scripting (the service worker registers the content
// script at runtime). host_permissions are scoped to the three meeting platforms
// only — never <all_urls>. The Groq fetch host is requested at runtime via
// optional_host_permissions when the user first hits Summarise (Phase 4).
//
// The content script is NOT declared here. Meeting pages (Google Meet) enforce a
// `strict-dynamic` CSP that blocks crxjs's dynamic-import content-script loader, so
// the service worker injects a self-contained IIFE (built by vite.content.config.ts)
// as a classic content script via chrome.scripting — classic content scripts run in
// the isolated world, exempt from the page's CSP. See src/background/index.ts.
export default defineManifest({
  manifest_version: 3,
  name: 'Breathe',
  version: '0.0.0',
  description:
    'Privacy-first, local meeting notes. Captures tab audio, transcribes in-browser, summarises on demand.',
  icons: {
    16: 'icons/icon-16.png',
    32: 'icons/icon-32.png',
    48: 'icons/icon-48.png',
    128: 'icons/icon-128.png',
  },
  action: {
    default_title: 'Breathe',
    default_popup: 'src/popup/index.html',
    default_icon: {
      16: 'icons/icon-16.png',
      32: 'icons/icon-32.png',
      48: 'icons/icon-48.png',
      128: 'icons/icon-128.png',
    },
  },
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },
  permissions: ['tabCapture', 'storage', 'activeTab', 'scripting', 'offscreen'],
  host_permissions: [
    '*://meet.google.com/*',
    '*://*.zoom.us/wc/*',
    '*://*.webex.com/*',
  ],
  optional_host_permissions: ['https://api.groq.com/*'],
  // The offscreen document runs the local Whisper model. MV3 forbids anything but
  // 'self'/'wasm-unsafe-eval' in script-src, so: 'wasm-unsafe-eval' lets ONNX
  // Runtime compile its WebAssembly, the worker + wasm load from 'self' (bundled
  // same-origin assets), and connect-src allows the one-time model-weight download
  // from HuggingFace (cached thereafter). The same-origin module worker is covered
  // by the script-src 'self' fallback, so no worker-src/blob: is needed.
  //
  // HF model files redirect from huggingface.co to its Xet storage backend
  // (cas-bridge.xethub.hf.co). Both *.hf.co and the explicit *.xethub.hf.co are
  // listed so it matches regardless of how strictly Chrome treats wildcard depth.
  // *.huggingface.co keeps the older cdn-lfs hosts.
  content_security_policy: {
    extension_pages:
      "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; connect-src 'self' data: blob: https://huggingface.co https://*.huggingface.co https://*.hf.co https://*.xethub.hf.co;",
  },
});
