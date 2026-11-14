import { useEffect, useRef } from 'react';
import { EditorState, StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, type DecorationSet } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';

const setErrorLineEffect = StateEffect.define<number | null>();

const errorLineField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decorations, tr) {
    decorations = decorations.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(setErrorLineEffect)) {
        if (effect.value && effect.value >= 1 && effect.value <= tr.state.doc.lines) {
          const line = tr.state.doc.line(effect.value);
          return Decoration.set([Decoration.line({ class: 'cm-error-line' }).range(line.from)]);
        }
        return Decoration.none;
      }
    }
    return decorations;
  },
  provide: (f) => EditorView.decorations.from(f),
});

export function CodeMirrorPuml({
  value,
  onChange,
  errorLine,
  readOnly = false,
}: {
  value: string;
  onChange: (next: string) => void;
  errorLine?: number | null;
  readOnly?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!hostRef.current) return;

    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        errorLineField,
        EditorView.editable.of(!readOnly),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString());
          }
        }),
        EditorView.theme({
          '&': { height: '100%', backgroundColor: '#0d1117', color: '#e2e8f0' },
          '.cm-scroller': { overflow: 'auto', fontFamily: 'var(--font-mono)' },
          '.cm-content': { padding: '12px 0' },
        }),
      ],
    });

    const view = new EditorView({
      state,
      parent: hostRef.current,
    });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [readOnly]);

  // Sync external value updates (e.g. switching views or Reset to Model)
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const currentDoc = view.state.doc.toString();
    if (currentDoc !== value) {
      view.dispatch({
        changes: { from: 0, to: currentDoc.length, insert: value },
      });
    }
  }, [value]);

  // Highlight PlantUML syntax error line when reported
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: setErrorLineEffect.of(errorLine ?? null),
    });
  }, [errorLine]);

  return (
    <div
      ref={hostRef}
      data-testid="codemirror-puml"
      className="h-full w-full overflow-hidden rounded-lg border border-slate-800 bg-[#0d1117]"
    />
  );
}
