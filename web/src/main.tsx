import '@fontsource/commissioner/400.css';
import '@fontsource/commissioner/500.css';
import '@fontsource/commissioner/600.css';
import '@fontsource/literata/400.css';
import '@fontsource/literata/600.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/app.css';
import './styles/print.css';
import { App } from './ui/App';

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
