import { autocompletion } from '@codemirror/autocomplete';
import { history, defaultKeymap, historyKeymap } from '@codemirror/commands';
import { PostgreSQL, sql } from '@codemirror/lang-sql';
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap, placeholder } from '@codemirror/view';
import { useEffect, useRef } from 'react';
import type { CompletionConfig } from '../../core/katalog';
import { completionConfig } from '../script/ScriptEditoru';

interface Props {
  /** Erişilebilir ad ve yer tutucu (`WHERE` / `ORDER BY`). */
  etiket: string;
  value: string;
  onChange: (value: string) => void;
  /** Enter (tamamlama listesi kapalıyken). */
  onApply: () => void;
  /** Katalogdan tamamlama; katalog yoksa `null`. */
  completion: CompletionConfig | null;
  invalid: boolean;
}

function sqlLanguage(completion: CompletionConfig | null): Extension {
  return [sql({ dialect: PostgreSQL, ...(completion ?? {}) }), completionConfig.of(completion)];
}

/**
 * Tablo sekmesinin tek satırlık SQL kutusu (CodeMirror): renklendirme ve katalog tamamlaması;
 * Enter uygular, yani yazarken satır eklenmez. Tamamlama listesi açıkken Enter öneriyi seçer
 * (autocompletion'ın keymap'i önce). Yapıştırılan çok satırlı metin olduğu gibi kalır: satır sonunu
 * boşluğa çevirmek `--` yorumundan sonraki satırı yorumun içine alırdı.
 */
export function FiltreKutusu({ etiket, value, onChange, onApply, completion, invalid }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const handlers = useRef({ onChange, onApply });
  handlers.current = { onChange, onApply };
  const language = useRef(new Compartment());
  const attributes = useRef(new Compartment());

  const ariaAttributes = (bad: boolean) =>
    EditorView.contentAttributes.of({ 'aria-label': etiket, ...(bad && { 'aria-invalid': 'true' }) });

  useEffect(() => {
    const created = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          autocompletion(),
          keymap.of([
            {
              key: 'Enter',
              run: () => {
                handlers.current.onApply();
                return true;
              },
            },
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          syntaxHighlighting(defaultHighlightStyle),
          placeholder(etiket),
          language.current.of(sqlLanguage(completion)),
          attributes.current.of(ariaAttributes(invalid)),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) handlers.current.onChange(update.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = created;
    return () => {
      created.destroy();
      view.current = null;
    };
    // Kutu bir kez kurulur; metin, tamamlama ve geçerlilik aşağıdaki effect'lerle eşitlenir.
  }, []);

  useEffect(() => {
    const current = view.current;
    if (current && current.state.doc.toString() !== value) {
      current.dispatch({ changes: { from: 0, to: current.state.doc.length, insert: value } });
    }
  }, [value]);

  useEffect(() => {
    view.current?.dispatch({ effects: language.current.reconfigure(sqlLanguage(completion)) });
  }, [completion]);

  useEffect(() => {
    view.current?.dispatch({ effects: attributes.current.reconfigure(ariaAttributes(invalid)) });
    // `etiket` sabittir.
  }, [invalid]);

  return <div ref={host} className="filtre-editoru" />;
}
