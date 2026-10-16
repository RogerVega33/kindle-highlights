import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { PwaProvider } from './pwa/PwaProvider';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PwaProvider><App /></PwaProvider>
  </React.StrictMode>,
);
