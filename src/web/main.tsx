import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ApiProvider, createHttpApiClient } from './api/client';
import { App } from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ApiProvider client={createHttpApiClient()}>
      <App />
    </ApiProvider>
  </StrictMode>,
);
