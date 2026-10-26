/**
 * Проверка ответа ученика.
 * Сравнивается нормализованная структура DOM, а не исходный текст:
 * отступы, переносы строк и порядок атрибутов на результат не влияют.
 */

export const Status = {
  idle: 'idle',
  success: 'success',
  partial: 'partial',
  error: 'error',
  mismatch: 'mismatch',
};

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'source', 'track', 'wbr',
]);

const TAG_PATTERN = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;

/** Ищет незакрытые и лишние теги — браузерный парсер такие ошибки молча исправляет. */
export function findMarkupErrors(source) {
  const errors = [];
  const stack = [];

  for (const match of source.matchAll(TAG_PATTERN)) {
    const [whole, closing, rawName, rest] = match;
    if (!rawName) continue; // комментарий
    const name = rawName.toLowerCase();

    if (closing) {
      const openIndex = stack.lastIndexOf(name);
      if (openIndex === -1) {
        errors.push(`Лишний закрывающий тег </${name}> — для него нет открывающего.`);
        continue;
      }
      for (const unclosed of stack.splice(openIndex).slice(1).reverse()) {
        errors.push(`Тег <${unclosed}> не закрыт до </${name}>.`);
      }
      continue;
    }

    if (countQuotes(rest) % 2 !== 0) {
      errors.push(`В теге <${name}> не закрыта кавычка у атрибута.`);
    }
    if (!VOID_TAGS.has(name) && !whole.endsWith('/>')) stack.push(name);
  }

  const withoutComments = source.replace(/<!--[\s\S]*?-->/g, '');
  if (/<\/?[a-zA-Z][^>]*$/.test(withoutComments)) {
    errors.push('Последний тег оборван — не хватает символа >.');
  }

  for (const unclosed of stack.reverse()) {
    errors.push(`Тег <${unclosed}> открыт, но не закрыт.`);
  }
  return errors;
}

