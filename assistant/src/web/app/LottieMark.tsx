import { useEffect, useRef } from 'react';
import { LOTTIE } from './visual-assets.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'dotlottie-player': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          src?: string;
          autoplay?: boolean;
          loop?: boolean;
          background?: string;
        },
        HTMLElement
      >;
    }
  }
}

export function LottieMark({
  src = LOTTIE.savings,
  className,
  label = 'Animated illustration',
}: {
  src?: string;
  className?: string;
  label?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const mount = (): void => {
      const el = document.createElement('dotlottie-player');
      el.setAttribute('src', src);
      el.setAttribute('autoplay', '');
      el.setAttribute('loop', '');
      el.setAttribute('background', 'transparent');
      el.setAttribute('aria-label', label);
      if (className) el.className = className;
      host.replaceChildren(el);
    };
    if (customElements.get('dotlottie-player')) {
      mount();
      return;
    }
    const id = window.setInterval(() => {
      if (customElements.get('dotlottie-player')) {
        window.clearInterval(id);
        mount();
      }
    }, 40);
    return () => window.clearInterval(id);
  }, [src, className, label]);

  return <div ref={hostRef} className={className ? `${className}-host` : undefined} />;
}
