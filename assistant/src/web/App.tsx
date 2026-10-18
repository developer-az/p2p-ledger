import { lazy, Suspense } from 'react';
import { ConsumerApp } from './app/ConsumerApp.js';

// The engineering console keeps its own global stylesheet, so it only loads on /ops.
const OpsConsole = lazy(() => import('./OpsConsole.js'));

export function App() {
  const ops = window.location.pathname.replace(/\/+$/, '') === '/ops';
  if (!ops) return <ConsumerApp />;
  return (
    <Suspense fallback={<p style={{ padding: 24 }}>Loading console…</p>}>
      <OpsConsole />
    </Suspense>
  );
}
