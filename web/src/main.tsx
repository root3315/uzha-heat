import '@fontsource-variable/martian-mono';
import '@fontsource-variable/onest';
import '@fontsource-variable/tektur/standard.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/app.css';
import './styles/page.css';
import './styles/print.css';
import { App } from './ui/App';

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
