import { EditorView } from '@codemirror/view';
import { act, screen, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';

/** Listedeki bağlantının formunu bağlantı menüsündeki "Düzenle" ile açar. */
export async function editConnection(user: UserEvent, name: RegExp) {
  const nav = screen.getByRole('navigation', { name: 'Bağlantılar' });
  const row = await within(nav).findByRole('button', { name });
  await user.click(within(row.closest('li')!).getByRole('button', { name: 'Bağlantı menüsü' }));
  await user.click(screen.getByRole('menuitem', { name: 'Düzenle' }));
}

/**
 * Alanı tek bir girişle doldurur (tıkla + yapıştır). `user.type` her tuşta tüm `App`'i yeniden
 * render eder; uzun metinlerde test, tam takımın yükü altında zaman aşımına yaklaşır.
 */
export async function fill(user: UserEvent, field: HTMLElement, text: string) {
  await user.click(field);
  await user.paste(text);
}

/** Script editörünün CodeMirror görünümü (jsdom'da yazmak yerine doğrudan işlem gönderilir). */
function editorView(): EditorView {
  const content = screen.getByRole('region', { name: 'Script editörü' }).querySelector('.cm-content');
  const view = content && EditorView.findFromDOM(content as HTMLElement);
  if (!view) throw new Error('Script editörü bulunamadı');
  return view;
}

/** Editörün tüm metnini kullanıcı yazmış gibi değiştirir. */
export function setEditorScript(text: string) {
  const view = editorView();
  act(() => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, userEvent: 'input' }));
}

export const editorScript = () => editorView().state.doc.toString();

/** İmlecin bulunduğu 1 tabanlı satır. */
export function editorCursorLine(): number {
  const { state } = editorView();
  return state.doc.lineAt(state.selection.main.head).number;
}

/** Satır numarasının solundaki ifade işaretleri: satır → işaret. */
export function gutterMarks(): Record<number, string> {
  const marks: Record<number, string> = {};
  for (const el of document.querySelectorAll<HTMLElement>('.cm-ifade-isareti')) {
    marks[Number(el.dataset.satir)] = el.textContent ?? '';
  }
  return marks;
}
