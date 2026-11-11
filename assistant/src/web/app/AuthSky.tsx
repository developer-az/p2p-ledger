import { forwardRef, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Mascot } from './Mascot.js';
import { StarSky } from './StarSky.js';

/**
 * The sign-in and create-account scene: a printed star atlas behind the card,
 * with Settle floating beside the form.
 *
 * Settle follows the form: it reads along the field you are typing in, covers
 * its eyes while you type a password, and peeks if you choose to show it.
 * Everything here is decoration around `children` (the form), so the form
 * keeps its own logic and labels.
 */

export const AuthSky = forwardRef<HTMLElement, { id?: string; labelledBy: string; children: ReactNode }>(
  function AuthSky({ id, labelledBy, children }, ref) {
    const formRef = useRef<HTMLDivElement>(null);
    const [lookAt, setLookAt] = useState<{ x: number; y: number } | null>(null);
    const [shy, setShy] = useState(false);
    const [peek, setPeek] = useState(false);
    const [cheer, setCheer] = useState(0);

    // Where the caret is in the field being typed in: the field's left edge
    // plus roughly one character width per character, clamped to the field.
    const follow = useCallback(() => {
      const el = document.activeElement;
      if (!(el instanceof HTMLInputElement) || !formRef.current?.contains(el)) {
        setLookAt(null);
        setShy(false);
        setPeek(false);
        return;
      }
      const box = el.getBoundingClientRect();
      const chars = el.value.length;
      const x = Math.min(box.right - 12, box.left + 14 + chars * 8.4);
      setLookAt({ x, y: box.top + box.height / 2 });
      const isPassword = /password/.test(el.autocomplete) || el.dataset.secret === 'true';
      setShy(isPassword);
      setPeek(isPassword && el.type === 'text');
    }, []);

    useEffect(() => {
      const root = formRef.current;
      if (!root) return undefined;
      const onFocusOut = () => window.setTimeout(follow, 0);
      // A finished, valid email earns a small hop.
      const onInput = (e: Event) => {
        follow();
        const t = e.target as HTMLInputElement;
        if (t.type === 'email' && /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(t.value) && !t.dataset.cheered) {
          t.dataset.cheered = 'true';
          setCheer(Date.now());
        }
      };
      root.addEventListener('focusin', follow);
      root.addEventListener('focusout', onFocusOut);
      root.addEventListener('input', onInput);
      root.addEventListener('click', follow);
      window.addEventListener('resize', follow);
      return () => {
        root.removeEventListener('focusin', follow);
        root.removeEventListener('focusout', onFocusOut);
        root.removeEventListener('input', onInput);
        root.removeEventListener('click', follow);
        window.removeEventListener('resize', follow);
      };
    }, [follow]);

    return (
      <section ref={ref} id={id} className="sky" aria-labelledby={labelledBy}>
        <StarSky variant="scene" />

        <div className="sky-stage">
          <div className="sky-mascot" aria-hidden="true">
            <div className="sky-mascot-float">
              <Mascot size={118} mood="happy" greet lookAt={lookAt} shy={shy} peek={peek} cheer={cheer} />
            </div>
          </div>
          <div ref={formRef} className="sky-card">{children}</div>
        </div>
      </section>
    );
  },
);

/**
 * The sky every screen sits on: fixed behind the page, so the welcome page,
 * Today, Activity and the rest share one continuous star atlas.
 */
export function SkyBackdrop() {
  return (
    <div className="sky-backdrop" aria-hidden="true">
      <StarSky variant="backdrop" />
    </div>
  );
}
