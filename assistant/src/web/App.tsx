import { lazy, Suspense } from 'react';
import { ConsumerApp } from './app/ConsumerApp.js';
import { ResetPassword } from './app/ResetPassword.js';
import { AccountAccess } from './app/AccountAccess.js';
import { Legal } from './app/Legal.js';
import { GoogleSignIn } from './app/GoogleSignIn.js';
import { useRoute } from './app/router.js';

// The engineering console keeps its own global stylesheet, so it only loads on /ops.
const OpsConsole = lazy(() => import('./OpsConsole.js'));

export function App() {
  const route = useRoute();
  switch (route.kind) {
    case 'reset-password':
      return <ResetPassword />;
    case 'account-access':
      return <AccountAccess />;
    case 'google-signin':
      return <GoogleSignIn />;
    case 'legal':
      return <Legal page={route.page} />;
    case 'ops':
      return (
        <Suspense fallback={<p style={{ padding: 24 }}>Loading console…</p>}>
          <OpsConsole />
        </Suspense>
      );
    case 'landing':
    case 'signin':
    case 'signup':
    case 'app':
      return <ConsumerApp />;
  }
}
