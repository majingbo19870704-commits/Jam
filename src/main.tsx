import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { router } from './app/router';
import { useThemeStore } from './stores/theme';
import { useBrandStore } from './stores/brand';
import { installRuntimeDiagnostics } from './lib/runtime-diagnostics';
import './themes/globals.css';

// 触发 theme store 的持久化 hydrate，把主题应用到 DOM
useThemeStore.getState();
useBrandStore.getState();
installRuntimeDiagnostics();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
