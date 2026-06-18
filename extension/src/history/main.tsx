import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { History } from './History';
import '../styles/global.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Breathe history: #root element not found');
}

createRoot(rootElement).render(
  <StrictMode>
    <History />
  </StrictMode>,
);
