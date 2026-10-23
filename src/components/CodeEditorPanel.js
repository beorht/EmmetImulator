import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection, placeholder } from '@codemirror/view';
import { EditorState, Transaction } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentMore, indentLess } from '@codemirror/commands';
import { html } from '@codemirror/lang-html';
import { syntaxHighlighting, HighlightStyle, indentUnit, bracketMatching } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

import { INDENT, expandAbbreviation, extractAbbreviation, EmmetError } from '../services/EmmetService.js';
import { isPractice } from '../services/ExerciseStore.js';
import { handwrittenTracking, handwrittenRanges, highlightHandwritten } from '../services/HandwrittenTracker.js';
import { PreviewFrame } from './PreviewFrame.js';
import { FeedbackMessage } from './FeedbackMessage.js';
import { ExerciseInstructions } from './ExerciseInstructions.js';
import { icons } from './icons.js';

const warmHighlight = HighlightStyle.define([
  { tag: [t.tagName, t.angleBracket], color: 'var(--code-tag)' },
  { tag: t.attributeName, color: 'var(--code-attr)' },
  { tag: t.attributeValue, color: 'var(--code-string)' },
  { tag: t.comment, color: 'var(--text-muted)', fontStyle: 'italic' },
  { tag: t.invalid, color: 'var(--status-error)' },
]);

const PREVIEW_DELAY = 250;

/**
 * Редактор ученика.
 * Tab: если слева от курсора есть Emmet-сокращение — разворачивает его и
 * сразу проверяет результат; если сокращения нет — просто запускает проверку.
 * Отступы: Ctrl+] / Ctrl+[ . Выход из редактора с клавиатуры: Esc, затем Tab.
 */
export class CodeEditorPanel {
  constructor(root, { store, validate, onResult }) {
    this.root = root;
    this.store = store;
    this.validate = validate;
    this.onResult = onResult;
    this.escapePressed = false;

    root.innerHTML = `
      <header class="panel-head">
        <div class="panel-heading">
          <p class="eyebrow"><span class="lesson-kind"></span> · <span class="lesson-count"></span></p>
          <h2 class="panel-title" id="practice-title"></h2>
        </div>
      </header>
      <div class="instructions"></div>
      <div class="editor-shell">
        <div class="editor"></div>
        <div class="editor-bar">
          <button class="preview-toggle" type="button" aria-controls="student-preview">${icons.eye}<span>Результат</span></button>
          <p class="key-help" id="key-help">
            <kbd>Tab</kbd> развернуть и проверить
            <span class="key-extra">· <kbd>Ctrl</kbd>+<kbd>Enter</kbd> проверить</span>
            <span class="visually-hidden">. Отступ: Ctrl+] и Ctrl+[. Выйти из редактора: Esc, затем Tab.</span>
          </p>
        </div>
        <div class="student-preview" id="student-preview"></div>
      </div>
      <footer class="practice-foot">
        <div class="feedback-slot"></div>
        <button class="btn btn-primary" type="button" data-action="check">${icons.check}<span>Проверить</span></button>
      </footer>
    `;

    this.title = root.querySelector('.panel-title');
    this.lessonKind = root.querySelector('.lesson-kind');
    this.lessonCount = root.querySelector('.lesson-count');

    this.instructions = new ExerciseInstructions(root.querySelector('.instructions'));
    this.feedback = new FeedbackMessage(root.querySelector('.feedback-slot'), {
      onNext: () => store.select(store.index + 1),
    });

    this.preview = new PreviewFrame({ title: 'Результат вашего кода' });
    this.previewBox = root.querySelector('.student-preview');
    this.previewToggle = root.querySelector('.preview-toggle');
    this.previewBox.append(this.preview.element);
    this.previewToggle.addEventListener('click', () => this.setPreviewOpen(this.previewBox.hidden));
    // На невысоких экранах предпросмотр свёрнут, чтобы редактору хватило места.
    this.setPreviewOpen(window.innerHeight >= 820);

    root.querySelector('[data-action="check"]').addEventListener('click', () => this.checkFromButton());

    this.view = this.createEditor(root.querySelector('.editor'));
  }

