import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router/dom';
import '@/app/globals.css';
import { createRouter } from './router';

// Created once, outside render: StrictMode double-invokes render in dev and would otherwise build two routers.
const router = createRouter();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
