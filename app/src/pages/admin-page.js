import { state } from '../app-core/state.js';
import { escapeHtml } from '../shared/lib/security.js';

const adminSectionLabels = {
  overview: '运营总览',
  attractions: '景点资产',
  analytics: '调用分析',
  feedback: '反馈收件箱',
  rerank: '模型与 Rerank',
  knowledge: '知识库管理',
  users: '账号与权限'
};

/**
 * Rerank 的缓存条目数和命中次数属于两套口径：前者按 TTL 存活，后者随 JVM
 * 生命周期累计。独立成局部片段，清缓存后可以只替换这里而不刷新管理整页。
 */
function rerankPanelContent(rerank) {
  const ttlMinutes = Number(rerank?.cacheTtlMinutes || 30);
  const l1Hits = Number(rerank?.l1Hits || 0);
  const l2Hits = Number(rerank?.l2Hits || 0);
  const l3Hits = Number(rerank?.l3Hits || 0);
  const l1Size = Number(rerank?.l1Size || 0);
  const l2Size = Number(rerank?.l2Size || 0);
  const l3Size = Number(rerank?.l3Size || 0);
  const totalHits = Number(rerank?.totalHits || 0);
  const misses = Number(rerank?.misses || 0);
  const requests = totalHits + misses;
  const totalSize = Number(rerank?.totalSize || 0);
  const apiCalls = Number(rerank?.apiCalls || 0);
  const scope = rerank?.metricScope === 'JVM_STARTUP_CUMULATIVE'
    ? '自 Java 服务启动后累计'
    : '实时统计';

  return `
    <div class="rerank-intro">
      <div>
        <span class="config-kicker">RETRIEVAL ACCELERATOR</span>
        <strong>它不生成答案，而是把向量检索找回的资料重新排出更相关的顺序。</strong>
        <p>数据直接来自 Java <code>/ai/rag/stats</code>：缓存只保存排序结果，不会删除或修改知识文档。</p>
      </div>
      <button class="secondary mini-btn" data-action="clear-admin-rerank-cache">清除排序缓存</button>
    </div>
    ${rerank ? `
      <div class="rerank-stats-bar">
        <div class="cache-tier tier-l1">
          <div class="tier-name">相同问题 · 即时复用</div>
          <div class="tier-val">${l1Hits} 次复用</div>
          <div class="tier-sub">当前保留 ${l1Size} 份精确匹配结果</div>
        </div>
        <div class="cache-tier tier-l2">
          <div class="tier-name">相近措辞 · 快速复用</div>
          <div class="tier-val">${l2Hits} 次复用</div>
          <div class="tier-sub">当前保留 ${l2Size} 份归一化结果</div>
        </div>
        <div class="cache-tier tier-l3">
          <div class="tier-name">语义相近 · 智能复用</div>
          <div class="tier-val">${l3Hits} 次复用</div>
          <div class="tier-sub">当前保留 ${l3Size} 份语义相近结果</div>
        </div>
      </div>
      <div class="rerank-summary-row">
        <div><span>统计口径</span><b>${escapeHtml(scope)}</b></div>
        <div><span>缓存存量</span><b>${totalSize} 份结果 · ${ttlMinutes} 分钟自动过期</b></div>
      </div>
      <div class="rerank-activity-note">累计排序请求 ${requests} 次，其中复用 ${totalHits} 次（${escapeHtml(String(rerank.hitRate ?? '0.0%'))}）；需重新排序 ${misses} 次，实际模型调用 ${apiCalls} 次。缓存有条目但暂未复用，表示此前查询已写入缓存，尚未出现可匹配的新问题。</div>
    ` : '<div class="notice compact-notice">暂未读取到 Java Rerank 统计，请确认管理接口和 Java 服务均已启动。</div>'}
  `;
}

/** 清缓存后只更新统计区域，保留当前管理分区、展开状态和滚动位置。 */
export function refreshRerankPanelInDOM() {
  const panel = document.getElementById('admin-rerank-panel-content');
  if (panel) panel.innerHTML = rerankPanelContent(state.adminRerankStats || state.adminOverview?.rerankCache || null);
}

/** 控制中心分区切换只切 class，不重建整张管理页面。 */
export function switchAdminSectionInDOM(section) {
  if (state.view !== 'admin' || !adminSectionLabels[section]) return false;
  const panels = [...document.querySelectorAll('[data-admin-section]')];
  if (!panels.length) return false;
  state.adminSection = section;
  panels.forEach((panel) => {
    const active = panel.dataset.adminSection === section;
    panel.classList.toggle('is-current', active);
    panel.classList.toggle('is-hidden', !active);
  });
  document.querySelectorAll('.admin-control-link[data-section]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.section === section);
  });
  const label = document.querySelector('[data-admin-current-section]');
  if (label) label.textContent = `当前：${adminSectionLabels[section]}`;
  return true;
}

