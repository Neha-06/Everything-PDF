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
  const dark = theme === 'dark';
  document.documentElement.classList.toggle('dark', dark);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#070e15' : '#ecf3fa');
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
    el('span', { class: 'brand__sub hide-sm', text: 'by Neha Ratna Mishra' }),
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
  const year = new Date().getFullYear();

  const brand = el('a', { class: 'brand', href: '#/' }, [
    el('div', { class: 'brand__mark' }, [icon('file-text', 19)]),
    el('span', { text: 'PDF Tools' }),
  ]);

  return el('footer', { class: 'site-footer' }, [
    el('div', { class: 'container' }, [
      el('div', { class: 'site-footer__grid' }, [
        el('div', { class: 'site-footer__brand' }, [
          brand,
          el('p', {
            class: 'site-footer__tagline',
            text: 'A complete PDF suite that runs entirely in your browser. No uploads, no accounts, no watermark.',
          }),
          el('span', { class: 'site-footer__pill' }, [
            icon('lock', 13),
            el('span', { text: '100% local' }),
          ]),
        ]),
        el('div', { class: 'site-footer__col' }, [
          el('h3', { class: 'site-footer__title', text: 'Popular tools' }),
          el('a', { href: '#/', text: 'All tools' }),
          el('a', { href: '#/tool/merge-pdf', text: 'Merge PDF' }),
          el('a', { href: '#/tool/compress-pdf', text: 'Compress PDF' }),
          el('a', { href: '#/tool/protect-pdf', text: 'Protect PDF' }),
        ]),
        el('div', { class: 'site-footer__col' }, [
          el('h3', { class: 'site-footer__title', text: 'Developer' }),
          el(
            'a',
            {
              class: 'dev-credit',
              href: 'https://github.com/Neha-06',
              target: '_blank',
              rel: 'noopener noreferrer',
              title: 'Neha Ratna Mishra on GitHub',
            },
            [
              el('span', { class: 'dev-credit__avatar', text: 'NM' }),
              el('span', { class: 'dev-credit__meta' }, [
                el('strong', { text: 'Neha Ratna Mishra' }),
                el('small', { text: 'Design & development' }),
              ]),
              icon('github', 16, 'dev-credit__icon'),
            ]
          ),
          el('p', {
            class: 'dev-credit__note',
            text: 'Built with care, one tool at a time.',
          }),
        ]),
      ]),
      el('div', { class: 'site-footer__bottom' }, [
        el('span', { text: `© ${year} Neha Ratna Mishra` }),
        el('span', { class: 'site-footer__sep', 'aria-hidden': 'true', text: '·' }),
        el('span', { class: 'site-footer__made' }, [
          icon('heart', 13, 'site-footer__heart'),
          el('span', { text: 'Runs entirely in your browser' }),
        ]),
      ]),
    ]),
  ]);
}

/* ----------------------------------------------------------------- home */

