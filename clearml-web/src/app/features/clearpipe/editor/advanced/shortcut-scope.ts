const EDITABLE_SELECTOR = [
  'input', 'textarea', 'select', '[contenteditable=""]', '[contenteditable="true"]',
  '[role="textbox"]', '[role="combobox"]', '[role="searchbox"]', '[role="spinbutton"]',
  '.ace_editor', '[data-clearpipe-editor]',
].join(', ');
const DIALOG_SELECTOR = 'dialog, [role="dialog"], [aria-modal="true"]';

export const isShortcutSuppressed = (target: EventTarget | null): boolean => {
  const element = target instanceof Element ? target : null;
  return !!element?.closest(`${EDITABLE_SELECTOR}, ${DIALOG_SELECTOR}`);
};

export const shortcutModifierLabel = (platform = typeof navigator === 'undefined' ? '' : navigator.platform): string =>
  /mac|iphone|ipad|ipod/i.test(platform) ? '⌘' : 'Ctrl';

export type CanvasShortcut = 'undo' | 'redo' | 'select-all' | 'copy' | 'paste' | 'duplicate';

export const canvasShortcut = (event: KeyboardEvent): CanvasShortcut | null => {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return null;
  const key = event.key.toLocaleLowerCase();
  if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
  if (key === 'y') return 'redo';
  if (key === 'a') return 'select-all';
  if (key === 'c') return 'copy';
  if (key === 'v') return 'paste';
  if (key === 'd') return 'duplicate';
  return null;
};
