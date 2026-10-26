// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { history, undo, redo, isolateHistory } from '@codemirror/commands';
import { validate, findMarkupErrors, findHandwrittenMarkup, Status } from '../src/services/ValidationService.js';
import { handwrittenTracking, handwrittenRanges } from '../src/services/HandwrittenTracker.js';
import { expandAbbreviation, extractAbbreviation } from '../src/services/EmmetService.js';
import { ExerciseStore } from '../src/services/ExerciseStore.js';
import { sanitize } from '../src/components/PreviewFrame.js';
import { blockedInput } from '../src/components/CodeEditorPanel.js';
import containers from '../src/data/containers.json';

const store = new ExerciseStore();
// Учебные задачи для проверки валидатора — отдельно от набора практических работ.
const task = (abbreviation) => ({ mode: 'emmet', expectedHtml: expandAbbreviation(abbreviation).html });
const list = task('ul>li*3');

describe('ExerciseStore', () => {
  it('банк из 30 работ без подсказок и демонстраций: 7 лёгких, 4 средних, 19 сложных', () => {
    expect(store.count).toBe(30);
    for (const exercise of store.list) {
      expect(exercise.expectedHtml, exercise.id).toContain('<');
      expect(exercise.hints, exercise.id).toBeUndefined();
      expect(exercise.demo, exercise.id).toBeUndefined();
    }
    const byLevel = (level) => store.list.filter((exercise) => exercise.difficulty === level).length;
    expect([byLevel(1), byLevel(2), byLevel(3)]).toEqual([7, 4, 19]);
  });

  it('каждое эталонное сокращение целиком берётся из строки по Tab', () => {
    for (const exercise of store.list) {
      const line = `  ${exercise.emmetExpression}`;
      expect(extractAbbreviation(line, line.length)?.abbreviation, exercise.id).toBe(exercise.emmetExpression);
    }
  });

  it('эталонное развёртывание проходит собственную проверку', () => {
    for (const exercise of store.list) {
      const { html } = expandAbbreviation(exercise.emmetExpression);
      expect(validate(html, exercise).status, exercise.id).toBe(Status.success);
    }
  });
});

describe('задания на контейнеры', () => {
  const section = new ExerciseStore(containers);
  const LESSON = { id: 'lesson', kind: 'lesson', title: 'Теория' };

  it('10 заданий только на HTML: div, header, nav, main, footer, id и class, без CSS', () => {
    expect(section.count).toBe(10);
    for (const exercise of section.list) {
      expect(exercise.mode, exercise.id).toBe('html');
      expect(exercise.section, exercise.id).toBe('containers');
      expect(exercise.expectedHtml, exercise.id).not.toMatch(/style|<link|©|₽/);
    }
    const html = section.list.map((exercise) => exercise.expectedHtml).join('');
    for (const tag of ['div', 'header', 'nav', 'main', 'footer']) expect(html).toContain(`<${tag}`);
    expect(html).toContain('id="');
    expect(html).toContain('class="');
  });

  it('HTML, написанный руками, засчитывается', () => {
    for (const exercise of section.list) {
      const handwritten = [[0, exercise.expectedHtml.length]];
      expect(validate(exercise.expectedHtml, exercise, { handwritten }).status, exercise.id).toBe(Status.success);
    }
    const [card] = section.list;
    const typed = '<div class="card"><h2>Котик Барсик</h2><p>Любит спать и есть.</p><button>Погладить</button></div>';
    expect(validate(typed, card).status).toBe(Status.success);
    expect(validate('<section class="card"></section>', card).status).toBe(Status.mismatch);
    expect(validate('Котик', card).title).toMatch(/нет ни одного тега/);
  });

  it('теория стоит перед разделом, нумеруются только работы', () => {
    const plan = new ExerciseStore([...store.list.slice(0, 2), LESSON, ...containers.slice(0, 2)]);
    expect(plan.tasks).toHaveLength(4);
    expect(plan.taskNumber(2)).toBeNull();
    expect(plan.taskNumber(3)).toBe(3);
    plan.solved = new Set([plan.list[0].id]);
    expect(plan.resumeIndex()).toBe(1);
    plan.solved.add(plan.list[1].id);
    expect(plan.resumeIndex()).toBe(2); // раздел ещё не начат — сначала теория
    plan.solved.add(plan.list[3].id);
    expect(plan.resumeIndex()).toBe(4);
  });

  it('схема подписывает контейнеры и метит теги с id и class', () => {
    const clean = sanitize('<div class="card big"><h1 id="logo">x</h1><p class="note">y</p><p>z</p></div>');
    expect(clean).toContain('data-label="div.card.big"');
    expect(clean).not.toMatch(/<div[^>]*data-kind/);
    expect(clean).toMatch(/data-label="h1#logo" data-kind="id"/);
    expect(clean).toMatch(/data-label="p.note" data-kind="class"/);
    expect(clean).toMatch(/data-label="p" data-kind="tag"/);
    expect(sanitize('<p class="btn" id="a">x</p>', { stripNames: true })).not.toMatch(/ class=| id=/);
  });

  it('в строке с разметкой Tab не превращает текст в тег', () => {
    expect(extractAbbreviation('<div>card', 9, { wholeLineOnly: true })).toBeNull();
    expect(extractAbbreviation('  div.card', 10, { wholeLineOnly: true })?.abbreviation).toBe('div.card');
  });
});

