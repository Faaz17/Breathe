import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { Welcome } from './Welcome';
import '../styles/global.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Breathe welcome: #root element not found');
}

createRoot(rootElement).render(
  <StrictMode>
    <Welcome />
  </StrictMode>,
);
