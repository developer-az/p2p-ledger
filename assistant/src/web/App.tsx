import { lazy, Suspense } from 'react';
import { ConsumerApp } from './app/ConsumerApp.js';
import { ResetPassword } from './app/ResetPassword.js';
import { AccountAccess } from './app/AccountAccess.js';
import { Legal } from './app/Legal.js';
import { GoogleSignIn } from './app/GoogleSignIn.js';

// The engineering console keeps its own global stylesheet, so it only loads on /ops.
const OpsConsole = lazy(() => import('./OpsConsole.js'));

export function App() {
  const path = window.location.pathname.replace(/\/+$/, '');
  if (path === '/reset-password') return <ResetPassword />;
  if (path === '/account-access') return <AccountAccess />;
  if (path === '/google-signin') return <GoogleSignIn />;
  if (path === '/privacy' || path === '/terms') return <Legal page={path.slice(1) as 'privacy' | 'terms'} />;
  const ops = path === '/ops';
  if (!ops) return <ConsumerApp />;
  return (
    <Suspense fallback={<p style={{ padding: 24 }}>Loading console…</p>}>
      <OpsConsole />
    </Suspense>
  );
}