describe('validate', () => {
  it('принимает другое форматирование той же структуры', () => {
    const result = validate('<ul><li></li>\n<li></li>   <li></li></ul>', list);
    expect(result.status).toBe(Status.success);
  });

  it('сообщает о пустом вводе и неразвёрнутом сокращении', () => {
    expect(validate('  ', list).title).toBe('Пока пусто');
    expect(validate('ul>li*3', list).title).toBe('Сокращение не развёрнуто');
  });

  it('называет недостающее количество элементов', () => {
    const result = validate('<ul><li></li><li></li></ul>', list);
    expect(result.status).toBe(Status.mismatch);
    expect(result.message).toBe('Внутри <ul> должно быть 3 × <li>, сейчас 2.');
  });

  it('находит неверный тег', () => {
    const result = validate('<ol><li></li><li></li><li></li></ol>', list);
    expect(result.message).toBe('Элемент должен быть <ul>, а сейчас <ol>.');
  });

  it('частично верно: структура совпала, не хватает класса', () => {
    const result = validate(
      '<ul><li class="item1"></li><li class="item2"></li><li></li></ul>',
      task('ul>li.item$*3'),
    );
    expect(result.status).toBe(Status.partial);
    expect(result.message).toBe('У <li> нет класса item3.');
  });

  it('проверяет текст и значения атрибутов', () => {
    const link = task('a[href=#about]{О нас}');
    expect(validate('<a href="#about">Контакты</a>', link).message)
      .toBe('Текст в <a> должен быть «О нас», а не «Контакты».');
    expect(validate('<a href="#">О нас</a>', link).message)
      .toBe('У <a> атрибут href должен быть «#about», а не «#».');
  });

  it('пустое ожидаемое значение атрибута принимает любое', () => {
    const result = validate('<nav><a href="/home">Домой</a></nav>', task('nav>a'));
    expect(result.status).toBe(Status.success);
  });

  it('HTML, набранный вручную целиком, не засчитывается', () => {
    const code = '<ul><li></li><li></li><li></li></ul>';
    const result = validate(code, list, { handwritten: [[0, code.length]] });
    expect(result.status).toBe(Status.error);
    expect(result.title).toBe('HTML набран вручную');
    expect(result.handwritten).toEqual([[0, code.length]]);
  });

  it('незакрытый тег — ошибка разметки', () => {
    const result = validate('<ul><li></li><li></ul>', list);
    expect(result.status).toBe(Status.error);
    expect(result.message).toBe('Тег <li> не закрыт до </ul>.');
  });
});