function toolCard(tool, index = 0) {
  const group = groupOf(tool.group);
  const card = el(
    'a',
    {
      class: 'tool-card',
      href: `#/tool/${tool.id}`,
      style: { '--cat': group.color, '--i': index },
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

  const chips = el('div', {
    class: 'chips',
    role: 'group',
    'aria-label': 'Filter tools by category',
  });
  const chipDefs = [{ id: 'all', label: 'All tools' }, ...GROUPS.map((g) => ({ id: g.id, label: g.label }))];
  const chipButtons = chipDefs.map((def) => {
    const group = GROUPS.find((g) => g.id === def.id);
    return el(
      'button',
      {
        type: 'button',
        class: `chip ${def.id === 'all' ? 'is-active' : ''}`,
        'aria-pressed': def.id === state.group ? 'true' : 'false',
        onclick: () => {
          state.group = def.id;
          chipButtons.forEach((b, i) => {
            const active = chipDefs[i].id === def.id;
            b.classList.toggle('is-active', active);
            b.setAttribute('aria-pressed', active ? 'true' : 'false');
          });
          renderGrid();
        },
      },
      [
        el('span', {
          class: `chip__dot${group ? '' : ' chip__dot--all'}`,
          'aria-hidden': 'true',
          style: group ? { background: group.color } : {},
        }),
        el('span', { text: def.label }),
      ]
    );
  });
  chips.append(...chipButtons);

  const search = el('input', {
    class: 'search-field__input',
    type: 'search',
    placeholder: 'Search for a tool…',
    'aria-label': 'Search for a tool',
  });
  search.addEventListener('input', () => {
    state.query = search.value;
    renderGrid();
  });

  const searchField = el('div', { class: 'search-field' }, [
    icon('search', 17, 'search-field__icon'),
    search,
    el('kbd', { class: 'search-field__kbd', text: '/' }),
  ]);

  const counter = el('div', { class: 'tool-browser__count' });

  function renderGrid() {
    const list = searchToolsInGroup(state.group, state.query);
    clear(grid);
    list.forEach((tool, index) => grid.append(toolCard(tool, index)));
    counter.textContent = list.length
      ? `${list.length} tool${list.length > 1 ? 's' : ''}`
      : 'No tool matches that search.';
  }

  const hero = el('section', { class: 'hero' }, [
    el('div', { class: 'hero__glow', 'aria-hidden': 'true' }),
    el('div', { class: 'hero__badge' }, [
      icon('sparkles', 14),
      el('span', { text: `${TOOLS.length} tools · 100% in your browser` }),
    ]),
    el('h1', { class: 'hero__title' }, [
      document.createTextNode('Every PDF tool '),
      el('span', { class: 'hero__title-accent', text: 'you need' }),
    ]),
    el('p', {
      class: 'hero__subtitle',
      text: 'Merge, split, compress, convert, edit and protect your documents. Everything happens inside your browser, so your files never leave your device.',
    }),
    el('div', { class: 'hero__cta' }, [
      el('a', { class: 'btn btn--lg', href: '#/tool/merge-pdf' }, [
        icon('layers', 18),
        el('span', { text: 'Merge PDFs' }),
        icon('arrow-right', 16, 'btn__trail'),
      ]),
      el('a', { class: 'btn btn--lg btn--outline', href: '#/tool/compress-pdf' }, [
        icon('zap', 18),
        el('span', { text: 'Compress a PDF' }),
      ]),
    ]),
    el('div', { class: 'hero__stats' }, [
      el('div', { class: 'hero__stat' }, [
        el('strong', { text: String(TOOLS.length) }),
        el('span', { text: 'tools' }),
      ]),
      el('div', { class: 'hero__stat' }, [
        el('strong', { text: '100%' }),
        el('span', { text: 'private' }),
      ]),
      el('div', { class: 'hero__stat' }, [
        el('strong', { text: '0 B' }),
        el('span', { text: 'uploaded' }),
      ]),
      el('div', { class: 'hero__stat' }, [
        el('strong', { text: 'Free' }),
        el('span', { text: 'no sign-up' }),
      ]),
    ]),
    el('p', { class: 'hero__author' }, [
      el('span', { class: 'hero__author-avatar', 'aria-hidden': 'true', text: 'NM' }),
      el('span', {}, [
        document.createTextNode('Designed & developed by '),
        el('strong', { text: 'Neha Ratna Mishra' }),
      ]),
    ]),
  ]);

  const features = el('section', { class: 'features' }, [
    el('div', { class: 'feature', style: { '--fc': 'var(--chart-4)' } }, [
      el('div', { class: 'feature__icon' }, [icon('shield', 18)]),
      el('div', { class: 'feature__title', text: 'Private by design' }),
      el('div', {
        class: 'feature__text',
        text: 'Files are processed by JavaScript in this tab. Nothing is uploaded to a server.',
      }),
    ]),
    el('div', { class: 'feature', style: { '--fc': 'var(--chart-5)' } }, [
      el('div', { class: 'feature__icon' }, [icon('zap', 18)]),
      el('div', { class: 'feature__title', text: 'Fast and free' }),
      el('div', {
        class: 'feature__text',
        text: 'No account, no watermark, no limits on the number of files you process.',
      }),
    ]),
    el('div', { class: 'feature', style: { '--fc': 'var(--chart-2)' } }, [
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
    el('section', { class: 'container tool-browser' }, [
      el('div', { class: 'search-row' }, [searchField]),
      chips,
      counter,
      el('div', { class: 'tool-grid-wrap' }, [grid]),
    ]),
    el('section', { class: 'container' }, [features])
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

  // Subtle depth change once the page scrolls under the sticky header.
  const syncHeader = () => header.classList.toggle('is-scrolled', window.scrollY > 6);
  window.addEventListener('scroll', syncHeader, { passive: true });
  syncHeader();

  // Press "/" anywhere (outside a field) to jump to tool search.
  document.addEventListener('keydown', (event) => {
    if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target;
    if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
    const input = document.querySelector('.search-field__input');
    if (!input) return;
    event.preventDefault();
    input.focus();
    input.select();
  });

  window.addEventListener('hashchange', () => {
    window.scrollTo({ top: 0, behavior: 'auto' });
    render();
  });
  render();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
