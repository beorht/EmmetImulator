import { highlightHtml } from '../services/highlight.js';
import { sanitize } from './PreviewFrame.js';
import { icons } from './icons.js';

/** Шаг с теорией перед заданиями на контейнеры (по презентации «id, class и контейнеры»). */
export const CONTAINERS_LESSON = { id: 'containers-lesson', kind: 'lesson', title: 'Теория: id, class и контейнеры' };

const code = (source) => `<pre class="lesson-code"><code>${source
  .trim()
  .split('\n')
  .map((line) => highlightHtml(line))
  .join('\n')}</code></pre>`;

// Схема рисуется из того же HTML, что показан в коде, — как в заданиях.
const boxes = (source) => `<div class="lesson-render boxes">${sanitize(source.trim(), { stripNames: true })}</div>`;

const example = (source, caption = 'В браузере') => `
  <div class="lesson-example">
    ${code(source)}
    <figure class="lesson-figure">
      <figcaption>${caption}</figcaption>
      ${boxes(source)}
    </figure>
  </div>`;

const ID_EXAMPLE = `
<h1 id="logo">Мой сайт</h1>
<p>Привет!</p>`;

const CLASS_EXAMPLE = `
<p class="card">Яблоко</p>
<p class="card">Груша</p>
<p class="card">Слива</p>`;

const BOTH_EXAMPLE = `
<button class="btn">Назад</button>
<button class="btn" id="buy">Купить</button>
<button class="btn">Далее</button>`;

const DIV_EXAMPLE = `
<div class="card">
  <h2>Котик Барсик</h2>
  <p>Любит спать и есть.</p>
  <button>Погладить</button>
</div>`;

const NESTED_EXAMPLE = `
<div class="page">
  <div class="card">
    <h2>Новости</h2>
  </div>
  <div class="card">
    <h2>Погода</h2>
  </div>
</div>`;

const PAGE_EXAMPLE = `
<header>
  <h1>Мой блог</h1>
  <nav>
    <a href="#">Главная</a>
    <a href="#">Статьи</a>
  </nav>
</header>
<main>
  <h2>Новая статья</h2>
  <p>Текст статьи</p>
</main>
<footer>
  <p>2026 Мой блог</p>
</footer>`;

