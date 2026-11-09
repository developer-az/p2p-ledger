import { useEffect, useState } from 'react';
import { Mascot } from './Mascot.js';

export function AppPreloader({ visible }: { visible: boolean }) {
  const [mounted, setMounted] = useState(visible);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      setExiting(false);
      return;
    }
    if (!mounted) return;
    setExiting(true);
    const id = window.setTimeout(() => setMounted(false), 440);
    return () => window.clearTimeout(id);
  }, [visible, mounted]);

  if (!mounted) return null;

  return (
    <div className={`app-preloader${exiting ? ' is-out' : ''}`} role="status" aria-live="polite" aria-label="Loading Settle">
      <div className="app-preloader-inner">
        <Mascot size={96} track={false} mood="happy" />
        <p className="app-preloader-copy">settle</p>
        <p className="app-preloader-sub">Getting your ledger ready…</p>
        <div className="app-preloader-bar" aria-hidden="true"><i /></div>
      </div>
    </div>
  );
}
