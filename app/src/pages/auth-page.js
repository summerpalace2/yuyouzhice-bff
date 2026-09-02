import { state } from '../app-core/state.js';
import { escapeHtml } from '../shared/lib/security.js';

export function authView() {
  const registering = state.authMode === 'register';
  return `
    <main class="page shell auth-page">
      <section class="auth-page-card">
        <div class="auth-page-intro">
          <span class="eyebrow">渝游智策 · 账号中心</span>
          <h1>${registering ? '注册一个账号，保存你的重庆路线' : '欢迎回来，继续你的旅行规划'}</h1>
          <p>${registering ? '账号密码登录是第一期唯一登录方式，注册后即可使用完整行程规划与局部微调。' : '登录后可以打开已保存的行程，继续聊天或对局部路线进行调整。'}</p>
          <div class="auth-benefit-list">
            <span>✓ 完整行程规划</span><span>✓ 局部微调与确认</span><span>✓ 行程管理与 PDF 导出</span>
          </div>
        </div>
        <div class="auth-form-card">
          <div class="auth-page-tabs">
            <button class="auth-page-tab ${!registering ? 'active' : ''}" data-action="set-auth-mode" data-mode="login">账号登录</button>
            <button class="auth-page-tab ${registering ? 'active' : ''}" data-action="set-auth-mode" data-mode="register">注册账号</button>
          </div>
          <h2>${registering ? '创建你的账号' : '登录你的账号'}</h2>
          <p class="auth-form-hint">${registering ? '只需邮箱、昵称和密码，注册后即可开始规划。' : '请使用注册时的邮箱和密码。'}</p>
          <form data-action="auth-form">
            <div class="form-row">
              <label for="login-email">邮箱地址</label>
              <input id="login-email" name="email" type="email" placeholder="name@example.com" autocomplete="email" required />
            </div>
            ${registering ? `
              <div class="form-row">
                <label for="login-name">称呼 / 昵称</label>
                <input id="login-name" name="name" type="text" placeholder="如：重庆旅行者" autocomplete="nickname" />
              </div>
            ` : ''}
            <div class="form-row">
              <label for="login-password">密码</label>
              <input id="login-password" name="password" type="password" minlength="6" autocomplete="${registering ? 'new-password' : 'current-password'}" required />
            </div>
            ${state.loginError ? `<div class="notice notice-error">${escapeHtml(state.loginError)}</div>` : ''}
            <button type="submit" class="primary auth-submit-button">${registering ? '立即注册' : '登录并进入规划'}</button>
          </form>
          <button class="auth-back-link" data-action="go" data-view="guest-chat">← 返回游客体验</button>
        </div>
      </section>
    </main>
  `;
}