describe('findHandwrittenMarkup', () => {
  const at = (source, part) => {
    const from = source.indexOf(part);
    return [from, from + part.length];
  };

  it('разрешает вручную текст и значения атрибутов', () => {
    const code = '<a href="#about">О нас</a>';
    expect(findHandwrittenMarkup(code, [at(code, '#about'), at(code, 'О нас')])).toEqual([]);
    expect(validate(code, task('a[href=#about]{О нас}'), { handwritten: [at(code, '#about'), at(code, 'О нас')] }).status)
      .toBe(Status.success);
  });

  it('разрешает вручную переносы строк и отступы', () => {
    const code = '<ul>\n  <li></li>\n</ul>';
    expect(findHandwrittenMarkup(code, [[4, 7], [16, 17]])).toEqual([]);
  });

  it('ловит атрибут, дописанный руками к тегу из Emmet', () => {
    const code = '<div class="card"></div>';
    const typed = at(code, ' class="card"');
    expect(findHandwrittenMarkup(code, [typed])).toEqual([[5, 12], [16, 17]]);
    const result = validate(code, task('div.card'), { handwritten: [typed] });
    expect(result.status).toBe(Status.error);
    expect(result.message).toContain('«<div class="card">»');
  });

  it('ловит тег, напечатанный внутри текста', () => {
    const code = '<p>Привет <b>мир</b></p>';
    expect(findHandwrittenMarkup(code, [at(code, '<b>мир</b>')])).toEqual([[10, 13], [16, 20]]);
  });
});

describe('HandwrittenTracker', () => {
  const editor = () => {
    let state = EditorState.create({ extensions: [history(), handwrittenTracking()] });
    const target = {
      get state() { return state; },
      dispatch: (tr) => { state = tr.state; },
    };
    // Каждый шаг — отдельное событие истории, как при паузе между действиями.
    const run = (spec) => target.dispatch(state.update({ ...spec, annotations: isolateHistory.of('full') }));
    return { target, run, ranges: () => handwrittenRanges(state), doc: () => state.doc.toString() };
  };

  it('помечает набранное и снимает пометку с развёрнутого Emmet', () => {
    const { run, ranges } = editor();
    run({ changes: { from: 0, insert: 'ul>li' }, userEvent: 'input.type' });
    expect(ranges()).toEqual([[0, 5]]);
    run({ changes: { from: 0, to: 5, insert: '<ul><li></li></ul>' }, userEvent: 'input.complete' });
    expect(ranges()).toEqual([]);
    run({ changes: { from: 8, insert: 'Текст' }, userEvent: 'input.type' });
    expect(ranges()).toEqual([[8, 13]]);
  });

  it('перенос строк и другие команды редактора не «отмывают» набранный HTML', () => {
    const { run, ranges } = editor();
    run({ changes: { from: 0, insert: '<p></p>\n' }, userEvent: 'input.type' });
    // Alt+↓: строка удаляется и вставляется заново — раньше это снимало пометку.
    run({ changes: [{ from: 0, to: 8 }, { from: 8, insert: '<p></p>\n' }], userEvent: 'move.line' });
    expect(ranges()).toEqual([[0, 8]]);
    run({ changes: { from: 0, insert: '<!-- -->' }, userEvent: 'comment.toggle' });
    expect(ranges()).toEqual([[0, 16]]);
  });

  it('вставка из буфера считается ручным вводом', () => {
    const { run, ranges } = editor();
    run({ changes: { from: 0, insert: '<p></p>' }, userEvent: 'input.paste' });
    expect(ranges()).toEqual([[0, 7]]);
  });

  it('отмена и повтор не стирают пометку', () => {
    const { target, run, ranges, doc } = editor();
    run({ changes: { from: 0, insert: '<p></p>' }, userEvent: 'input.type' });
    run({ changes: { from: 0, to: 7 }, userEvent: 'delete' });
    expect(ranges()).toEqual([]);
    undo(target);
    expect(doc()).toBe('<p></p>');
    expect(ranges()).toEqual([[0, 7]]);
    undo(target);
    redo(target);
    expect(ranges()).toEqual([[0, 7]]);
  });
});

