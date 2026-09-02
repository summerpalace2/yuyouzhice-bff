import { state } from '../app-core/state.js';
import { chatPanel } from '../features/trip-chat/chat-panel.js';

export function guestChatView() {
  const messageCount = Array.isArray(state.chatMessages) ? state.chatMessages.length : 0;
  return `
    <main class="page shell guest-page">
      <section class="guest-hero">
        <div class="guest-hero-copy">
          <span class="eyebrow">游客体验 · 先聊聊再决定</span>
          <h1>先问问悠悠，<br /><em>再决定去哪里</em></h1>
          <p>这里是独立的游客聊天空间。你可以咨询重庆景点、天气、交通和美食；完整行程规划与保存功能需要注册账号。</p>
          <div class="guest-hero-actions">
            <button class="primary" data-action="open-auth-page" data-mode="register">注册账号，开始完整规划</button>
            <button class="secondary" data-action="open-auth-page" data-mode="login">已有账号，登录</button>
          </div>
          <div class="guest-proof-row">
            <span>✦ 只聊旅行问题</span>
            <span>◌ 不会修改行程</span>
            <span>⌁ 登录后可保存</span>
          </div>
        </div>
        <div class="guest-hero-art" aria-hidden="true">
          <div class="guest-orbit guest-orbit-one"></div>
          <div class="guest-orbit guest-orbit-two"></div>
          <div class="guest-art-card guest-art-main"><strong>重庆 · 旅行灵感</strong><span>从一场对话开始</span></div>
          <div class="guest-art-card guest-art-float guest-art-float-one">🌃 山城夜景</div>
          <div class="guest-art-card guest-art-float guest-art-float-two">🍜 地道美食</div>
        </div>
      </section>

      <section class="guest-workspace">
        <div class="guest-side-panel">
          <div class="guest-side-eyebrow">登录后解锁</div>
          <h2>把灵感变成一份可执行的行程</h2>
          <p>注册账号后，可以进入完整规划页，保存行程、局部微调并导出 PDF。</p>
          <div class="guest-feature-list">
            <button class="guest-feature-card" data-action="open-auth-page" data-mode="register">
              <span class="guest-feature-icon">🧭</span><span><strong>AI 行程规划</strong><small>生成多天路线与地图</small></span><b>›</b>
            </button>
            <button class="guest-feature-card" data-action="open-auth-page" data-mode="login">
              <span class="guest-feature-icon">🗂</span><span><strong>行程管理</strong><small>保存、再次打开和调整</small></span><b>›</b>
            </button>
            <button class="guest-feature-card" data-action="open-auth-page" data-mode="login">
              <span class="guest-feature-icon">📄</span><span><strong>PDF 导出</strong><small>登录后导出你的专属方案</small></span><b>›</b>
            </button>
          </div>
          ${messageCount ? `<div class="guest-history-note">本次游客对话已有 ${messageCount} 条消息，登录后可继续使用当前浏览器中的聊天记录。</div>` : ''}
        </div>
        <div class="guest-chat-column">
          ${chatPanel({ floating: false })}
        </div>
      </section>
    </main>
  `;
}
