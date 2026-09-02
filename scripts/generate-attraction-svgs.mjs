import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ATTRACTIONS_DATA } from '../server/attractions-data.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const COLOR_MAP = {
  gold: { bg1: '#3a270d', bg2: '#181206', accent: '#f59e0b', text: '#fef3c7', tagBg: 'rgba(245,158,11,0.2)' },
  red: { bg1: '#3d0e0e', bg2: '#1a0606', accent: '#ef4444', text: '#fee2e2', tagBg: 'rgba(239,68,68,0.2)' },
  blue: { bg1: '#0e243d', bg2: '#06101a', accent: '#3b82f6', text: '#dbeafe', tagBg: 'rgba(59,130,246,0.2)' },
  green: { bg1: '#0d3622', bg2: '#061a10', accent: '#10b981', text: '#d1fae5', tagBg: 'rgba(16,185,129,0.2)' },
  purple: { bg1: '#2b103d', bg2: '#13061a', accent: '#a855f7', text: '#f3e8ff', tagBg: 'rgba(168,85,247,0.2)' },
  teal: { bg1: '#0c3538', bg2: '#05181a', accent: '#14b8a6', text: '#ccfbf1', tagBg: 'rgba(20,184,166,0.2)' }
};

function generateSvg(item) {
  const c = COLOR_MAP[item.tone] || COLOR_MAP.gold;
  const tagsText = item.tags.slice(0, 3).map((t, idx) => `
    <g transform="translate(${40 + idx * 95}, 270)">
      <rect width="85" height="26" rx="13" fill="${c.tagBg}" stroke="${c.accent}" stroke-width="1" />
      <text x="42.5" y="17" fill="${c.accent}" font-size="12" font-weight="600" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif">${t}</text>
    </g>
  `).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 360" width="100%" height="100%">
  <defs>
    <linearGradient id="grad-${item.id}" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${c.bg1}" />
      <stop offset="100%" stop-color="${c.bg2}" />
    </linearGradient>
    <radialGradient id="glow-${item.id}" cx="75%" cy="30%" r="60%">
      <stop offset="0%" stop-color="${c.accent}" stop-opacity="0.35" />
      <stop offset="100%" stop-color="${c.accent}" stop-opacity="0" />
    </radialGradient>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="#000" flood-opacity="0.5" />
    </filter>
  </defs>

  <rect width="600" height="360" rx="16" fill="url(#grad-${item.id})" />
  <rect width="600" height="360" rx="16" fill="url(#glow-${item.id})" />

  <!-- Background Decorative Grid & Wave Lines -->
  <g opacity="0.08" stroke="#ffffff" stroke-width="1">
    <line x1="0" y1="90" x2="600" y2="90" />
    <line x1="0" y1="180" x2="600" y2="180" />
    <line x1="0" y1="270" x2="600" y2="270" />
    <line x1="150" y1="0" x2="150" y2="360" />
    <line x1="300" y1="0" x2="300" y2="360" />
    <line x1="450" y1="0" x2="450" y2="360" />
  </g>

  <!-- Big Decorative Icon Watermark -->
  <text x="470" y="240" font-size="140" fill="${c.accent}" opacity="0.16" font-family="'PingFang SC', 'Microsoft YaHei', sans-serif" font-weight="900" text-anchor="middle">${item.icon}</text>

  <!-- District Badge -->
  <g transform="translate(40, 40)">
    <rect width="70" height="24" rx="6" fill="${c.accent}" />
    <text x="35" y="16" fill="#18181b" font-size="12" font-weight="700" text-anchor="middle" font-family="system-ui, sans-serif">${item.district}</text>
  </g>

  <!-- Attraction Title -->
  <text x="40" y="115" fill="#ffffff" font-size="32" font-weight="800" font-family="'PingFang SC', 'Microsoft YaHei', sans-serif" filter="url(#shadow)">${item.name}</text>

  <!-- Summary / Subtitle -->
  <text x="40" y="155" fill="${c.text}" font-size="15" font-weight="400" font-family="'PingFang SC', 'Microsoft YaHei', sans-serif" opacity="0.9">
    <tspan x="40" dy="0">${item.summary.slice(0, 24)}</tspan>
    <tspan x="40" dy="24">${item.summary.slice(24)}</tspan>
  </text>

  <!-- Key Attributes Line -->
  <g transform="translate(40, 225)" font-size="13" font-family="system-ui, sans-serif">
    <text fill="#94a3b8">⏱️ 游玩时长：<tspan fill="#e2e8f0" font-weight="600">${item.duration}</tspan></text>
    <text x="180" fill="#94a3b8">🎫 门票：<tspan fill="#e2e8f0" font-weight="600">${item.ticket.split('·')[0]}</tspan></text>
    <text x="330" fill="#94a3b8">🚶 强度：<tspan fill="${item.walkDifficulty === '低' ? '#34d399' : '#fbbf24'}" font-weight="600">${item.walkDifficulty === '低' ? '轻松少走' : item.walkDifficulty === '待核验' ? '待核验' : '适中步行'}</tspan></text>
  </g>

  <!-- Tags -->
  ${tagsText}
</svg>`;
}

async function run() {
  for (const item of ATTRACTIONS_DATA) {
    const svg = generateSvg(item);
    await writeFile(path.join(ROOT, 'images', 'attractions', `${item.id}.svg`), svg, 'utf8');
    await writeFile(path.join(ROOT, 'outputs', 'attractions', `${item.id}.svg`), svg, 'utf8');
  }

  // Create default attraction hero svg
  const defaultHeroSvg = generateSvg({
    id: 'cq-default-hero',
    name: '渝游智策 · 8D魔幻山城',
    district: '重庆核心地标',
    category: '城市',
    tags: ['少走路', '8D魔幻', '山城夜景'],
    icon: '渝',
    tone: 'gold',
    summary: '高低错落的吊脚楼与轻轨穿楼，两江交汇处的璀璨千厮门与洪崖洞。',
    walk: '地铁/轻轨直达',
    duration: '2 - 3 天定制',
    ticket: '全城经典聚合',
    walkDifficulty: '低'
  });
  await writeFile(path.join(ROOT, 'outputs', 'attraction-hero.svg'), defaultHeroSvg, 'utf8');
  await writeFile(path.join(ROOT, 'images', 'attraction-hero.svg'), defaultHeroSvg, 'utf8');
  console.log(`Successfully generated SVGs for ${ATTRACTIONS_DATA.length} attractions in both images/ and outputs/!`);
}

run();