export function adminView() {
  if (state.adminLoading || !state.adminOverview) {
    const failed = String(state.adminLoadError || '').trim();
    return `<main class="page shell admin-loading-page" aria-busy="${failed ? 'false' : 'true'}">
      <section class="panel admin-loading-panel">
        <span class="config-kicker">CONTROL CENTER</span>
        <h2>${failed ? '暂时无法载入管理数据' : '正在加载管理控制中心'}</h2>
        <p>${failed ? escapeHtml(failed) : '正在读取远端数据库中的账号、景点资产、知识库与服务统计…'}</p>
        ${failed
          ? '<button class="primary" data-action="health">重新加载</button>'
          : '<div class="admin-loading-skeleton" aria-label="管理数据加载中"><i></i><i></i><i></i><i></i></div>'}
      </section>
    </main>`;
  }

  const overview = state.adminOverview || {};
  const quality = overview.qualityMetrics || {};
  const qualityAvailable = quality.available === true;
  const analytics = overview.analytics || {};
  const analyticsDashboard = analytics.dashboard || {};
  const serviceCount = analyticsDashboard.serviceCount || {};
  const activeUsers = analyticsDashboard.activeUsers || {};
  const hotQuestions = Array.isArray(analytics.hotQuestions) && analytics.hotQuestions.length
    ? analytics.hotQuestions
    : (analyticsDashboard.hotQuestionsTop10 || []);
  const feedbackSummary = overview.feedbackSummary || {};
  const feedbackItems = Array.isArray(overview.feedbackItems) ? overview.feedbackItems : [];
  const feedbackTotal = Number(feedbackSummary.total || 0);
  const helpfulRate = feedbackTotal ? Math.round((Number(feedbackSummary.helpful || 0) / feedbackTotal) * 100) : null;
  const knowledge = overview.knowledge || {};
  const corpus = knowledge.corpus || {};
  const users = Array.isArray(overview.users) ? overview.users : [];
  const rerank = state.adminRerankStats || overview.rerankCache || null;
  const allDocs = Array.isArray(state.adminDocs) ? state.adminDocs : [];
  const attractions = overview.attractions || {};
  const attractionItems = Array.isArray(attractions.items) ? attractions.items : [];
  const attractionContent = attractions.content || {};
  const attractionAvailable = attractions.available !== false && Number.isFinite(Number(attractions.total));
  const docsByEntity = new Map();
  allDocs.forEach((doc) => {
    const entityId = String(doc.entityId || '').trim();
    if (entityId) docsByEntity.set(entityId, (docsByEntity.get(entityId) || 0) + 1);
  });
  const categoryEntries = Object.entries(attractions.categories || {}).sort(([, left], [, right]) => right - left);
  const districtEntries = Object.entries(attractions.districts || {}).sort(([, left], [, right]) => right - left);
  const attractionCoverage = Number.isFinite(Number(attractionContent.coverage))
    ? `${Math.round(Number(attractionContent.coverage) * 100)}%`
    : '—';
  const adminSection = state.adminSection || 'overview';
  const adminSections = [
    ['overview', '运营总览', '服务状态与核心指标', '概'],
    ['attractions', '景点资产', '景点项目与内容覆盖', '景'],
    ['analytics', '调用分析', '流量、主题与常用规划', '析'],
    ['feedback', '反馈收件箱', '查看用户反馈详情', '信'],
    ['rerank', '模型与 Rerank', '缓存命中与模型调用', '模'],
    ['knowledge', '知识库管理', '上传、编辑与索引', '库'],
    ['users', '账号与权限', '用户、角色与来源', '账']
  ];

  const filteredDocs = allDocs.filter((doc) => {
    if (state.adminDocTopic && doc.topic !== state.adminDocTopic) return false;
    if (state.adminDocQuery) {
      const q = state.adminDocQuery.toLowerCase();
      const match = [doc.title, doc.entityName, doc.content].join(' ').toLowerCase();
      if (!match.includes(q)) return false;
    }
    return true;
  });

  const topicLabels = {
    accessibility: '无障碍与轻松出行',
    transport: '交通衔接',
    dynamic: '实时动态信息',
    warning: '出行提醒',
    itinerary: '行程建议'
  };
  const topicsList = [{ key: '', label: '全部分类' }, ...Object.entries(topicLabels).map(([key, label]) => ({ key, label }))];

  return `
    <main class="page shell admin-stream-page">
      <div class="section-title">
        <div>
          <div class="eyebrow">Admin Console · 智能管控中心</div>
          <h2>管理控制台</h2>
          <p>从真实服务日志、账号权限、景点资产和用户反馈中读取运营状态。</p>
        </div>
        <div class="section-actions">
          <button class="primary" data-action="enter-planner-test">进入 AI 规划测试</button>
          <button class="secondary" data-action="health">刷新数据</button>
        </div>
      </div>

      <div class="admin-planner-test-note">
        <span class="admin-planner-test-icon">✦</span>
        <div>
          <strong>管理员也可以完整测试规划链路</strong>
          <p>进入后使用当前管理员账号生成规划、进行局部调整并保存；数据仍按当前管理员账号隔离，不会变成游客草稿。</p>
        </div>
      </div>

      <section class="admin-control-center">
        <div class="admin-control-center-head">
          <div><span class="config-kicker">Control Center</span><strong>管理控制中心</strong><small>按工作内容进入独立管理页，避免所有信息堆在同一屏。</small></div>
          <span class="admin-current-section" data-admin-current-section>当前：${escapeHtml(adminSections.find(([key]) => key === adminSection)?.[1] || '运营总览')}</span>
        </div>
        <div class="admin-control-nav">
          ${adminSections.map(([key, label, desc, icon]) => `<button class="admin-control-link ${adminSection === key ? 'is-active' : ''}" type="button" data-action="admin-section" data-section="${key}"><span>${icon}</span><strong>${label}</strong><small>${desc}</small><b>进入 →</b></button>`).join('')}
        </div>
      </section>

      <section class="admin-stream-section admin-section-panel ${adminSection === 'overview' ? 'is-current' : 'is-hidden'}" data-admin-section="overview">
        <div class="admin-stream-head">
          <h3>系统运行概览</h3>
          <span class="head-meta-badge">${analytics.available ? '实时服务日志已接入' : '服务日志暂不可用'}</span>
        </div>
        <div class="admin-kpi-grid">
          <div class="kpi-card">
            <span class="kpi-title">注册用户总数</span>
            <span class="kpi-num">${users.length || 0}</span>
            <span class="kpi-sub">包含 ${overview.metrics?.travelers || 0} 位旅行者账号</span>
          </div>
          <div class="kpi-card">
            <span class="kpi-title">今日活跃会话</span>
            <span class="kpi-num">${analytics.available ? Number(activeUsers.current || 0) : '—'}</span>
            <span class="kpi-sub">按独立对话会话统计</span>
          </div>
          <div class="kpi-card">
            <span class="kpi-title">今日服务调用</span>
            <span class="kpi-num">${analytics.available ? Number(serviceCount.today || 0) : '—'}</span>
            <span class="kpi-sub">累计 ${analytics.available ? Number(serviceCount.total || 0) : '—'} 次对话服务</span>
          </div>
          <div class="kpi-card">
            <span class="kpi-title">用户满意度</span>
            <span class="kpi-num">${helpfulRate === null ? '—' : `${helpfulRate}%`}</span>
            <span class="kpi-sub">${feedbackTotal ? `${feedbackTotal} 条已收集反馈` : '等待第一条有效反馈'}</span>
          </div>
        </div>
        <div class="admin-metric-note">
          <span>数据口径：活跃和调用来自 Java 服务日志；满意度来自用户主动反馈。</span>
          <span>${qualityAvailable ? `约束匹配样本 ${quality.measuredTrips} 份，平均 ${Math.round(Number(quality.avgConstraintSatisfaction || 0) * 100)}%` : '约束匹配会在用户提交带质量分的反馈后显示。'}</span>
        </div>
      </section>

      <section class="admin-stream-section admin-section-panel ${adminSection === 'attractions' ? 'is-current' : 'is-hidden'}" data-admin-section="attractions">
        <div class="admin-stream-head">
          <div class="head-with-meta">
            <h3>景点项目与内容资产</h3>
            <span class="head-meta-badge">${attractionAvailable ? `Java 景点目录 · ${attractions.total} 个项目` : 'Java 景点目录暂不可用'}</span>
          </div>
        </div>
        ${attractionAvailable ? `
          <div class="admin-assets-kpi-grid">
            <div class="kpi-card asset-kpi-card">
              <span class="kpi-title">景点项目</span>
              <span class="kpi-num">${attractions.total}</span>
              <span class="kpi-sub">Java attraction 目录</span>
            </div>
            <div class="kpi-card asset-kpi-card">
              <span class="kpi-title">室内景点</span>
              <span class="kpi-num">${attractions.indoor ?? 0}</span>
              <span class="kpi-sub">适合少走路与雨天筛选</span>
            </div>
            <div class="kpi-card asset-kpi-card">
              <span class="kpi-title">覆盖区域</span>
              <span class="kpi-num">${attractions.districtCount ?? 0}</span>
              <span class="kpi-sub">${attractions.categoryCount ?? 0} 类文旅项目</span>
            </div>
            <div class="kpi-card asset-kpi-card">
              <span class="kpi-title">结构化内容覆盖</span>
              <span class="kpi-num">${attractionCoverage}</span>
              <span class="kpi-sub">${attractionContent.complete ?? 0} 个项目字段完整</span>
            </div>
          </div>
          <div class="admin-assets-layout">
            <div class="panel panel-pad">
              <div class="panel-title">项目分布</div>
              <div class="asset-distribution-block">
                <div class="asset-distribution-title">按类别</div>
                ${categoryEntries.length ? categoryEntries.map(([label, count]) => `
                  <div class="asset-distribution-row">
                    <span>${escapeHtml(label)}</span><b>${count}</b>
                    <span class="asset-distribution-bar"><i style="width:${Math.round((count / Math.max(1, attractions.total)) * 100)}%"></i></span>
                  </div>
                `).join('') : '<div class="muted">暂无分类数据</div>'}
              </div>
              <div class="asset-distribution-block">
                <div class="asset-distribution-title">按区域</div>
                ${districtEntries.length ? districtEntries.map(([label, count]) => `
                  <div class="asset-distribution-row">
                    <span>${escapeHtml(label)}</span><b>${count}</b>
                    <span class="asset-distribution-bar"><i style="width:${Math.round((count / Math.max(1, attractions.total)) * 100)}%"></i></span>
                  </div>
                `).join('') : '<div class="muted">暂无区域数据</div>'}
              </div>
            </div>
            <div class="panel panel-pad asset-coverage-panel">
              <div class="panel-title">内容覆盖说明</div>
              <p class="muted">目录会展示每个景点的结构化资料、适配标签和已关联知识条目；下面完整展开，不再隐藏在固定高度的滚动框中。</p>
              <div class="asset-coverage-summary"><strong>${attractionContent.complete ?? 0}</strong><span>个景点资料完整</span><strong>${allDocs.length}</strong><span>篇知识语料可关联</span></div>
            </div>
          </div>
          <div class="panel panel-pad admin-attraction-catalog">
            <div class="admin-attraction-catalog-head"><div><div class="panel-title">景点内容目录</div><p>完整展示 ${attractionItems.length} 个已接入景点，便于核对资产和知识关联。</p></div><span>${attractionItems.length} 个项目</span></div>
            <div class="admin-attraction-list admin-attraction-list-full">
              ${attractionItems.length ? attractionItems.map((item) => {
                const docCount = docsByEntity.get(String(item.id || ''));
                const contentLabel = Number(item.contentFieldCount) === Number(item.contentFieldTotal)
                  ? '资料完整'
                  : `资料字段 ${item.contentFieldCount ?? 0}/${item.contentFieldTotal ?? 0}`;
                return `
                  <div class="admin-attraction-row">
                    <div class="attraction-main-info">
                      <span class="attraction-icon">${item.indoor ? '室内' : '户外'}</span>
                      <div>
                        <strong>${escapeHtml(item.name || item.id)}</strong>
                        <span>${escapeHtml(item.district || '未标注区域')} · ${escapeHtml(item.category || '未分类')} · ${escapeHtml(item.walkDifficulty || '步行难度未标注')}</span>
                      </div>
                    </div>
                    <div class="attraction-content-meta">
                      <span class="asset-status ${contentLabel === '资料完整' ? 'is-complete' : ''}">${escapeHtml(contentLabel)}</span>
                      <span>${docCount == null ? '知识资料尚未关联' : `已关联 ${docCount} 篇知识资料`}</span>
                    </div>
                  </div>
                `;
              }).join('') : '<div class="notice">暂无景点项目数据。</div>'}
            </div>
          </div>
        ` : '<div class="panel panel-pad"><div class="notice">当前无法从 Java Core Backend 读取景点目录，请先确认 8080 服务已启动。</div></div>'}
      </section>

      <section class="admin-stream-section admin-section-panel ${adminSection === 'analytics' ? 'is-current' : 'is-hidden'}" data-admin-section="analytics">
        <div class="admin-stream-head">
          <div class="head-with-meta"><h3>调用流量与主题分布</h3><span class="head-meta-badge">今日 · 自动更新</span></div>
        </div>
        <div class="admin-operations-grid">
          <div class="panel panel-pad admin-insight-card">
            <div class="panel-title">高频咨询</div>
            <p class="muted">来自服务日志的原始问题聚合，不展示用户身份。</p>
            <div class="hot-question-list">
              ${hotQuestions.length ? hotQuestions.map((item, index) => `<div class="hot-question-row"><b>${String(item.rank || index + 1).padStart(2, '0')}</b><span>${escapeHtml(item.question || '未命名问题')}</span><em>${Number(item.count || 0)} 次</em></div>`).join('') : '<div class="notice compact-notice">今天还没有可聚合的咨询主题。</div>'}
            </div>
          </div>
          <div class="panel panel-pad admin-insight-card">
            <div class="panel-title">常用规划</div>
            <p class="muted">用户端可一键带入条件，仍可继续按本次需求调整。</p>
            <div class="admin-template-list">
              <button class="admin-template-row" data-action="go" data-view="home"><span>01</span><div><strong>长辈省心游</strong><small>少台阶 · 文博 · 夜景</small></div><i>体验 →</i></button>
              <button class="admin-template-row" data-action="go" data-view="home"><span>02</span><div><strong>情侣江夜</strong><small>江景 · 老街 · 温泉</small></div><i>体验 →</i></button>
              <button class="admin-template-row" data-action="go" data-view="home"><span>03</span><div><strong>亲子研学</strong><small>科技馆 · 博物馆 · 轻松节奏</small></div><i>体验 →</i></button>
            </div>
          </div>
        </div>
      </section>

      <section class="admin-stream-section admin-section-panel ${adminSection === 'feedback' ? 'is-current' : 'is-hidden'}" data-admin-section="feedback">
        <div class="admin-stream-head">
          <div class="head-with-meta"><h3>意见反馈收件箱</h3><span class="head-meta-badge">${feedbackTotal} 条已收集</span></div>
        </div>
        <div class="panel panel-pad feedback-inbox-panel">
          <div class="feedback-summary-strip"><span class="feedback-summary-good">认可 ${Number(feedbackSummary.helpful || 0)}</span><span class="feedback-summary-work">历史改进 ${Number(feedbackSummary.needsWork || 0)}</span><span class="feedback-summary-letter">用户来信 ${Number(feedbackSummary.letters || 0)}</span><span>点击来信查看提交账号与会话详情。</span></div>
          <div class="feedback-inbox-list">
            ${feedbackItems.length ? feedbackItems.map((item, index) => `<article class="feedback-inbox-item ${item.value === 'helpful' ? 'is-helpful' : item.value === 'letter' ? 'is-letter' : 'is-needs-work'}" data-action="view-feedback-detail" data-index="${index}" tabindex="0" role="button"><span>${item.value === 'helpful' ? '认可' : item.value === 'letter' ? '来信' : '改进'}</span><div><strong>${escapeHtml(item.reason || '未填写原因')}</strong><small>${escapeHtml(item.sourceMode || '未标注来源')} · ${item.createdAt ? new Date(item.createdAt).toLocaleString('zh-CN') : '刚刚'}</small></div><b class="feedback-detail-hint">看详情 →</b></article>`).join('') : '<div class="notice compact-notice">还没有收到来信。用户在行程页写下反馈后，会自动汇总到这里。</div>'}
          </div>
        </div>
      </section>

      <section class="admin-stream-section admin-section-panel ${adminSection === 'rerank' ? 'is-current' : 'is-hidden'}" data-admin-section="rerank">
        <div class="admin-stream-head">
          <div class="head-with-meta"><h3>检索结果加速器</h3><span class="head-meta-badge">Java RerankService · ${Number(rerank?.cacheTtlMinutes || 30)} 分钟缓存</span></div>
        </div>
        <div class="panel panel-pad rerank-explainer-panel" id="admin-rerank-panel-content">${rerankPanelContent(rerank)}</div>
      </section>

      <section class="admin-stream-section admin-section-panel ${adminSection === 'knowledge' ? 'is-current' : 'is-hidden'}" data-admin-section="knowledge">
        <div class="admin-stream-head">
          <div class="head-with-meta">
            <h3>知识库语料登记 (Knowledge Registry) 与在线编辑</h3>
            <span class="head-meta-badge">已索引 ${corpus.documents ?? '—'} 篇文档 · ${corpus.entities ?? '—'} 个实体</span>
          </div>
        </div>
        <div class="panel panel-pad">
          <div class="admin-upload-panel">
            <div class="admin-upload-copy">
              <span class="config-kicker">Knowledge Upload</span>
              <strong>上传知识文档</strong>
              <small>上传后由 Java 自动登记、解析、切片并同步到 RAG 索引。</small>
            </div>
            <form class="admin-upload-form" data-action="upload-knowledge-form" enctype="multipart/form-data">
              <div class="admin-upload-fields">
                <div class="form-row"><label for="knowledge-upload-file">文档文件</label><input id="knowledge-upload-file" name="file" type="file" accept=".txt,.md,.pdf,.doc,.docx,.xls,.xlsx" required /></div>
                <div class="form-row"><label for="knowledge-upload-title">文档标题（可选）</label><input id="knowledge-upload-title" name="title" placeholder="默认使用文件名" /></div>
                <div class="form-row"><label for="knowledge-upload-category">资料分类</label><select id="knowledge-upload-category" name="category"><option value="other">其它资料</option><option value="history">历史文化</option><option value="culture">人文艺术</option><option value="faq">常见问题</option><option value="notice">游览须知</option></select></div>
                <div class="form-row"><label for="knowledge-upload-tags">标签（可选）</label><input id="knowledge-upload-tags" name="tags" placeholder="景点,交通,开放时间" /></div>
              </div>
              <div class="admin-upload-actions"><button class="primary" type="submit">上传并建立索引</button><span>建议单文件不超过 50 MB，支持 TXT / MD / PDF / Word / Excel。</span></div>
            </form>
          </div>
          <div class="admin-doc-toolbar">
            <input id="admin-doc-search" value="${escapeHtml(state.adminDocQuery)}" placeholder="搜索语料标题、景点、正文关键词..." />
            <div class="doc-toolbar-sub">
              <div class="chip-row" id="admin-doc-topic-bar">
                ${topicsList.map((topic) => `
                  <button class="chip ${state.adminDocTopic === topic.key || (!state.adminDocTopic && !topic.key) ? 'selected' : ''}" data-action="admin-doc-topic" data-topic="${escapeHtml(topic.key)}">${escapeHtml(topic.label)}</button>
                `).join('')}
              </div>
              <button class="secondary mini-btn fold-toggle-btn" data-action="toggle-admin-docs-fold">
                ${state.adminDocsFolded ? `展开全部 (${filteredDocs.length} 篇) ↓` : '折叠精选 (6 篇) ↑'}
              </button>
            </div>
          </div>

          <div class="doc-accordion-list" id="doc-accordion-container">
            ${(state.adminDocsFolded ? filteredDocs.slice(0, 6) : filteredDocs).length ? (state.adminDocsFolded ? filteredDocs.slice(0, 6) : filteredDocs).map((doc) => {
              const isExpanded = state.adminDocExpanded.has(doc.docId);
              return `
                <div class="doc-item ${isExpanded ? 'expanded' : ''}" data-doc-id="${doc.docId}">
                  <div class="doc-item-head" data-action="toggle-doc-expand" data-id="${doc.docId}">
                    <div class="doc-title-group">
                      <span class="doc-badge">${escapeHtml(doc.entityName)}</span>
                      <strong>${escapeHtml(doc.title)}</strong>
                      <span class="doc-topic-tag">${escapeHtml(topicLabels[doc.topic] || '其它旅行资料')}</span>
                    </div>
                    <div class="doc-head-actions">
                      <button class="secondary mini-btn" data-action="edit-doc" data-id="${doc.docId}" data-entity="${escapeHtml(doc.entityName)}" data-title="${escapeHtml(doc.title)}" data-content="${escapeHtml(doc.content)}">编辑语料</button>
                      <span class="expand-icon">${isExpanded ? '收起 ↑' : '展开 ↓'}</span>
                    </div>
                  </div>
                  <div class="doc-body-view ${isExpanded ? 'show-full' : ''}">
                    <div class="doc-content-text">${escapeHtml(doc.content)}</div>
                    <div class="doc-meta-footer">
                      <span>实体ID: <code>${escapeHtml(doc.entityId || doc.docId)}</code></span>
                      <span>资料归类: <b class="health-ok">${escapeHtml(topicLabels[doc.topic] || '其它旅行资料')}</b></span>
                    </div>
                  </div>
                </div>
              `;
            }).join('') : `
              <div class="notice">没有找到匹配的知识库文档，请尝试更换关键词。</div>
            `}
          </div>

          ${filteredDocs.length > 6 ? `
            <div class="fold-footer-bar">
              <button class="ghost" data-action="toggle-admin-docs-fold">
                ${state.adminDocsFolded ? `查看更多语料（当前显示 6 / ${filteredDocs.length} 篇，点击展开全部）` : '收起至精选 6 篇'}
              </button>
            </div>
          ` : ''}
        </div>
      </section>

      <section class="admin-stream-section admin-section-panel ${adminSection === 'users' ? 'is-current' : 'is-hidden'}" data-admin-section="users">
        <div class="admin-stream-head">
          <div class="head-with-meta">
            <h3>用户管理 · 只读与操作授权</h3>
            <span class="head-meta-badge" data-admin-user-count>共 ${users.length} 位注册用户</span>
          </div>
        </div>
        <div class="panel panel-pad admin-users-panel">
          <div class="admin-user-directory-intro">
            <div>
              <span class="eyebrow">ACCOUNT DIRECTORY</span>
              <h4>账号与权限</h4>
              <p>在当前列表中查看旅行资产、调整角色或停用账号；停用会立即从列表移除，后台继续完成处理。</p>
            </div>
            <div class="admin-user-overview" aria-label="账号概览">
              <span><b data-admin-user-count-value>${users.length}</b> 个账号</span>
              <span><b data-admin-admin-count>${users.filter((u) => u.role === 'admin').length}</b> 位管理员</span>
            </div>
          </div>
          <details class="admin-users-disclosure" ${state.adminUsersExpanded ? 'open' : ''}>
            <summary>
              <span>全部账号</span>
              <span class="admin-users-disclosure-hint">${state.adminUsersExpanded ? '收起列表' : '展开查看账号、旅行资产和权限'}</span>
            </summary>
            <div class="admin-user-list" data-admin-user-list>
              ${users.map((u) => {
                const isSelf = state.user?.id === u.id;
                return `
                  <article class="admin-user-row" data-admin-user-id="${escapeHtml(u.id)}">
                    <div class="user-main-info">
                      <div class="user-avatar-circle">${escapeHtml((u.name || u.email || '用')[0])}</div>
                      <div>
                        <strong>${escapeHtml(u.name || '用户')}</strong>
                        <span class="user-email-meta">${escapeHtml(u.email)} · <b data-admin-user-role-label>${u.role === 'admin' ? '系统管理员' : '普通旅行者'}</b></span>
                      </div>
                    </div>
                    <div class="user-metrics-chips">
                      <span class="user-mini-stat"><small>行程</small><b>${u.savedTrips ?? 0}</b></span>
                      <span class="user-mini-stat"><small>旅行记忆</small><b>${u.memories ?? 0}</b></span>
                      <span class="user-mini-stat"><small>画像</small><b>${u.profileConfigured ? '已设置' : '未设置'}</b></span>
                    </div>
                    <div class="user-actions-group">
                      <button class="action-btn-sm secondary" data-action="view-user-detail" data-id="${u.id}">详情</button>
                      <button class="action-btn-sm ${u.role === 'admin' ? 'role-demote' : 'role-promote'}" data-admin-user-role-button data-action="toggle-user-role" data-id="${u.id}" data-role="${u.role === 'admin' ? 'traveler' : 'admin'}">
                        ${u.role === 'admin' ? '设为游客' : '设为管理员'}
                      </button>
                      ${!isSelf ? `
                        <button class="action-btn-sm danger" data-action="delete-user" data-id="${u.id}" data-name="${escapeHtml(u.name || u.email)}" title="立即从列表移除，并在后台停用该账号">
                          停用
                        </button>
                      ` : ''}
                    </div>
                  </article>
                `;
              }).join('')}
            </div>
          </details>
        </div>
      </section>

    </main>
  `;
}

