import { escapeHtml, sanitizeHtml } from './security.js';

function decodeHtmlEntities(value) {
  const named = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' '
  };
  return String(value ?? '')
    .replace(/&#x([0-9a-f]+);/gi, (match, hex) => {
      try { return String.fromCodePoint(Number.parseInt(hex, 16)); } catch { return match; }
    })
    .replace(/&#(\d+);/g, (match, decimal) => {
      try { return String.fromCodePoint(Number(decimal)); } catch { return match; }
    })
    .replace(/&([a-z]+);/gi, (match, name) => named[name.toLowerCase()] ?? match);
}

function normalizeMarkdownText(rawText) {
  return decodeHtmlEntities(String(rawText ?? ''))
    .replace(/\r\n?/g, '\n')
    .replace(/\\(?=\n)/g, '')
    .replace(/^\\?(#{1,6})(?!#)\s*/gm, '$1 ')
    .replace(/^\\?([-*])\s*/gm, '$1 ')
    .replace(/^\\?(\d+)\.\s*/gm, '$1. ');
}

/**
 * 静态 Markdown 渲染器（增强版，支持代码高亮、表格、列表与引用）
 */
export function renderMarkdownStatic(rawText) {
  if (!rawText) return '';
  let text = normalizeMarkdownText(rawText);

  // 1. Code blocks
  const codeBlocks = [];
  text = text.replace(/```(\w*)\r?\n([\s\S]*?)```/g, (match, lang, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push(`<pre class="code-block"><code class="language-${escapeHtml(lang || 'text')}">${escapeHtml(code.trim())}</code></pre>`);
    return `__CODE_BLOCK_${idx}__`;
  });

  // 2. Escape raw HTML chars
  text = escapeHtml(text);

  // 3. Inline code
  text = text.replace(/`([^`\n]+)`/g, '<code class="inline-code">$1</code>');

  // 4. Headers
  text = text.replace(/^#### (.*?)$/gm, '<h4>$1</h4>');
  text = text.replace(/^### (.*?)$/gm, '<h3>$1</h3>');
  text = text.replace(/^## (.*?)$/gm, '<h2>$1</h2>');
  text = text.replace(/^# (.*?)$/gm, '<h1>$1</h1>');

  // 5. Blockquotes
  text = text.replace(/^\> (.*?)$/gm, '<blockquote>$1</blockquote>');
  text = text.replace(/(<\/blockquote>\s*)+<blockquote>/g, '<br />');

  // 6. Bold & Italic
  text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/__(.*?)__/g, '<strong>$1</strong>');
  text = text.replace(/\*([^\*\n]+)\*/g, '<em>$1</em>');

  // 7. Links
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s\)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

  // 8. Tables
  text = text.replace(/((?:\|[^\n]+\|\r?\n)+)/g, (match) => {
    const lines = match.trim().split(/\r?\n/).filter((l) => l.trim().startsWith('|'));
    if (lines.length >= 2 && lines[1].includes('---')) {
      const headers = lines[0].split('|').slice(1, -1).map((h) => `<th>${h.trim()}</th>`).join('');
      const rows = lines.slice(2).map((r) => {
        const cells = r.split('|').slice(1, -1).map((c) => `<td>${c.trim()}</td>`).join('');
        return `<tr>${cells}</tr>`;
      }).join('');
      return `<table class="markdown-table"><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table>`;
    }
    return match;
  });

  // 9. Lists
  text = text.replace(/^[\*\-] (.*?)$/gm, '<li>$1</li>');
  text = text.replace(/(<li>.*?<\/li>(\s*<li>.*?<\/li>)*)/g, '<ul>$1</ul>');
  text = text.replace(/^\d+\. (.*?)$/gm, '<li class="ol-item">$1</li>');
  text = text.replace(/(<li class="ol-item">.*?<\/li>(\s*<li class="ol-item">.*?<\/li>)*)/g, '<ol>$1</ol>');

  // 10. Restore code blocks
  codeBlocks.forEach((block, idx) => {
    text = text.replace(`__CODE_BLOCK_${idx}__`, block);
  });

  // 11. Paragraphs & Line Breaks
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const formatted = paragraphs.map((p) => {
    if (p.startsWith('<h') || p.startsWith('<pre') || p.startsWith('<ul') || p.startsWith('<ol') || p.startsWith('<table') || p.startsWith('<blockquote')) {
      return p;
    }
    return `<p>${p.replace(/\n/g, '<br />')}</p>`;
  }).join('');

  return sanitizeHtml(formatted);
}

/**
 * 流式 Markdown 增量渲染器（支持自动补齐未闭合语法与打字机光标）
 */
export function renderMarkdownStreaming(rawText) {
  if (!rawText) return '<span class="typing-cursor">正在思考中…</span>';
  let text = normalizeMarkdownText(rawText);

  // Auto-close unclosed code block if streaming cut in the middle
  const codeBlockCount = (text.match(/```/g) || []).length;
  if (codeBlockCount % 2 === 1) {
    text += '\n```';
  }

  // Auto-close unclosed bold
  const boldCount = (text.match(/\*\*/g) || []).length;
  if (boldCount % 2 === 1) {
    text += '**';
  }

  // Auto-close unclosed inline code
  const inlineCodeCount = (text.match(/`/g) || []).length - (codeBlockCount * 3);
  if (inlineCodeCount % 2 === 1) {
    text += '`';
  }

  return renderMarkdownStatic(text) + '<span class="typing-cursor">▌</span>';
}
