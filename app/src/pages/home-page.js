import { preferences, state } from '../app-core/state.js';
import { escapeHtml } from '../shared/lib/security.js';

export function homeView() {
  return `
    <main class="page shell">
      <section class="hero planner-home-hero">
        <div class="hero-content">
          <div class="eyebrow">AI ITINERARY STUDIO · 重庆</div>
          <h1>把山城的复杂，<br /><em>交给一份懂你的行程</em></h1>
          <p class="lede">说清这次出行的时间、同行人和节奏，悠悠会生成可执行草案；每一站都由你确认，也始终可以局部微调。</p>

          <div class="planner-trust-row"><span>36+ 精选景点资产</span><span>当前输入优先</span><span>确认后才修改行程</span></div>

          <div class="planner-flow" aria-label="AI 规划流程">
            <span><b>01</b>说说这次出行</span><i>→</i><span><b>02</b>生成路线草案</span><i>→</i><span><b>03</b>自由确认与微调</span>
          </div>

          <div class="prompt-box">
            <div class="prompt-box-head"><strong>这次想怎么游？</strong><span>自然语言或快捷条件都可以</span></div>
            <textarea id="prompt-input" aria-label="旅行需求" placeholder="输入你想游玩的时间、同行人、体力偏好，或点击下方标签快捷辅助填写...">${escapeHtml(state.prompt)}</textarea>
            <div class="prompt-footer">
              <span class="hint">已确认旅行记忆会参考 · 本次输入始终优先</span>
              <button class="primary" data-action="plan">开始 AI 智能规划</button>
            </div>
          </div>

          <!-- 懂你的 AI 智能画像快捷模版 -->
          <div class="smart-presets-wrap common-plan-library">
            <div class="library-head"><span class="presets-label">常用规划，从一个场景开始</span><span>可继续修改条件</span></div>
            <div class="presets-row">
              <button class="preset-badge" data-action="apply-preset" data-preset="elderly"><b>长辈省心游</b><small>少爬坡 · 文博 · 夜景</small></button>
              <button class="preset-badge" data-action="apply-preset" data-preset="magic8d"><b>8D魔幻打卡</b><small>单轨 · 天桥 · 老火锅</small></button>
              <button class="preset-badge" data-action="apply-preset" data-preset="couple"><b>情侣浪漫江夜</b><small>江岸 · 老街 · 清幽</small></button>
              <button class="preset-badge" data-action="apply-preset" data-preset="family"><b>亲子研学</b><small>科技馆 · 博物馆 · 轻松</small></button>
            </div>
          </div>

          <!-- 偏好状态机胶囊组：单选替换、多选切换，杜绝文字重复 -->
          <div class="preference-capsules">
            <div class="preference-capsules-head"><strong>补充这次出行条件</strong><span>仅用于当前方案；长期偏好可在「偏好与记忆」中管理</span></div>
            <div class="capsule-group">
              <span class="capsule-label">游玩天数</span>
              <div class="capsule-list">
                ${['1天速览', '2天经典', '3天深度', '4天全景'].map((item) => `
                  <button class="pref-chip ${preferences.duration === item ? 'active' : ''}" data-action="toggle-pref" data-category="duration" data-value="${item}">${item}</button>
                `).join('')}
              </div>
            </div>

            <div class="capsule-group">
              <span class="capsule-label">同行人员</span>
              <div class="capsule-list">
                ${['独自出发', '情侣双人', '带父母', '亲子家庭', '朋友结伴'].map((item) => `
                  <button class="pref-chip ${preferences.companions === item ? 'active' : ''}" data-action="toggle-pref" data-category="companions" data-value="${item}">${item === '带父母' ? '长辈同行' : item}</button>
                `).join('')}
              </div>
            </div>

            <div class="capsule-group">
              <span class="capsule-label">步行节奏</span>
              <div class="capsule-list">
                ${['少走路', '经典适中', '深度打卡'].map((item) => `
                  <button class="pref-chip ${preferences.pace === item ? 'active' : ''}" data-action="toggle-pref" data-category="pace" data-value="${item}">${item === '少走路' ? '轻松少走台阶' : item}</button>
                `).join('')}
              </div>
            </div>

            <div class="capsule-group">
              <span class="capsule-label">出行方式</span>
              <div class="capsule-list">
                ${['轻轨地铁优先', '公交优先', '打车为主'].map((item) => `
                  <button class="pref-chip ${preferences.transport === item ? 'active' : ''}" data-action="toggle-pref" data-category="transport" data-value="${item}">${item}</button>
                `).join('')}
              </div>
            </div>

            <div class="capsule-group">
              <span class="capsule-label">餐饮风味</span>
              <div class="capsule-list">
                ${['九宫格老火锅', '地道江湖菜', '街头小吃小面', '清淡不辣', '本地菜优先'].map((item) => `
                  <button class="pref-chip ${preferences.dining.has(item) ? 'active' : ''}" data-action="toggle-pref" data-category="dining" data-value="${item}">${item}</button>
                `).join('')}
              </div>
            </div>

            <div class="capsule-group">
              <span class="capsule-label">体验主题</span>
              <div class="capsule-list">
                ${['8D魔幻', '山城夜景', '人文历史', '市井烟火', '自然奇观', '天然温泉'].map((item) => `
                  <button class="pref-chip ${preferences.themes.has(item) ? 'active' : ''}" data-action="toggle-pref" data-category="themes" data-value="${item}">${item}</button>
                `).join('')}
              </div>
            </div>
          </div>
        </div>

        <div class="hero-visual">
          <div class="visual-tag">36+ 个重庆旅行资产</div>
          <div class="visual-route-board" aria-hidden="true">
            <span class="visual-route-line visual-route-line-a"></span>
            <span class="visual-route-line visual-route-line-b"></span>
            <span class="visual-route-point visual-route-point-a">渝中</span>
            <span class="visual-route-point visual-route-point-b">江北嘴</span>
            <span class="visual-route-point visual-route-point-c">南滨路</span>
            <span class="visual-route-label">AI 路线草案</span>
          </div>
          <div class="visual-caption">
            <strong>一张路线，装下山城的层次</strong>
            <span>景点、步行、天气与偏好，先生成草案，再由你确认。</span>
          </div>
        </div>
      </section>

      <section class="feature-strip">
        <div class="feature">
          <div class="feature-marker">01</div>
          <div>
            <strong>智能去重与多天规划</strong>
            <span>支持 1-4 天个性化组合，景点绝不重复，自动编排最佳游览次序。</span>
          </div>
        </div>
        <div class="feature">
          <div class="feature-marker">02</div>
          <div>
            <strong>高德多天轨迹交互</strong>
            <span>按天切换分色路线，站点时长与交通换乘一目了然，支持全屏沉浸地图。</span>
          </div>
        </div>
        <div class="feature">
          <div class="feature-marker">03</div>
          <div>
            <strong>自由增删与局部微调</strong>
            <span>随时添加/移除站点、灵活替换景区，行程随心而变。</span>
          </div>
        </div>
      </section>
    </main>
  `;
}