describe('запрещённый ввод в редакторе', () => {
  const state = EditorState.create({ doc: '' });
  const kind = (spec) => blockedInput(state.update(spec));

  it('вставка, перетаскивание и текст целым куском блокируются', () => {
    expect(kind({ changes: { from: 0, insert: 'p.caption' }, userEvent: 'input.paste' })).toBe('paste');
    expect(kind({ changes: { from: 0, insert: 'p' }, userEvent: 'input.drop' })).toBe('drop');
    expect(kind({ changes: { from: 0, insert: 'ul>li*3' }, userEvent: 'input.type' })).toBe('bulk');
  });

  it('обычный набор, перенос строки, IME и Emmet разрешены', () => {
    expect(kind({ changes: { from: 0, insert: 'u' }, userEvent: 'input.type' })).toBeNull();
    expect(kind({ changes: { from: 0, insert: '\n    ' }, userEvent: 'input' })).toBeNull();
    expect(kind({ changes: { from: 0, insert: '日本語' }, userEvent: 'input.type.compose' })).toBeNull();
    expect(kind({ changes: { from: 0, insert: '<ul></ul>' }, userEvent: 'input.complete' })).toBeNull();
  });
});

describe('findMarkupErrors', () => {
  it('ловит лишние закрывающие и оборванные теги', () => {
    expect(findMarkupErrors('<p></p></div>')).toEqual(['Лишний закрывающий тег </div> — для него нет открывающего.']);
    expect(findMarkupErrors('<p></p><a href=""')).toContain('Последний тег оборван — не хватает символа >.');
    expect(findMarkupErrors('<img src="" alt=""><br><input />')).toEqual([]);
  });
});

describe('EmmetService', () => {
  it('извлекает сокращение слева от курсора', () => {
    expect(extractAbbreviation('  ul>li*3', 9)).toMatchObject({ abbreviation: 'ul>li*3', start: 2 });
    expect(extractAbbreviation('a[href=#about]{О нас}', 21)?.abbreviation).toBe('a[href=#about]{О нас}');
    expect(extractAbbreviation('<p></p>', 7)).toBeNull();
    // В строке после HTML берётся только сокращение.
    expect(extractAbbreviation('<ul></ul>li*2', 13)?.abbreviation).toBe('li*2');
    // Пробел вне {…} — в строке не одно сокращение, берётся последнее.
    expect(extractAbbreviation('see ul>li', 9)?.abbreviation).toBe('ul>li');
  });

  it('не даёт спрятать готовый HTML в текст {…}', () => {
    expect(() => expandAbbreviation('{<p class="caption">Фото дня</p>}')).toThrow(/нельзя писать HTML-теги/);
    expect(() => expandAbbreviation('p{a > b}')).toThrow();
    expect(expandAbbreviation('p.caption{Фото дня}').html).toBe('<p class="caption">Фото дня</p>');
  });

  it('ставит курсор в первое пустое поле', () => {
    const { html, cursor } = expandAbbreviation('ul>li*2', { withCursor: true });
    expect(html).toBe('<ul>\n  <li></li>\n  <li></li>\n</ul>');
    expect(html.slice(0, cursor)).toBe('<ul>\n  <li>');
  });
});

describe('sanitize', () => {
  it('убирает скрипты и обработчики событий', () => {
    const clean = sanitize('<p onclick="alert(1)">x</p><script>alert(1)</script><a href="javascript:alert(1)">y</a>');
    expect(clean).not.toMatch(/script|onclick|javascript:/i);
    expect(clean).toContain('data-t="p"');
  });
});
