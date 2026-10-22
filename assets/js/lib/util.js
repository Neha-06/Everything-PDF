/* Small DOM + file helpers shared by every tool. */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/**
 * Apply a style object to a node. Custom properties (`--x`) must go through
 * `setProperty` — assigning them on the style object is a silent no-op.
 */
function setStyle(node, styles) {
  for (const [prop, value] of Object.entries(styles || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (prop.startsWith('--')) node.style.setProperty(prop, String(value));
    else node.style[prop] = value;
  }
}

/**
 * Terse element factory.
 * el('div', { class: 'x', onclick: fn }, 'text' | childNode | [children])
 */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'style' && typeof value === 'object') setStyle(node, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, value);
  }
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function clear(node) {
  while (node && node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function fmtBytes(bytes) {
  if (!Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[i]}`;
}

export function fmtPct(value) {
  if (!Number.isFinite(value)) return '—';
  return `${Math.round(value * 100)}%`;
}

export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function bytesToBlob(bytes, type = 'application/octet-stream') {
  return new Blob([bytes], { type });
}

/* ---------------------------------------------------------------- toasts */

let toastHost = null;

export function toast(message, kind = 'info', ttl = 4200) {
  if (!toastHost) {
    toastHost = el('div', { class: 'toasts' });
    document.body.append(toastHost);
  }
  const icon =
    kind === 'error'
      ? 'alert'
      : kind === 'success'
        ? 'check'
        : kind === 'info'
          ? 'info'
          : 'info';
  const node = el(
    'div',
    { class: `toast toast--${kind}` },
    [iconNode(icon, 17), el('div', { text: message })]
  );
  toastHost.append(node);
  const kill = () => {
    node.style.transition = 'opacity .2s ease, transform .2s ease';
    node.style.opacity = '0';
    node.style.transform = 'translateY(6px)';
    setTimeout(() => node.remove(), 220);
  };
  const timer = setTimeout(kill, ttl);
  node.addEventListener('click', () => {
    clearTimeout(timer);
    kill();
  });
  return node;
}

/* ---------------------------------------------------------------- modals */

export function modal({ title, desc, body, actions = [], onClose }) {
  const backdrop = el('div', { class: 'modal-backdrop' });
  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
    if (onClose) onClose();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };
  document.addEventListener('keydown', onKey);
  backdrop.addEventListener('mousedown', (e) => {
    if (e.target === backdrop) close();
  });

  const panel = el('div', { class: 'modal' }, [
    el('div', { class: 'modal__title', text: title }),
    desc ? el('div', { class: 'modal__desc', text: desc }) : null,
    body ? el('div', { class: 'modal__body', style: { marginTop: '18px' } }, body) : null,
    el(
      'div',
      { class: 'modal__actions' },
      actions.map((a) =>
        el('button', {
          class: `btn ${a.class || 'btn--secondary'}`,
          text: a.label,
          onclick: () => {
            if (a.onClick) {
              const res = a.onClick();
              if (res === false) return;
            }
            close();
          },
        })
      )
    ),
  ]);

  backdrop.append(panel);
  document.body.append(backdrop);
  const focusable = panel.querySelector('input, select, textarea, button');
  if (focusable) setTimeout(() => focusable.focus(), 40);
  return { close, panel };
}

/* ------------------------------------------------------------ form utils */

/** Build a labelled text input. */
export function textField(label, opts = {}) {
  const input = el('input', { class: 'input', type: opts.type || 'text', ...(opts.attrs || {}) });
  if (opts.value !== undefined) input.value = opts.value;
  const wrap = el('div', { class: 'field' }, [
    label ? el('label', { class: 'field__label', text: label }) : null,
    input,
    opts.hint ? el('div', { class: 'field__hint', text: opts.hint }) : null,
  ]);
  return { wrap, input, get value() { return input.value; } };
}

/** Build a labelled select. */
export function selectField(label, options, opts = {}) {
  const select = el(
    'select',
    { class: 'select' },
    options.map((o) =>
      el('option', { value: o.value, text: o.label, selected: o.value === opts.value })
    )
  );
  const wrap = el('div', { class: 'field' }, [
    label ? el('label', { class: 'field__label', text: label }) : null,
    select,
    opts.hint ? el('div', { class: 'field__hint', text: opts.hint }) : null,
  ]);
  return { wrap, select, get value() { return select.value; } };
}

/** Build a segmented radio group. */
export function segmentedField(label, options, opts = {}) {
  const buttons = options.map((o) =>
    el('button', {
      type: 'button',
      class: o.value === opts.value ? 'is-active' : '',
      text: o.label,
      onclick: () => {
        buttons.forEach((b) => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        if (opts.onChange) opts.onChange(o.value);
      },
    })
  );
  const btn = buttons[Math.max(0, options.findIndex((o) => o.value === opts.value))];
  const wrap = el('div', { class: 'field' }, [
    label ? el('label', { class: 'field__label', text: label }) : null,
    el('div', { class: 'segmented' }, buttons),
    opts.hint ? el('div', { class: 'field__hint', text: opts.hint }) : null,
  ]);
  return {
    wrap,
    get value() {
      return buttons.findIndex((b) => b.classList.contains('is-active'));
    },
  };
}

/** Build a toggle switch. */
export function switchField(label, hint, checked = false, onChange) {
  const input = el('input', { type: 'checkbox', checked: checked || undefined });
  input.addEventListener('change', () => onChange && onChange(input.checked));
  const wrap = el('div', { class: 'field' }, [
    // The whole row is the label, so the text and the track both toggle it
    // and screen readers get the visible text as the control's name.
    el('label', { class: 'switch' }, [
      el('div', { class: 'switch__text' }, [
        document.createTextNode(label),
        hint ? el('small', { text: hint }) : null,
      ]),
      el('span', { class: 'switch__track' }, [input]),
    ]),
  ]);
  return {
    wrap,
    get value() {
      return input.checked;
    },
    set value(v) {
      input.checked = !!v;
    },
  };
}

/** Build a range slider. */
export function rangeField(label, { min = 0, max = 100, step = 1, value = 50, onInput }) {
  const input = el('input', { class: 'range', type: 'range', min, max, step, value });
  const readout = el('span', { class: 'mono', style: { fontSize: '0.8125rem' }, text: String(value) });
  input.addEventListener('input', () => {
    readout.textContent = input.value;
    if (onInput) onInput(Number(input.value));
  });
  const wrap = el('div', { class: 'field' }, [
    el(
      'label',
      { class: 'field__label' },
      [document.createTextNode(label + ' '), readout]
    ),
    input,
  ]);
  return {
    wrap,
    get value() {
      return Number(input.value);
    },
  };
}

/* ------------------------------------------------------------ misc utils */

export function debounce(fn, ms = 150) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Yield to the event loop so the UI can paint between heavy steps. */
export function tick() {
  return new Promise((r) => requestAnimationFrame(() => r()));
}

export function baseName(name) {
  return name.replace(/\.[^.]+$/, '');
}

/* Icons are registered lazily to avoid a circular import with icons.js */
let iconResolver = null;
export function registerIcons(fn) {
  iconResolver = fn;
}
export function iconNode(name, size = 24) {
  if (!iconResolver) return el('span');
  return iconResolver(name, size);
}
