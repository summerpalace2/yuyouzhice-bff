import { preferences, state } from '../../app-core/state.js';

/**
 * 根据结构化偏好组合自然语言基准 Prompt
 */
export function buildPromptFromPreferences() {
  const parts = [];

  if (preferences.duration === '1天速览') parts.push('周六全天在重庆游玩（1天速览）');
  else if (preferences.duration === '3天深度') parts.push('周五下午到重庆，周日晚上离开（3天深度）');
  else if (preferences.duration === '4天全景') parts.push('计划在重庆深度游玩4天（4天全景）');
  else parts.push('周六下午到重庆，周日晚上离开（2天经典）');

  if (preferences.companions === '独自出发') parts.push('一个人自由行');
  else if (preferences.companions === '情侣双人') parts.push('情侣双人出游');
  else if (preferences.companions === '亲子家庭') parts.push('带小孩亲子家庭出游');
  else if (preferences.companions === '朋友结伴') parts.push('朋友结伴聚会');
  else parts.push('带父母长辈同行');

  if (preferences.pace === '深度打卡') parts.push('不怕多走路深度打卡');
  else if (preferences.pace === '经典适中') parts.push('正常步行节奏');
  else parts.push('希望轻松少走台阶少爬坡');

  if (preferences.transport === '轻轨地铁优先') parts.push('轻轨地铁优先');
  else if (preferences.transport === '公交优先') parts.push('公交优先');
  else if (preferences.transport === '打车为主') parts.push('以打车为主');

  if (preferences.dining.size > 0) {
    const dList = [...preferences.dining];
    parts.push(`想体验${dList.join('和')}`);
  }

  if (preferences.themes.size > 0) {
    const tList = [...preferences.themes];
    parts.push(`喜欢${tList.join('、')}`);
  }

  parts.push('预算有限');

  return parts.join('，') + '。';
}

/**
 * 局部更新：更新主页偏好按钮的高亮样式，无需刷新整个页面
 */
export function updatePreferenceChipsInDOM() {
  const chips = document.querySelectorAll('.pref-chip');
  chips.forEach((chip) => {
    const cat = chip.dataset.category;
    const val = chip.dataset.value;
    if (cat === 'duration' || cat === 'companions' || cat === 'pace' || cat === 'transport') {
      chip.classList.toggle('active', preferences[cat] === val);
    } else if (cat === 'dining' || cat === 'themes') {
      chip.classList.toggle('active', preferences[cat].has(val));
    }
  });
  const input = document.querySelector('#prompt-input');
  if (input) input.value = state.prompt;
}
