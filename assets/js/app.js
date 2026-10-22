/*
 * Application shell — hash router, header, home page and tool pages.
 */
import { $, el, clear } from './lib/util.js';
import { icon } from './lib/icons.js';
import { TOOLS, GROUPS, getTool, groupOf, toolsInGroup, searchToolsInGroup } from './tools/index.js';
import { createToolView } from './ui/shell.js';

/* -------------------------------------------------------------- theming */

const THEME_KEY = 'pdf-tools-theme';

function currentTheme() {
  try {
    return localStorage.getItem(THEME_KEY) || 'light';
  } catch {
    return 'light';
  }
}

function applyTheme(theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* storage may be unavailable — the theme still applies for this session */
  }
}

/* --------------------------------------------------------------- header */

function buildHeader() {
  const brand = el('a', { class: 'brand', href: '#/' }, [
    el('div', { class: 'brand__mark' }, [icon('file-text', 19)]),
    el('span', { text: 'PDF Tools' }),
    el('span', { class: 'brand__sub hide-sm', text: 'All-in-one PDF suite' }),
  ]);

  const panel = el('div', { class: 'dropdown__panel' });
  for (const group of GROUPS) {
    panel.append(el('div', { class: 'dropdown__group-title', text: group.label }));
    for (const tool of toolsInGroup(group.id)) {
      panel.append(
        el('a', { class: 'dropdown__item', href: `#/tool/${tool.id}` }, [
          icon(tool.icon, 15),
          el('span', { text: tool.name }),
        ])
      );
    }
  }

  const dropdown = el('div', { class: 'dropdown' }, [
    el('button', { class: 'nav__link', type: 'button' }, [
      icon('grid', 15),
      el('span', { text: 'All PDF tools' }),
      icon('chevron-down', 14),
    ]),
    panel,
  ]);

  const toggle = el('button', {
    class: 'theme-toggle',
    type: 'button',
    title: 'Toggle dark mode',
    'aria-label': 'Toggle dark mode',
    onclick: () => {
      const next = document.documentElement.classList.contains('dark') ? 'light' : 'dark';
      applyTheme(next);
    },
  }, [
    icon('moon', 17, 'icon-moon'),
    icon('sun', 17, 'icon-sun'),
  ]);

  return el('header', { class: 'site-header' }, [
    el('div', { class: 'container site-header__inner' }, [brand, el('nav', { class: 'nav' }, [dropdown, toggle])]),
  ]);
}

/* --------------------------------------------------------------- footer */

function buildFooter() {
  return el('footer', { class: 'site-footer' }, [
    el('div', { class: 'container site-footer__inner' }, [
      el('span', { text: 'Every tool runs locally in your browser — no file is ever uploaded.' }),
      el('div', { class: 'site-footer__links' }, [
        el('a', { href: '#/', text: 'All tools' }),
        el('a', { href: '#/tool/merge-pdf', text: 'Merge PDF' }),
        el('a', { href: '#/tool/compress-pdf', text: 'Compress PDF' }),
        el('a', { href: '#/tool/protect-pdf', text: 'Protect PDF' }),
      ]),
    ]),
  ]);
}

/* ----------------------------------------------------------------- home */

function toolCard(tool) {
  const group = groupOf(tool.group);
  const card = el(
    'a',
    {
      class: 'tool-card',
      href: `#/tool/${tool.id}`,
      style: { '--cat': group.color },
      onmousemove: (event) => {
        const rect = card.getBoundingClientRect();
        card.style.setProperty('--mx', `${event.clientX - rect.left}px`);
        card.style.setProperty('--my', `${event.clientY - rect.top}px`);
      },
    },
    [
      el('div', { class: 'tool-card__top' }, [
        el('div', { class: 'tool-card__icon' }, [icon(tool.icon, 21)]),
        icon('arrow-up-right', 16, 'tool-card__arrow'),
      ]),
      el('div', { class: 'tool-card__name', text: tool.name }),
      el('div', { class: 'tool-card__desc', text: tool.desc }),
      el('span', { class: 'tool-card__tag', text: tool.tag }),
    ]
  );
  return card;
}