  createEditor(parent) {
    const run = (command) => () => {
      command();
      return true;
    };

    const tabKeymap = keymap.of([
      { key: 'Tab', run: (view) => this.handleTab(view) },
      { key: 'Mod-Enter', run: run(() => this.check()) },
      { key: 'Mod-]', run: indentMore },
      { key: 'Mod-[', run: indentLess },
      { key: 'Shift-Tab', run: indentLess },
    ]);

    return new EditorView({
      parent,
      state: EditorState.create({
        doc: '',
        extensions: [
          lineNumbers(),
          history(),
          drawSelection(),
          highlightActiveLine(),
          bracketMatching(),
          indentUnit.of(INDENT),
          EditorState.tabSize.of(2),
          html({ autoCloseTags: false }),
          syntaxHighlighting(warmHighlight),
          handwrittenTracking(),
          placeholder('Введите Emmet-сокращение и нажмите Tab'),
          tabKeymap,
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.contentAttributes.of({
            'aria-label': 'Редактор кода ученика',
            'aria-describedby': 'key-help',
            spellcheck: 'false',
            autocapitalize: 'off',
            autocorrect: 'off',
          }),
          EditorView.domEventHandlers({
            keydown: (event) => {
              // Esc «разблокирует» следующий Tab, чтобы фокус мог уйти из редактора.
              if (event.key === 'Escape') this.escapePressed = true;
              else if (event.key !== 'Tab') this.escapePressed = false;
              return false;
            },
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) this.schedulePreview();
          }),
        ],
      }),
    });
  }

  handleTab(view) {
    if (this.escapePressed) {
      this.escapePressed = false;
      return false; // браузер переносит фокус дальше
    }
    if (!view.state.selection.main.empty) return indentMore(view);

    if (this.expandAt(view.state.selection.main.head)) this.check();
    return true;
  }

  /**
   * Разворачивает сокращение слева от позиции. Возвращает false, если
   * сокращение содержит ошибку (о ней уже сообщено ученику).
   */
  expandAt(position) {
    const { state } = this.view;
    const line = state.doc.lineAt(position);
    const found = extractAbbreviation(line.text, position - line.from);
    if (!found) return true;

    const baseIndent = /^\s*/.exec(line.text)[0];
    try {
      const { html, cursor } = expandAbbreviation(found.abbreviation, { baseIndent, withCursor: true });
      const from = line.from + found.start;
      this.view.dispatch({
        changes: { from, to: line.from + found.end, insert: html },
        selection: { anchor: from + cursor },
        scrollIntoView: true,
        userEvent: 'input.complete',
      });
      return true;
    } catch (error) {
      if (!(error instanceof EmmetError)) throw error;
      this.report({ status: 'error', title: 'Сокращение с ошибкой', message: error.message });
      return false;
    }
  }

  /** Кнопка «Проверить»: на сенсорных клавиатурах нет Tab, поэтому сначала разворачиваем сокращение. */
  checkFromButton() {
    const { doc } = this.view.state;
    const text = doc.toString().trim();
    if (text && !text.includes('<') && doc.lines === 1) {
      if (!this.expandAt(doc.line(1).from + doc.line(1).text.trimEnd().length)) return;
    }
    this.check();
  }

  check() {
    const code = this.view.state.doc.toString();
    this.renderPreview();
    const result = this.validate(code, { handwritten: handwrittenRanges(this.view.state) });
    if (result.handwritten) highlightHandwritten(this.view, result.handwritten);
    this.report(result);
  }

  report(result) {
    this.feedback.show(result, { canAdvance: this.store.index < this.store.count - 1 });
    this.onResult(result);
  }

  schedulePreview() {
    clearTimeout(this.previewTimer);
    this.previewTimer = setTimeout(() => this.renderPreview(), PREVIEW_DELAY);
  }

  renderPreview() {
    clearTimeout(this.previewTimer);
    this.preview.render(this.view.state.doc.toString());
  }

  load(exercise) {
    this.title.textContent = exercise.title;
    const practice = isPractice(exercise);
    const { number, total } = this.store.positionOf(exercise);
    this.lessonKind.textContent = practice ? 'Практическая работа' : 'Практика';
    this.lessonCount.textContent = `${number} / ${total}`;
    this.instructions.load(exercise);
    this.feedback.reset({ practice });
    this.view.dispatch({
      changes: { from: 0, to: this.view.state.doc.length, insert: '' },
      selection: { anchor: 0 },
      // Новое задание — без истории правок прошлого.
      annotations: Transaction.addToHistory.of(false),
    });
    this.renderPreview();
  }

  setPreviewOpen(open) {
    this.previewBox.hidden = !open;
    this.previewToggle.setAttribute('aria-expanded', String(open));
    this.previewToggle.title = open ? 'Скрыть результат' : 'Показать результат';
  }

  focus() {
    this.view.focus();
  }
}
