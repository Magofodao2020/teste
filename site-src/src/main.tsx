import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { store } from './state/store';
import { installSideGuard } from './ui/sideGuard';
import './ui/theme.css';

installSideGuard();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
void store.init();
