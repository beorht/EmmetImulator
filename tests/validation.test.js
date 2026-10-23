// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { history, undo, redo, isolateHistory } from '@codemirror/commands';
import { validate, findMarkupErrors, findHandwrittenMarkup, Status } from '../src/services/ValidationService.js';
import { handwrittenTracking, handwrittenRanges } from '../src/services/HandwrittenTracker.js';
import { expandAbbreviation, extractAbbreviation } from '../src/services/EmmetService.js';
import { ExerciseStore, isPractice } from '../src/services/ExerciseStore.js';
import { sanitize } from '../src/components/PreviewFrame.js';

const store = new ExerciseStore();
const byId = (id) => store.list.find((exercise) => exercise.id === id);
const list = byId('emmet-006'); // ul>li*3

describe('ExerciseStore', () => {
  it('каждое упражнение и демо разворачиваются Emmet без ошибок', () => {
    for (const exercise of store.list) {
      expect(exercise.expectedHtml).toContain('<');
      if (isPractice(exercise)) continue;
      expect(() => expandAbbreviation(exercise.demo.abbreviation)).not.toThrow();
      expect(exercise.demo.abbreviation).not.toBe(exercise.emmetExpression);
    }
  });

  it('после обучения идут 20 практических работ: 4 простых, 3 средних, 13 сложных', () => {
    const practice = store.list.filter(isPractice);
    expect(practice).toHaveLength(20);
    expect(store.list.slice(-20)).toEqual(practice);
    const byLevel = (level) => practice.filter((exercise) => exercise.difficulty === level).length;
    expect([byLevel(1), byLevel(2), byLevel(3)]).toEqual([4, 3, 13]);
    for (const exercise of practice) {
      expect(exercise.hints, exercise.id).toBeUndefined();
      expect(exercise.demo, exercise.id).toBeUndefined();
    }
    expect(store.positionOf(practice[0])).toEqual({ number: 1, total: 20 });
  });

  it('эталонное развёртывание проходит собственную проверку', () => {
    for (const exercise of store.list) {
      const { html } = expandAbbreviation(exercise.emmetExpression);
      expect(validate(html, exercise).status, exercise.id).toBe(Status.success);
    }
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
      byId('emmet-009'),
    );
    expect(result.status).toBe(Status.partial);
    expect(result.message).toBe('У <li> нет класса item3.');
  });

  it('проверяет текст и значения атрибутов', () => {
    const link = byId('emmet-008');
    expect(validate('<a href="#about">Контакты</a>', link).message)
      .toBe('Текст в <a> должен быть «О нас», а не «Контакты».');
    expect(validate('<a href="#">О нас</a>', link).message)
      .toBe('У <a> атрибут href должен быть «#about», а не «#».');
  });

  it('пустое ожидаемое значение атрибута принимает любое', () => {
    const result = validate('<nav><a href="/home">Домой</a></nav>', byId('emmet-004'));
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
    expect(validate(code, byId('emmet-008'), { handwritten: [at(code, '#about'), at(code, 'О нас')] }).status)
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
    const result = validate(code, byId('emmet-002'), { handwritten: [typed] });
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
