/// <reference types="vite/client" />
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Forward browser logs to the server terminal
if (import.meta.env.DEV) {
  const originalConsole = {
    log: console.log,
    error: console.error,
    warn: console.warn,
    info: console.info
  };

  let isSending = false;

  const forwardLog = (type: string, args: any[]) => {
    if (isSending) return;
    isSending = true;

    try {
      const processedArgs = args.map((arg) => {
        if (arg instanceof Error) {
          return `${arg.name}: ${arg.message}\n${arg.stack}`;
        }
        if (typeof arg === 'object') {
          try {
            return JSON.stringify(arg);
          } catch (e) {
            return String(arg);
          }
        }
        return String(arg);
      });

      fetch('/api/client-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, messages: processedArgs })
      })
        .catch(() => {})
        .finally(() => {
          isSending = false;
        });
    } catch (e) {
      isSending = false;
    }
  };

  console.log = (...args) => { originalConsole.log(...args); forwardLog('log', args); };
  console.error = (...args) => { originalConsole.error(...args); forwardLog('error', args); };
  console.warn = (...args) => { originalConsole.warn(...args); forwardLog('warn', args); };
  console.info = (...args) => { originalConsole.info(...args); forwardLog('info', args); };

  window.addEventListener('error', (e) => {
    forwardLog('error', [e.error?.message || e.message || 'Unknown window error']);
  });
  window.addEventListener('unhandledrejection', (e) => {
    forwardLog('error', ['Unhandled Rejection:', e.reason?.message || e.reason || 'Unknown rejection']);
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
