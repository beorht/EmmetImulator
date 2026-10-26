import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection, placeholder } from '@codemirror/view';
import { EditorState, Transaction, Compartment } from '@codemirror/state';
import {
  defaultKeymap, history, historyKeymap, indentMore, indentLess,
  moveLineUp, moveLineDown, copyLineUp, copyLineDown,
} from '@codemirror/commands';
import { html } from '@codemirror/lang-html';
import { syntaxHighlighting, HighlightStyle, indentUnit, bracketMatching } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

import { INDENT, expandAbbreviation, extractAbbreviation, EmmetError } from '../services/EmmetService.js';
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
 * Сколько непробельных символов может появиться за одно нажатие.
 * Больше — это не набор с клавиатуры, а вставка: автонаборщик, ИИ-помощник
 * браузера, диктовка. Набор через IME (input.type.compose) не трогаем.
 */
const MAX_TYPED_CHARS = 2;

// Перенос и дублирование строк не нужны для Emmet, а дубль готового HTML — та же вставка.
const LINE_COMMANDS = new Set([moveLineUp, moveLineDown, copyLineUp, copyLineDown]);
const editorKeymap = defaultKeymap.filter((binding) => !LINE_COMMANDS.has(binding.run));

const PLACEHOLDER = {
  emmet: 'Введите Emmet-сокращение и нажмите Tab',
  html: 'Напишите HTML-код. Emmet тоже работает: сокращение в строке и Tab',
};

const KEY_HELP = {
  emmet: `<kbd>Tab</kbd> развернуть и проверить
    <span class="key-extra">· <kbd>Ctrl</kbd>+<kbd>Enter</kbd> проверить</span>
    <span class="visually-hidden">. Отступ: Ctrl+] и Ctrl+[. Выйти из редактора: Esc, затем Tab.</span>`,
  html: `<kbd>Ctrl</kbd>+<kbd>Enter</kbd> проверить
    <span class="key-extra">· <kbd>Tab</kbd> отступ или Emmet</span>
    <span class="visually-hidden">. Выйти из редактора: Esc, затем Tab.</span>`,
};