function buildHome(mount) {
  const state = { group: 'all', query: '' };

  const grid = el('div', { class: 'tool-grid' });

  const chips = el('div', { class: 'chips' });
  const chipDefs = [{ id: 'all', label: 'All tools' }, ...GROUPS.map((g) => ({ id: g.id, label: g.label }))];
  const chipButtons = chipDefs.map((def) =>
    el('button', {
      type: 'button',
      class: `chip ${def.id === 'all' ? 'is-active' : ''}`,
      text: def.label,
      onclick: () => {
        state.group = def.id;
        chipButtons.forEach((b) => b.classList.remove('is-active'));
        chipButtons[chipDefs.indexOf(def)].classList.add('is-active');
        renderGrid();
      },
    })
  );
  chips.append(...chipButtons);

  const search = el('input', {
    class: 'input',
    type: 'search',
    placeholder: 'Search for a tool…',
    style: { maxWidth: '420px', margin: '0 auto' },
  });
  search.addEventListener('input', () => {
    state.query = search.value;
    renderGrid();
  });

  const counter = el('div', { class: 'muted', style: { fontSize: '0.8125rem', textAlign: 'center' } });

  function renderGrid() {
    const list = searchToolsInGroup(state.group, state.query);
    clear(grid);
    for (const tool of list) grid.append(toolCard(tool));
    counter.textContent = list.length
      ? `${list.length} tool${list.length > 1 ? 's' : ''}`
      : 'No tool matches that search.';
  }

  const hero = el('section', { class: 'hero' }, [
    el('h1', { class: 'hero__title', text: 'Every PDF tool you need' }),
    el('p', {
      class: 'hero__subtitle',
      text: 'Merge, split, compress, convert, edit and protect your documents. Everything happens inside your browser, so your files never leave your device.',
    }),
    el('div', { class: 'hero__cta' }, [
      el('a', { class: 'btn btn--lg', href: '#/tool/merge-pdf' }, [
        icon('layers', 18),
        el('span', { text: 'Merge PDFs' }),
      ]),
      el('a', { class: 'btn btn--lg btn--outline', href: '#/tool/compress-pdf' }, [
        icon('zap', 18),
        el('span', { text: 'Compress a PDF' }),
      ]),
    ]),
    el('div', { class: 'hero__stats' }, [
      el('div', {}, [el('strong', { text: String(TOOLS.length) }), document.createTextNode(' tools')]),
      el('div', {}, [el('strong', { text: '100%' }), document.createTextNode(' private')]),
      el('div', {}, [el('strong', { text: '0 B' }), document.createTextNode(' uploaded')]),
    ]),
  ]);

  const features = el('section', { class: 'features' }, [
    el('div', { class: 'feature' }, [
      el('div', { class: 'feature__icon' }, [icon('shield', 18)]),
      el('div', { class: 'feature__title', text: 'Private by design' }),
      el('div', {
        class: 'feature__text',
        text: 'Files are processed by JavaScript in this tab. Nothing is uploaded to a server.',
      }),
    ]),
    el('div', { class: 'feature' }, [
      el('div', { class: 'feature__icon' }, [icon('zap', 18)]),
      el('div', { class: 'feature__title', text: 'Fast and free' }),
      el('div', {
        class: 'feature__text',
        text: 'No account, no watermark, no limits on the number of files you process.',
      }),
    ]),
    el('div', { class: 'feature' }, [
      el('div', { class: 'feature__icon' }, [icon('settings', 18)]),
      el('div', { class: 'feature__title', text: 'Works everywhere' }),
      el('div', {
        class: 'feature__text',
        text: 'A single static page that runs on any modern browser, on any device.',
      }),
    ]),
  ]);

  mount.append(
    hero,
    el('section', { class: 'container', style: { paddingBottom: '20px' } }, [
      el('div', { style: { display: 'flex', justifyContent: 'center', marginBottom: '20px' } }, [search]),
      chips,
      counter,
      el('div', { style: { marginTop: '18px' } }, [grid]),
    ]),
    el('div', { class: 'container' }, [features])
  );

  renderGrid();
}

/* ------------------------------------------------------------ tool page */

function buildToolPage(mount, tool) {
  const group = groupOf(tool.group);

  mount.append(
    el('div', { class: 'container' }, [
      el('nav', { class: 'breadcrumb' }, [
        el('a', { href: '#/', text: 'All tools' }),
        icon('chevron-right', 13),
        el('span', { text: tool.name }),
      ]),
      el('div', { class: 'page-head' }, [
        el('div', {
          class: 'page-head__icon',
          style: { color: group.color },
        }, [icon(tool.icon, 22)]),
        el('div', {}, [
          el('div', { class: 'page-head__eyebrow', text: group.label }),
          el('h1', { class: 'page-head__title', text: tool.name }),
        ]),
      ]),
      el('p', {
        class: 'muted',
        style: { marginTop: '-14px', marginBottom: '22px', fontSize: '0.9375rem' },
        text: tool.desc,
      }),
      el('div', { id: 'tool-root' }),
    ])
  );

  const host = $('#tool-root', mount);
  createToolView(tool, host);
}

/* --------------------------------------------------------------- router */

function parseRoute() {
  const hash = location.hash.replace(/^#/, '');
  const parts = hash.split('/').filter(Boolean);
  if (!parts.length) return { name: 'home' };
  if (parts[0] === 'tool' && parts[1]) return { name: 'tool', id: parts[1] };
  return { name: 'home' };
}

let currentView = null;

function render() {
  const app = $('#app');
  if (!app) return;
  clear(app);
  currentView = null;

  const route = parseRoute();

  if (route.name === 'tool') {
    const tool = getTool(route.id);
    if (tool) {
      buildToolPage(app, tool);
      document.title = `${tool.name} — PDF Tools`;
      return;
    }
    app.append(
      el('div', { class: 'container' }, [
        el('div', { class: 'card card--pad', style: { marginTop: '40px', textAlign: 'center' } }, [
          el('h1', { class: 'page-head__title', text: 'Tool not found' }),
          el('p', { class: 'muted', style: { marginTop: '10px' }, text: 'That tool does not exist.' }),
          el('a', { class: 'btn', href: '#/', style: { marginTop: '18px' } }, [
            el('span', { text: 'Back to all tools' }),
          ]),
        ]),
      ])
    );
    document.title = 'Not found — PDF Tools';
    return;
  }

  buildHome(app);
  document.title = 'PDF Tools — every PDF tool in one place';
}

/* ----------------------------------------------------------------- boot */

function boot() {
  applyTheme(currentTheme());

  const header = buildHeader();
  const app = el('main', { id: 'app' });
  const footer = buildFooter();

  // The shell is the flex column that keeps the footer at the bottom of the
  // viewport; the app must live inside it, not next to it.
  const shell = document.querySelector('.shell') || document.body;
  shell.append(header, app, footer);

  window.addEventListener('hashchange', render);
  render();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
