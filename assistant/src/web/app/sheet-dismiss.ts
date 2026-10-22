function nodeLike(target: EventTarget | null): Node | null {
  if (target == null || typeof target !== 'object') return null;
  return target as Node;
}

/** Only dismiss when the press started and ended outside the sheet panel (avoids closing during text select drags). */
export function shouldDismissSheet(
  panel: Node | null | undefined,
  pointerDownTarget: EventTarget | null,
  pointerUpTarget: EventTarget | null,
): boolean {
  if (!panel || typeof panel.contains !== 'function') return false;
  const down = nodeLike(pointerDownTarget);
  const up = nodeLike(pointerUpTarget);
  if (!down || !up) return false;
  if (panel.contains(down)) return false;
  return !panel.contains(up);
}
