import { defineManifest } from '@crxjs/vite-plugin';

// MV3 manifest. Permissions are kept to the documented minimum (tech_defaults.md):
// tabCapture (audio), storage (settings + session metadata), activeTab (gentle,
// paired with user gestures). host_permissions are scoped to the three meeting
// platforms only — never <all_urls>. The Groq fetch host is requested at runtime
// via optional_host_permissions when the user first hits Summarise (Phase 4).
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
  permissions: ['tabCapture', 'storage', 'activeTab'],
  host_permissions: [
    '*://meet.google.com/*',
    '*://*.zoom.us/wc/*',
    '*://*.webex.com/*',
  ],
  optional_host_permissions: ['https://api.groq.com/*'],
});
