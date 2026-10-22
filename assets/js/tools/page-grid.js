/* Interactive page grid used by Organize / Remove / Extract / Split. */
import { el, clear } from '../lib/util.js';
import { icon } from '../lib/icons.js';
import { openDocument, renderPageToDataUrl } from '../lib/pdfjs.js';

const MAX_THUMBS = 160;

/**
 * Build a draggable, selectable page grid.
 * @param {File} file
 * @param {{mode?: 'reorder'|'select', selected?: number[]}} options
 */
export async function buildPageGrid(file, options = {}) {
  const { mode = 'select', selected: initialSelection } = options;
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await openDocument(data);
  const total = doc.numPages;

  const pages = Array.from({ length: total }, (_, i) => ({
    index: i,
    rotation: 0,
    removed: false,
    selected: initialSelection ? initialSelection.includes(i) : mode === 'select',
  }));

  const node = el('div', { class: 'card card--pad' });
  const grid = el('div', { class: 'pagegrid' });
  const status = el('div', { class: 'card__hint', style: { marginTop: '12px' } });

  node.append(
    el('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' } }, [
      el('div', { class: 'card__title', text: mode === 'reorder' ? 'Reorder pages' : 'Choose pages' }),
      el('div', { style: { marginLeft: 'auto' } }, [
        mode === 'select'
          ? el('div', { class: 'segmented' }, [
              el('button', {
                type: 'button',
                text: 'All',
                onclick: () => {
                  pages.forEach((p) => (p.selected = true));
                  syncSelection();
                },
              }),
              el('button', {
                type: 'button',
                text: 'None',
                onclick: () => {
                  pages.forEach((p) => (p.selected = false));
                  syncSelection();
                },
              }),
            ])
          : null,
      ]),
    ]),
    grid,
    status
  );

  let dragIndex = null;

  const cards = new Map();

  function buildCard(page, position) {
    const card = el('div', {
      class: `pagecard${page.selected ? ' is-selected' : ''}`,
      draggable: mode === 'reorder' ? 'true' : null,
      dataset: { index: String(page.index) },
    });

    const thumb = el('div', { class: 'pagecard__thumb' }, [icon('file-text', 22)]);
    card.append(thumb, el('div', { class: 'pagecard__num', text: String(position + 1) }));

    if (mode === 'select') {
      card.append(el('div', { class: 'pagecard__check' }, [icon('check', 12)]));
      card.addEventListener('click', () => {
        page.selected = !page.selected;
        card.classList.toggle('is-selected', page.selected);
        updateStatus();
      });
    } else {
      const bar = el('div', { class: 'pagecard__bar' }, [
        el('button', {
          type: 'button',
          title: 'Rotate left',
          onclick: (e) => {
            e.stopPropagation();
            page.rotation = (page.rotation + 270) % 360;
            thumb.style.transform = `rotate(${page.rotation}deg)`;
          },
        }, [icon('rotate-cw', 14)]),
        el('button', {
          type: 'button',
          title: 'Delete page',
          onclick: (e) => {
            e.stopPropagation();
            page.removed = !page.removed;
            card.style.opacity = page.removed ? '0.35' : '';
            updateStatus();
          },
        }, [icon('trash', 14)]),
      ]);
      card.append(bar);

      card.addEventListener('dragstart', (e) => {
        dragIndex = page.position;
        card.classList.add('is-dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(page.position));
      });
      card.addEventListener('dragend', () => {
        card.classList.remove('is-dragging');
        dragIndex = null;
      });
      card.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      });
      card.addEventListener('drop', (e) => {
        e.preventDefault();
        if (dragIndex === null || dragIndex === page.position) return;
        const moved = pages.splice(dragIndex, 1)[0];
        pages.splice(page.position, 0, moved);
        dragIndex = page.position;
        render();
      });
    }

    cards.set(page.index, { card, thumb });
    return card;
  }

  function updateStatus() {
    const kept = pages.filter((p) => !p.removed);
    const selected = kept.filter((p) => p.selected).length;
    if (mode === 'select') {
      status.textContent = `${selected} of ${kept.length} page${kept.length === 1 ? '' : 's'} selected.`;
    } else {
      status.textContent = `${kept.length} page${kept.length === 1 ? '' : 's'} will be kept. Drag a page to reorder it.`;
    }
  }

  function syncSelection() {
    for (const page of pages) {
      const entry = cards.get(page.index);
      if (entry) entry.card.classList.toggle('is-selected', page.selected);
    }
    updateStatus();
  }

  function render() {
    clear(grid);
    pages.forEach((page, position) => {
      page.position = position;
      const card = buildCard(page, position);
      grid.append(card);
    });
    updateStatus();
  }

  render();

  // Render thumbnails lazily so huge documents stay responsive.
  const limit = Math.min(total, MAX_THUMBS);
  for (let i = 0; i < limit; i++) {
    try {
      const page = await doc.getPage(i + 1);
      const url = await renderPageToDataUrl(page, { scale: 0.32, type: 'image/jpeg', quality: 0.7 });
      const entry = cards.get(i);
      if (!entry) continue;
      clear(entry.thumb);
      entry.thumb.append(el('img', { src: url, alt: `Page ${i + 1}` }));
    } catch {
      /* keep the placeholder */
    }
  }

  return {
    node,
    total,
    pages,
    read() {
      return {
        order: pages.filter((p) => !p.removed).map((p) => p.index),
        rotations: Object.fromEntries(pages.filter((p) => p.removed === false).map((p) => [p.index, p.rotation])),
        selected: pages.filter((p) => p.selected && !p.removed).map((p) => p.index),
      };
    },
  };
}
