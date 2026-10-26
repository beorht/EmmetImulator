import boxesCss from '../styles/boxes.css?raw';

/**
 * Изолированный предпросмотр HTML.
 * iframe с пустым sandbox: без скриптов, без доступа к родительскому окну,
 * без отправки форм. CSP внутри документа запрещает внешние загрузки.
 */

const BLOCKED_TAGS = 'script, iframe, frame, object, embed, link, meta, base, style, template';

const BASE_STYLES = `
  :root { color-scheme: light; }
  html, body { margin: 0; }
  * { user-select: none; }
`;

const PLAIN_STYLES = `
  body {
    padding: 12px 14px;
    font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
    color: #3D3A36;
    background: #FFFDF9;
  }
  [data-t] { outline: 1px dashed #D9CBB5; outline-offset: 2px; }
  [data-t]:empty::before {
    content: "<" attr(data-t) ">";
    font: 11px/1.4 ui-monospace, monospace;
    color: #A8977E;
  }
  h1, h2, h3, p, ul, ol { margin: 6px 0; }
  a { color: #8A5F35; }
  button, input { font: inherit; }
  img { min-width: 40px; min-height: 28px; background: #F3ECE1; }
`;

/** Контейнеры рисуются на схеме коробками, остальные элементы получают метку тега. */
export const CONTAINER_TAGS = new Set(['div', 'header', 'nav', 'main', 'footer', 'section', 'article', 'aside']);

const BOXES_STYLES = `
  ${boxesCss}
  body.boxes { padding: 14px; background: #FFFDF9; }
  body.boxes:empty::before { content: "Пока пусто"; font-size: 13px; color: #A8977E; }
`;

const CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:";

/**
 * Очищает HTML для показа. stripNames — убрать id и class после подписей:
 * так пример, вставленный прямо в страницу, не подхватит её собственные стили (.btn, .card).
 */
export function sanitize(html, { stripNames = false } = {}) {
  const template = document.createElement('template');
  template.innerHTML = html;
  const root = template.content;

  root.querySelectorAll(BLOCKED_TAGS).forEach((node) => node.remove());
  root.querySelectorAll('*').forEach((element) => {
    for (const { name, value } of [...element.attributes]) {
      if (name.startsWith('on') || /^\s*javascript:/i.test(value)) element.removeAttribute(name);
    }
    // Подпись тега для пустых элементов — чтобы была видна сама структура.
    const tag = element.tagName.toLowerCase();
    element.setAttribute('data-t', tag);
    // Подпись для схемы коробок: div.card, h1#logo, button#buy.btn.
    const id = element.id.trim().split(/\s+/)[0];
    const classes = [...element.classList];
    element.setAttribute('data-label', `${tag}${id ? `#${id}` : ''}${classes.map((name) => `.${name}`).join('')}`);
    if (!CONTAINER_TAGS.has(tag)) element.setAttribute('data-kind', id ? 'id' : classes.length ? 'class' : 'tag');
    if (stripNames) {
      element.removeAttribute('id');
      element.removeAttribute('class');
    }
  });

  const container = document.createElement('div');
  container.append(root);
  return container.innerHTML;
}

/** Чистый HTML: стили браузера по умолчанию, ничего своего — как страница без CSS. */
const CLEAN_STYLES = `
  body { background: #FFFFFF; }
`;

const VARIANTS = {
  plain: { styles: PLAIN_STYLES, bodyClass: '' },
  clean: { styles: CLEAN_STYLES, bodyClass: '' },
  boxes: { styles: BOXES_STYLES, bodyClass: ' class="boxes"' },
};

export class PreviewFrame {
  /**
   * variant: 'plain' — разметка с пунктиром тегов, 'clean' — чистый HTML как в браузере,
   * 'boxes' — схема контейнеров.
   */
  constructor({ title, variant = 'plain' }) {
    this.variant = variant;
    this.html = '';
    this.element = document.createElement('iframe');
    this.element.className = 'preview-frame';
    this.element.title = title;
    this.element.setAttribute('sandbox', '');
    this.element.setAttribute('referrerpolicy', 'no-referrer');
    this.render('');

    // Chrome не рисует изолированный (sandbox) iframe, загруженный внутри скрытого блока:
    // тетрадь, теория и половинки образца переключаются через display: none. Когда окно
    // становится видимым, вставляем его заново — iframe перезагружается и рисуется.
    if (typeof ResizeObserver !== 'undefined') {
      let hidden = true;
      new ResizeObserver(([entry]) => {
        const visible = entry.contentRect.width > 0 && entry.contentRect.height > 0;
        if (visible && hidden) this.reattach();
        hidden = !visible;
      }).observe(this.element);
    }
  }

  reattach() {
    const { parentNode, nextSibling } = this.element;
    if (parentNode) parentNode.insertBefore(this.element, nextSibling);
  }

  /** Сменить вид, не теряя показанный код. */
  setVariant(variant) {
    if (variant === this.variant) return;
    this.variant = variant;
    this.render(this.html);
  }

  render(html) {
    this.html = html;
    const { styles, bodyClass } = VARIANTS[this.variant];
    this.element.srcdoc = `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<style>${BASE_STYLES}${styles}</style></head>
<body${bodyClass}>${sanitize(html)}</body></html>`;
  }
}
