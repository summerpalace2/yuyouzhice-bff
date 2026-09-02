import { escapeHtml } from './security.js';

/**
 * 结构化事实辅助构建器
 */
export function fact(label, value, status = '未知', note = '') {
  return { label, value, status, note };
}

/**
 * 根据事实确定性状态返回对应的 CSS 语义类名
 */
export function factClass(status) {
  if (status === '未知') return 'fact-unknown';
  if (status === '动态') return 'fact-dynamic';
  if (status === '冲突') return 'fact-conflict';
  return '';
}

/**
 * 渲染事实列表 HTML 标记
 */
export function factLines(facts = []) {
  return facts
    .map(
      (item) =>
        `<div class="fact-line"><span>${escapeHtml(item.label)}</span><b class="${factClass(item.status)}">${escapeHtml(item.value)}</b></div>`
    )
    .join('');
}

/**
 * 渲染事实引用 Citation 徽章 HTML 标记
 */
export function citations(items = []) {
  return items
    .map(
      (item) =>
        `<span class="citation" title="${escapeHtml(item.note || '')}">${escapeHtml(item.title)} · ${escapeHtml(item.endpoint)}</span>`
    )
    .join('');
}
