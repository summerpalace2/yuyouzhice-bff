import { escapeHtml } from '../../shared/lib/security.js';

export function slots(constraints = {}, editing = false) {
  const rows = [
    ['人', constraints.companions || '未提供', '同行人与出行特点'],
    ['时', `${constraints.arrivalAt || '未提供'} → ${constraints.departureAt || '未提供'}`, `${constraints.durationDays || 2} 天节奏 · 弹性可调`],
    ['趣', (constraints.interests || ['城市', '人文', '夜景']).join(' + '), '兴趣偏好'],
    ['步', constraints.walkingTolerance === '低' ? '少走路优先' : '正常步行', `${constraints.transportPreference || '路线待计算'}`],
    ['住', constraints.stayArea || '未提供', '住宿区域影响出发衔接'],
    ['食', constraints.dietPreference || '未提供', '餐饮策略'],
    ['钱', constraints.budget || '未提供', '预算策略']
  ];

  if (!editing) {
    return `
      <aside class="panel">
        <div class="panel-pad">
          <div class="panel-title-row">
            <div class="panel-title">已识别的旅行条件</div>
            <button class="ghost" data-action="edit-constraints">修改条件</button>
          </div>
          ${rows.map(([mark, title, note]) => `
            <div class="slot">
              <div class="slot-mark">${escapeHtml(mark)}</div>
              <div>
                <strong>${escapeHtml(title)}</strong>
                <span>${escapeHtml(note)}</span>
              </div>
            </div>
          `).join('')}
          <div class="constraint-source">点击修改条件可直接重新生成定制行程。</div>
        </div>
      </aside>
    `;
  }

  const interestValue = (constraints.interests || []).join('、');
  return `
    <aside class="panel">
      <form class="panel-pad constraint-form" id="constraint-form" data-action="constraints-form">
        <div class="panel-title-row">
          <div class="panel-title">修改旅行条件</div>
          <button type="button" class="ghost" data-action="cancel-constraints">取消</button>
        </div>
        <label>到达时间<input name="arrivalAt" value="${escapeHtml(constraints.arrivalAt || '')}" placeholder="如：周六下午" /></label>
        <label>离开时间<input name="departureAt" value="${escapeHtml(constraints.departureAt || '')}" placeholder="如：周日晚上" /></label>
        <label>同行人<input name="companions" value="${escapeHtml(constraints.companions || '')}" placeholder="如：带父母、情侣、独自" /></label>
        <label>步行强度
          <select name="walkingTolerance">
            <option value="低" ${constraints.walkingTolerance === '低' ? 'selected' : ''}>低 · 少走路</option>
            <option value="正常" ${constraints.walkingTolerance !== '低' ? 'selected' : ''}>正常</option>
          </select>
        </label>
        <label>住宿区域<input name="stayArea" value="${escapeHtml(constraints.stayArea || '')}" placeholder="如：解放碑、观音桥" /></label>
        <label>交通偏好
          <select name="transportPreference">
            <option value="未提供" ${!constraints.transportPreference || constraints.transportPreference === '未提供' ? 'selected' : ''}>未指定</option>
            <option value="公交优先" ${constraints.transportPreference === '公交优先' ? 'selected' : ''}>公交优先</option>
            <option value="公共交通优先" ${constraints.transportPreference === '公共交通优先' ? 'selected' : ''}>公共交通优先</option>
            <option value="地铁优先" ${constraints.transportPreference === '地铁优先' ? 'selected' : ''}>地铁/轻轨优先</option>
            <option value="打车优先" ${constraints.transportPreference === '打车优先' ? 'selected' : ''}>打车优先</option>
          </select>
        </label>
        <label>饮食偏好
          <select name="dietPreference">
            <option value="未提供" ${!constraints.dietPreference || constraints.dietPreference === '未提供' ? 'selected' : ''}>未指定</option>
            <option value="重庆火锅" ${constraints.dietPreference === '重庆火锅' ? 'selected' : ''}>九宫格老火锅</option>
            <option value="地道江湖菜" ${constraints.dietPreference === '地道江湖菜' ? 'selected' : ''}>地道江湖菜</option>
            <option value="街头小吃" ${constraints.dietPreference === '街头小吃' ? 'selected' : ''}>街头小吃小面</option>
            <option value="本地菜优先" ${constraints.dietPreference === '本地菜优先' ? 'selected' : ''}>本地菜优先</option>
            <option value="清淡" ${constraints.dietPreference === '清淡' ? 'selected' : ''}>清淡</option>
          </select>
        </label>
        <label>预算<input name="budget" value="${escapeHtml(constraints.budget || '')}" placeholder="如：有限" /></label>
        <label>兴趣<input name="interests" value="${escapeHtml(interestValue)}" placeholder="城市、人文、夜景、8D魔幻" /></label>
        <button class="primary constraint-submit" type="submit">按新条件重新规划</button>
      </form>
    </aside>
  `;
}

export function constraintValues(form) {
  const data = new FormData(form);
  return {
    arrivalAt: String(data.get('arrivalAt') || ''),
    departureAt: String(data.get('departureAt') || ''),
    companions: String(data.get('companions') || ''),
    walkingTolerance: String(data.get('walkingTolerance') || '正常'),
    budget: String(data.get('budget') || ''),
    stayArea: String(data.get('stayArea') || ''),
    transportPreference: String(data.get('transportPreference') || ''),
    dietPreference: String(data.get('dietPreference') || ''),
    interests: String(data.get('interests') || '').split(/[、,，]/).map((item) => item.trim()).filter(Boolean)
  };
}
