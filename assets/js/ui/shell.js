/*
 * Tool shell — the shared iLovePDF-style workspace:
 * dropzone → file list → option panel → action bar → result card.
 */
import {
  $,
  el,
  clear,
  fmtBytes,
  download,
  toast,
  baseName,
} from '../lib/util.js';
import { icon } from '../lib/icons.js';

function fileIcon(name) {
  const lower = name.toLowerCase();
  if (lower.endsWith('.pdf')) return 'file-text';
  if (/\.(png|jpe?g|gif|webp|bmp)$/.test(lower)) return 'image';
  if (/\.(docx?|rtf)$/.test(lower)) return 'file-text';
  if (/\.(xlsx?|csv)$/.test(lower)) return 'file-spreadsheet';
  if (/\.(pptx?)$/.test(lower)) return 'file-slides';
  if (/\.(md|txt|html?)$/.test(lower)) return 'file-code';
  return 'file-text';
}

/**
 * @param {object} tool  tool descriptor from the registry
 * @param {HTMLElement} mount
 */
export function createToolView(tool, mount) {
  const state = {
    files: [],
    result: null,
    busy: false,
    panel: null,
    toolPanelNode: null,
  };

  /* ---------------------------------------------------------- structure */

  const dropzone = el('label', { class: 'dropzone' }, [
    el('div', { class: 'dropzone__icon' }, [icon('upload-cloud', 30)]),
    el('div', { class: 'dropzone__title', text: tool.dropTitle || 'Drop your file here' }),
    el('div', {
      class: 'dropzone__hint',
      text: tool.dropHint || `or click to browse — ${tool.acceptLabel || 'PDF'}`,
    }),
    el('input', { type: 'file', accept: tool.accept || '.pdf', multiple: tool.multiple ? '' : null }),
  ]);

  const fileInput = dropzone.querySelector('input');

  const fileListWrap = el('div', { class: 'filelist' });
  const toolPanelHost = el('div', { style: { marginTop: '14px' } });

  const mainColumn = el('div', {}, [
    dropzone,
    el('div', { style: { marginTop: '14px' } }, [fileListWrap]),
    toolPanelHost,
  ]);

  const sideCard = el('div', { class: 'card panel' });
  const sideColumn = el('aside', { class: 'tool-layout__side' }, [sideCard]);

  const layout = el('div', { class: 'tool-layout' }, [mainColumn, sideColumn]);

  const progressWrap = el('div', { style: { flex: '1', minWidth: '160px', display: 'none' } }, [
    el('div', { class: 'progress' }, [el('div', { class: 'progress__bar' })]),
    el('div', { class: 'actionbar__info', style: { marginTop: '6px' } }, ''),
  ]);

  const actionInfo = el('div', { class: 'actionbar__info' });
  const actionButton = el('button', { class: 'btn btn--lg' }, [
    icon('sparkles', 18),
    el('span', { text: tool.actionLabel || 'Process' }),
  ]);

  const actionBar = el('div', { class: 'actionbar' }, [
    actionInfo,
    progressWrap,
    el('div', { class: 'actionbar__spacer' }),
    actionButton,
  ]);

  mount.append(layout, actionBar);

  /* ------------------------------------------------------------ helpers */

  function setBusy(busy, label = '') {
    state.busy = busy;
    actionButton.disabled = busy || state.files.length === 0;
    progressWrap.style.display = busy ? 'block' : 'none';
    if (busy) setProgress(0, label);
    renderActionInfo();
  }

  function setProgress(ratio, label) {
    const bar = progressWrap.querySelector('.progress__bar');
    const text = progressWrap.querySelector('.actionbar__info');
    bar.style.width = `${Math.max(0, Math.min(1, ratio)) * 100}%`;
    text.textContent = label || '';
  }

  function renderActionInfo() {
    clear(actionInfo);
    if (state.busy) {
      actionInfo.append('Working…');
      return;
    }
    if (!state.files.length) {
      actionInfo.append(el('span', { class: 'muted', text: 'Add a file to get started.' }));
      return;
    }
    const total = state.files.reduce((n, f) => n + f.size, 0);
    actionInfo.append(
      el('div', {}, [
        el('strong', { text: `${state.files.length} file${state.files.length > 1 ? 's' : ''}` }),
        ` · ${fmtBytes(total)}`,
      ])
    );
    if (state.files[0].info) {
      const bits = [state.files[0].info.pages ? `${state.files[0].info.pages} pages` : null, state.files[0].info.detail]
        .filter(Boolean)
        .join(' · ');
      if (bits) actionInfo.append(el('div', { class: 'muted', text: bits }));
    }
  }

  async function addFiles(list) {
    const incoming = Array.from(list || []);
    if (!incoming.length) return;
    const accepted = [];
    for (const file of incoming) {
      if (tool.validate && !tool.validate(file)) {
        toast(`“${file.name}” is not a supported file for this tool.`, 'error');
        continue;
      }
      accepted.push(file);
    }
    if (!accepted.length) return;

    if (!tool.multiple) {
      state.files.length = 0;
      clear(toolPanelHost);
    }

    for (const file of accepted) {
      const entry = { file, name: file.name, size: file.size, info: null, thumb: null };
      state.files.push(entry);
      renderFiles();
      enrich(entry);
    }
    await rebuildPanel();
  }

  async function enrich(entry) {
    try {
      const mod = await import('../lib/pdfjs.js');
      const data = new Uint8Array(await entry.file.arrayBuffer());
      const doc = await mod.openDocument(data);
      entry.info = { pages: doc.numPages };
      entry.thumb = await mod.renderPageToDataUrl(await doc.getPage(1), { scale: 0.4 });
      await doc.destroy();
    } catch {
      entry.info = { detail: fmtBytes(entry.size) };
    }
    renderFiles();
  }

  function removeFile(index) {
    state.files.splice(index, 1);
    state.result = null;
    renderFiles();
    renderResult();
    rebuildPanel();
  }

  function moveFile(index, delta) {
    const target = index + delta;
    if (target < 0 || target >= state.files.length) return;
    const [item] = state.files.splice(index, 1);
    state.files.splice(target, 0, item);
    renderFiles();
    rebuildPanel();
  }

  function renderFiles() {
    clear(fileListWrap);
    dropzone.style.display = state.files.length ? 'none' : '';
    if (!state.files.length) {
      renderActionInfo();
      return;
    }

    state.files.forEach((entry, index) => {
      const thumb = el('div', { class: 'filerow__thumb' }, [icon(fileIcon(entry.name), 18)]);
      if (entry.thumb) {
        clear(thumb);
        thumb.append(el('img', { src: entry.thumb, alt: '' }));
      }

      const meta = [];
      if (entry.info?.pages) meta.push(`${entry.info.pages} page${entry.info.pages > 1 ? 's' : ''}`);
      meta.push(fmtBytes(entry.size));

      const actions = el('div', { class: 'filerow__actions' });
      if (tool.multiple && state.files.length > 1) {
        actions.append(
          el('button', {
            class: 'btn btn--ghost btn--icon',
            title: 'Move up',
            onclick: () => moveFile(index, -1),
          }, [icon('arrow-up', 16)]),
          el('button', {
            class: 'btn btn--ghost btn--icon',
            title: 'Move down',
            onclick: () => moveFile(index, 1),
          }, [icon('arrow-down', 16)])
        );
      }
      actions.append(
        el('button', {
          class: 'btn btn--ghost btn--icon',
          title: 'Remove',
          onclick: () => removeFile(index),
        }, [icon('trash', 16)])
      );

      fileListWrap.append(
        el('div', { class: 'filerow' }, [
          thumb,
          el('div', { class: 'filerow__body' }, [
            el('div', { class: 'filerow__name', text: entry.name, title: entry.name }),
            el('div', { class: 'filerow__meta', text: meta.join(' · ') }),
          ]),
          actions,
        ])
      );
    });

    if (tool.multiple) {
      fileListWrap.append(
        el('button', {
          class: 'btn btn--outline btn--sm',
          style: { alignSelf: 'flex-start' },
          onclick: () => fileInput.click(),
        }, [icon('plus', 15), el('span', { text: 'Add more files' })])
      );
    }

    renderActionInfo();
  }

  /* ------------------------------------------------------- tool panel */

  async function rebuildPanel() {
    clear(sideCard);
    state.panel = null;

    if (!state.files.length) {
      sideCard.append(
        el('div', { class: 'panel__title', text: tool.name }),
        el('div', { class: 'panel__desc', text: tool.sideHint || tool.desc })
      );
      actionButton.disabled = true;
      return;
    }

    const ctx = {
      files: state.files.map((f) => f.file),
      entries: state.files,
      progress: setProgress,
      toast,
    };

    let built = null;
    try {
      built = tool.options ? await tool.options(ctx) : null;
    } catch (err) {
      toast(err.message || 'Could not build the options panel.', 'error');
    }

    state.panel = built;
    const node = built?.node;
    if (node) {
      if (built.placement === 'main') {
        clear(toolPanelHost);
        toolPanelHost.append(node);
      } else {
        sideCard.append(node);
      }
    }

    if (!sideCard.childElementCount) {
      sideCard.append(
        el('div', { class: 'panel__title', text: tool.name }),
        el('div', { class: 'panel__desc', text: tool.sideHint || tool.desc })
      );
    }

    actionButton.disabled = false;
    renderActionInfo();
  }

  /* ------------------------------------------------------------ result */

  function renderResult() {
    const existing = sideColumn.querySelector('.result');
    if (existing) existing.remove();
    if (!state.result) return;

    const stats = el(
      'div',
      { class: 'result__stats' },
      (state.result.stats || []).map((s) =>
        el('div', { class: `stat ${s.good ? 'stat--good' : ''}` }, [
          el('div', { class: 'stat__label', text: s.label }),
          el('div', { class: 'stat__value', text: s.value }),
        ])
      )
    );

    const card = el('div', { class: 'card result' }, [
      el('div', { class: 'result__icon' }, [icon('check-circle', 28)]),
      el('div', { class: 'result__title', text: state.result.title || 'Done!' }),
      state.result.description ? el('div', { class: 'result__desc', text: state.result.description }) : null,
      stats.childElementCount ? stats : null,
      el('div', { class: 'result__actions' }, [
        el('button', {
          class: 'btn',
          onclick: () => download(state.result.blob, state.result.filename),
        }, [icon('download', 17), el('span', { text: 'Download file' })]),
        el('button', {
          class: 'btn btn--outline',
          onclick: () => {
            state.result = null;
            renderResult();
          },
        }, [icon('refresh-cw', 16), el('span', { text: 'Start over' })]),
      ]),
    ]);

    sideColumn.append(card);
  }

  /* ------------------------------------------------------------- wiring */

  fileInput.addEventListener('change', async (e) => {
    await addFiles(e.target.files);
    e.target.value = '';
  });

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('is-over');
  });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('is-over'));
  dropzone.addEventListener('drop', async (e) => {
    e.preventDefault();
    dropzone.classList.remove('is-over');
    await addFiles(e.dataTransfer.files);
  });

  // Prevent the browser from navigating away when a file is dropped outside the zone.
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  actionButton.addEventListener('click', async () => {
    if (state.busy || !state.files.length) return;
    let options = {};
    try {
      options = state.panel?.read ? state.panel.read() : {};
    } catch (err) {
      toast(err.message || 'Invalid options.', 'error');
      return;
    }

    setBusy(true, 'Preparing…');
    try {
      const ctx = {
        files: state.files.map((f) => f.file),
        entries: state.files,
        options,
        progress: setProgress,
        toast,
        host: toolPanelHost,
      };
      const result = await tool.run(ctx);
      state.result = result;
      renderResult();
      toast(result.title || 'Finished.', 'success');
    } catch (err) {
      console.error(err);
      toast(err?.message || 'Something went wrong while processing the file.', 'error');
    } finally {
      setBusy(false);
    }
  });

  renderFiles();
  rebuildPanel();

  return {
    destroy() {
      mount.innerHTML = '';
    },
  };
}

export { baseName };
