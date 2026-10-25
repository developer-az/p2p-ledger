import { useEffect, useState } from 'react';

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
    const id = window.setTimeout(() => setMounted(false), 520);
    return () => window.clearTimeout(id);
  }, [visible, mounted]);

  if (!mounted) return null;

  return (
    <div className={`app-preloader${exiting ? ' is-out' : ''}`} role="status" aria-live="polite" aria-label="Loading Settle">
      <div className="app-preloader-inner">
        <div className="app-preloader-mark" aria-hidden="true">S</div>
        <div className="app-preloader-punches" aria-hidden="true"><span /><span /><span /></div>
        <p className="app-preloader-copy">Opening your wallet…</p>
        <p className="app-preloader-sub">Two taps to stamp the day.</p>
      </div>
    </div>
  );
}