function countQuotes(text) {
  // Кавычки внутри пары кавычек другого типа не считаем.
  const stripped = text.replace(/"[^"]*"|'[^']*'/g, '');
  return (stripped.match(/["']/g) ?? []).length;
}

/** Превращает HTML в дерево { tag, attrs, text, children } без пробельных узлов. */
export function parseTree(html) {
  const template = document.createElement('template');
  template.innerHTML = html;
  return toNodes(template.content);
}

function toNodes(parent) {
  const nodes = [];
  for (const child of parent.childNodes) {
    if (child.nodeType !== 1) continue;
    const attrs = new Map();
    for (const { name, value } of child.attributes) {
      attrs.set(name, name === 'class' ? normalizeClasses(value) : value);
    }
    const text = [...child.childNodes]
      .filter((node) => node.nodeType === 3)
      .map((node) => node.textContent)
      .join(' ');
    nodes.push({
      tag: child.tagName.toLowerCase(),
      attrs,
      text: collapse(text),
      children: toNodes(child.content ?? child),
    });
  }
  return nodes;
}

const collapse = (text) => text.replace(/\s+/g, ' ').trim();
const normalizeClasses = (value) => value.split(/\s+/).filter(Boolean).sort().join(' ');

function skeleton(nodes) {
  return nodes.map((node) => `${node.tag}(${skeleton(node.children)})`).join(',');
}

const label = (node) => `<${node.tag}>`;
const ordinal = (index) => `${index + 1}-й`;

/** Первое структурное расхождение: не тот тег, не то количество, не та вложенность. */
function findStructureIssue(expected, actual, parent) {
  const where = parent ? `Внутри ${label(parent)}` : 'На верхнем уровне';

  if (expected.length !== actual.length) {
    const tags = new Set([...expected, ...actual].map((node) => node.tag));
    for (const tag of tags) {
      const need = expected.filter((node) => node.tag === tag).length;
      const have = actual.filter((node) => node.tag === tag).length;
      if (need > have) {
        return need === 1
          ? `${where} не хватает элемента <${tag}>.`
          : `${where} должно быть ${need} × <${tag}>, сейчас ${have}.`;
      }
      if (have > need) {
        return need === 0
          ? `${where} лишний элемент <${tag}>.`
          : `${where} должно быть ${need} × <${tag}>, сейчас ${have}.`;
      }
    }
    return `${where} другое количество элементов.`;
  }

  for (let i = 0; i < expected.length; i += 1) {
    const need = expected[i];
    const have = actual[i];
    if (need.tag !== have.tag) {
      const position = expected.length > 1 ? `${ordinal(i)} элемент` : 'Элемент';
      const scope = parent ? ` внутри ${label(parent)}` : '';
      return `${position}${scope} должен быть <${need.tag}>, а сейчас <${have.tag}>.`;
    }
    const nested = findStructureIssue(need.children, have.children, have);
    if (nested) return nested;
  }
  return null;
}

/**
 * Расхождения в атрибутах и тексте при уже совпавшей структуре.
 * Пустое ожидаемое значение означает «атрибут должен быть, значение — любое».
 */
function findDetailIssues(expected, actual, issues = []) {
  expected.forEach((need, i) => {
    const have = actual[i];
    const name = label(have);

    for (const [attr, value] of need.attrs) {
      if (!have.attrs.has(attr)) {
        issues.push(
          attr === 'class' ? `У ${name} нет класса ${value}.` : `У ${name} нет атрибута ${attr}.`,
        );
        continue;
      }
      if (!value) continue;
      const actualValue = have.attrs.get(attr);
      if (attr === 'class') {
        const present = new Set(actualValue.split(' '));
        const missing = value.split(' ').filter((cls) => !present.has(cls));
        if (missing.length) issues.push(`У ${name} не хватает класса ${missing.join(', ')}.`);
      } else if (actualValue !== value) {
        issues.push(`У ${name} атрибут ${attr} должен быть «${value}», а не «${actualValue}».`);
      }
    }

    if (need.text && need.text !== have.text) {
      issues.push(
        have.text
          ? `Текст в ${name} должен быть «${need.text}», а не «${have.text}».`
          : `В ${name} не хватает текста «${need.text}».`,
      );
    }

    findDetailIssues(need.children, have.children, issues);
  });
  return issues;
}

/**
 * Разметка документа по символам: «t» — текст между тегами,
 * «s» — синтаксис тега (скобки, имена, атрибуты), «v» — значение атрибута в кавычках.
 */
function classifyCharacters(source) {
  const kinds = new Array(source.length).fill('t');
  let inTag = false;
  let quote = null;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (!inTag) {
      if (char === '<' && /[a-zA-Z/!]/.test(source[i + 1] ?? '')) {
        inTag = true;
        kinds[i] = 's';
      }
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = null;
        kinds[i] = 's';
      } else {
        kinds[i] = 'v';
      }
      continue;
    }
    kinds[i] = 's';
    if (char === '"' || char === "'") quote = char;
    else if (char === '>') inTag = false;
  }
  return kinds;
}

/**
 * Находит участки HTML, которые ученик написал сам, а не получил через Emmet.
 * handwritten — интервалы [from, to) набранного вручную текста.
 * Разрешено вручную: текст внутри элементов и значения атрибутов в кавычках.
 * Запрещено: угловые скобки, имена тегов, имена атрибутов, знаки = и кавычки.
 */
export function findHandwrittenMarkup(source, handwritten) {
  if (!handwritten.length) return [];
  const kinds = classifyCharacters(source);
  const offending = [];
  for (const [from, to] of handwritten) {
    for (let i = from; i < Math.min(to, source.length); i += 1) {
      const char = source[i];
      const isMarkup = char === '<' || char === '>' || (kinds[i] === 's' && !/\s/.test(char));
      if (!isMarkup) continue;
      const last = offending[offending.length - 1];
      if (last && last[1] === i) last[1] = i + 1;
      else offending.push([i, i + 1]);
    }
  }
  return offending;
}

/** Короткий фрагмент вокруг нарушения для сообщения ученику. */
function snippet(source, [from, to]) {
  const start = source.lastIndexOf('<', from) > source.lastIndexOf('>', from - 1)
    ? source.lastIndexOf('<', from)
    : from;
  const end = source.indexOf('>', to - 1);
  const text = source.slice(start, end === -1 ? to : end + 1).replace(/\s+/g, ' ').trim();
  return text.length > 32 ? `${text.slice(0, 31)}…` : text;
}

/**
 * Проверяет решение.
 * context.handwritten — интервалы текста, набранного вручную (из редактора).
 */
export function validate(source, exercise, { handwritten = [] } = {}) {
  const code = source.trim();

  if (!code) {
    return {
      status: Status.mismatch,
      title: 'Пока пусто',
      message: exercise.mode === 'html'
        ? 'Напишите HTML-код в редакторе.'
        : 'Наберите сокращение в редакторе и нажмите Tab.',
    };
  }

  if (!code.includes('<') && exercise.mode === 'html') {
    return {
      status: Status.mismatch,
      title: 'Пока нет ни одного тега',
      message: 'Напишите теги с угловыми скобками или наберите сокращение Emmet отдельной строкой и нажмите Tab.',
    };
  }

  if (!code.includes('<')) {
    return {
      status: Status.mismatch,
      title: 'Сокращение не развёрнуто',
      message: 'Поставьте курсор сразу после сокращения и нажмите Tab — Emmet превратит его в HTML.',
    };
  }

  if (exercise.mode === 'emmet') {
    const offending = findHandwrittenMarkup(source, handwritten);
    if (offending.length) {
      return {
        status: Status.error,
        title: 'HTML набран вручную',
        message: `«${snippet(source, offending[0])}» напечатано руками. Сотрите и получите разметку сокращением с Tab.`,
        extra: 'Руками можно вводить только текст и значения атрибутов.',
        handwritten: offending,
      };
    }
  }

  const markupErrors = findMarkupErrors(code);
  if (markupErrors.length) {
    return {
      status: Status.error,
      title: 'Ошибка в разметке',
      message: markupErrors[0],
      extra: markupErrors.length > 1 ? `Ещё ошибок: ${markupErrors.length - 1}.` : '',
    };
  }

  const expected = parseTree(exercise.expectedHtml);
  const actual = parseTree(code);

  if (skeleton(expected) !== skeleton(actual)) {
    return {
      status: Status.mismatch,
      title: 'Структура пока другая',
      message: findStructureIssue(expected, actual, null),
    };
  }

  const issues = findDetailIssues(expected, actual);
  if (issues.length) {
    return {
      status: Status.partial,
      title: 'Почти получилось',
      message: issues[0],
      extra: issues.length > 1 ? `Осталось поправить ещё: ${issues.length - 1}.` : '',
    };
  }

  return {
    status: Status.success,
    title: 'Решение принято',
    message: 'Структура совпадает с условием задания.',
  };
}
