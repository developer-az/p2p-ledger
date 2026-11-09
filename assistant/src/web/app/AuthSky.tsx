import { forwardRef, useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Mascot } from './Mascot.js';

/**
 * The sign-in and create-account scene: a morning sky above the clouds. Three
 * banks of cloud drift at different speeds (far ones slower), the sun sits
 * behind the card, and Settle floats on a cloud of its own beside the form.
 *
 * Settle follows the form: it reads along the field you are typing in, covers
 * its eyes while you type a password, and peeks if you choose to show it.
 * Everything here is decoration around `children` (the form), so the form
 * keeps its own logic and labels.
 */

/** A puffy cloud: a flat base with overlapping domes, in a 200 x 90 box. */
export function Cloud({ className, tone = 'a' }: { className: string; tone?: 'a' | 'b' }) {
  return (
    <svg className={`sky-cloud ${className}`} viewBox="0 0 200 90" aria-hidden="true" preserveAspectRatio="xMidYMax meet">
      <path
        className={`sky-cloud-body sky-cloud-${tone}`}
        d="M18 86 C2 86 0 64 16 60 C12 40 36 30 52 40 C58 18 92 8 110 28 C120 14 152 14 158 38 C178 34 196 50 188 66 C200 72 196 86 182 86 Z"
      />
      <path className="sky-cloud-light" d="M40 46 C48 38 58 37 64 42 M98 30 C106 22 118 22 124 28" />
    </svg>
  );
}

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
        <div className="sky-sun" aria-hidden="true" />
        <div className="sky-layer sky-far" aria-hidden="true">
          <Cloud className="c1" tone="b" /><Cloud className="c2" tone="b" /><Cloud className="c3" tone="b" />
        </div>
        <div className="sky-layer sky-mid" aria-hidden="true">
          <Cloud className="c4" /><Cloud className="c5" /><Cloud className="c6" />
        </div>
        <div className="sky-twinkles" aria-hidden="true">
          {Array.from({ length: 9 }, (_, i) => <i key={i} style={{ '--i': i } as CSSProperties} />)}
        </div>

        <div className="sky-stage">
          <div className="sky-mascot" aria-hidden="true">
            <div className="sky-mascot-float">
              <Mascot size={118} mood="happy" greet lookAt={lookAt} shy={shy} peek={peek} cheer={cheer} />
              <Cloud className="sky-mascot-cloud" />
            </div>
          </div>
          <div ref={formRef} className="sky-card">{children}</div>
        </div>

        <div className="sky-layer sky-near" aria-hidden="true">
          <Cloud className="c7" /><Cloud className="c8" /><Cloud className="c9" /><Cloud className="c10" />
        </div>
      </section>
    );
  },
);

/**
 * The sky every screen sits on: fixed behind the page, so the welcome page,
 * Today, Activity and the rest share one continuous daylight with clouds
 * drifting slowly behind the cards. Transforms only, so it never repaints.
 */
export function SkyBackdrop() {
  return (
    <div className="sky-backdrop" aria-hidden="true">
      <div className="sky-layer sky-bd-far">
        <Cloud className="b1" tone="b" /><Cloud className="b2" tone="b" /><Cloud className="b3" tone="b" />
      </div>
      <div className="sky-layer sky-bd-near">
        <Cloud className="b4" /><Cloud className="b5" /><Cloud className="b6" />
      </div>
    </div>
  );
}

