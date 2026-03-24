import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import { Toaster } from './components/ui/sonner';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
    <Toaster
      position="top-right"
      toastOptions={{
        style: {
          background: '#FFFFFF',
          border: '1px solid #E8E8E8',
          color: '#333333',
          boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
        },
      }}
    />
  </React.StrictMode>
);
