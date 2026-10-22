/*
 * Tool registry — every tool the app exposes.
 *
 * A tool descriptor looks like:
 *   { id, name, group, tag, desc, icon, accept, multiple,
 *     actionLabel, dropTitle, dropHint, acceptLabel, validate,
 *     options(ctx) -> { node, read, placement }, run(ctx) -> result }
 */
import { organizeTools } from './organize.js';
import { optimizeTools } from './optimize.js';
import { convertTools } from './convert.js';
import { editTools } from './edit.js';
import { securityTools } from './security.js';

export const GROUPS = [
  { id: 'organize', label: 'Organize', color: 'var(--cat-organize)' },
  { id: 'optimize', label: 'Optimize', color: 'var(--cat-optimize)' },
  { id: 'convert', label: 'Convert', color: 'var(--cat-convert)' },
  { id: 'edit', label: 'Edit', color: 'var(--cat-edit)' },
  { id: 'security', label: 'Security', color: 'var(--cat-security)' },
];

export const TOOLS = [
  ...organizeTools,
  ...optimizeTools,
  ...convertTools,
  ...editTools,
  ...securityTools,
];

const BY_ID = new Map(TOOLS.map((tool) => [tool.id, tool]));

/**
 * Extra search terms per tool, so people find a tool by the word they would
 * naturally use ("encrypt", "shrink", "black out"…) and not only by its name.
 */
const KEYWORDS = {
  'merge-pdf': ['combine', 'join', 'append', 'concatenate', 'together', 'one file'],
  'split-pdf': ['divide', 'separate', 'cut', 'break', 'range', 'interval'],
  'organize-pdf': ['sort', 'reorder', 'arrange', 'rotate', 'delete', 'shuffle', 'move pages'],
  'remove-pages': ['delete', 'cut', 'erase', 'omit', 'drop'],
  'extract-pages': ['pick', 'select', 'copy out', 'save pages', 'pull out'],
  'repair-pdf': ['fix', 'recover', 'damaged', 'corrupt', 'broken', 'restore', 'salvage'],
  'compress-pdf': ['reduce', 'shrink', 'smaller', 'optimise', 'optimize', 'size', 'weight'],
  'ocr-pdf': ['recognise', 'recognize', 'searchable', 'scanned', 'text layer', 'read'],
  'pdf-to-jpg': ['image', 'picture', 'photo', 'jpeg', 'png', 'bitmap'],
  'jpg-to-pdf': ['image', 'photo', 'picture', 'jpeg', 'png', 'webp'],
  'pdf-to-word': ['docx', 'editable', 'document', 'office'],
  'word-to-pdf': ['docx', 'document', 'office'],
  'pdf-to-excel': ['spreadsheet', 'xlsx', 'csv', 'sheet', 'table'],
  'excel-to-pdf': ['spreadsheet', 'xlsx', 'csv', 'sheet', 'table'],
  'pdf-to-powerpoint': ['pptx', 'slides', 'presentation', 'deck'],
  'powerpoint-to-pdf': ['pptx', 'slides', 'presentation', 'deck'],
  'html-to-pdf': ['webpage', 'web page', 'print', 'url', 'htm'],
  'pdf-to-pdfa': ['archival', 'pdfa', 'long term', 'archive', 'compliance'],
  'pdf-to-markdown': ['md', 'text', 'plain text', 'git'],
  'rotate-pdf': ['turn', 'orientation', 'sideways', 'upside down', 'landscape'],
  'watermark-pdf': ['stamp', 'overlay', 'confidential', 'draft'],
  'page-numbers': ['numbering', 'pagination', 'footer', 'page count'],
  'crop-pdf': ['trim', 'margins', 'cut', 'white space', 'borders'],
  'edit-pdf': ['annotate', 'add text', 'write', 'comment', 'insert'],
  'redact-pdf': ['black out', 'blackout', 'censor', 'hide', 'sensitive', 'remove text'],
  'scan-pdf': ['photo', 'camera', 'capture', 'shoot', 'photograph'],
  'unlock-pdf': ['decrypt', 'remove password', 'unprotect', 'crack', 'open password'],
  'protect-pdf': ['encrypt', 'encryption', 'password', 'lock', 'restrict', 'permissions', 'secure'],
  'sign-pdf': ['signature', 'e-sign', 'esign', 'draw', 'initials', 'sign'],
  'compare-pdf': ['diff', 'difference', 'changes', 'redline', 'revision', 'track'],
};

function haystack(tool) {
  return [tool.name, tool.desc, tool.tag, ...(KEYWORDS[tool.id] || [])]
    .join(' ')
    .toLowerCase();
}

export function getTool(id) {
  return BY_ID.get(id) || null;
}

export function groupOf(id) {
  return GROUPS.find((g) => g.id === id) || GROUPS[0];
}

export function toolsInGroup(id) {
  return TOOLS.filter((tool) => tool.group === id);
}

/** Search tools by name, description, tag and extra keywords. */
export function searchTools(query) {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return TOOLS;
  return TOOLS.filter((tool) => haystack(tool).includes(needle));
}

/** Search tools inside a single group. */
export function searchToolsInGroup(groupId, query) {
  const list = searchTools(query);
  if (!groupId || groupId === 'all') return list;
  return list.filter((tool) => tool.group === groupId);
}