export class LessonView {
  constructor(root, { onStart }) {
    this.root = root;
    root.innerHTML = `
      <article class="lesson-page">
        <header class="lesson-hero">
          <p class="eyebrow">Теория · перед заданиями</p>
          <h1 class="lesson-title">id, class и контейнеры</h1>
          <p class="lesson-lead">Как давать элементам имена и раскладывать страницу по «коробкам».
            Прочитайте — дальше 10 заданий по этой теме.</p>
        </header>

        <section class="lesson-section">
          <h2 class="lesson-heading"><span class="lesson-num">1</span>id и class — имена для элементов</h2>
          <p>На странице десятки элементов. Чтобы найти нужный и потом оформить его, ему дают имя —
            <b>id</b> или <b>class</b>. Имя пишется внутри открывающего тега.</p>
          <div class="lesson-cards">
            <div class="lesson-card" data-tone="id">
              <h3><code>id</code> — как номер паспорта</h3>
              <p>У каждого свой. Два одинаковых id на одной странице быть не может.</p>
            </div>
            <div class="lesson-card" data-tone="class">
              <h3><code>class</code> — как форма команды</h3>
              <p>Одинаковую форму носят многие игроки, и все они выглядят одинаково.</p>
            </div>
          </div>

          <h3 class="lesson-subheading">id — уникальное имя</h3>
          ${example(ID_EXAMPLE)}
          <h3 class="lesson-subheading">class — общее имя для группы</h3>
          ${example(CLASS_EXAMPLE)}
          <h3 class="lesson-subheading">id и class на одном элементе</h3>
          ${example(BOTH_EXAMPLE)}
          <p>class даёт всем кнопкам одинаковую форму, а id выделяет одну — главную.
            Классов у элемента может быть несколько: <code>class="card big"</code>.</p>

          <table class="lesson-table">
            <thead><tr><th></th><th data-tone="id">id</th><th data-tone="class">class</th></tr></thead>
            <tbody>
              <tr><th>Как пишется в HTML</th><td><code>id="logo"</code></td><td><code>class="card"</code></td></tr>
              <tr><th>Как найти в CSS</th><td><code>#logo</code> — решётка</td><td><code>.card</code> — точка</td></tr>
              <tr><th>Сколько на странице</th><td>Только один элемент</td><td>Сколько угодно</td></tr>
              <tr><th>Сколько у элемента</th><td>Один id</td><td>Несколько классов</td></tr>
            </tbody>
          </table>
          <p class="lesson-tip"><b>Совет:</b> для оформления почти всегда берите class, а id — когда элемент действительно один.</p>
        </section>

        <section class="lesson-section">
          <h2 class="lesson-heading"><span class="lesson-num">2</span>div — универсальная коробка</h2>
          <p>Контейнер — это коробка для элементов. Сам по себе <code>&lt;div&gt;</code> ничего не означает и в браузере
            не виден. Его работа — <b>держать вместе</b> то, что связано.</p>
          ${example(DIV_EXAMPLE, 'Пунктир — граница div, в браузере её не видно')}
          <ul class="lesson-points">
            <li><b>Сгруппировать.</b> Связанные элементы лежат вместе, как вещи в одной коробке при переезде.</li>
            <li><b>Оформить разом.</b> Фон, рамку и отступы потом задают один раз — для всей коробки.</li>
            <li><b>Расположить.</b> Коробки можно ставить в ряд, в колонки или по центру страницы.</li>
          </ul>

          <h3 class="lesson-subheading">Коробки внутри коробок</h3>
          ${example(NESTED_EXAMPLE)}
          <p>Как матрёшка: внешняя коробка держит внутренние. <b>Отступы в коде</b> показывают, кто внутри кого.</p>
        </section>

        <section class="lesson-section">
          <h2 class="lesson-heading"><span class="lesson-num">3</span>Специальные контейнеры</h2>
          <p>Работают как div, но их <b>имя сразу говорит</b>, что лежит внутри.</p>
          <div class="lesson-cards is-four">
            <div class="lesson-card" data-tone="header"><code>&lt;header&gt;</code><h3>Шапка</h3><p>Логотип и название сайта. Обычно в самом верху.</p></div>
            <div class="lesson-card" data-tone="nav"><code>&lt;nav&gt;</code><h3>Навигация</h3><p>Меню со ссылками на разделы сайта.</p></div>
            <div class="lesson-card" data-tone="main"><code>&lt;main&gt;</code><h3>Главное</h3><p>Основное содержимое. Только один на странице.</p></div>
            <div class="lesson-card" data-tone="footer"><code>&lt;footer&gt;</code><h3>Подвал</h3><p>Контакты и подпись. В самом низу.</p></div>
          </div>

          <h3 class="lesson-subheading">Собираем страницу</h3>
          ${example(PAGE_EXAMPLE, 'Как это выглядит по коробкам')}

          <h3 class="lesson-subheading">Почему не просто div?</h3>
          <p><code>&lt;div class="header"&gt;</code> тоже работает, но <code>&lt;header&gt;</code> лучше:</p>
          <ul class="lesson-points">
            <li><b>Понятнее людям.</b> Код читается как план страницы.</li>
            <li><b>Понятнее поисковикам.</b> Google видит, где на странице главное.</li>
            <li><b>Доступнее.</b> Программы чтения с экрана помогают незрячим людям.</li>
          </ul>
        </section>

        <section class="lesson-section lesson-howto">
          <h2 class="lesson-heading"><span class="lesson-num">${icons.check}</span>Как устроены задания</h2>
          <ul class="lesson-points">
            <li>Справа вы пишете HTML — руками или через Emmet: сокращение отдельной строкой и <kbd>Tab</kbd>.</li>
            <li>Слева сверху — как ваш HTML выглядит в браузере, он обновляется, пока вы печатаете. Снизу — как он должен выглядеть.</li>
            <li>В браузере div, id и class не видны. Переключатель «Схема» покажет обе страницы коробками:
              <code>div.card</code> — коробка div с классом card, <code>h1#logo</code> — заголовок с id logo,
              серая метка — просто тег без имени.</li>
            <li>Когда всё совпадёт, нажмите <kbd>Ctrl</kbd>+<kbd>Enter</kbd> или «Проверить». CSS не нужен — только HTML.</li>
          </ul>
          <button class="btn btn-primary lesson-start" type="button">К заданиям${icons.next}</button>
        </section>
      </article>
    `;
    root.querySelector('.lesson-start').addEventListener('click', onStart);
  }

  show() {
    this.root.scrollTop = 0;
  }
}