/** 管理员详情、确认与文档编辑都挂载到全局弹窗层，不能为打开弹窗而重绘后台页面。 */
export function adminOverlays() {
  return `
    ${state.editingDoc ? `
      <div class="modal-wrap">
        <div class="modal doc-edit-modal">
          <h2>编辑知识库语料 · ${escapeHtml(state.editingDoc.entity)}</h2>
          <p class="muted" style="margin:0 0 16px;">修改后将保存到本地语料库并自动触发向量重建与索引更新。</p>
          <form data-action="save-doc-form">
            <div class="form-row">
              <label>文档标题</label>
              <input id="edit-doc-title" value="${escapeHtml(state.editingDoc.title)}" required />
            </div>
            <div class="form-row">
              <label>语料核心内容（完整文本）</label>
              <textarea id="edit-doc-content" rows="9" class="doc-editor-textarea" required>${escapeHtml(state.editingDoc.content)}</textarea>
            </div>
            <div class="modal-actions">
              <button type="button" class="secondary" data-action="close-doc-edit">取消</button>
              <button type="submit" class="primary">保存并更新索引</button>
            </div>
          </form>
        </div>
      </div>
    ` : ''}

    ${state.userActionConfirm ? `
      <div class="modal-wrap">
        <div class="modal">
          <h2>${escapeHtml(state.userActionConfirm.title)}</h2>
          <p>${escapeHtml(state.userActionConfirm.message)}</p>
          <div class="modal-actions">
            <button type="button" class="secondary" data-action="cancel-user-action">取消</button>
            <button type="button" class="primary ${state.userActionConfirm.isDanger ? 'button-danger' : ''}" data-action="confirm-user-action" ${state.adminActionPending ? 'disabled' : ''}>${state.adminActionPending ? '处理中…' : '确认执行'}</button>
          </div>
        </div>
      </div>
    ` : ''}

    ${state.adminUserDetail ? `
      <div class="modal-wrap">
        <div class="modal admin-detail-modal">
          <div class="modal-heading-row"><div><span class="config-kicker">User Profile</span><h2>用户详情</h2></div><button type="button" class="icon-btn" data-action="close-user-detail" aria-label="关闭">×</button></div>
          <div class="admin-detail-grid">
            <div><span>姓名</span><strong>${escapeHtml(state.adminUserDetail.name || '未设置')}</strong></div>
            <div><span>邮箱</span><strong>${escapeHtml(state.adminUserDetail.email || '—')}</strong></div>
            <div><span>角色</span><strong>${escapeHtml(state.adminUserDetail.role || 'USER')}</strong></div>
            <div><span>状态</span><strong>${escapeHtml(state.adminUserDetail.status || 'active')}</strong></div>
            <div><span>用户 ID</span><code>${escapeHtml(state.adminUserDetail.id || state.adminUserDetail.userId || '—')}</code></div>
            <div><span>注册时间</span><strong>${escapeHtml(state.adminUserDetail.createdAt || '—')}</strong></div>
          </div>
        </div>
      </div>
    ` : ''}

    ${state.adminFeedbackDetail ? `
      <div class="modal-wrap">
        <div class="modal admin-detail-modal feedback-detail-modal">
          <div class="modal-heading-row"><div><span class="config-kicker">Feedback Detail</span><h2>反馈详情</h2></div><button type="button" class="icon-btn" data-action="close-feedback-detail" aria-label="关闭">×</button></div>
          <div class="feedback-detail-status ${state.adminFeedbackDetail.value === 'helpful' ? 'is-helpful' : 'is-needs-work'}">${state.adminFeedbackDetail.value === 'helpful' ? '用户认为有帮助' : '用户提出了改进建议'}</div>
          <div class="admin-detail-grid">
            <div><span>联系邮箱</span><strong>${escapeHtml(state.adminFeedbackDetail.ownerEmail || '游客反馈，无账号邮箱')}</strong></div>
            <div><span>反馈原因</span><strong>${escapeHtml(state.adminFeedbackDetail.reason || '未填写')}</strong></div>
            <div><span>来源模式</span><strong>${escapeHtml(state.adminFeedbackDetail.sourceMode || '未标注')}</strong></div>
            <div><span>行程版本</span><strong>V${escapeHtml(String(state.adminFeedbackDetail.tripVersion || 1))}</strong></div>
            <div><span>会话 ID</span><code>${escapeHtml(state.adminFeedbackDetail.sessionId || '—')}</code></div>
            <div><span>提交时间</span><strong>${state.adminFeedbackDetail.createdAt ? new Date(state.adminFeedbackDetail.createdAt).toLocaleString('zh-CN') : '刚刚'}</strong></div>
          </div>
          <div class="modal-actions"><button type="button" class="primary" data-action="close-feedback-detail">知道了</button></div>
        </div>
      </div>
    ` : ''}
  `;
}
