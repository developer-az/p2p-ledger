import { useEffect, useState } from 'react';
import { Pip } from './Pip.js';

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
        <Pip size={84} track={false} mood="happy" />
        <p className="app-preloader-copy">settle</p>
        <p className="app-preloader-sub">waking up the ledger…</p>
      </div>
    </div>
  );
}
