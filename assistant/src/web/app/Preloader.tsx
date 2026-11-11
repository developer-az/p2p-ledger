import { useEffect, useState } from 'react';
import { BrandMark } from './BrandMark.js';
import { useBootProgress } from './boot-progress.js';
import { LoadingSteps } from './LoadingSteps.js';

export function AppPreloader({ visible }: { visible: boolean }) {
  const { state, now } = useBootProgress();
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
    <div className={`app-preloader${exiting ? ' is-out' : ''}`}>
      <div className="app-preloader-inner">
        <div className="app-preloader-brand">
          <BrandMark size={32} />
          <p className="app-preloader-copy">Settle</p>
        </div>
        <LoadingSteps state={state} now={now} />
      </div>
    </div>
  );
}
