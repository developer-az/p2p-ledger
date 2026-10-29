import { lazy, Suspense } from 'react';
import { ConsumerApp } from './app/ConsumerApp.js';
import { ResetPassword } from './app/ResetPassword.js';

// The engineering console keeps its own global stylesheet, so it only loads on /ops.
const OpsConsole = lazy(() => import('./OpsConsole.js'));

export function App() {
  const path = window.location.pathname.replace(/\/+$/, '');
  if (path === '/reset-password') return <ResetPassword />;
  const ops = path === '/ops';
  if (!ops) return <ConsumerApp />;
  return (
    <Suspense fallback={<p style={{ padding: 24 }}>Loading console…</p>}>
      <OpsConsole />
    </Suspense>
  );
}
