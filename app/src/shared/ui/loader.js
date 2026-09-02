import { state } from '../../app-core/state.js';
import { escapeHtml } from '../lib/security.js';

export function planningLoader() {
  if (!state.loading || !state.loadingPhase) return '';
  const phases = [
    ['理解旅行条件', '整理时间、同行人、体力和偏好'],
    ['检索可信信息', '由服务端提供景点、路线与事实依据'],
    ['组合路线', '优化景点顺序与公共交通/步行衔接'],
    ['生成方案', '形成可解释、去重且可随时微调的行程']
  ];
  const currentIndex = Math.max(0, phases.findIndex(([label]) => label === state.loadingPhase));
  return `
    <div class="planning-loader" role="status" aria-live="polite">
      <div class="loader-kicker">智能规划进行中 · ${escapeHtml(state.loadingPhase || phases[0][0])}</div>
      <div class="loader-steps">
        ${phases.map(([label, note], index) => `
          <div class="loader-step ${index <= currentIndex ? 'active' : ''} ${label === state.loadingPhase ? 'current' : ''}">
            <span>${index < currentIndex ? '✓' : index + 1}</span>
            <div>
              <strong>${label}</strong>
              <small>${note}</small>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

/**
 * 局部更新：顶部规划进度条（支持原地无跳动微更新）
 */
export function renderLoader() {
  const mount = document.getElementById('loader-mount');
  if (!mount) return;
  if (!state.loading || !state.loadingPhase) {
    mount.innerHTML = '';
    return;
  }

  const phases = [
    ['理解旅行条件', '整理时间、同行人、体力和偏好'],
    ['检索可信信息', '由服务端提供景点、路线与事实依据'],
    ['组合路线', '优化景点顺序与公共交通/步行衔接'],
    ['生成方案', '形成可解释、去重且可随时微调的行程']
  ];
  const currentIndex = Math.max(0, phases.findIndex(([label]) => label === state.loadingPhase));

  const existingLoader = mount.querySelector('.planning-loader');
  if (!existingLoader) {
    mount.innerHTML = planningLoader();
    return;
  }

  const kicker = existingLoader.querySelector('.loader-kicker');
  if (kicker) kicker.textContent = `智能规划进行中 · ${state.loadingPhase || phases[0][0]}`;

  const stepEls = existingLoader.querySelectorAll('.loader-step');
  stepEls.forEach((stepEl, index) => {
    const isActive = index <= currentIndex;
    const isCurrent = phases[index] && phases[index][0] === state.loadingPhase;
    stepEl.className = `loader-step ${isActive ? 'active' : ''} ${isCurrent ? 'current' : ''}`;
    const badge = stepEl.querySelector('span');
    if (badge) badge.textContent = index < currentIndex ? '✓' : String(index + 1);
  });
}
