import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { Popup } from './Popup';
import '../styles/global.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Breathe popup: #root element not found');
}

createRoot(rootElement).render(
  <StrictMode>
    <Popup />
  </StrictMode>,
);
