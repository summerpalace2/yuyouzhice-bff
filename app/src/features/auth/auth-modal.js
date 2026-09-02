import { state } from '../../app-core/state.js';
import { escapeHtml } from '../../shared/lib/security.js';

export function loginModal() {
  if (!state.loginOpen) return '';
  const registering = state.authMode === 'register';

  return `
    <div class="modal-wrap">
      <div class="modal">
        <div class="auth-tabs">
          <button class="auth-tab ${!registering ? 'active' : ''}" data-action="set-auth-mode" data-mode="login">账号登录</button>
          <button class="auth-tab ${registering ? 'active' : ''}" data-action="set-auth-mode" data-mode="register">新用户注册</button>
        </div>

        <h2>${registering ? '注册新账号' : '登录渝游智策'}</h2>
        <p>${registering ? '注册后即可保存完整行程、局部调整和偏好资产。' : '登录后可进入完整规划、行程管理和偏好设置。'}</p>

        <div class="quick-fill-bar">
          <span class="quick-fill-label">安全提示：</span>
          <span class="muted">请使用已配置的账号；系统不会提供固定默认凭据。</span>
        </div>

        <form data-action="auth-form">
          <div class="form-row">
            <label for="login-email">邮箱地址</label>
            <input id="login-email" name="email" type="email" value="" placeholder="name@example.com" required />
          </div>

          ${registering ? `
            <div class="form-row">
              <label for="login-name">称呼 / 昵称</label>
              <input id="login-name" name="name" type="text" placeholder="如：重庆旅行者" />
            </div>
          ` : ''}

          <div class="form-row">
            <label for="login-password">密码</label>
            <input id="login-password" name="password" type="password" value="" minlength="6" required />
          </div>

          ${state.loginError ? `<div class="notice notice-error">${escapeHtml(state.loginError)}</div>` : ''}

          <div class="modal-actions">
            <button type="button" class="secondary" data-action="close-login">取消</button>
            <button type="submit" class="primary">${registering ? '立即注册' : '登录'}</button>
          </div>
        </form>
      </div>
    </div>
  `;
}
