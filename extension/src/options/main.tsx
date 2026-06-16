import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { Options } from './Options';
import '../styles/global.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Breathe options: #root element not found');
}

createRoot(rootElement).render(
  <StrictMode>
    <Options />
  </StrictMode>,
);
