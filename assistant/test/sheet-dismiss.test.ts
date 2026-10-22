import { describe, expect, it } from 'vitest';
import { shouldDismissSheet } from '../src/web/app/sheet-dismiss.js';

function mockPanel(contains: (node: Node) => boolean): Node {
  return { contains } as Node;
}

describe('shouldDismissSheet', () => {
  it('does not dismiss when the press started inside the panel', () => {
    const input = {} as Node;
    const panel = mockPanel((n) => n === input);
    expect(shouldDismissSheet(panel, input, input)).toBe(false);
  });

  it('dismisses when press started and ended on the backdrop', () => {
    const backdrop = {} as Node;
    const panel = mockPanel(() => false);
    expect(shouldDismissSheet(panel, backdrop, backdrop)).toBe(true);
  });

  it('does not dismiss when drag starts in input and ends outside (text selection)', () => {
    const input = {} as Node;
    const backdrop = {} as Node;
    const panel = mockPanel((n) => n === input);
    expect(shouldDismissSheet(panel, input, backdrop)).toBe(false);
  });
});
