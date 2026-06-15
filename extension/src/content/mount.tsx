import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { PanelApp } from './ui/PanelApp';
import panelCss from './panel.css?inline';

const HOST_TAG = 'breathe-root';

export interface PanelHandle {
  unmount: () => void;
}

/**
 * Mounts the Breathe panel inside an isolated Shadow DOM so host-page CSS and
 * ours can't bleed into each other. Tailwind is injected as a constructable
 * stylesheet adopted by the shadow root.
 */
export function mountPanel(): PanelHandle {
  const host = document.createElement(HOST_TAG);
  const shadow = host.attachShadow({ mode: 'open' });

  const sheet = new CSSStyleSheet();
  sheet.replaceSync(panelCss);
  shadow.adoptedStyleSheets = [sheet];

  const container = document.createElement('div');
  shadow.appendChild(container);
  document.body.appendChild(host);

  const root: Root = createRoot(container);
  root.render(
    <StrictMode>
      <PanelApp />
    </StrictMode>,
  );

  return {
    unmount: () => {
      root.unmount();
      host.remove();
    },
  };
}