// Сокращение Emmet начинается с имени тега, точки, решётки или скобки — не с русского слова.
const ABBREVIATION_START = /^[a-zA-Z.#(]/;

const BLOCKED_MESSAGE = {
  paste: 'Вставка в редактор отключена. Наберите сокращение сами.',
  drop: 'Перетаскивать текст в редактор нельзя. Наберите сокращение сами.',
  bulk: 'Текст появился целым куском, а не с клавиатуры. Наберите сокращение сами.',
};

function insertedChars(tr) {
  let count = 0;
  tr.changes.iterChanges((_fromA, _toA, _fromB, _toB, text) => {
    count += text.toString().replace(/\s/g, '').length;
  });
  return count;
}

/** Какой запрещённый ввод несёт транзакция, если несёт. */
export function blockedInput(tr) {
  if (!tr.docChanged) return null;
  if (tr.isUserEvent('input.paste')) return 'paste';
  if (tr.isUserEvent('input.drop')) return 'drop';
  if (tr.isUserEvent('input.type') && !tr.isUserEvent('input.type.compose') && insertedChars(tr) > MAX_TYPED_CHARS) {
    return 'bulk';
  }
  return null;
}

/**
 * Редактор ученика.
 * Tab: если слева от курсора есть Emmet-сокращение — разворачивает его и
 * сразу проверяет результат; если сокращения нет — просто запускает проверку.
 * Отступы: Ctrl+] / Ctrl+[ . Выход из редактора с клавиатуры: Esc, затем Tab.
 */
export class CodeEditorPanel {
  constructor(root, { store, validate, onResult, onBlocked, onPreview = () => {} }) {
    this.root = root;
    this.store = store;
    this.validate = validate;
    this.onResult = onResult;
    this.onBlocked = onBlocked;
    this.onPreview = onPreview;
    this.escapePressed = false;
    this.mode = 'emmet';
    this.placeholder = new Compartment();

    root.innerHTML = `
      <header class="panel-head">
        <div class="panel-heading">
          <p class="eyebrow">Практическая работа · <span class="lesson-count"></span></p>
          <h2 class="panel-title" id="practice-title"></h2>
        </div>
      </header>
      <div class="instructions"></div>
      <div class="editor-shell">
        <div class="editor"></div>
        <div class="editor-bar">
          <button class="preview-toggle" type="button" aria-controls="student-preview">${icons.eye}<span>Результат</span></button>
          <p class="key-help" id="key-help">${KEY_HELP.emmet}</p>
        </div>
        <div class="student-preview" id="student-preview"></div>
      </div>
      <footer class="practice-foot">
        <div class="feedback-slot"></div>
        <button class="btn btn-primary" type="button" data-action="check">${icons.check}<span>Проверить</span></button>
      </footer>
    `;

    this.title = root.querySelector('.panel-title');
    this.keyHelp = root.querySelector('.key-help');
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
    this.previewOpen = window.innerHeight >= 820;
    this.setPreviewOpen(this.previewOpen);

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
          this.placeholder.of(placeholder(PLACEHOLDER.emmet)),
          tabKeymap,
          keymap.of([...editorKeymap, ...historyKeymap]),
          // Последний рубеж: вставка любым путём (в том числе средней кнопкой мыши) отменяется.
          EditorState.transactionFilter.of((tr) => {
            const kind = blockedInput(tr);
            if (!kind) return tr;
            queueMicrotask(() => this.block(kind));
            return [];
          }),
          EditorView.contentAttributes.of({
            'aria-label': 'Редактор кода ученика',
            'aria-describedby': 'key-help',
            spellcheck: 'false',
            autocapitalize: 'off',
            autocorrect: 'off',
          }),
          EditorView.domEventHandlers({
            paste: (event) => {
              event.preventDefault();
              this.block('paste');
              return true;
            },
            drop: (event) => {
              event.preventDefault();
              this.block('drop');
              return true;
            },
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
    const { head } = view.state.selection.main;

    if (this.mode === 'html') {
      // HTML пишут руками: Tab — отступ, а сокращение разворачивается, только если оно — вся строка.
      const line = view.state.doc.lineAt(head);
      const found = extractAbbreviation(line.text, head - line.from, { wholeLineOnly: true });
      if (found && ABBREVIATION_START.test(found.abbreviation)) this.expandAt(head, found);
      else view.dispatch(view.state.replaceSelection(INDENT));
      return true;
    }

    if (this.expandAt(head)) this.check();
    return true;
  }

  /**
   * Разворачивает сокращение слева от позиции. Возвращает false, если
   * сокращение содержит ошибку (о ней уже сообщено ученику).
   */
  expandAt(position, found = null) {
    const { state } = this.view;
    const line = state.doc.lineAt(position);
    found ??= extractAbbreviation(line.text, position - line.from);
    if (!found) return true;

    const baseIndent = /^\s*/.exec(line.text)[0];
    try {
      const { html, cursor } = expandAbbreviation(found.abbreviation, { baseIndent, withCursor: true });
      const from = line.from + found.start;
      // Длинное сокращение прокрутило редактор вправо — после развёртывания строки короткие.
      this.view.scrollDOM.scrollLeft = 0;
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

  /** Запрещённый ввод: сообщаем ученику и в статистику, но попыткой решения это не считается. */
  block(kind) {
    this.feedback.show({ status: 'error', title: 'Так нельзя', message: BLOCKED_MESSAGE[kind] });
    this.onBlocked(kind);
  }

  report(result) {
    this.feedback.show(result, { canAdvance: this.store.index < this.store.count - 1 });
    this.onResult(result, this.view.state.doc.toString());
  }

  schedulePreview() {
    clearTimeout(this.previewTimer);
    this.previewTimer = setTimeout(() => this.renderPreview(), PREVIEW_DELAY);
  }

  renderPreview() {
    clearTimeout(this.previewTimer);
    const code = this.view.state.doc.toString();
    if (this.mode === 'emmet') this.preview.render(code);
    this.onPreview(code);
  }

  load(exercise) {
    this.title.textContent = exercise.title;
    this.lessonCount.textContent = `${this.store.taskNumber()} / ${this.store.tasks.length}`;
    this.instructions.load(exercise);
    this.setMode(exercise.mode === 'html' ? 'html' : 'emmet');
    this.feedback.reset(this.mode);
    this.view.dispatch({
      changes: { from: 0, to: this.view.state.doc.length, insert: '' },
      selection: { anchor: 0 },
      // Новое задание — без истории правок прошлого.
      annotations: Transaction.addToHistory.of(false),
    });
    this.renderPreview();
  }

  /** emmet — только сокращения; html — разметку можно писать руками, схема кода видна слева. */
  setMode(mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.view.dispatch({ effects: this.placeholder.reconfigure(placeholder(PLACEHOLDER[mode])) });
    this.keyHelp.innerHTML = KEY_HELP[mode];
    // В заданиях на контейнеры результат виден слева, своя панель результата не нужна.
    this.previewToggle.hidden = mode === 'html';
    this.setPreviewOpen(this.previewOpen);
  }

  setPreviewOpen(open) {
    this.previewOpen = open;
    this.previewBox.hidden = !open || this.mode === 'html';
    this.previewToggle.setAttribute('aria-expanded', String(open));
    this.previewToggle.title = open ? 'Скрыть результат' : 'Показать результат';
  }

  focus() {
    this.view.focus();
  }
}
