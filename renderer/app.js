(() => {
  'use strict';

  const THEME_KEY = 'qtb_theme';
  const themeQuery = window.matchMedia('(prefers-color-scheme: light)');

  function systemTheme() {
    return themeQuery.matches ? 'light' : 'dark';
  }

  function storedTheme() {
    const value = localStorage.getItem(THEME_KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  }

  function currentTheme() {
    const mode = storedTheme();
    return mode === 'system' ? systemTheme() : mode;
  }

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  }

  applyTheme(currentTheme());
  themeQuery.addEventListener('change', () => {
    if (storedTheme() === 'system') {
      applyTheme(systemTheme());
    }
  });

  // 开发（electron .）连本地服务，打包后的生产版本连线上；地址按环境分别记忆。
  const APP_ENV = window.desktop?.env === 'development' ? 'development' : 'production';
  const IS_DEV = APP_ENV === 'development';
  const BASE_KEY = `qtb_base_url_${APP_ENV}`;
  const LEGACY_BASE_KEY = 'qtb_base_url';
  const DEFAULT_BASE = IS_DEV ? 'http://127.0.0.1:32500' : 'https://qserver.deepbit001.com';
  const APP_VERSION = '1.0.10020';

  function initialBaseUrl() {
    const saved = localStorage.getItem(BASE_KEY);
    if (saved) return saved;

    // 兼容旧版本共用的 key：生产环境沿用已保存的线上地址，但忽略开发时留下的本地地址。
    if (!IS_DEV) {
      const legacy = localStorage.getItem(LEGACY_BASE_KEY);
      if (legacy && !/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/i.test(legacy)) {
        return legacy;
      }
    }

    return DEFAULT_BASE;
  }

  const state = {
    token: '',
    user: null,
    baseUrl: initialBaseUrl(),
    view: 'home',
    authTab: 'password',
    geoTab: 'profile',
    update: null,
    downloads: {},
    data: {},
    geo: { profile: null, contents: [], usage: [], usagePage: 1, usageTotal: 0, usageTotalPages: 1, audit: null, index: null, push: null },
    platformContent: { platforms: [], contents: [], platform: 'news', draft: null },
    ai: { conversations: [], messages: [], conversationId: null, streaming: false },
    busy: false
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function esc(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function fmtDate(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString('zh-CN', { hour12: false });
  }

  function fmtDateOnly(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleDateString('zh-CN');
  }

  function fmtDay(value) {
    if (!value) return '';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString('zh-CN');
  }

  function pill(text, tone = '') {
    return `<span class="pill ${tone}">${esc(text)}</span>`;
  }

  function toast(message, isError = false) {
    const el = $('#toast');
    el.textContent = message;
    el.className = `toast${isError ? ' error' : ''}`;
    el.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { el.hidden = true; }, 3200);
  }

  function showModal(title, html, options = {}) {
    const dismissible = options.dismissible !== false;
    $('#modal-root').innerHTML = `
      <div class="modal-backdrop" data-modal-backdrop ${dismissible ? '' : 'data-modal-locked'}>
        <div class="modal" role="dialog" aria-modal="true">
          <div class="row"><h3 class="spacer">${esc(title)}</h3><button class="btn-sm" data-action="close-modal">关闭</button></div>
          <div>${html}</div>
        </div>
      </div>`;
  }

  function closeModal() {
    $('#modal-root').innerHTML = '';
  }

  function apiUrl(path) {
    return `${state.baseUrl.replace(/\/+$/, '')}${path}`;
  }

  async function api(path, options = {}) {
    const {
      method = 'GET',
      body,
      token = state.token,
      timeout = 30000
    } = options;
    const headers = { Accept: 'application/json', 'X-Device-Info': `Electron / ${navigator.platform}` };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    if (window.desktop?.request) {
      const result = await window.desktop.request({
        url: apiUrl(path),
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        timeout
      });
      if (result.error) throw new Error(result.error);
      let envelope;
      try {
        envelope = JSON.parse(result.text);
      } catch {
        throw new Error(`服务器返回异常（HTTP ${result.status}）`);
      }
      if (envelope.Code !== '0') {
        throw new Error(envelope.Message || '请求失败');
      }
      return envelope.Data;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(apiUrl(path), {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal
      });
      const text = await response.text();
      let envelope;
      try {
        envelope = JSON.parse(text);
      } catch {
        throw new Error(`服务器返回异常（HTTP ${response.status}）`);
      }
      if (envelope.Code !== '0') {
        throw new Error(envelope.Message || '请求失败');
      }
      return envelope.Data;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('请求超时，请重试');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async function getStoredToken() {
    if (window.desktop?.getToken) return (await window.desktop.getToken()) || '';
    return localStorage.getItem('qtb_token') || '';
  }

  async function storeToken(token) {
    state.token = token;
    if (window.desktop?.setToken) await window.desktop.setToken(token);
    else localStorage.setItem('qtb_token', token);
  }

  async function clearToken() {
    state.token = '';
    if (window.desktop?.clearToken) await window.desktop.clearToken();
    else localStorage.removeItem('qtb_token');
  }

  async function init() {
    render();
    try {
      const token = await getStoredToken();
      if (token) {
        state.token = token;
        state.user = await api('/api/auth/me');
        state.view = 'home';
      }
    } catch {
      await clearToken();
      state.user = null;
    }
    render();
    if (state.user) {
      loadView();
      checkForUpdates(true);
    }
  }

  const NAV = [
    ['home', '首页'],
    ['dashboard', '大屏'],
    ['ai', 'DeepBit AI助手'],
    ['annual', '年度总结'],
    ['opportunities', '商机'],
    ['enterprises', '企业信息'],
    ['messages', '消息'],
    ['activities', '活动'],
    ['procurements', '招标采购'],
    ['courtesy', '人情簿'],
    ['preferred', '温商优选'],
    ['pro', 'Pro 会员'],
    ['geo', 'GEO 优化', true],
    ['platformContent', 'GEO平台内容', true],
    ['website', '官网', true]
  ];

  const VIEW_LABELS = {
    personal: '个人资料管理',
    org: '组织管理',
    memberTypes: '会员类型管理',
    memberIdentity: '会员身份管理',
    joinReview: '入会审核',
    feedback: '投诉与建议',
    update: '版本检查'
  };

  const NAV_ICONS = {
    home: '⌂', dashboard: '▦', annual: '◔', personal: '◉', org: '▣', memberTypes: '▦', memberIdentity: '♙', joinReview: '✓',
    activities: '◷', opportunities: '▤', procurements: '▥', courtesy: '♡',
    preferred: '✦', enterprises: '▦', messages: '✉', ai: '◌', geo: '◎', platformContent: '✈', website: '◍',
    pro: '♛', feedback: '!', update: '↻'
  };
  const NAV_DESCRIPTIONS = {
    home: '组织概览与快捷入口',
    dashboard: '组织成员、内容与运营数据一屏总览',
    annual: '按年度汇总组织成员、内容与运营数据',
    personal: '个人资料与登录密码',
    org: '组织资料、证照与电子签章留痕；仅会长和秘书长可修改',
    memberTypes: '新增或删除本组织的会员身份类型',
    memberIdentity: '调整成员身份与 Pro 名额',
    joinReview: '审核申请加入本组织的成员',
    activities: '以组织身份发布活动',
    opportunities: '以组织身份发布商机',
    procurements: '以组织身份发布招标采购',
    courtesy: '记录组织内的人情往来',
    preferred: '管理端精选的温商优选内容',
    enterprises: '查询已入驻企业信息',
    messages: '平台通知与站内消息',
    ai: 'DeepBit AI 助手',    geo: 'GEO 内容生成、检测与发布',
    platformContent: '为权威发布平台生成、编辑和删除本地内容',
    website: '组织官网内容、模板与发布',
    pro: 'Pro 会员与原石充值',
    feedback: '投诉、建议与问题反馈',
    update: '检查客户端版本与服务器最新构建'
  };

  function render() {
    const app = $('#app');
    if (!state.user) {
      app.innerHTML = authHTML();
      return;
    }
    const name = state.user.organization?.name || '组织';
    const orgName = state.user.organization?.name || '';
    const currentNav = NAV.find(([key]) => key === state.view);
    const currentLabel = currentNav ? currentNav[1] : (VIEW_LABELS[state.view] || '');
    app.innerHTML = `
      <div class="app-shell">
        <aside class="sidebar">
          <div class="brand-lockup">
            <div class="brand-mark">⌂</div>
            <div class="brand-copy">
              <h1>企通宝</h1>
              <p>${esc(orgName)} · ${esc(state.user.memberTypeName || '')}</p>
            </div>
          </div>
          <div class="sidebar-nav">
            ${NAV.filter(([,, manageOnly]) => !manageOnly || state.user.canManage).map(([key, label]) => `
              <button class="nav-item ${state.view === key ? 'active' : ''}" data-nav="${key}">
                <span class="nav-icon">${NAV_ICONS[key] || '•'}</span>
                <span>${esc(label)}</span>
              </button>
            `).join('')}
          </div>
          <div class="sidebar-footer">
            <button class="user-trigger" data-action="toggle-user-menu">
              <span class="avatar">${esc(String(state.user.nickname || state.user.realName || state.user.phone || '企').slice(0, 1))}</span>
              <span class="user-copy">
                <strong>${esc(state.user.nickname || state.user.phone || '未命名用户')}</strong>
                <small>${esc(state.user.realName || '')} · v${APP_VERSION}</small>
              </span>
            </button>
            <div class="user-menu" id="user-menu" hidden>
              <div class="user-menu-label">账号</div>
              <button data-nav="personal"><span>◉</span>个人资料管理</button>
              <button data-nav="org"><span>▣</span>组织管理</button>
              ${state.user.canManage ? `
                <div class="user-menu-label">会员管理</div>
                <button data-nav="memberTypes"><span>▦</span>会员类型管理</button>
                <button data-nav="memberIdentity"><span>♙</span>会员身份管理</button>
                <button data-nav="joinReview"><span>✓</span>入会审核</button>
              ` : ''}
              <div class="user-menu-label">外观</div>
              <button data-action="theme-select" data-mode="system"><span>◐</span>跟随系统</button>
              <button data-action="theme-select" data-mode="light"><span>☀</span>明亮</button>
              <button data-action="theme-select" data-mode="dark"><span>☾</span>黑暗</button>
              <div class="user-menu-label">其他</div>
              <button data-nav="feedback"><span>!</span>投诉与建议</button>
              <button data-action="open-update"><span>↻</span>版本检查</button>
              <button data-action="logout"><span>↪</span>退出登录</button>
            </div>
          </div>
        </aside>
        <main class="main">
          <div class="topbar">
            <div class="topbar-copy">
              <h2>${esc(currentLabel)}</h2>
              <div class="topbar-sub">${esc(NAV_DESCRIPTIONS[state.view] || '')}</div>
            </div>
            <span class="spacer"></span>
            <span class="small muted">${esc(name)}</span>
            <button class="btn-sm" data-action="refresh">刷新</button>
          </div>
          <div class="view" id="view"><div class="empty">加载中…</div></div>
        </main>
      </div>`;
  }

  function authHTML() {
    return `
      <div class="auth-shell">
        <div class="auth-brand">
          <div class="brand-lockup">
            <div class="brand-mark">⌂</div>
            <div class="brand-copy">
              <h1>企通宝</h1>
              <p>多商会 · 企业入驻</p>
            </div>
          </div>
          <h1>把商会里的人情与生意<br>也把好内容，都留下来</h1>
          <p class="lead">
            会员、商机、活动与内容运营一处管理；<br>
            入驻申请审核通过后即可开始使用。
          </p>
          <div class="auth-features">
            <div class="auth-feature">
              <div class="auth-feature-icon">♙</div>
              <div><strong>会员与组织</strong><span>会员目录、企业档案与入会审核</span></div>
            </div>
            <div class="auth-feature">
              <div class="auth-feature-icon">✦</div>
              <div><strong>商机与活动</strong><span>供需对接、活动报名与签到</span></div>
            </div>
            <div class="auth-feature">
              <div class="auth-feature-icon">◎</div>
              <div><strong>GEO 内容运营</strong><span>让商会的好内容被 AI 看见</span></div>
            </div>
          </div>
          <div class="auth-copyright">© 2026 西安深比特人工智能科技有限公司</div>
        </div>

        <div class="card auth-panel">
          <h2>登录</h2>
          <div class="card-sub">欢迎回来，登录后继续管理你的商会</div>
          <div class="auth-tabs">
            <button class="${state.authTab === 'password' ? 'primary' : ''}" data-action="auth-tab" data-tab="password">密码登录</button>
            <button class="${state.authTab === 'sms' ? 'primary' : ''}" data-action="auth-tab" data-tab="sms">验证码登录</button>
          </div>
          ${state.authTab === 'password' ? `
            <form data-form="login-password">
              <label class="field"><span>手机号</span><input name="phone" placeholder="请输入手机号" required></label>
              <label class="field"><span>密码</span><input type="password" name="password" placeholder="请输入密码" required></label>
              <button class="primary" style="width:100%" type="submit">登录</button>
            </form>` : `
            <form data-form="login-sms">
              <label class="field"><span>手机号</span><input name="phone" placeholder="请输入手机号" required></label>
              <label class="field"><span>验证码</span><div class="row"><input name="code" placeholder="6 位验证码" required style="flex:1"><button type="button" class="btn-sm" data-action="send-sms" data-scene="login">发送验证码</button></div></label>
              <button class="primary" style="width:100%" type="submit">登录</button>
            </form>`}
          <div class="row" style="margin-top:12px">
            <button class="link" data-action="show-register">申请入驻</button>
            <span class="spacer"></span>
            <span class="small muted">服务器：${esc(state.baseUrl)}</span>
          </div>
          <details style="margin-top:12px">
            <summary class="small muted">修改服务器地址</summary>
            <form data-form="save-base" style="margin-top:8px">
              <label class="field"><span>API 地址</span><input name="baseUrl" value="${esc(state.baseUrl)}"></label>
              <button type="submit" class="btn-sm">保存</button>
            </form>
          </details>
        </div>
      </div>`;
  }

  function navTo(view) {
    state.view = view;
    render();
    loadView();
  }

  async function loadView() {
    const main = $('#view');
    if (!main) return;
    try {
      switch (state.view) {
        case 'home': await loadHome(main); break;
        case 'dashboard': await loadDashboard(main); break;
        case 'annual': await loadAnnualSummary(main); break;
        case 'personal': await loadPersonal(main); break;
        case 'org': await loadOrg(main); break;
        case 'memberTypes': await loadMemberTypes(main); break;
        case 'memberIdentity': await loadMemberIdentity(main); break;
        case 'joinReview': await loadJoinReview(main); break;
        case 'activities': await loadActivities(main); break;
        case 'opportunities': await loadOpportunities(main); break;
        case 'procurements': await loadProcurements(main); break;
        case 'courtesy': await loadCourtesy(main); break;
        case 'preferred': await loadPreferred(main); break;
        case 'enterprises': await loadEnterprises(main); break;
        case 'messages': await loadMessages(main); break;
        case 'ai': await loadAI(main); break;
        case 'geo': await loadGeo(main); break;
        case 'platformContent': await loadPlatformContent(main); break;
        case 'website': await loadWebsite(main); break;
        case 'pro': await loadPro(main); break;
        case 'update': await loadUpdate(main); break;
        case 'feedback': renderFeedback(main); break;
        default: main.innerHTML = '<div class="empty">未知页面</div>';
      }
    } catch (error) {
      main.innerHTML = `<div class="card">加载失败：${esc(error.message)}</div>`;
    }
  }

  function field(label, name, value = '', type = 'text', extra = '') {
    return `<label class="field"><span>${esc(label)}</span><input type="${type}" name="${esc(name)}" value="${esc(value ?? '')}" ${extra}></label>`;
  }

  function textareaField(label, name, value = '', extra = '') {
    return `<label class="field"><span>${esc(label)}</span><textarea name="${esc(name)}" ${extra}>${esc(value ?? '')}</textarea></label>`;
  }

  function selectField(label, name, options, value = '', extra = '') {
    const opts = options.map(([optionValue, text]) =>
      `<option value="${esc(optionValue)}" ${String(optionValue) === String(value) ? 'selected' : ''}>${esc(text)}</option>`
    ).join('');
    return `<label class="field"><span>${esc(label)}</span><select name="${esc(name)}" ${extra}>${opts}</select></label>`;
  }

  function dataKey(name) {
    return (state.data[name] || []);
  }

  function regionProvinces() {
    return (window.SHANGHUI_REGIONS || []).map(item => item.name);
  }

  function regionChildren(province, city) {
    const provinceItem = (window.SHANGHUI_REGIONS || []).find(item => item.name === province);
    if (!provinceItem) return [];
    if (city === undefined) return provinceItem.children.map(item => item.name);
    const cityItem = provinceItem.children.find(item => item.name === city);
    return cityItem ? cityItem.children.map(item => item.name) : [];
  }

  function regionOptions(values, current) {
    const list = [['', '请选择']].concat(values.map(value => [value, value]));
    if (current && !values.includes(current)) list.push([current, current]);
    return list;
  }

  function fillRegionSelect(form, name, values, current) {
    const select = form.querySelector(`select[name="${name}"]`);
    if (!select) return;
    select.innerHTML = regionOptions(values, current)
      .map(([value, text]) => `<option value="${esc(value)}">${esc(text)}</option>`)
      .join('');
    select.value = current || '';
  }

  async function loadDashboard(main) {
    const safe = (path) => api(path).catch(() => null);
    const [profile, members, types, opportunities, myOpportunities, activities, myActivities, procurements, myProcurements, preferred, pro, website, geo, messages, enterprises] = await Promise.all([
      safe('/api/org/profile'),
      safe('/api/org/members'),
      safe('/api/org/member-types'),
      safe('/api/org/opportunities/public'),
      safe('/api/org/opportunities/mine'),
      safe('/api/org/activities/public'),
      safe('/api/org/activities/mine'),
      safe('/api/org/procurements/public'),
      safe('/api/org/procurements/mine'),
      safe('/api/org/preferred-items'),
      safe('/api/org/pro/status'),
      safe('/api/org/website'),
      safe('/api/org/geo/contents'),
      safe('/api/org/messages?page=1&pageSize=5'),
      safe('/api/org/enterprises?page=1&pageSize=5')
    ]);
    const org = profile || state.user.organization || {};
    const counts = {
      members: Array.isArray(members) ? members.length : 0,
      types: Array.isArray(types) ? types.length : 0,
      opportunities: Array.isArray(opportunities) ? opportunities.length : 0,
      activities: Array.isArray(activities) ? activities.length : 0,
      procurements: Array.isArray(procurements) ? procurements.length : 0,
      preferred: Array.isArray(preferred) ? preferred.length : 0,
      geo: Array.isArray(geo) ? geo.length : 0,
      enterprises: enterprises?.total ?? enterprises?.items?.length ?? 0,
      messages: messages?.items?.length ?? 0
    };
    const recentOpportunities = (Array.isArray(opportunities) ? opportunities : []).slice(0, 5);
    const recentActivities = (Array.isArray(activities) ? activities : []).slice(0, 5);
    const recentMessages = (messages?.items || []).slice(0, 5);
    const stone = pro?.organizationStoneBalance ?? pro?.personalStoneBalance ?? '-';
    main.innerHTML = `
      <div class="dashboard">
        <div class="dash-hero">
          <div>
            <div class="eyebrow">ORGANIZATION OVERVIEW</div>
            <h1>${esc(org.name || '组织运营大屏')}</h1>
            <div class="card-sub">${esc(org.creditCode || '')} · ${esc(org.address || org.city || '')}</div>
            <p class="lead">${esc(org.introduction || '以商会组织为中心，汇总成员、内容、商机、活动与数字化运营数据。')}</p>
          </div>
          <div class="dash-hero-side">
            <span class="pill info">${esc(state.user.memberTypeName || '成员')}</span>
            <div class="dash-big-number">${esc(stone)}</div>
            <div class="small muted">可用原石${pro?.isPro ? ' · Pro 已开通' : ''}</div>
            <button class="btn-sm" data-action="fullscreen-dashboard" style="margin-top:10px">进入全屏</button>
          </div>
        </div>
        <div class="stat-grid">
          ${dashStat('成员', counts.members, '组织成员')}
          ${dashStat('会员类型', counts.types, '身份体系')}
          ${dashStat('商机', counts.opportunities, '公开商机')}
          ${dashStat('活动', counts.activities, '公开活动')}
          ${dashStat('招标采购', counts.procurements, '公开项目')}
          ${dashStat('企业库', counts.enterprises, '匹配企业')}
          ${dashStat('GEO 内容', counts.geo, '已生成内容')}
          ${dashStat('优选', counts.preferred, '温商优选')}
        </div>
        <div class="dash-columns">
          <div class="card">
            <div class="row"><h3 class="spacer">最新商机</h3><button class="btn-sm" data-nav="opportunities">全部</button></div>
            ${recentOpportunities.map(x => `<div class="dash-row"><div><strong>${esc(x.title)}</strong><div class="small muted">${esc(x.organizationName || '')} · ${esc(x.location || '')}</div></div>${pill(x.statusLabel || x.status || '')}</div>`).join('') || '<div class="empty">暂无商机</div>'}
          </div>
          <div class="card">
            <div class="row"><h3 class="spacer">最新活动</h3><button class="btn-sm" data-nav="activities">全部</button></div>
            ${recentActivities.map(x => `<div class="dash-row"><div><strong>${esc(x.title)}</strong><div class="small muted">${esc(x.location || '')} · ${fmtDate(x.startTime)}</div></div>${pill(x.statusLabel || x.status || '')}</div>`).join('') || '<div class="empty">暂无活动</div>'}
          </div>
          <div class="card">
            <div class="row"><h3 class="spacer">站内消息</h3><button class="btn-sm" data-nav="messages">全部</button></div>
            ${recentMessages.map(x => `<div class="dash-row"><div><strong>${esc(x.title)}</strong><div class="small muted">${fmtDate(x.publishedAt)}</div></div>${x.isRead ? pill('已读') : pill('未读', 'warn')}</div>`).join('') || '<div class="empty">暂无消息</div>'}
          </div>
          <div class="card">
            <h3>运营状态</h3>
            <div class="dash-status">
              <div><span>官网</span><strong>${esc(website?.status || '未创建')}</strong></div>
              <div><span>官网地址</span><strong>${website?.siteUrl ? `<a href="${esc(website.siteUrl)}" target="_blank" rel="noreferrer">${esc(website.siteUrl)}</a>` : '—'}</strong></div>
              <div><span>Pro</span><strong>${pro?.isPro ? '已开通' : '未开通'}</strong></div>
              <div><span>GEO 内容</span><strong>${counts.geo} 篇</strong></div>
            </div>
          </div>
        </div>
      </div>`;
  }

  async function loadAnnualSummary(main) {
    const currentYear = new Date().getFullYear();
    const year = Number(state.data.summaryYear || currentYear);
    const safe = (path) => api(path).catch(() => null);
    const [profile, members, opportunities, activities, procurements, notes, geo, website, pro] = await Promise.all([
      safe('/api/org/profile'),
      safe('/api/org/members'),
      safe('/api/org/opportunities/mine'),
      safe('/api/org/activities/mine'),
      safe('/api/org/procurements/mine'),
      safe('/api/org/courtesy-notes?page=1&pageSize=500'),
      safe('/api/org/geo/contents'),
      safe('/api/org/website'),
      safe('/api/org/pro/status')
    ]);
    const asArray = (value) => Array.isArray(value) ? value : [];
    const memberList = asArray(members);
    const opportunityList = asArray(opportunities);
    const activityList = asArray(activities);
    const procurementList = asArray(procurements);
    const noteList = asArray(notes?.items ?? notes);
    const geoList = asArray(geo);

    const dateOf = (item, keys) => {
      for (const key of keys) {
        if (item?.[key]) {
          const value = new Date(item[key]);
          if (!Number.isNaN(value.getTime())) return value;
        }
      }
      return null;
    };
    const inYear = (item, keys) => dateOf(item, keys)?.getFullYear() === year;
    const monthly = Array.from({ length: 12 }, () => 0);
    const collect = (list, keys) => {
      for (const item of list) {
        const date = dateOf(item, keys);
        if (date?.getFullYear() === year) monthly[date.getMonth()] += 1;
      }
    };
    collect(memberList, ['createdAt']);
    collect(opportunityList, ['createdAt', 'eventTime']);
    collect(activityList, ['createdAt', 'startTime']);
    collect(procurementList, ['createdAt', 'bidDeadline']);
    collect(noteList, ['createdAt', 'eventTime']);
    collect(geoList, ['createdAt']);

    const count = (list, keys) => list.filter(item => inYear(item, keys)).length;
    const memberCount = count(memberList, ['createdAt']);
    const opportunityCount = count(opportunityList, ['createdAt', 'eventTime']);
    const activityCount = count(activityList, ['createdAt', 'startTime']);
    const procurementCount = count(procurementList, ['createdAt', 'bidDeadline']);
    const noteCount = count(noteList, ['createdAt', 'eventTime']);
    const geoCount = count(geoList, ['createdAt']);
    const approvedOpportunities = opportunityList.filter(item => inYear(item, ['createdAt', 'eventTime']) && item.status === 'Approved').length;
    const maxMonthly = Math.max(1, ...monthly);
    const yearOptions = [currentYear, currentYear - 1, currentYear - 2, currentYear - 3];
    const recentOpportunities = opportunityList
      .filter(item => inYear(item, ['createdAt', 'eventTime']))
      .slice(0, 3);
    const recentActivities = activityList
      .filter(item => inYear(item, ['createdAt', 'startTime']))
      .slice(0, 3);

    const stat = (label, value, hint) => `
      <div class="summary-stat">
        <div class="summary-stat-value">${esc(value)}</div>
        <div class="summary-stat-label">${esc(label)}</div>
        <div class="summary-stat-hint">${esc(hint)}</div>
      </div>`;

    main.innerHTML = `
      <div class="summary-page">
        <div class="card summary-hero">
          <div>
            <div class="eyebrow">ANNUAL REVIEW</div>
            <h1>${year} 年度总结</h1>
            <p class="card-sub">${esc(profile?.name || state.user.organization?.name || '当前组织')} · 成员、内容与运营数据年度回顾</p>
          </div>
          <div class="tabs summary-years">
            ${yearOptions.map(item => `<button class="tab ${item === year ? 'active' : ''}" data-action="summary-year" data-year="${item}">${item}</button>`).join('')}
          </div>
        </div>

        <div class="summary-stat-grid">
          ${stat('新增成员', memberCount, `当前共 ${memberList.length} 人`)}
          ${stat('发布商机', opportunityCount, `已通过 ${approvedOpportunities} 条`)}
          ${stat('举办活动', activityCount, `活动记录 ${activityList.length} 条`)}
          ${stat('招标采购', procurementCount, `采购记录 ${procurementList.length} 条`)}
          ${stat('人情往来', noteCount, `人情簿共 ${noteList.length} 条`)}
          ${stat('GEO 内容', geoCount, `累计 ${geoList.length} 篇`)}
        </div>

        <div class="summary-columns">
          <div class="card">
            <h3>月度内容产出</h3>
            <div class="summary-chart">
              ${monthly.map((value, index) => `
                <div class="summary-bar-wrap">
                  <div class="summary-bar" style="height:${Math.max(4, Math.round(value / maxMonthly * 100))}%">
                    <span>${value}</span>
                  </div>
                  <div class="summary-bar-label">${index + 1}月</div>
                </div>`).join('')}
            </div>
          </div>
          <div class="card">
            <h3>年度状态</h3>
            <div class="summary-status">
              <div><span>官网</span><strong>${esc(website?.status || '未创建')}</strong></div>
              <div><span>官网地址</span><strong>${website?.siteUrl ? `<a href="${esc(website.siteUrl)}" target="_blank" rel="noreferrer">${esc(website.siteUrl)}</a>` : '—'}</strong></div>
              <div><span>Pro 会员</span><strong>${pro?.isPro ? '已开通' : '未开通'}</strong></div>
              <div><span>可用原石</span><strong>${pro?.organizationStoneBalance ?? pro?.personalStoneBalance ?? 0}</strong></div>
            </div>
          </div>
        </div>

        <div class="summary-columns">
          <div class="card">
            <h3>年度商机</h3>
            ${recentOpportunities.map(item => `<div class="summary-row"><div><strong>${esc(item.title)}</strong><div class="small muted">${esc(item.location || '')}</div></div>${pill(item.statusLabel || item.status || '', item.status === 'Approved' ? 'ok' : 'warn')}</div>`).join('') || '<div class="empty">本年度暂无商机</div>'}
          </div>
          <div class="card">
            <h3>年度活动</h3>
            ${recentActivities.map(item => `<div class="summary-row"><div><strong>${esc(item.title)}</strong><div class="small muted">${esc(item.location || '')} · ${fmtDate(item.startTime)}</div></div><span class="small muted">${esc(item.statusLabel || item.status || '')}</span></div>`).join('') || '<div class="empty">本年度暂无活动</div>'}
          </div>
        </div>
      </div>`;
  }

  function dashStat(label, value, hint) {
    return `<div class="stat-tile"><div class="stat-value">${esc(value)}</div><div class="stat-label">${esc(label)}</div><div class="stat-hint">${esc(hint)}</div></div>`;
  }

  function compareVersions(left, right) {
    const a = String(left || '').split('.').map(value => Number.parseInt(value, 10) || 0);
    const b = String(right || '').split('.').map(value => Number.parseInt(value, 10) || 0);
    const length = Math.max(a.length, b.length);
    for (let index = 0; index < length; index += 1) {
      const av = a[index] || 0;
      const bv = b[index] || 0;
      if (av !== bv) return av > bv ? 1 : -1;
    }
    return 0;
  }

  async function getCurrentVersion() {
    if (window.desktop?.version) {
      try {
        const value = await window.desktop.version();
        if (value) return String(value);
      } catch {
        // 回退到页面内置版本
      }
    }
    return APP_VERSION;
  }

  function downloadKey(url, fileName) {
    return JSON.stringify([String(url || ''), String(fileName || '')]);
  }

  function downloadProgressText(record) {
    if (!record) return '准备下载…';
    const percent = record.percent;
    if (percent !== null && percent !== undefined) return `下载中 ${percent}%`;
    if (record.received > 0) return `下载中 ${(record.received / 1024 / 1024).toFixed(1)} MB`;
    return '准备下载…';
  }

  function applyDownloadRecord(el, record) {
    if (!el || !record) return;
    const stateText = el.querySelector('.update-download-state');
    if (record.status === 'downloading') {
      el.disabled = true;
      el.classList.remove('done');
      el.dataset.action = 'download-update';
      if (stateText) stateText.textContent = downloadProgressText(record);
    } else if (record.status === 'done' && record.path) {
      el.disabled = false;
      el.classList.add('done');
      el.dataset.action = 'open-downloaded';
      el.dataset.path = record.path;
      if (stateText) stateText.textContent = '已下载，点击打开安装包';
    } else if (record.status === 'error') {
      el.disabled = false;
      el.classList.remove('done');
      el.dataset.action = 'download-update';
      delete el.dataset.path;
      if (stateText) stateText.textContent = '下载失败，点击重试';
    }
  }

  function refreshDownloadButtons() {
    $$('[data-download-key]').forEach((el) => {
      applyDownloadRecord(el, state.downloads[el.dataset.downloadKey]);
    });
  }

  async function checkForUpdates(notify = false) {
    const current = await getCurrentVersion();
    try {
      const data = await api('/api/public/releases', { token: '' });
      const latest = String(data?.latestVersion || '');
      const versions = Array.isArray(data?.versions) ? data.versions : [];
      const downloads = Array.isArray(data?.downloads)
        ? data.downloads.filter(item => item.version === latest)
        : [];
      const notes = versions.find(item => item.version === latest)?.notes || '';
      const available = latest.length > 0 && compareVersions(latest, current) > 0;
      state.update = {
        current,
        latest,
        notes,
        downloads,
        available,
        checkedAt: new Date(),
        error: null
      };
      if (notify && available) {
        toast(`发现新版本 ${latest}，可在左下角头像菜单中进入版本检查`);
      }
    } catch (error) {
      state.update = {
        current,
        latest: '',
        notes: '',
        downloads: [],
        available: false,
        checkedAt: new Date(),
        error: error.message || '版本检查失败'
      };
      if (notify) toast('版本检查失败，请稍后在头像菜单重试', true);
    }
    return state.update;
  }

  async function loadUpdate(main) {
    main.innerHTML = '<div class="card"><div class="empty">正在从服务器检查版本…</div></div>';
    const update = await checkForUpdates(false);
    const latest = update.latest || '';
    const downloadLinks = (update.downloads || []).map(item => {
      const size = Number(item.fileSize || 0);
      const sizeText = size > 0 ? `${(size / 1024 / 1024).toFixed(1)} MB` : '';
      const href = apiUrl(item.downloadUrl || '/');
      const fileName = item.fileName || '';
      const key = downloadKey(href, fileName);
      return `<button type="button" class="update-download" data-action="download-update" data-download-key="${esc(key)}" data-url="${esc(href)}" data-name="${esc(fileName)}">
        <strong>${esc(item.platformLabel || item.platform || '下载')}</strong>
        <span>${esc(fileName)}${sizeText ? ` · ${sizeText}` : ''}</span>
        <span class="update-download-state">在应用内下载</span>
      </button>`;
    }).join('');

    let status;
    if (!latest) {
      status = '<span class="pill warn">服务器暂无版本信息</span>';
    } else if (update.available) {
      status = `<span class="pill info">发现新版本 ${esc(latest)}</span>`;
    } else if (compareVersions(update.current, latest) > 0) {
      status = '<span class="pill warn">当前版本高于服务器版本</span>';
    } else {
      status = '<span class="pill ok">已是最新版本</span>';
    }

    main.innerHTML = `
      <div class="update-page">
        <div class="card update-hero">
          <div>
            <div class="eyebrow">CLIENT UPDATE</div>
            <h2>软件版本检查</h2>
            <p class="card-sub">版本信息从当前服务器读取，只提醒有可用更新，不会自动下载或安装。</p>
          </div>
          <div class="update-current">
            <span>当前版本</span>
            <strong>v${esc(update.current)}</strong>
            ${status}
          </div>
        </div>
        <div class="update-grid">
          <div class="card">
            <h3>服务器最新版本</h3>
            <div class="update-latest">${latest ? `v${esc(latest)}` : '—'}</div>
            <div class="small muted">检查时间：${fmtDate(update.checkedAt)}</div>
            ${update.error ? `<div class="pill bad" style="margin-top:10px">${esc(update.error)}</div>` : ''}
            <div class="row" style="margin-top:14px">
              <button data-action="refresh-update">重新检查</button>
            </div>
          </div>
          <div class="card">
            <h3>更新说明</h3>
            <div class="update-notes">${esc(update.notes || '服务器暂未提供本次版本的更新说明。')}</div>
          </div>
        </div>
        <div class="card">
          <div class="row">
            <h3 class="spacer">服务器安装包</h3>
            <span class="small muted">在应用内下载到系统下载目录，完成后可直接打开安装包</span>
          </div>
          <div class="update-downloads">
            ${downloadLinks || '<div class="empty">服务器暂未提供该版本的安装包</div>'}
          </div>
        </div>
      </div>`;

    // 页面重建后恢复已有的下载状态（下载中 / 已下载 / 下载失败）。
    refreshDownloadButtons();
  }

  async function loadHome(main) {
    const user = state.user;
    const org = user.organization || {};
    let pro = null;
    try { pro = await api('/api/org/pro/status'); } catch { /* 忽略 */ }
    main.innerHTML = `
      <div class="grid">
        <div class="card">
          <h3>${esc(org.name || '组织')}</h3>
          <div class="card-sub">${esc(org.creditCode || '')}</div>
          <p class="small muted">${esc(org.introduction || '暂无组织介绍')}</p>
          <div class="row">
            <span class="pill ok">${esc(org.status || '')}</span>
            ${user.canManage ? '<span class="pill info">管理员</span>' : ''}
          </div>
        </div>
        <div class="card">
          <h3>原石</h3>
          <div class="row" style="gap:24px">
            <div><div class="small muted">个人原石</div><div style="font-size:26px">${pro?.personalStoneBalance ?? '-'}</div></div>
            <div><div class="small muted">企业原石</div><div style="font-size:26px">${pro?.organizationStoneBalance ?? '-'}</div></div>
          </div>
          <div class="small muted" style="margin-top:8px">Pro：${pro?.isPro ? '已开通' : '未开通'}</div>
        </div>
        <div class="card">
          <h3>快捷入口</h3>
          <div class="row">
            <button data-nav="geo">GEO 优化</button>
            <button data-nav="messages">站内消息</button>
            <button data-nav="ai">DeepBit AI</button>
          </div>
        </div>
      </div>
      <div class="card">
        <h3>账号信息</h3>
        <table>
          <tr><th>手机号</th><td>${esc(user.phone)}</td><th>昵称</th><td>${esc(user.nickname)}</td></tr>
          <tr><th>姓名</th><td>${esc(user.realName)}</td><th>身份</th><td>${esc(user.memberTypeName)}</td></tr>
        </table>
      </div>`;
  }

  async function loadPersonal(main) {
    const tab = state.data.personalTab === 'password' ? 'password' : 'profile';
    const user = state.user || {};
    main.innerHTML = `
      <div class="tabs">
        <button class="tab ${tab === 'profile' ? 'active' : ''}" data-action="personal-tab" data-tab="profile">资料</button>
        <button class="tab ${tab === 'password' ? 'active' : ''}" data-action="personal-tab" data-tab="password">改密码</button>
      </div>
      ${tab === 'profile' ? personalProfileHTML(user) : personalPasswordHTML(user)}`;
  }

  function personalProfileHTML(user) {
    return `
      <div class="card">
        <div class="row"><h3 class="spacer">个人资料</h3><span class="small muted">手机号 ${esc(user.phone)} 不可修改</span></div>
        <form data-form="save-personal">
          <div class="split">
            ${field('昵称', 'nickname', user.nickname)}
            ${field('手机号', 'phone', user.phone, 'text', 'disabled')}
          </div>
          ${PERSONAL_GROUPS.map(group => `
            <h4 style="margin:14px 0 8px">${esc(group.title)}</h4>
            ${courtesyGroupFieldsHTML(group.fields, user)}
          `).join('')}
          <button class="primary" type="submit">保存</button>
        </form>
      </div>`;
  }

  function personalPasswordHTML(user) {
    return `
      <div class="card">
        <h3>修改密码</h3>
        <form data-form="change-password">
          <label class="field"><span>短信验证码（发送到 ${esc(user.phone)}）</span><div class="row"><input name="code" placeholder="6 位验证码" autocomplete="off" style="flex:1"><button type="button" class="btn-sm" data-action="send-sms" data-scene="change-password">发送验证码</button></div></label>
          ${field('新密码', 'newPassword', '', 'password')}
          ${field('确认新密码', 'confirmPassword', '', 'password')}
          <button class="primary" type="submit">修改密码</button>
        </form>
      </div>`;
  }

  async function loadOrg(main) {
    const org = await api('/api/org/profile');
    state.data.org = org;
    const canManage = state.user.canManage === true;
    const ro = canManage ? '' : 'disabled';
    main.innerHTML = `
      <div class="card">
        <h3>组织资料</h3>
        ${canManage ? '' : '<div class="card-sub" style="margin-bottom:10px">仅会长或秘书长可以修改组织资料和证照，当前为只读。</div>'}
        <form data-form="save-org">
          <div class="split">
            ${field('组织名称', 'name', org.name, 'text', 'disabled')}
            ${field('统一社会信用代码', 'creditCode', org.creditCode, 'text', 'disabled')}
          </div>
          ${field('地址', 'address', org.address || '', 'text', ro)}
          <div class="split">
            ${selectField('省', 'province', regionOptions(regionProvinces(), org.province || ''), org.province || '', `data-region="province" ${ro}`)}
            ${selectField('市', 'city', regionOptions(regionChildren(org.province || ''), org.city || ''), org.city || '', `data-region="city" ${ro}`)}
          </div>
          <div class="split">
            ${selectField('区/县', 'district', regionOptions(regionChildren(org.province || '', org.city || ''), org.district || ''), org.district || '', `data-region="district" ${ro}`)}
            ${field('联系电话', 'contactPhone', org.contactPhone || '', 'text', ro)}
          </div>
          ${textareaField('组织介绍', 'introduction', org.introduction || '', ro)}
          ${canManage ? '<button class="primary" type="submit">保存组织资料</button>' : ''}
        </form>
      </div>
      <div class="card">
        <h3>营业执照</h3>
        <div class="row">
          <span>营业执照：${org.hasBusinessLicense ? pill('已上传', 'ok') : pill('未上传')}</span>
          <button data-action="upload-asset" data-kind="license" ${ro}>上传营业执照</button>
          <button class="danger" data-action="delete-asset" data-kind="license" ${ro}>删除</button>
        </div>
      </div>`;
  }

  async function loadMemberTypes(main) {
    if (!state.user.canManage) {
      main.innerHTML = '<div class="card"><div class="empty">只有会长或秘书长可以管理会员类型。</div></div>';
      return;
    }
    const types = await api('/api/org/member-types');
    state.data.memberTypes = types;
    main.innerHTML = `
      <div class="card">
        <h3>会员类型管理</h3>
        <div class="card-sub">会长和秘书长是内置身份，不能删除；其他类型可自由增加或删除。仍有成员使用的类型需要先调整成员身份。</div>
        <form data-form="add-member-type" class="row" style="margin-top:12px">
          <div  style="display: flex;justify-content: space-between;width: 100%">
          <input name="name" placeholder="新身份名称，例如：理事" required style="width: 200px">
          <button class="primary" type="submit" >新增身份</button>
          </div>
        </form>
        <table style="margin-top:10px">
          <tr><th>名称</th><th>代码</th><th>成员数</th><th>操作</th></tr>
          ${types.map(t => `
            <tr>
              <td>${esc(t.name)}</td>
              <td class="mono">${esc(t.code || '')}</td>
              <td>${t.memberCount}</td>
              <td>${t.isBuiltIn ? '<span class="small muted">内置</span>' : `<button class="btn-sm danger" data-action="delete-member-type" data-id="${t.id}">删除</button>`}</td>
            </tr>`).join('') || '<tr><td colspan="4" class="empty">还没有会员类型</td></tr>'}
        </table>
      </div>`;
  }

  async function loadMemberIdentity(main) {
    if (!state.user.canManage) {
      main.innerHTML = '<div class="card"><div class="empty">只有会长或秘书长可以调整会员身份。</div></div>';
      return;
    }
    const [types, members] = await Promise.all([
      api('/api/org/member-types'),
      api('/api/org/members')
    ]);
    state.data.memberTypes = types;
    state.data.members = members;
    main.innerHTML = `
      <div class="card">
        <h3>会员身份管理</h3>
        <div class="card-sub">会长身份由入驻审核自动设置，不能在这里修改；其他成员可调整为秘书长、普通会员或自定义类型。</div>
        <table style="margin-top:10px">
          <tr><th>成员</th><th>手机号</th><th>身份</th><th>Pro</th><th>操作</th></tr>
          ${members.map(m => `
            <tr>
              <td>${esc(m.nickname)}<div class="small muted">${esc(m.realName)}</div></td>
              <td>${esc(m.phone)}</td>
              <td>
                <select data-member-type="${m.id}" disabled="${m.name === '会长'| m.name==='秘书长'}">
                  ${types.map(t => `<option value="${t.id}" ${t.id === m.memberTypeId ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}
                </select>
              </td>
              <td>${m.isPro ? pill('Pro', 'ok') : pill('普通')}</td>
              <td>
                <button class="btn-sm" data-action="save-member-type" data-id="${m.id}">保存身份</button>
                <button class="btn-sm" data-action="toggle-member-pro" data-id="${m.id}" data-enabled="${m.isPro ? 'false' : 'true'}">${m.isPro ? '取消 Pro' : '授予 Pro'}</button>
              </td>
            </tr>`).join('') || '<tr><td colspan="5" class="empty">组织内还没有成员</td></tr>'}
        </table>
      </div>`;
  }

  function listTabs(view, tab) {
    const labels = {
      opportunities: '商机广场',
      activities: '活动广场',
      procurements: '招标采购广场'
    };
    return `
      <div class="tabs">
        <button class="tab ${tab === 'public' ? 'active' : ''}" data-action="list-tab" data-view="${view}" data-tab="public">${labels[view] || '广场'}</button>
        <button class="tab ${tab === 'mine' ? 'active' : ''}" data-action="list-tab" data-view="${view}" data-tab="mine">我的发布</button>
      </div>`;
  }

  function modeTabs(view, mode) {
    return `
      <div class="tabs">
        <button class="tab ${mode === 'view' ? 'active' : ''}" data-action="mode-tab" data-view="${view}" data-mode="view">查看</button>
        <button class="tab ${mode === 'publish' ? 'active' : ''}" data-action="mode-tab" data-view="${view}" data-mode="publish">发布</button>
      </div>`;
  }

  async function loadOpportunities(main) {
    const mode = state.data.oppMode || 'view';
    if (mode === 'publish') {
      main.innerHTML = `${modeTabs('opportunities', mode)}
        <div class="card">
          <h3>发布商机</h3>
          <form data-form="create-opportunity">
            <div class="split">${field('标题', 'title')}${field('地点', 'location')}</div>
            ${field('活动时间', 'eventTime', '', 'datetime-local')}
            ${textareaField('内容', 'content')}
            <button class="primary" type="submit">发布</button>
          </form>
        </div>`;
      return;
    }

    const tab = state.data.oppTab || 'public';
    const [pub, mine] = await Promise.all([
      api('/api/org/opportunities/public'),
      api('/api/org/opportunities/mine')
    ]);
    const list = tab === 'public' ? pub : mine;
    main.innerHTML = `${modeTabs('opportunities', mode)}
      <div class="card">
        ${listTabs('opportunities', tab)}
        <table>
          <tr><th>标题</th><th>发布方</th><th>时间</th><th>地点</th><th>状态</th></tr>
          ${list.map(x => `
            <tr>
              <td>${esc(x.title)}<div class="small muted">${esc(x.content).slice(0, 60)}</div></td>
              <td>${esc(x.organizationName)}</td>
              <td>${fmtDate(x.eventTime)}</td>
              <td>${esc(x.location)}</td>
              <td>${pill(x.statusLabel || x.status, x.status === 'Approved' ? 'ok' : x.status === 'Rejected' ? 'bad' : 'warn')}</td>
            </tr>`).join('') || '<tr><td colspan="5" class="empty">暂无数据</td></tr>'}
        </table>
      </div>`;
  }

  async function loadJoinReview(main) {
    if (!state.user.canManage) {
      main.innerHTML = '<div class="card"><div class="empty">只有会长或秘书长可以审核入会申请。</div></div>';
      return;
    }
    const applications = await api('/api/org/join-applications?status=Pending');
    main.innerHTML = `
      <div class="card">
        <div class="row">
          <h3 class="spacer">入会审核</h3>
          <span class="small muted">仅显示本组织待审核申请</span>
        </div>
        <table>
          <tr><th>申请人</th><th>手机号</th><th>申请说明</th><th>提交时间</th><th>操作</th></tr>
          ${(applications || []).map(item => `
            <tr>
              <td>${esc(item.nickname)}<div class="small muted">${esc(item.realName)}${item.companyName ? ` · ${esc(item.companyName)}` : ''}</div></td>
              <td>${esc(item.phone)}</td>
              <td>${esc(item.message || '—')}</td>
              <td class="small">${fmtDate(item.createdAt)}</td>
              <td class="row">
                <button class="btn-sm primary" data-action="approve-join" data-id="${item.id}">通过</button>
                <button class="btn-sm danger" data-action="reject-join" data-id="${item.id}">驳回</button>
              </td>
            </tr>`).join('') || '<tr><td colspan="5" class="empty">暂无待审核入会申请</td></tr>'}
        </table>
      </div>`;
  }

  async function loadActivities(main) {
    const mode = state.data.actMode || 'view';
    if (mode === 'publish') {
      main.innerHTML = `${modeTabs('activities', mode)}
        <div class="card">
          <h3>发布活动</h3>
          <form data-form="create-activity">
            <div class="split">${field('标题', 'title')}${field('地点', 'location')}</div>
            <div class="split">${field('开始时间', 'startTime', '', 'datetime-local')}${field('结束时间', 'endTime', '', 'datetime-local')}</div>
            ${field('人数上限', 'maxParticipants', '30', 'number')}
            ${textareaField('活动内容', 'content')}
            <button class="primary" type="submit">发布</button>
          </form>
        </div>`;
      return;
    }

    const tab = state.data.actTab || 'public';
    const [pub, mine] = await Promise.all([
      api('/api/org/activities/public'),
      api('/api/org/activities/mine')
    ]);
    const list = tab === 'public' ? pub : mine;
    main.innerHTML = `${modeTabs('activities', mode)}
      <div class="card">
        ${listTabs('activities', tab)}
        <table>
          <tr><th>标题</th><th>发布方</th><th>时间</th><th>地点</th><th>状态</th></tr>
          ${list.map(x => `
            <tr>
              <td>${esc(x.title)}<div class="small muted">${esc(x.content).slice(0, 60)}</div></td>
              <td>${esc(x.organizationName)}</td>
              <td>${fmtDate(x.startTime)} ~ ${fmtDate(x.endTime)}</td>
              <td>${esc(x.location)}</td>
              <td>${pill(x.statusLabel || x.status, x.status === 'Approved' ? 'ok' : x.status === 'Rejected' ? 'bad' : 'warn')}</td>
            </tr>`).join('') || '<tr><td colspan="5" class="empty">暂无数据</td></tr>'}
        </table>
      </div>`;
  }

  async function loadProcurements(main) {
    const mode = state.data.procMode || 'view';
    if (mode === 'publish') {
      main.innerHTML = `${modeTabs('procurements', mode)}
        <div class="card">
          <h3>发布招标采购</h3>
          <form data-form="create-procurement">
            ${field('标题', 'title')}
            ${textareaField('采购内容', 'content')}
            <div class="split">${field('预算金额', 'budgetAmount', '', 'number')}${field('投标截止', 'bidDeadline', '', 'datetime-local')}</div>
            <div class="split">${field('开标时间', 'openingTime', '', 'datetime-local')}${field('开标地点', 'openingLocation')}</div>
            <div class="split">${field('联系人', 'contactName')}${field('联系电话', 'contactPhone')}</div>
            <button class="primary" type="submit">发布</button>
          </form>
        </div>`;
      return;
    }

    const tab = state.data.procTab || 'public';
    const [pub, mine] = await Promise.all([
      api('/api/org/procurements/public'),
      api('/api/org/procurements/mine')
    ]);
    const list = tab === 'public' ? pub : mine;
    main.innerHTML = `${modeTabs('procurements', mode)}
      <div class="card">
        ${listTabs('procurements', tab)}
        <table>
          <tr><th>标题</th><th>发布方</th><th>预算</th><th>截止</th><th>状态</th></tr>
          ${list.map(x => `
            <tr>
              <td>${esc(x.title)}</td>
              <td>${esc(x.organizationName)}</td>
              <td>${x.budgetAmount ?? '-'}</td>
              <td>${fmtDate(x.bidDeadline)}</td>
              <td>${pill(x.statusLabel || x.status, x.status === 'Approved' ? 'ok' : x.status === 'Rejected' ? 'bad' : 'warn')}</td>
            </tr>`).join('') || '<tr><td colspan="5" class="empty">暂无数据</td></tr>'}
        </table>
      </div>`;
  }

  const COURTESY_DATE_FIELDS = ['solarBirthday', 'metAt', 'lastContactAt', 'nextFollowUpAt', 'eventTime'];
  const COURTESY_REQUIRED = new Set(['title', 'personName', 'eventTime']);
  const COURTESY_GROUPS = [
    {
      title: '基本信息',
      fields: [
        ['title', '标题'],
        ['personName', '姓名'],
        ['gender', '性别', 'select', [['', '未填写'], ['男', '男'], ['女', '女'], ['其他', '其他']]],
        ['solarBirthday', '公历生日', 'date'],
        ['lunarBirthday', '农历生日'],
        ['zodiac', '属相'],
        ['nativePlace', '籍贯'],
        ['currentResidence', '现居地']
      ]
    },
    {
      title: '关系信息',
      fields: [
        ['relationSource', '关系来源'],
        ['relationLevel', '关系等级'],
        ['metAt', '认识时间', 'date'],
        ['mutualFriends', '共同好友'],
        ['introducer', '中间人'],
        ['meetingFrequency', '见面频率']
      ]
    },
    {
      title: '联系方式与职业',
      fields: [
        ['phone', '手机号'],
        ['weChat', '微信'],
        ['company', '单位'],
        ['position', '岗位'],
        ['industry', '行业']
      ]
    },
    {
      title: '家庭情况',
      fields: [
        ['maritalStatus', '婚姻状态'],
        ['spouseInfo', '配偶信息'],
        ['childrenInfo', '子女情况']
      ]
    },
    {
      title: '个人偏好',
      fields: [
        ['interests', '兴趣', 'textarea'],
        ['hobbies', '爱好', 'textarea'],
        ['specialty', '特长'],
        ['dietHabits', '饮食习惯'],
        ['dietaryRestrictions', '忌口过敏'],
        ['smokingDrinking', '烟酒偏好'],
        ['taboos', '禁忌雷区'],
        ['personalityTags', '性格标签'],
        ['habits', '习惯', 'textarea']
      ]
    },
    {
      title: '资源与往来',
      fields: [
        ['resources', '拥有资源', 'textarea'],
        ['canProvide', '能提供帮助', 'textarea'],
        ['oweSituation', '欠人情情况', 'textarea'],
        ['giftsGiven', '送礼送出', 'textarea'],
        ['giftsReceived', '收礼收到', 'textarea'],
        ['conversationPoints', '谈话要点', 'textarea'],
        ['todoItems', '待办事项', 'textarea']
      ]
    },
    {
      title: '跟进与归档',
      fields: [
        ['eventTime', '记录时间', 'date'],
        ['lastContactAt', '上次联系时间', 'date'],
        ['nextFollowUpAt', '下次跟进提醒', 'date'],
        ['importantDates', '重要纪念日'],
        ['tags', '标签'],
        ['priority', '优先级', 'select', [['', '未设置'], ['高', '高'], ['中', '中'], ['低', '低']]],
        ['archiveStatus', '归档状态', 'select', [['', '正常'], ['已归档', '已归档']]]
      ]
    },
    {
      title: '内容与备注',
      fields: [
        ['content', '内容', 'textarea'],
        ['remarks', '备注', 'textarea']
      ]
    }
  ];

  const PERSONAL_GROUPS = [
    {
      title: '基本信息',
      fields: [
        ['realName', '姓名'],
        ['gender', '性别', 'select', [['', '未填写'], ['男', '男'], ['女', '女'], ['其他', '其他']]],
        ['solarBirthday', '公历生日', 'date'],
        ['lunarBirthday', '农历生日'],
        ['zodiac', '属相'],
        ['nativePlace', '籍贯'],
        ['currentResidence', '现居地']
      ]
    },
    {
      title: '联系方式与职业',
      fields: [
        ['weChat', '微信'],
        ['company', '单位'],
        ['position', '岗位'],
        ['industry', '行业']
      ]
    },
    {
      title: '家庭情况',
      fields: [
        ['maritalStatus', '婚姻状态'],
        ['spouseInfo', '配偶信息'],
        ['childrenInfo', '子女情况']
      ]
    },
    {
      title: '个人偏好',
      fields: [
        ['interests', '兴趣', 'textarea'],
        ['hobbies', '爱好', 'textarea'],
        ['specialty', '特长'],
        ['dietHabits', '饮食习惯'],
        ['dietaryRestrictions', '忌口过敏'],
        ['smokingDrinking', '烟酒偏好'],
        ['taboos', '禁忌雷区'],
        ['personalityTags', '性格标签'],
        ['habits', '习惯', 'textarea']
      ]
    },
    {
      title: '资源与标签',
      fields: [
        ['resources', '拥有资源', 'textarea'],
        ['canProvide', '能提供帮助', 'textarea'],
        ['tags', '标签']
      ]
    },
    {
      title: '简介与备注',
      fields: [
        ['content', '内容', 'textarea'],
        ['remarks', '备注', 'textarea']
      ]
    }
  ];

  function toDateInputValue(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
  }

  function courtesyFieldHTML(config, note) {
    const [name, label, type = 'text', options] = config;
    const value = note?.[name] ?? '';
    const required = COURTESY_REQUIRED.has(name) ? 'required' : '';
    if (type === 'date') {
      return field(label, name, toDateInputValue(value), 'date', required);
    }
    if (type === 'select') {
      return selectField(label, name, options, value || '', required);
    }
    if (type === 'textarea') {
      return textareaField(label, name, value, 'rows="3"');
    }
    return field(label, name, value, 'text', required);
  }

  function courtesyGroupFieldsHTML(fields, note) {
    let html = '';
    let pending = [];
    const flush = () => {
      if (!pending.length) return;
      html += `<div class="split">${pending.join('')}</div>`;
      pending = [];
    };

    for (const config of fields) {
      const item = courtesyFieldHTML(config, note);
      if (config[2] === 'textarea') {
        flush();
        html += item;
      } else {
        pending.push(item);
        if (pending.length === 2) flush();
      }
    }

    flush();
    return html;
  }

  function courtesyFormHTML(note) {
    return `
      <form data-form="create-courtesy">
        ${COURTESY_GROUPS.map(group => `
          <h4 style="margin:14px 0 8px">${esc(group.title)}</h4>
          ${courtesyGroupFieldsHTML(group.fields, note)}
        `).join('')}
        <div class="row" style="margin-top:12px">
          <button class="primary" type="submit">${note ? '保存修改' : '保存'}</button>
          ${note ? '<button type="button" data-action="cancel-courtesy-edit">取消编辑</button>' : ''}
        </div>
      </form>`;
  }

  async function loadCourtesy(main) {
    const page = Math.max(1, Number(state.data.courtesyPage) || 1);
    const result = await api(`/api/org/courtesy-notes?page=${page}&pageSize=20`);
    const notes = Array.isArray(result?.items) ? result.items : [];
    state.data.courtesyNotes = notes;
    state.data.courtesyTotal = Number(result?.total) || notes.length;
    state.data.courtesyPage = Number(result?.page) || page;
    state.data.courtesyTotalPages = Number(result?.totalPages) || 0;

    const tab = state.data.courtesyTab === 'form' ? 'form' : 'list';
    const editing = state.data.courtesyEditing || null;
    main.innerHTML = `
      <div class="tabs">
        <button class="tab ${tab === 'list' ? 'active' : ''}" data-action="courtesy-tab" data-tab="list">列表（${state.data.courtesyTotal}）</button>
        <button class="tab ${tab === 'form' ? 'active' : ''}" data-action="courtesy-tab" data-tab="form">${editing ? '编辑' : '新增'}</button>
      </div>
      ${tab === 'list' ? courtesyListHTML(notes) : courtesyFormCardHTML(editing)}`;
  }

  function courtesyListHTML(notes) {
    return `
      <div class="card">
        <div class="row">
          <h3 class="spacer">记录列表（共 ${state.data.courtesyTotal || notes.length} 条）</h3>
          <button class="primary btn-sm" data-action="courtesy-new">新增记录</button>
        </div>
        <table>
          <tr><th>标题 / 姓名</th><th>关系等级</th><th>优先级</th><th>归档状态</th><th>下次跟进</th><th>操作</th></tr>
          ${notes.map(n => `
            <tr>
              <td>${esc(n.title)}<div class="small muted">${esc(n.personName)} · ${esc(n.company || '')}</div></td>
              <td>${esc(n.relationLevel || '-')}</td>
              <td>${n.priority ? esc(n.priority) : '-'}</td>
              <td>${n.archiveStatus === '已归档' ? pill('已归档', 'warn') : pill('正常', 'ok')}</td>
              <td>${n.nextFollowUpAt ? fmtDateOnly(n.nextFollowUpAt) : '-'}</td>
              <td class="row">
                <button class="btn-sm" data-action="edit-courtesy" data-id="${n.id}">编辑</button>
                <button class="btn-sm danger" data-action="delete-courtesy" data-id="${n.id}">删除</button>
              </td>
            </tr>`).join('') || '<tr><td colspan="6" class="empty">人情簿还是空的</td></tr>'}
        </table>
        ${courtesyPagerHTML()}
      </div>`;
  }

  function courtesyPagerHTML() {
    const totalPages = state.data.courtesyTotalPages || 0;
    if (totalPages <= 1) return '';
    const page = state.data.courtesyPage || 1;
    return `<div class="row" style="margin-top:10px">
      <span class="spacer"></span>
      <button class="btn-sm" data-action="courtesy-page" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>上一页</button>
      <span class="small muted">${page}/${totalPages}</span>
      <button class="btn-sm" data-action="courtesy-page" data-page="${page + 1}" ${page >= totalPages ? 'disabled' : ''}>下一页</button>
    </div>`;
  }

  function courtesyFormCardHTML(editing) {
    return `
      <div class="card">
        <div class="row">
          <h3 class="spacer">${editing ? '编辑人情簿记录' : '新增人情簿记录'}</h3>
          <span class="small muted">${editing ? esc(editing.title) : '标题、姓名与记录时间为必填'}</span>
        </div>
        ${courtesyFormHTML(editing)}
      </div>`;
  }

  async function loadPreferred(main) {
    const items = await api('/api/org/preferred-items');
    main.innerHTML = `
      <div class="card">
        <h3>温商优选</h3>
        <div class="card-sub">由管理端精选的优选内容</div>
        <table>
          <tr><th>标题</th><th>关联组织</th><th>评分</th><th>摘要</th></tr>
          ${items.map(x => `
            <tr>
              <td>${esc(x.title)}</td>
              <td>${esc(x.organizationName || '-')}</td>
              <td>${x.starRating}/10</td>
              <td>${esc(x.summary)}</td>
            </tr>`).join('') || '<tr><td colspan="4" class="empty">还没有温商优选内容</td></tr>'}
        </table>
      </div>`;
  }

  async function loadEnterprises(main) {
    const p = state.data.enterprisePage || 1;
    const filters = state.data.enterpriseFilters || {};
    const params = new URLSearchParams({ page: String(p), pageSize: '20' });
    for (const [key, value] of Object.entries(filters)) {
      if (value) params.set(key, value);
    }
    const result = await api(`/api/org/enterprises?${params}`);
    state.data.enterpriseResult = result;
    main.innerHTML = `
      <div class="card">
        <h3>企业信息</h3>
        <form data-form="search-enterprises" class="row">
          <input name="keyword" placeholder="企业名称/关键词" style="flex:1">
          <input name="creditCode" placeholder="信用代码" style="flex:1">
          <input name="province" placeholder="省" style="width:100px">
          <input name="city" placeholder="市" style="width:100px">
          <input name="district" placeholder="区/县" style="width:100px">
          <button class="primary" type="submit">查询</button>
        </form>
      </div>
      <div class="card">
        <table>
          <tr><th>企业</th><th>信用代码</th><th>成员数</th><th>操作</th></tr>
          ${result.items.map(x => `
            <tr>
              <td>${esc(x.name)}<div class="small muted">${esc(x.introduction || '')}</div></td>
              <td class="mono">${esc(x.creditCode)}</td>
              <td>${x.memberCount}</td>
              <td><button class="btn-sm" data-action="view-enterprise" data-id="${x.id}">查看详情</button></td>
            </tr>`).join('') || '<tr><td colspan="4" class="empty">没有找到匹配的企业</td></tr>'}
        </table>
        <div class="row row-end" style="margin-top:10px">
          <button class="btn-sm" data-action="enterprise-page" data-page="${Math.max(1, result.page - 1)}" ${result.page <= 1 ? 'disabled' : ''}>上一页</button>
          <span class="small muted">${result.page}/${result.totalPages || 1}</span>
          <button class="btn-sm" data-action="enterprise-page" data-page="${result.page + 1}" ${result.page >= result.totalPages ? 'disabled' : ''}>下一页</button>
        </div>
      </div>`;
  }

  async function loadMessages(main) {
    const page = state.data.messagePage || 1;
    const result = await api(`/api/org/messages?page=${page}&pageSize=20`);
    state.data.messageResult = result;
    main.innerHTML = `
      <div class="card">
        <h3>消息</h3>
        <table>
          <tr><th>标题</th><th>内容</th><th>发布时间</th><th>有效期</th><th>操作</th></tr>
          ${result.items.map(m => `
            <tr>
              <td>${esc(m.title)}</td>
              <td>${esc(m.content).slice(0, 80)}</td>
              <td>${fmtDate(m.publishedAt)}</td>
              <td>${m.isExpired ? pill('已过期') : fmtDate(m.expiresAt)}</td>
              <td>${m.isRead ? '<span class="small muted">已读</span>' : `<button class="btn-sm" data-action="read-message" data-id="${m.id}">标为已读</button>`}</td>
            </tr>`).join('') || '<tr><td colspan="5" class="empty">暂时没有新消息</td></tr>'}
        </table>
        <div class="row row-end" style="margin-top:10px">
          <button class="btn-sm" data-action="message-page" data-page="${Math.max(1, page - 1)}" ${page <= 1 ? 'disabled' : ''}>上一页</button>
          <span class="small muted">${page}/${result.totalPages || 1}</span>
          <button class="btn-sm" data-action="message-page" data-page="${page + 1}" ${page >= result.totalPages ? 'disabled' : ''}>下一页</button>
        </div>
      </div>`;
  }

  async function loadAI(main) {
    const [config, conversations] = await Promise.all([
      api('/api/org/ai/config'),
      api('/api/org/ai/conversations')
    ]);
    state.ai.conversations = Array.isArray(conversations) ? conversations : [];
    if (state.ai.conversationId
      && !state.ai.conversations.some(item => item.id === state.ai.conversationId)) {
      state.ai.conversationId = null;
      state.ai.messages = [];
    }
    if (!state.ai.conversationId && state.ai.conversations.length) {
      state.ai.conversationId = state.ai.conversations[0].id;
    }
    if (state.ai.conversationId) {
      try {
        state.ai.messages = await api(`/api/org/ai/conversations/${state.ai.conversationId}/messages`);
      } catch {
        state.ai.conversationId = null;
        state.ai.messages = [];
      }
    }
    const configured = config?.configured !== false;
    main.innerHTML = `
      <div class="ai-layout">
        <div class="card">
          <div class="row"><h3 class="spacer">历史对话</h3><button class="btn-sm" data-action="new-ai">新对话</button></div>
          <div class="scroll-list">
            ${state.ai.conversations.map(c => `
              <button class="nav-item ${c.id === state.ai.conversationId ? 'active' : ''}" data-action="open-ai" data-id="${c.id}">${esc(c.title)}</button>
            `).join('') || '<div class="empty">暂无历史对话</div>'}
          </div>
        </div>
        <div class="card">
          <div class="row">
            <h3 class="spacer">DeepBit AI助手</h3>
            <span class="small muted">个人 ${config.personalStones} / 企业 ${config.organizationStones} 原石</span>
          </div>
          <div class="card-sub">由平台服务端统一转发模型请求，按 token 扣原石</div>
          ${configured ? '' : '<div class="pill warn" style="margin-top:10px">AI 模型尚未配置，请联系管理员</div>'}
          <div class="chat" id="chat-box">
            ${(state.ai.messages || []).map(m => `<div class="msg ${m.role === 'user' ? 'user' : 'assistant'}">${esc(m.content)}</div>`).join('') || '<div class="empty">发送第一条消息会自动创建对话</div>'}
          </div>
          <form data-form="send-ai" class="chat-input">
            <textarea name="content" placeholder="给 DeepBit AI助手发消息…" ${configured ? '' : 'disabled'}></textarea>
            <button class="primary" type="submit" ${configured ? '' : 'disabled'}>发送</button>
          </form>
        </div>
      </div>`;
  }


  async function loadPlatformContent(main) {
    const pc = state.platformContent;
    if (!pc.platforms.length) {
      pc.platforms = await api('/api/org/geo/platforms');
    }
    if (!pc.platforms.some(platform => platform.code === pc.platform) && pc.platforms[0]) {
      pc.platform = pc.platforms[0].code;
    }
    pc.contents = await api(`/api/org/geo/platform-contents?platform=${encodeURIComponent(pc.platform)}`);
    main.innerHTML = platformContentHTML();
  }

  function platformContentHTML() {
    const pc = state.platformContent;
    const platforms = pc.platforms || [];
    const contents = pc.contents || [];
    const draft = pc.draft;
    return `
      <div class="card">
        <div class="row"><h3 class="spacer">GEO平台内容</h3><span class="small muted">为网媒、自媒体、公众号、微博、小红书、短视频维护本地内容</span></div>
        <div class="row">
          ${platforms.map(platform => `<button class="btn-sm ${platform.code === pc.platform ? 'primary' : ''}" data-action="pc-platform" data-code="${esc(platform.code)}">${esc(platform.name)}</button>`).join('')}
        </div>
      </div>
      <div class="card">
        <h3>AI 生成</h3>
        <form data-form="pc-generate">
          <div class="split">
            ${field('选题 / 主题', 'topic', '', 'text', 'placeholder="例如：温州企业如何选择合适的商会服务"')}
            ${field('标题（可选）', 'title', '', 'text', 'placeholder="留空由 AI 生成"')}
          </div>
          ${field('额外要求（可选）', 'extraInstructions')}
          <button class="primary" type="submit">生成内容</button>
        </form>
        <div class="small muted">生成会扣除 GEO 基础服务费与模型费用；确认内容后可在下方内容库选择媒体发稿，发稿会按媒体价格扣除组织原石。</div>
      </div>
      ${draft ? `
      <div class="card">
        <div class="row"><h3 class="spacer">${draft.id ? '编辑内容' : '新建内容'}</h3><span class="small muted">${(draft.body || '').length} 字</span></div>
        <form data-form="pc-save">
          <input type="hidden" name="id" value="${draft.id || ''}">
          ${field('标题', 'title', draft.title)}
          <div class="row" style="margin:6px 0">
            <button type="button" class="btn-sm" data-action="pc-insert-media" data-kind="image">插入图片</button>
            <button type="button" class="btn-sm" data-action="pc-insert-media" data-kind="video">插入视频</button>
            <button type="button" class="btn-sm" data-action="pc-insert-link">插入外链</button>
            <span class="small muted">图片用 Markdown 图片语法，视频用 &lt;video&gt; 标签，发稿时自动转 HTML</span>
          </div>
          <input type="file" id="pc-media-file" style="display:none" accept="image/*,video/*">
          ${textareaField('正文', 'body', draft.body, 'rows="14" id="pc-draft-body" placeholder="支持 Markdown；可用上方按钮插入图片/视频链接"')}
          <button class="primary" type="submit">保存内容</button>
          <button type="button" data-action="pc-cancel">取消</button>
        </form>
      </div>` : ''}
      <div class="card">
        <h3>内容库（${contents.length} 条）</h3>
        <table>
          <tr><th>标题</th><th>平台</th><th>更新时间</th><th>字数</th><th>操作</th></tr>
          ${contents.map(content => {
            const platformName = platforms.find(item => item.code === content.platform)?.name
              || content.platformName;
            return `
            <tr>
              <td>${esc(content.title)}
                ${content.publishStatus === 'Published'
                  ? `<div class="small muted">已发布 · ${esc(content.mediaTitle || '')} · 订单 ${esc(content.orderNumber || '')}</div>`
                  : content.publishStatus === 'Failed'
                    ? `<div class="small muted" style="color:var(--warning)">发稿失败：${esc(content.publishError || '')}</div>`
                    : '<div class="small muted">未发布</div>'}
              </td>
              <td>${esc(platformName)}</td>
              <td class="small">${fmtDate(content.updatedAt)}</td>
              <td class="small">${(content.body || '').length}</td>
              <td class="row">
                ${content.publishStatus !== 'Published'
                  ? `<button class="btn-sm primary" data-action="pc-publish" data-id="${content.id}">发稿</button>`
                  : ''}
                <button class="btn-sm" data-action="pc-edit" data-id="${content.id}">编辑</button>
                <button class="btn-sm danger" data-action="pc-delete" data-id="${content.id}">删除</button>
              </td>
            </tr>`;
          }).join('') || '<tr><td colspan="5" class="empty">暂无内容</td></tr>'}
        </table>
      </div>`;
  }

  async function openPublishMedia(page = 1) {
    const target = state.data.pcPublishTarget;
    if (!target) return;

    const params = new URLSearchParams({
      platform: target.platform,
      page: String(Math.max(1, page)),
      pageSize: '5'
    });
    if (state.data.pcPublishKeyword) params.set('keyword', state.data.pcPublishKeyword);
    if (state.data.pcPublishMinStone) params.set('minStonePrice', state.data.pcPublishMinStone);
    if (state.data.pcPublishMaxStone) params.set('maxStonePrice', state.data.pcPublishMaxStone);
    if (state.data.pcPublishSort) params.set('sort', state.data.pcPublishSort);

    const result = await api(`/api/org/geo/platform-contents/media?${params}`);
    state.data.pcPublishResult = result;
    state.data.pcPublishPage = result.page || page;
    renderPublishModal();
  }

  function renderPublishModal() {
    const target = state.data.pcPublishTarget;
    const result = state.data.pcPublishResult;
    if (!target || !result) return;

    const tab = state.data.pcPublishTab === 'favorites' ? 'favorites' : 'list';
    const selected = state.data.pcPublishSelected || {};
    const selectedList = Object.values(selected);
    const totalStones = selectedList.reduce((sum, item) => sum + (item.stonePrice || 0), 0);
    const favoriteIds = new Set((result.favorites || []).map(item => item.id));

    const row = (media, isFavorite) => {
      const checked = selected[media.id] ? 'checked' : '';
      const disabled = media.stonePrice == null ? 'disabled' : '';
      return `
        <tr>
          <td class="col-check"><input type="checkbox" data-action="pc-publish-toggle" data-id="${media.id}" data-title="${esc(media.title)}" data-stone-price="${media.stonePrice ?? 0}" ${checked} ${disabled}></td>
          <td>${esc(media.title)}</td>
          <td style="white-space:nowrap">${media.stonePrice != null ? `${media.stonePrice} 原石` : '价格待确认'}</td>
          <td style="width:56px;text-align:center"><button type="button" class="btn-sm" title="${isFavorite ? '取消收藏' : '收藏'}" data-action="pc-publish-favorite" data-id="${media.id}" data-title="${esc(media.title)}" data-favorite="${isFavorite ? '1' : '0'}">${isFavorite ? '♥' : '♡'}</button></td>
        </tr>`;
    };

    const pageItems = result.items || [];
    const page = result.page || 1;
    const totalPages = result.totalPages || 1;

    const listHtml = `
      <div class="small muted" style="margin:10px 0 6px">媒体列表（共 ${result.total} 个）</div>
      <table>
        <tr><th class="col-check"></th><th>媒体</th><th>价格</th><th style="width:56px"></th></tr>
        ${pageItems.map(item => row(item, favoriteIds.has(item.id))).join('') || '<tr><td colspan="4" class="empty">没有匹配的媒体</td></tr>'}
      </table>
      <div class="row" style="margin-top:8px">
        <span class="spacer"></span>
        <button type="button" class="btn-sm" data-action="pc-publish-page" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>上一页</button>
        <span class="small muted">${page}/${totalPages}</span>
        <button type="button" class="btn-sm" data-action="pc-publish-page" data-page="${page + 1}" ${page >= totalPages ? 'disabled' : ''}>下一页</button>
      </div>`;

    const favorites = result.favorites || [];
    const favoriteHtml = `
      <table>
        <tr><th class="col-check"></th><th>媒体</th><th>价格</th><th style="width:56px"></th></tr>
        ${favorites.map(item => row(item, true)).join('') || '<tr><td colspan="4" class="empty">还没有收藏媒体</td></tr>'}
      </table>`;

    const filterVisible = state.data.pcPublishFilterVisible === true;

    showModal('选择发稿媒体', `
      <div class="row">
        <span class="small muted">内容：${esc(target.title)} · 平台：${esc(target.platformName)}</span>
        <span class="spacer"></span>
        <button type="button" class="btn-sm" title="筛选" data-action="pc-publish-filter-toggle">⌕</button>
      </div>
      ${filterVisible ? `
      <div class="row" style="margin:8px 0">
        <input name="pcKeyword" placeholder="搜索媒体名称（当前批）" value="${esc(state.data.pcPublishKeyword || '')}" style="flex:1">
        <input name="pcMinStone" placeholder="最低原石" value="${esc(state.data.pcPublishMinStone || '')}" style="width:100px">
        <input name="pcMaxStone" placeholder="最高原石" value="${esc(state.data.pcPublishMaxStone || '')}" style="width:100px">
        <select name="pcSort" style="width:130px">
          <option value="">默认排序</option>
          <option value="priceAsc" ${state.data.pcPublishSort === 'priceAsc' ? 'selected' : ''}>原石从低到高</option>
          <option value="priceDesc" ${state.data.pcPublishSort === 'priceDesc' ? 'selected' : ''}>原石从高到低</option>
        </select>
        <button type="button" class="btn-sm primary" data-action="pc-publish-search">查询</button>
      </div>` : ''}
      <div class="tabs" style="margin:10px 0">
        <button type="button" class="tab ${tab === 'list' ? 'active' : ''}" data-action="pc-publish-tab" data-tab="list">媒体列表</button>
        <button type="button" class="tab ${tab === 'favorites' ? 'active' : ''}" data-action="pc-publish-tab" data-tab="favorites">我的收藏（${favorites.length}）</button>
      </div>
      ${tab === 'list' ? listHtml : favoriteHtml}
      <div class="row" style="margin-top:12px">
        <span class="small muted">已选 ${selectedList.length} 个，合计 ${totalStones} 原石</span>
        <span class="spacer"></span>
        <button type="button" data-action="close-modal">关闭</button>
        <button type="button" class="primary" data-action="pc-publish-submit" ${selectedList.length ? '' : 'disabled'}>确认发稿</button>
      </div>
      <div class="small muted">发稿会提交到 GEO 权威服务并按原石扣费，提交后不可撤回。</div>`, { dismissible: false });
  }

  function insertDraftMedia(snippet) {
    const textarea = document.getElementById('pc-draft-body');
    if (!textarea) return;
    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? start;
    textarea.value = textarea.value.slice(0, start) + snippet + textarea.value.slice(end);
    textarea.focus();
    textarea.selectionStart = textarea.selectionEnd = start + snippet.length;
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || '');
        const index = result.indexOf(',');
        resolve(index >= 0 ? result.slice(index + 1) : result);
      };
      reader.onerror = () => reject(new Error('读取文件失败'));
      reader.readAsDataURL(file);
    });
  }

  function renderPlatformContentView() {
    const view = $('#view');
    if (view && state.view === 'platformContent') {
      view.innerHTML = platformContentHTML();
    }
  }

  async function loadGeo(main) {
    const usagePage = state.geo.usagePage || 1;
    const [profile, contents, usage] = await Promise.all([
      api('/api/org/geo/profile'),
      api('/api/org/geo/contents'),
      api(`/api/org/geo/usage?page=${usagePage}&pageSize=20`)
    ]);
    state.geo.profile = profile;
    state.geo.contents = contents;
    state.geo.usage = usage.items || [];
    state.geo.usagePage = usage.page || 1;
    state.geo.usageTotal = usage.total || 0;
    state.geo.usageTotalPages = usage.totalPages || 1;
    main.innerHTML = geoHTML();
  }

  function geoHTML() {
    const tab = ['profile', 'generate', 'usage', 'check'].includes(state.geoTab)
      ? state.geoTab
      : 'profile';
    return `
      <div class="tabs">
        <button class="tab ${tab === 'profile' ? 'active' : ''}" data-action="geo-tab" data-tab="profile">组织资料</button>
        <button class="tab ${tab === 'generate' ? 'active' : ''}" data-action="geo-tab" data-tab="generate">生成内容</button>
        <button class="tab ${tab === 'usage' ? 'active' : ''}" data-action="geo-tab" data-tab="usage">GEO 用量</button>
        <button class="tab ${tab === 'check' ? 'active' : ''}" data-action="geo-tab" data-tab="check">优化检测</button>
      </div>
      ${tab === 'profile' ? geoProfileHTML()
        : tab === 'generate' ? geoGenerateHTML()
        : tab === 'usage' ? geoUsageHTML()
        : geoCheckHTML()}`;
  }

  function geoProfileHTML() {
    const p = state.geo.profile || {};
    return `
      <div class="card">
        <div class="row"><h3 class="spacer">GEO 组织资料</h3><span class="small muted">保存后会同步公开站</span></div>
        <form data-form="save-geo-profile">
          <div class="split">
            ${field('公开名称', 'publicName', p.publicName)}
            ${field('一句话介绍', 'summary', p.summary)}
          </div>
          ${textareaField('详细介绍', 'description', p.description)}
          <div class="split">
            ${field('省', 'province', p.province || '')}
            ${field('市', 'city', p.city || '')}
          </div>
          <div class="split">
            ${field('区/县', 'district', p.district || '')}
            ${field('公开电话', 'publicPhone', p.publicPhone || '')}
          </div>
          <div class="split">
            ${field('公开邮箱', 'publicEmail', p.publicEmail || '')}
            ${field('关键词', 'keywords', p.keywords || '')}
          </div>
          <div class="split">
            ${field('核心服务', 'services', p.services || '')}
            ${field('服务区域', 'serviceArea', p.serviceArea || '')}
          </div>
          ${field('目标客户', 'targetCustomers', p.targetCustomers || '')}
          <div class="card" style="margin:12px 0;background:var(--bg-soft)">
            <h3>外部可信来源</h3>
            <div class="split">
              ${field('官网地址', 'websiteUrl', p.websiteUrl || '')}
              ${field('微信公众号', 'weChat', p.weChat || '')}
            </div>
            <div class="split">
              ${field('地图/企业信息页', 'mapUrl', p.mapUrl || '')}
              ${field('企业信用平台', 'businessRegistryUrl', p.businessRegistryUrl || '')}
            </div>
            ${textareaField('其他可信链接（每行一个）', 'externalLinks', p.externalLinks || '')}
            <div class="small muted">这些链接会写入公开站的 sameAs 结构化数据。</div>
          </div>
          <div class="row">
            <div style="display: flex;justify-content: center;align-items: center">
              <input type="checkbox" name="isPublished" ${p.isPublished ? 'checked' : ''} style="width:auto">
              <label class="small">公开</label>
            </div>
            <span class="spacer"></span>
            <button type="button" data-action="geo-suggest-profile">AI 完善资料</button>
            <button class="primary" type="submit">保存 GEO 资料</button>
          </div>
        </form>
      </div>`;
  }

  function geoGenerateHTML() {
    const contents = state.geo.contents || [];
    return `
      <div class="card">
        <div class="row"><h3 class="spacer">生成 GEO 内容</h3><span class="small muted">生成后自动诊断/重写并发布</span></div>
        <form data-form="geo-generate">
          <div class="split">
            ${field('目标问题', 'targetQuestion', '', 'text', 'placeholder="例如：西安有哪些做企业数字化的商会？"')}
            ${field('标题（可选）', 'title')}
          </div>
          ${field('补充要求（可选）', 'extraInstructions')}
          <button class="primary" type="submit">生成一篇</button>
          <button type="button" data-action="geo-auto">一键优化</button>
          <button type="button" data-action="geo-diagnose-all">诊断全部</button>
        </form>
      </div>
      <div class="card">
        <h3>GEO 内容（${contents.length} 篇）</h3>
        <table>
          <tr><th>标题</th><th>目标问题</th><th>评分</th><th>状态</th><th>操作</th></tr>
          ${contents.map(c => `
            <tr>
              <td style="width: 300px">${esc(c.title)}</td>
              <td  style="width: 300px" class="small muted">${esc(c.targetQuestion)}</td>
              <td  style="width: 50px">${c.score ?? '-'}</td>
              <td style="width: 80px">${pill(c.status === 'Published' ? '已发布' : c.status === 'Archived' ? '已下线' : '草稿', c.status === 'Published' ? 'ok' : '')}</td>
              <td  class="row">
                <button class="btn-sm" data-action="geo-diagnose" data-id="${c.id}">诊断</button>
                <button class="btn-sm" data-action="geo-improve" data-id="${c.id}">AI 优化</button>
                ${c.status !== 'Published' ? `<button class="btn-sm" data-action="geo-publish" data-id="${c.id}">发布</button>` : ''}
                <button class="btn-sm danger" data-action="geo-delete" data-id="${c.id}">删除</button>
              </td>
            </tr>`).join('') || '<tr><td colspan="5" class="empty">还没有生成内容</td></tr>'}
        </table>
      </div>`;
  }

  function geoUsageHTML() {
    const usage = state.geo.usage || [];
    return `
      <div class="card">
        <div class="row"><h3 class="spacer">GEO 用量</h3><span class="small muted">共 ${state.geo.usageTotal} 条</span></div>
        <table>
          <tr><th>时间</th><th>动作</th><th>模型</th><th>Token</th><th>扣费</th></tr>
          ${usage.map(u => `
            <tr>
              <td>${fmtDate(u.createdAt)}</td>
              <td>${esc(u.action)}</td>
              <td class="mono small">${esc(u.model)}</td>
              <td class="small">${u.promptTokens}/${u.completionTokens}</td>
              <td>${u.totalCostStones} 原石</td>
            </tr>`).join('') || '<tr><td colspan="5" class="empty">暂无用量</td></tr>'}
        </table>
        ${usagePagerHTML()}
      </div>`;
  }

  function usagePagerHTML() {
    const totalPages = state.geo.usageTotalPages || 1;
    if (totalPages <= 1) return '';
    const page = state.geo.usagePage || 1;
    return `<div class="row" style="margin-top:10px">
      <span class="spacer"></span>
      <button class="btn-sm" data-action="geo-usage-page" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>上一页</button>
      <span class="small muted">${page}/${totalPages}</span>
      <button class="btn-sm" data-action="geo-usage-page" data-page="${page + 1}" ${page >= totalPages ? 'disabled' : ''}>下一页</button>
    </div>`;
  }

  function geoCheckHTML() {
    const audit = state.geo.audit;
    const index = state.geo.index;
    const push = state.geo.push;
    return `
      <div class="card">
        <div class="row">
          <h3 class="spacer">GEO 优化检测</h3>
          <button data-action="geo-audit">开始检测</button>
          <button class="primary" data-action="geo-auto">一键优化</button>
        </div>
        ${audit ? `
          <div class="row"><div style="font-size:34px;font-weight:700">${audit.score}</div><div>${esc(audit.summary)}</div></div>
          ${(audit.dimensions || []).map(d => `<div class="row"><strong style="width:100px">${esc(d.name)}</strong><span class="pill info">${d.score}</span><span class="small muted">${esc(d.comment)}</span></div>`).join('')}
          <div class="split">
            <div><h3>问题</h3>${(audit.issues || []).map(x => `<div class="small">· ${esc(x)}</div>`).join('')}</div>
            <div><h3>优先行动</h3>${(audit.actions || []).map(x => `<div class="small">· ${esc(x)}</div>`).join('')}</div>
          </div>
          <div class="small muted">本次扣费 ${audit.tokenCostStones} 原石</div>` : '<div class="empty">尚未检测</div>'}
      </div>
      <div class="card">
        <div class="row"><h3 class="spacer">收录情况检测</h3><button data-action="geo-index">开始检测</button></div>
        ${index ? `
          <div class="small muted">检测时间：${fmtDate(index.checkedAt)}，扣费 ${index.tokenCostStones} 原石</div>
          ${index.results.map(r => `
            <div class="row" style="margin-top:6px">
              <strong style="width:150px">${esc(r.platform)}</strong>
              ${pill(r.status, r.status.includes('已收录') || r.status.includes('已推送') ? 'ok' : r.status.includes('失败') || r.status.includes('未收录') ? 'warn' : '')}
              <span class="small muted">${esc(r.detail)}</span>
            </div>`).join('')}` : '<div class="empty">尚未检测</div>'}
      </div>
      <div class="card">
        <div class="row"><h3 class="spacer">主动推送</h3><button class="primary" data-action="geo-push">主动推送</button></div>
        <div class="small muted">仅在你点击时推送；每次按管理端设置扣固定费 + 模型费用。</div>
        ${push ? `
          <div class="small" style="margin-top:8px">${esc(push.summary || '')}</div>
          <div class="small muted">固定 ${push.baseFeeStones} + 模型 ${push.tokenCostStones} = ${push.totalCostStones} 原石</div>
          ${push.results.map(r => `<div class="row" style="margin-top:6px"><strong style="width:180px">${esc(r.platform)}</strong>${pill(r.status, r.status.includes('已推送') ? 'ok' : r.status.includes('失败') ? 'warn' : '')}<span class="small muted">${esc(r.detail)}</span></div>`).join('')}` : ''}
      </div>`;
  }

  function websiteTemplatesOrDefault(templates) {
    if (Array.isArray(templates) && templates.length) return templates;
    return [{ id: 'default', name: '企业官网', description: '默认官网模板', category: 'website' }];
  }

  function websiteTemplateSelect(templates, current) {
    return `<select name="templateId">${websiteTemplatesOrDefault(templates).map(t => `
      <option value="${esc(t.id)}" ${t.id === current ? 'selected' : ''}>${esc(t.name)} — ${esc(t.description || '')}</option>
    `).join('')}</select>`;
  }

  async function loadWebsite(main) {
    const [templates, site] = await Promise.all([
      api('/api/org/website/templates').catch(() => []),
      api('/api/org/website')
    ]);
    state.data.website = site;
    state.data.websiteTemplates = templates;
    main.innerHTML = site.siteId ? websiteEditHTML(site, templates) : websiteCreateHTML(templates);
  }

  function websiteCreateHTML(templates) {
    const org = state.user.organization || {};
    return `
      <div class="card">
        <h3>创建官网</h3>
        <div class="card-sub">填写品牌与联系方式，选择模板和域名；创建后可继续编辑完整内容并发布。</div>
        <form data-form="create-website" style="margin-top:12px">
          <div class="split">
            ${field('公司名称', 'companyName', org.name || '', 'text', 'required')}
            ${field('品牌简称', 'shortName', org.name || '')}
          </div>
          <div class="split">
            ${field('英文名', 'englishName', '')}
            ${field('品牌标语', 'tagline', '')}
          </div>
          ${textareaField('公司简介', 'description', org.introduction || '')}
          <div class="split">
            ${field('联系电话', 'phone', org.contactPhone || '')}
            ${field('邮箱', 'email', '')}
          </div>
          <div class="split">
            ${field('微信', 'wechat', '')}
            ${field('公司地址', 'address', org.address || '')}
          </div>
          <div class="split">
            ${field('SEO 关键词', 'keywords', '')}
            ${field('服务 / 业务', 'services', '')}
          </div>
          <div class="split">
            ${field('服务地区', 'serviceArea', '')}
            <label class="field"><span>站点模板</span>${websiteTemplateSelect(templates, 'default')}</label>
          </div>
          ${field('官网域名', 'host', '', 'text', 'placeholder="留空自动分配；自填域名需自行解析并准备证书"')}
          <div class="row">
            <label class="small"><input type="checkbox" name="generateWithAi" checked style="width:auto"> 用 AI 生成初稿</label>
            <label class="small"><input type="checkbox" name="publish" style="width:auto"> 创建后立即发布</label>
          </div>
          ${textareaField('AI 补充要求（可选）', 'instructions', '')}
          <button class="primary" type="submit">创建官网</button>
        </form>
      </div>`;
  }

  function websiteEditHTML(site, templates) {
    const currentTemplate = site.templateId || 'default';
    const contentText = JSON.stringify(site.content || {}, null, 2);
    const templateName = websiteTemplatesOrDefault(templates).find(t => t.id === currentTemplate)?.name || currentTemplate;
    return `
      <div class="card">
        <div class="row">
          <h3 class="spacer">组织官网</h3>
          ${pill(site.status || '未发布', site.status === 'Active' ? 'ok' : site.status === 'PanelFailed' ? 'bad' : 'warn')}
          ${site.siteUrl ? `<a href="${esc(site.siteUrl)}" target="_blank" rel="noreferrer">${esc(site.siteUrl)}</a>` : '<span class="small muted">发布后生成访问地址</span>'}
        </div>
        <div class="card-sub">当前模板：${esc(templateName)} · content 保存/发布时会整包推送</div>
        ${site.lastError ? `<div class="pill bad" style="margin-top:8px">${esc(site.lastError)}</div>` : ''}
        <form data-form="update-website" style="margin-top:12px">
          <div class="split">
            ${field('官网域名', 'host', site.host || '')}
            <label class="field"><span>站点模板</span>${websiteTemplateSelect(templates, currentTemplate)}</label>
          </div>
          ${field('AI 补充要求（可选）', 'instructions', '')}
          <label class="field"><span>完整 content JSON</span><textarea name="content" class="mono" style="min-height:360px">${esc(contentText)}</textarea></label>
          <div class="row">
            <button class="primary" type="submit">保存内容</button>
            <button type="button" data-action="generate-website">AI 生成初稿</button>
            <button type="button" data-action="preview-website">预览模板</button>
            <button type="button" class="primary" data-action="publish-website">发布官网</button>
          </div>
        </form>
      </div>`;
  }

  function websiteParseContent(text) {
    let value;
    try {
      value = JSON.parse(text || '{}');
    } catch {
      throw new Error('官网内容不是有效 JSON');
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('官网内容必须是 JSON 对象');
    }
    return value;
  }

  function previewWebsiteFromForm(form) {
    const data = Object.fromEntries(new FormData(form));
    const content = websiteParseContent(data.content);
    const templates = websiteTemplatesOrDefault(state.data.websiteTemplates);
    const templateId = data.templateId || state.data.website?.templateId || 'default';
    const templateName = templates.find(t => t.id === templateId)?.name || templateId;
    showModal('模板预览', '<iframe id="website-preview-frame" style="width:100%;height:65vh;border:0;border-radius:10px;background:#fff"></iframe>');
    const frame = document.getElementById('website-preview-frame');
    if (!frame) return;
    const doc = frame.contentDocument;
    doc.open();
    doc.write(buildWebsitePreviewHTML(content, templateName, templateId));
    doc.close();
  }

  function buildWebsitePreviewHTML(content, templateName, templateId) {
    const brand = content.brand || {};
    const hero = content.hero || {};
    const contact = content.contact || {};
    const stats = Array.isArray(content.stats) ? content.stats.slice(0, 4) : [];
    const themeClass = String(templateId).toLowerCase().includes('aurora') ? 'theme-aurora' : 'theme-default';
    const cardList = (items, titleKeys, descKeys) => (Array.isArray(items) ? items : []).slice(0, 6).map(item => {
      const title = titleKeys.map(key => item?.[key]).find(Boolean) || '';
      const description = descKeys.map(key => item?.[key]).find(Boolean) || '';
      return `<article class="card"><h3>${esc(title)}</h3><p>${esc(description)}</p></article>`;
    }).join('');
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
      :root{color-scheme:dark;--bg:#0a0710;--line:rgba(255,255,255,.1);--text:#f7f2f4;--muted:#b7adb7;--rose:#eea2a4}
      *{box-sizing:border-box}body{margin:0;background:radial-gradient(120% 100% at 20% 0%,#241327 0%,var(--bg) 55%);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;line-height:1.7}
      .wrap{max-width:1040px;margin:0 auto;padding:32px 28px 64px}.notice{padding:9px 13px;border:1px solid rgba(238,162,164,.28);background:rgba(238,162,164,.07);border-radius:10px;color:var(--muted);font-size:12px;margin-bottom:28px}
      header{display:flex;gap:14px;align-items:center;padding-bottom:24px;border-bottom:1px solid var(--line)}.mark{width:44px;height:44px;border-radius:13px;display:grid;place-items:center;background:rgba(238,162,164,.12);border:1px solid rgba(238,162,164,.3);color:var(--rose);font-weight:700}
      .tagline{color:var(--muted);font-size:13px;margin-top:4px}.eyebrow{color:var(--rose);font-size:11px;letter-spacing:.16em;text-transform:uppercase;margin-top:38px}
      h1{font-size:clamp(34px,6vw,62px);line-height:1.08;letter-spacing:-.045em;margin:10px 0 18px}h1 span{color:var(--rose)}h2{font-size:22px;margin:0 0 16px}h3{font-size:15px;margin:0 0 6px}.lead{max-width:700px;color:var(--muted);font-size:15px}
      .cta{display:inline-block;margin-top:22px;padding:10px 16px;border-radius:9px;background:var(--rose);color:#1b0c10;font-weight:600;font-size:13px}
      .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin:42px 0}.stat{padding:16px;border:1px solid var(--line);border-radius:13px;background:rgba(255,255,255,.025)}.stat strong{display:block;font-size:24px;color:var(--rose)}.stat span{font-size:11px;color:var(--muted)}
      section{margin-top:42px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}.card{padding:17px;border:1px solid var(--line);border-radius:13px;background:rgba(255,255,255,.025)}.card p{font-size:12px;color:var(--muted);margin:5px 0 0}
      .contact{display:flex;flex-wrap:wrap;gap:16px;color:var(--muted);font-size:13px}.contact b{color:var(--text);font-weight:500}footer{margin-top:50px;padding-top:20px;border-top:1px solid var(--line);color:var(--muted);font-size:12px}
      body.theme-aurora{background:#f5f8fd;color:#142033}body.theme-aurora .notice{border-color:#dbe6f3;background:#fff;color:#617089}body.theme-aurora header{border-color:#dbe6f3}
      body.theme-aurora .mark{background:linear-gradient(135deg,#2563eb,#0ea5a4);border:0;color:#fff}body.theme-aurora .tagline,body.theme-aurora .lead,body.theme-aurora .stat span,body.theme-aurora .card p,body.theme-aurora .contact,body.theme-aurora footer{color:#617089}
      body.theme-aurora .eyebrow,body.theme-aurora h1 span,body.theme-aurora .stat strong{color:#2563eb}body.theme-aurora .cta{background:#2563eb;color:#fff}body.theme-aurora .stat,body.theme-aurora .card{background:#fff;border-color:#dbe6f3;box-shadow:0 20px 60px rgba(28,52,90,.08)}
    </style></head><body class="${themeClass}"><div class="wrap"><div class="notice">模板内容预览 · ${esc(templateName)} · 最终发布效果以发布引擎生成页面为准</div>
      <header><div class="mark">${esc(String(brand.name || '企业').slice(0,2))}</div><div><strong>${esc(brand.name || '未命名企业')}</strong><div class="tagline">${esc(brand.tagline || '')}</div></div></header>
      <div class="eyebrow">${esc(hero.eyebrow || '')}</div><h1>${esc(hero.title || '')}<br><span>${esc(hero.titleAccent || '')}</span></h1><p class="lead">${esc(hero.description || '')}</p>
      ${hero.primaryCta?.label ? `<span class="cta">${esc(hero.primaryCta.label)}</span>` : ''}
      ${stats.length ? `<div class="stats">${stats.map(s => `<div class="stat"><strong>${esc(s.value || '')}</strong><span>${esc(s.label || '')}</span></div>`).join('')}</div>` : ''}
      ${cardList(content.products, ['name','title'], ['summary','description']) ? `<section><h2>核心产品</h2><div class="grid">${cardList(content.products, ['name','title'], ['summary','description'])}</div></section>` : ''}
      ${cardList(content.solutions, ['title','name'], ['summary','description']) ? `<section><h2>解决方案</h2><div class="grid">${cardList(content.solutions, ['title','name'], ['summary','description'])}</div></section>` : ''}
      ${cardList(content.cases, ['title','name'], ['summary','description']) ? `<section><h2>客户案例</h2><div class="grid">${cardList(content.cases, ['title','name'], ['summary','description'])}</div></section>` : ''}
      ${(contact.phone || contact.email || contact.address) ? `<section><h2>联系我们</h2><div class="contact">${contact.phone ? `<span><b>电话</b> ${esc(contact.phone)}</span>` : ''}${contact.email ? `<span><b>邮箱</b> ${esc(contact.email)}</span>` : ''}${contact.address ? `<span><b>地址</b> ${esc(contact.address)}</span>` : ''}</div></section>` : ''}
      <footer>${esc(brand.description || '')}${content.icp?.number ? `<br>${esc(content.icp.number)}` : ''}</footer></div></body></html>`;
  }

  async function loadPro(main) {
    const status = await api('/api/org/pro/status');
    state.data.pro = status;
    const scope = status.personalVisible
      ? (state.data.proScope || 'personal')
      : 'organization';
    state.data.proScope = scope;
    const plans = (status.plans || []).filter(plan => plan.scope === scope);
    main.innerHTML = `
      <div class="card">
        <h3>Pro 状态</h3>
        <div class="row">
          ${pill(status.isPro ? 'Pro 已开通' : '未开通', status.isPro ? 'ok' : '')}
          <span class="small muted">个人原石 ${status.personalStoneBalance} · 企业原石 ${status.organizationStoneBalance}</span>
        </div>
      </div>
      <div class="card">
        <div class="row">
          <h3 class="spacer">套餐</h3>
          ${status.personalVisible ? `
            <div class="tabs" style="margin:0">
              <button class="tab ${scope === 'personal' ? 'active' : ''}" data-action="pro-scope" data-scope="personal">个人版</button>
              <button class="tab ${scope === 'organization' ? 'active' : ''}" data-action="pro-scope" data-scope="organization">企业版</button>
            </div>` : ''}
        </div>
        <div class="pro-plan-grid">
          ${plans.map(p => `
            <div class="pro-plan-card">
              <div class="pro-plan-head">
                <h4>${esc(p.name)}</h4>
                ${p.scope === 'organization' ? pill('组织', 'info') : pill('个人')}
              </div>
              <div class="pro-price">
                <span>¥</span><strong>${p.price}</strong><span>/${p.billingCycleMonths === 1 ? '月' : `${p.billingCycleMonths}个月`}</span>
              </div>
              <div class="pro-plan-meta">✦ 赠送 ${p.bonusStones} 原石</div>
              ${p.seatCount ? `<div class="pro-plan-meta">♙ 支持 ${p.seatCount} 人</div>` : ''}
              <div class="pro-benefits">
                ${(p.benefits || []).map(benefit => `<div><span>✓</span>${esc(benefit)}</div>`).join('') || '<div class="muted">暂无权益说明</div>'}
              </div>
              <div class="pro-plan-actions">
                ${status.wechatAvailable ? `<button class="primary" data-action="buy-pro" data-code="${esc(p.code)}" data-provider="wechat">微信支付</button>` : ''}
                ${status.alipayAvailable ? `<button data-action="buy-pro" data-code="${esc(p.code)}" data-provider="alipay">支付宝</button>` : ''}
              </div>
            </div>`).join('') || '<div class="empty">暂无可购买套餐</div>'}
        </div>
      </div>
      <div class="card">
        <h3>原石套餐</h3>
        <div class="pro-stone-grid">
          ${(status.stonePackages || []).map(p => `
            <div class="pro-stone-card">
              <div class="pro-plan-head"><h4>${esc(p.name)}</h4>${pill(`+${p.bonusStones} 原石`, 'info')}</div>
              <div class="pro-price"><span>¥</span><strong>${p.price}</strong></div>
              <div class="pro-plan-actions">
                ${status.wechatAvailable ? `<button class="btn-sm" data-action="buy-pro" data-code="${esc(p.code)}" data-provider="wechat">微信</button>` : ''}
                ${status.alipayAvailable ? `<button class="btn-sm" data-action="buy-pro" data-code="${esc(p.code)}" data-provider="alipay">支付宝</button>` : ''}
              </div>
            </div>`).join('') || '<div class="empty">暂未配置原石套餐</div>'}
        </div>
      </div>`;
  }

  const FEEDBACK_TYPES = [
    ['suggestion', '建议'],
    ['complaint', '投诉'],
    ['bug', 'BUG 上报'],
    ['question', '咨询'],
    ['other', '其他']
  ];

  function renderFeedback(main) {
    main.innerHTML = `
      <div class="card">
        <h3>投诉与建议</h3>
        <form data-form="submit-feedback">
          <div class="split">
            ${selectField('类型', 'type', FEEDBACK_TYPES, 'suggestion')}
            ${field('标题', 'title')}
          </div>
          ${textareaField('问题描述', 'description')}
          ${textareaField('复现步骤', 'steps')}
          ${textareaField('期望结果', 'expected')}
          ${field('联系方式', 'contact', state.user.phone)}
          <button class="primary" type="submit">提交</button>
        </form>
      </div>`;
  }

  async function showRegister() {
    showModal('申请入驻', `
      <form data-form="register">
        <div class="split">${field('手机号', 'phone')}${field('验证码', 'code')}</div>
        <div class="row"><button type="button" class="btn-sm" data-action="send-sms" data-scene="register">发送验证码</button></div>
        <div class="split">${field('密码', 'password', '', 'password')}${field('昵称', 'nickname')}</div>
        <div class="split">${field('真实姓名', 'realName')}${field('统一社会信用代码', 'creditCode', '', 'text', 'data-credit-code autocomplete="off"')}</div>
        <div id="credit-code-status" class="small muted" style="margin:-2px 0 10px">输入信用代码后会检查是否已有对应组织</div>
        ${field('企业名称', 'companyName')}
        <div class="split">${field('省', 'province')}${field('市', 'city')}</div>
        ${field('区/县', 'district')}
        <div class="modal-actions"><button class="primary" type="submit">提交申请</button></div>
      </form>`, { dismissible: false });
  }

  async function lookupCreditCode(input) {
    const box = document.getElementById('credit-code-status');
    if (!box) return;
    const value = (input.value || '').trim().toUpperCase();
    if (value.length < 8) {
      box.textContent = '输入信用代码后会检查是否已有对应组织';
      box.style.color = 'var(--text-3)';
      return;
    }

    const seq = (state.data.creditLookupSeq || 0) + 1;
    state.data.creditLookupSeq = seq;
    box.textContent = '正在检查组织…';
    box.style.color = 'var(--text-3)';
    try {
      const result = await api(
        `/api/public/organizations/lookup?creditCode=${encodeURIComponent(value)}`,
        { token: '' });
      if (seq !== state.data.creditLookupSeq) return;
      if (!result?.found) {
        box.textContent = '未找到对应组织，提交后将创建新组织';
        box.style.color = 'var(--text-3)';
      } else if (result.status === 'Active') {
        box.textContent = `找到组织：${result.name} · 提交后将申请加入该组织`;
        box.style.color = 'var(--accent-soft)';
      } else if (result.status === 'Pending') {
        box.textContent = `找到组织：${result.name} · 该组织正在入驻审核中，暂时不能申请加入`;
        box.style.color = 'var(--warning)';
      } else {
        box.textContent = `找到组织：${result.name} · 当前状态 ${result.status}，不能申请加入`;
        box.style.color = 'var(--danger)';
      }
    } catch (error) {
      if (seq !== state.data.creditLookupSeq) return;
      box.textContent = '暂时无法检查信用代码，请稍后重试';
      box.style.color = 'var(--warning)';
    }
  }

  async function sendSms(scene, phone) {
    if (!phone) throw new Error('请先填写手机号');
    const result = await api('/api/auth/sms/send', { method: 'POST', body: { phone, scene } });
    toast(`验证码已发送，${result.cooldownSeconds} 秒后可重发`);
  }

  async function loginDone(result) {
    await storeToken(result.token);
    state.user = result.user;
    state.view = 'home';
    render();
    await loadView();
    closeModal();
    checkForUpdates(true);
  }

  async function sendAIMessage(content) {
    if (!content) return;
    if (!state.ai.conversationId) {
      const conversation = await api('/api/org/ai/conversations', { method: 'POST' });
      state.ai.conversationId = conversation.id;
      state.ai.messages = [];
    }
    const box = $('#chat-box');
    if (!box) return;
    box.insertAdjacentHTML('beforeend', `<div class="msg user">${esc(content)}</div>`);
    const assistant = document.createElement('div');
    assistant.className = 'msg assistant';
    assistant.textContent = '正在思考…';
    box.appendChild(assistant);
    assistant.scrollIntoView({ block: 'end' });

    const headers = {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      Authorization: `Bearer ${state.token}`,
      'X-Device-Info': `Electron / ${navigator.platform}`
    };
    const url = apiUrl(`/api/org/ai/conversations/${state.ai.conversationId}/messages`);
    const payload = JSON.stringify({ content });

    if (window.desktop?.stream) {
      let streamed = '';
      const unsubscribe = window.desktop.onAIChunk?.((chunk) => {
        if (!chunk?.content) return;
        streamed += chunk.content;
        assistant.textContent = streamed;
        assistant.scrollIntoView({ block: 'end' });
      });
      try {
        const result = await window.desktop.stream({ url, headers, body: payload, timeout: 300000 });
        if (!streamed) {
          assistant.textContent = result.error && !result.text
            ? `请求失败：${result.error}`
            : (result.text || (result.error ? `错误：${result.error}` : '（没有返回内容）'));
        }
      } finally {
        unsubscribe?.();
      }
      assistant.scrollIntoView({ block: 'end' });
      return;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: payload
    });
    if (!response.ok) {
      const text = await response.text();
      assistant.textContent = `请求失败：${text.slice(0, 200)}`;
      return;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let answer = '';
    assistant.textContent = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          const event = JSON.parse(payload);
          if (event.content) {
            answer += event.content;
            assistant.textContent = answer;
            assistant.scrollIntoView({ block: 'end' });
          }
          if (event.type === 'error' && event.message) {
            assistant.textContent = `错误：${event.message}`;
          }
        } catch {
          // 忽略无法解析的 SSE 片段
        }
      }
    }
    if (!answer) assistant.textContent = '（没有返回内容）';
  }

  const actions = {
    'auth-tab': (el) => { state.authTab = el.dataset.tab; render(); },
    'show-register': () => showRegister(),
    'close-modal': () => closeModal(),
    'logout': async () => {
      if (!confirm('确定要退出登录吗？退出后需要重新验证手机号。')) return;
      await clearToken();
      state.user = null;
      state.ai = { conversations: [], messages: [], conversationId: null, streaming: false };
      render();
    },
    'refresh': () => loadView(),
    'toggle-user-menu': () => {
      const menu = document.getElementById('user-menu');
      if (menu) menu.hidden = !menu.hidden;
    },
    'open-update': () => {
      const menu = document.getElementById('user-menu');
      if (menu) menu.hidden = true;
      state.view = 'update';
      render();
      loadView();
    },
    'refresh-update': () => loadView(),
    'download-update': async (el) => {
      if (!window.desktop?.downloadUpdate) {
        toast('当前环境不支持应用内下载', true);
        return;
      }
      const url = el.dataset.url;
      const fileName = el.dataset.name;
      const key = el.dataset.downloadKey || downloadKey(url, fileName);
      // 已有同一安装包的下载任务时直接忽略，避免重复点击并发下载。
      if (state.downloads[key]?.status === 'downloading') return;

      state.downloads[key] = { status: 'downloading', percent: null, received: 0, total: 0 };
      refreshDownloadButtons();

      try {
        const result = await window.desktop.downloadUpdate(url, fileName);
        const finalKey = result?.key || key;
        if (finalKey !== key) delete state.downloads[key];
        state.downloads[finalKey] = { status: 'done', path: result.path };
        refreshDownloadButtons();
        toast(`安装包已下载到 ${result.path}`);
      } catch (error) {
        state.downloads[key] = { status: 'error' };
        refreshDownloadButtons();
        toast(error.message || '下载失败', true);
      }
    },
    'open-downloaded': async (el) => {
      if (!el.dataset.path) return;
      const result = await window.desktop.openPath(el.dataset.path);
      if (result && result.ok === false) toast(result.error || '打开安装包失败', true);
    },
    'fullscreen-dashboard': () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen?.().catch(() => toast('当前环境不支持全屏', true));
      } else {
        document.exitFullscreen?.();
      }
    },
    'send-sms': async (el) => {
      try {
        const form = el.closest('form');
        const phone = form?.querySelector('input[name="phone"]')?.value || state.user?.phone || '';
        await sendSms(el.dataset.scene || 'login', phone);
      } catch (error) { toast(error.message, true); }
    },
    'personal-tab': (el) => {
      state.data.personalTab = el.dataset.tab;
      loadView();
    },
    'theme-select': (el) => {
      const mode = el.dataset.mode;
      if (mode === 'system') {
        localStorage.removeItem(THEME_KEY);
      } else {
        localStorage.setItem(THEME_KEY, mode);
      }
      applyTheme(currentTheme());
      const menu = document.getElementById('user-menu');
      if (menu) menu.hidden = true;
    },
    'list-tab': (el) => {
      const key = el.dataset.view === 'activities' ? 'actTab'
        : el.dataset.view === 'opportunities' ? 'oppTab' : 'procTab';
      state.data[key] = el.dataset.tab;
      loadView();
    },
    'pro-scope': (el) => {
      state.data.proScope = el.dataset.scope;
      loadView();
    },
    'summary-year': (el) => {
      state.data.summaryYear = Number(el.dataset.year);
      loadView();
    },
    'mode-tab': (el) => {
      const key = el.dataset.view === 'activities' ? 'actMode'
        : el.dataset.view === 'opportunities' ? 'oppMode' : 'procMode';
      state.data[key] = el.dataset.mode;
      loadView();
    },
    'enterprise-page': (el) => { state.data.enterprisePage = Number(el.dataset.page); loadView(); },
    'message-page': (el) => { state.data.messagePage = Number(el.dataset.page); loadView(); },
    'read-message': async (el) => {
      try { await api(`/api/org/messages/${el.dataset.id}/read`, { method: 'POST' }); loadView(); }
      catch (error) { toast(error.message, true); }
    },
    'upload-asset': async (el) => {
      try {
        const file = await window.desktop.openFile();
        if (!file) return;
        await api(`/api/org/assets/${el.dataset.kind}`, {
          method: 'PUT',
          body: { imageBase64: file.base64, contentType: file.mime }
        });
        toast('上传成功');
        loadView();
      } catch (error) { toast(error.message, true); }
    },
    'delete-asset': async (el) => {
      try {
        await api(`/api/org/assets/${el.dataset.kind}`, { method: 'DELETE' });
        toast('已删除');
        loadView();
      } catch (error) { toast(error.message, true); }
    },
    'delete-member-type': async (el) => {
      try { await api(`/api/org/member-types/${el.dataset.id}`, { method: 'DELETE' }); loadView(); }
      catch (error) { toast(error.message, true); }
    },
    'approve-join': async (el) => {
      try {
        await api(`/api/org/join-applications/${el.dataset.id}/review`, {
          method: 'POST',
          body: { approved: true }
        });
        toast('已通过入会申请');
        loadView();
      } catch (error) { toast(error.message, true); }
    },
    'reject-join': async (el) => {
      const reason = prompt('请输入驳回原因');
      if (reason === null) return;
      try {
        await api(`/api/org/join-applications/${el.dataset.id}/review`, {
          method: 'POST',
          body: { approved: false, reason }
        });
        toast('已驳回入会申请');
        loadView();
      } catch (error) { toast(error.message, true); }
    },
    'save-member-type': async (el) => {
      try {
        const select = document.querySelector(`select[data-member-type="${el.dataset.id}"]`);
        await api(`/api/org/members/${el.dataset.id}/member-type`, {
          method: 'PUT',
          body: { memberTypeId: Number(select.value) }
        });
        toast('身份已更新');
        loadView();
      } catch (error) { toast(error.message, true); }
    },
    'toggle-member-pro': async (el) => {
      try {
        await api(`/api/org/members/${el.dataset.id}/pro`, {
          method: 'PUT',
          body: { enabled: el.dataset.enabled === 'true' }
        });
        toast('Pro 已更新');
        loadView();
      } catch (error) { toast(error.message, true); }
    },
    'courtesy-page': (el) => {
      state.data.courtesyPage = Math.max(1, Number(el.dataset.page) || 1);
      loadView();
    },
    'courtesy-tab': (el) => {
      state.data.courtesyTab = el.dataset.tab;
      if (el.dataset.tab === 'list') {
        state.data.courtesyEditing = null;
      }
      loadView();
    },
    'courtesy-new': () => {
      state.data.courtesyEditing = null;
      state.data.courtesyTab = 'form';
      loadView();
    },
    'edit-courtesy': (el) => {
      const note = (state.data.courtesyNotes || []).find(item => String(item.id) === el.dataset.id);
      if (!note) return;
      state.data.courtesyEditing = note;
      state.data.courtesyTab = 'form';
      loadView();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    'cancel-courtesy-edit': () => {
      state.data.courtesyEditing = null;
      state.data.courtesyTab = 'list';
      loadView();
    },
    'delete-courtesy': async (el) => {
      if (!confirm('删除后无法恢复，确定删除这条人情簿记录？')) return;
      try {
        await api(`/api/org/courtesy-notes/${el.dataset.id}`, { method: 'DELETE' });
        if (String(state.data.courtesyEditing?.id) === el.dataset.id) {
          state.data.courtesyEditing = null;
          state.data.courtesyTab = 'list';
        }
        toast('已删除');
        loadView();
      } catch (error) { toast(error.message, true); }
    },
    'view-enterprise': async (el) => {
      try {
        const org = await api(`/api/public/organizations/${el.dataset.id}`);
        showModal(org.name, `
          <div class="small muted">统一社会信用代码：${esc(org.creditCode)}</div>
          <p>${esc(org.introduction || '暂无介绍')}</p>
          <div class="small muted">地址：${esc(org.address || '-')}</div>
          <div class="small muted">电话：${esc(org.contactPhone || '-')}</div>`);
      } catch (error) { toast(error.message, true); }
    },
    'new-ai': async () => {
      try {
        const conversation = await api('/api/org/ai/conversations', { method: 'POST' });
        state.ai.conversationId = conversation.id;
        state.ai.messages = [];
        loadView();
      } catch (error) { toast(error.message, true); }
    },
    'open-ai': (el) => {
      state.ai.conversationId = Number(el.dataset.id);
      loadView();
    },
    'buy-pro': async (el) => {
      try {
        const order = await api('/api/org/pro/orders', {
          method: 'POST',
          body: { planCode: el.dataset.code, provider: el.dataset.provider }
        });
        showModal('扫码支付', `
          <div class="row"><span class="pill info">${esc(order.orderNo)}</span><span>¥${order.amount}</span></div>
          ${String(order.qrCode || '').startsWith('http')
            ? `<img src="${esc(order.qrCode)}" style="max-width:260px;margin-top:12px" alt="支付二维码">`
            : `<pre class="block">${esc(order.qrCode || '')}</pre>`}
          <div class="small muted">有效期至 ${fmtDate(order.expiresAt)}</div>`);
      } catch (error) { toast(error.message, true); }
    },
    'geo-tab': (el) => { state.geoTab = el.dataset.tab; loadView(); },
    'geo-usage-page': (el) => {
      state.geo.usagePage = Math.max(1, Number(el.dataset.page) || 1);
      loadView();
    },
    'pc-platform': (el) => {
      state.platformContent.platform = el.dataset.code;
      state.platformContent.draft = null;
      loadView();
    },
    'pc-edit': (el) => {
      const content = (state.platformContent.contents || []).find(item => String(item.id) === el.dataset.id);
      if (!content) return;
      state.platformContent.draft = {
        id: content.id,
        title: content.title,
        body: content.body
      };
      renderPlatformContentView();
    },
    'pc-insert-media': (el) => {
      const kind = el.dataset.kind === 'video' ? 'video' : 'image';
      state.data.pcMediaKind = kind;
      const input = document.getElementById('pc-media-file');
      if (!input) return;
      input.accept = kind === 'video' ? 'video/*' : 'image/*';
      input.value = '';
      input.click();
    },
    'pc-insert-link': () => {
      const url = (prompt('粘贴图片或视频链接（http/https）') || '').trim();
      if (!/^https?:\/\//i.test(url)) {
        if (url) toast('请输入 http(s) 链接', true);
        return;
      }
      const isVideo = /\.(mp4|webm|mov)(\?|$)/i.test(url);
      insertDraftMedia(isVideo ? `<video src="${url}" controls></video>` : `![图片](${url})`);
    },
    'pc-cancel': () => {
      state.platformContent.draft = null;
      renderPlatformContentView();
    },
    'pc-publish': async (el) => {
      const content = (state.platformContent.contents || []).find(item => String(item.id) === el.dataset.id);
      if (!content) return;
      state.data.pcPublishTarget = content;
      state.data.pcPublishTab = 'list';
      state.data.pcPublishPage = 1;
      state.data.pcPublishFilterVisible = false;
      state.data.pcPublishKeyword = '';
      state.data.pcPublishMinStone = '';
      state.data.pcPublishMaxStone = '';
      state.data.pcPublishSort = '';
      state.data.pcPublishSelected = {};
      showModal('选择发稿媒体', '<div class="empty">正在加载媒体…</div>', { dismissible: false });
      try {
        await openPublishMedia(1);
      } catch (error) {
        closeModal();
        toast(error.message, true);
      }
    },
    'pc-publish-filter-toggle': () => {
      state.data.pcPublishFilterVisible = !state.data.pcPublishFilterVisible;
      renderPublishModal();
    },
    'pc-publish-search': async () => {
      const modal = document.querySelector('.modal');
      if (!modal) return;
      state.data.pcPublishKeyword = (modal.querySelector('input[name="pcKeyword"]')?.value || '').trim();
      state.data.pcPublishMinStone = (modal.querySelector('input[name="pcMinStone"]')?.value || '').trim();
      state.data.pcPublishMaxStone = (modal.querySelector('input[name="pcMaxStone"]')?.value || '').trim();
      state.data.pcPublishSort = modal.querySelector('select[name="pcSort"]')?.value || '';
      state.data.pcPublishPage = 1;
      try {
        await openPublishMedia(1);
      } catch (error) { toast(error.message, true); }
    },
    'pc-publish-tab': (el) => {
      state.data.pcPublishTab = el.dataset.tab;
      renderPublishModal();
    },
    'pc-publish-page': async (el) => {
      const page = Math.max(1, Number(el.dataset.page) || 1);
      state.data.pcPublishPage = page;
      try {
        await openPublishMedia(page);
      } catch (error) { toast(error.message, true); }
    },
    'pc-publish-toggle': (el) => {
      const id = Number(el.dataset.id);
      if (!id) return;
      const selected = state.data.pcPublishSelected || {};
      if (el.checked) {
        selected[id] = {
          id,
          title: el.dataset.title || '',
          stonePrice: Number(el.dataset.stonePrice) || 0
        };
      } else {
        delete selected[id];
      }
      state.data.pcPublishSelected = selected;
      renderPublishModal();
    },
    'pc-publish-favorite': async (el) => {
      const target = state.data.pcPublishTarget;
      if (!target) return;
      const mediaId = Number(el.dataset.id);
      const isFavorite = el.dataset.favorite === '1';
      try {
        if (isFavorite) {
          await api(`/api/org/geo/media-favorites/${mediaId}?platform=${encodeURIComponent(target.platform)}`, { method: 'DELETE' });
        } else {
          await api('/api/org/geo/media-favorites', {
            method: 'POST',
            body: {
              platform: target.platform,
              mediaId,
              mediaTitle: el.dataset.title || ''
            }
          });
        }
        await openPublishMedia(state.data.pcPublishPage || 1);
      } catch (error) { toast(error.message, true); }
    },
    'pc-publish-submit': async () => {
      const target = state.data.pcPublishTarget;
      const selected = Object.values(state.data.pcPublishSelected || {});
      if (!target || !selected.length) return;

      const total = selected.reduce((sum, item) => sum + (item.stonePrice || 0), 0);
      if (!confirm(`确认向 ${selected.length} 个媒体发稿？\n预计扣除 ${total} 原石。\n提交后不可撤回。`)) return;

      try {
        const result = await api(`/api/org/geo/platform-contents/${target.id}/publish`, {
          method: 'POST',
          body: { mediaIds: selected.map(item => item.id) },
          timeout: 300000
        });
        closeModal();
        state.data.pcPublishTarget = null;
        state.data.pcPublishSelected = {};
        toast(`发稿完成：成功 ${result.successCount} 个，失败 ${result.failedCount} 个，扣 ${result.totalCostStones} 原石，余额 ${result.balanceAfter}`);
        loadView();
      } catch (error) { toast(error.message, true); }
    },
    'pc-delete': async (el) => {
      if (!confirm('删除后无法恢复，仅影响本地内容库。确定删除？')) return;
      try {
        await api(`/api/org/geo/platform-contents/${el.dataset.id}`, { method: 'DELETE' });
        state.platformContent.draft = null;
        toast('已删除');
        loadView();
      } catch (error) { toast(error.message, true); }
    },
    'generate-website': async (el) => {
      const form = el.closest('form');
      if (!form) return;
      const data = Object.fromEntries(new FormData(form));
      const result = await api('/api/org/website/generate', {
        method: 'POST',
        body: { instructions: data.instructions || '' },
        timeout: 300000
      });
      const textarea = form.querySelector('textarea[name="content"]');
      if (textarea) textarea.value = JSON.stringify(result.content || {}, null, 2);
      toast(`AI 初稿已生成${result.totalCostStones ? `，扣 ${result.totalCostStones} 原石` : ''}`);
    },
    'preview-website': (el) => {
      const form = el.closest('form');
      if (form) previewWebsiteFromForm(form);
    },
    'publish-website': async (el) => {
      const form = el.closest('form');
      if (!form) return;
      const data = Object.fromEntries(new FormData(form));
      const content = websiteParseContent(data.content);
      const result = await api('/api/org/website/publish', {
        method: 'POST',
        body: {
          host: data.host || '',
          templateId: data.templateId || 'default',
          content
        },
        timeout: 300000
      });
      toast(result.siteUrl ? `已发布：${result.siteUrl}` : '官网已发布');
      loadView();
    },
    'geo-suggest-profile': async () => {
      try {
        const result = await api('/api/org/geo/profile/suggest', { method: 'POST', body: { referenceText: '' }, timeout: 180000 });
        const s = result.suggestion;
        const form = document.querySelector('form[data-form="save-geo-profile"]');
        for (const [key, value] of Object.entries({
          publicName: s.publicName, summary: s.summary, description: s.description,
          services: s.services, serviceArea: s.serviceArea,
          targetCustomers: s.targetCustomers, keywords: s.keywords
        })) {
          const input = form?.querySelector(`[name="${key}"]`);
          if (input) input.value = value ?? '';
        }
        toast(`AI 已完善资料，扣 ${result.tokenCostStones} 原石`);
      } catch (error) { toast(error.message, true); }
    },
    'geo-generate': async (el) => { await generateGeoOne(el); },
    'geo-diagnose': async (el) => {
      try {
        const result = await api(`/api/org/geo/contents/${el.dataset.id}/diagnose`, { method: 'POST', timeout: 180000 });
        toast(`诊断完成：${result.score} 分，扣 ${result.tokenCostStones} 原石`);
        loadView();
      } catch (error) { toast(error.message, true); }
    },
    'geo-improve': async (el) => { await improveGeo(el.dataset.id); },
    'geo-publish': async (el) => {
      try {
        const result = await api(`/api/org/geo/contents/${el.dataset.id}/publish`, { method: 'POST' });
        toast(result.siteUrl ? `已发布：${result.siteUrl}` : '内容已发布');
        loadView();
      } catch (error) { toast(error.message, true); }
    },
    'geo-delete': async (el) => {
      if (!confirm('删除后无法恢复，静态站点会同步更新。确定删除？')) return;
      try { await api(`/api/org/geo/contents/${el.dataset.id}`, { method: 'DELETE' }); toast('已删除'); loadView(); }
      catch (error) { toast(error.message, true); }
    },
    'geo-diagnose-all': async () => {
      try {
        const contents = state.geo.contents || [];
        let done = 0;
        for (const content of contents) {
          await api(`/api/org/geo/contents/${content.id}/diagnose`, { method: 'POST', timeout: 180000 });
          done += 1;
        }
        toast(`已诊断 ${done} 篇`);
        loadView();
      } catch (error) { toast(error.message, true); }
    },
    'geo-audit': async () => {
      try {
        const result = await api('/api/org/geo/audit', { method: 'POST', timeout: 180000 });
        state.geo.audit = result;
        renderGeoView();
      } catch (error) { toast(error.message, true); }
    },
    'geo-index': async () => {
      try {
        const result = await api('/api/org/geo/index-status', { timeout: 180000 });
        state.geo.index = result;
        renderGeoView();
      } catch (error) { toast(error.message, true); }
    },
    'geo-push': async () => {
      try {
        const result = await api('/api/org/geo/push', { method: 'POST', timeout: 180000 });
        state.geo.push = result;
        renderGeoView();
        toast(`推送完成，扣 ${result.totalCostStones} 原石`);
      } catch (error) { toast(error.message, true); }
    },
    'geo-auto': async () => {
      try {
        await geoAutoOptimize();
        loadView();
      } catch (error) { toast(error.message, true); }
    }
  };

  function renderGeoView() {
    const view = $('#view');
    if (view && state.view === 'geo') {
      view.innerHTML = geoHTML();
    }
  }

  async function generateGeoOne(el) {
    const form = el?.closest('form') || document.querySelector('form[data-form="geo-generate"]');
    if (!form) return;
    const data = Object.fromEntries(new FormData(form));
    const question = (data.targetQuestion || '').trim();
    if (question.length < 2) { toast('请填写目标问题', true); return; }
    const btn = form.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;
    try {
      const result = await api('/api/org/geo/generate', {
        method: 'POST',
        body: { title: data.title || '', targetQuestion: question, extraInstructions: data.extraInstructions || '' },
        timeout: 180000
      });
      toast(`已生成，扣 ${result.totalCostStones} 原石`);
      loadView();
    } catch (error) {
      toast(error.message, true);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function improveGeo(id) {
    try {
      const diagnosis = await api(`/api/org/geo/contents/${id}/diagnose`, { method: 'POST', timeout: 180000 });
      if (diagnosis.score >= 80) { toast(`当前 ${diagnosis.score} 分，无需重写`); return; }
      const improved = await api(`/api/org/geo/contents/${id}/improve`, {
        method: 'POST',
        body: { issues: diagnosis.issues, suggestions: diagnosis.suggestions },
        timeout: 180000
      });
      toast(`已重写，扣 ${improved.tokenCostStones} 原石`);
      loadView();
    } catch (error) { toast(error.message, true); }
  }

  function normalizeText(text) {
    return String(text || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  }

  async function geoAutoOptimize() {
    const count = 3;
    if (Array.isArray(state.geo.contents) && state.geo.contents.length) {
      const seen = new Set();
      for (const content of state.geo.contents) {
        const key = normalizeText(content.title) + '|' + normalizeText(content.targetQuestion);
        if (key === '|') continue;
        if (seen.has(key)) {
          try {
            await api(`/api/org/geo/contents/${content.id}`, { method: 'DELETE' });
          } catch {
            // 删除失败则保留
          }
        } else {
          seen.add(key);
        }
      }
    }
    let profile = state.geo.profile || {};
    const suggestion = await api('/api/org/geo/profile/suggest', { method: 'POST', body: { referenceText: '' }, timeout: 180000 });
    const s = suggestion.suggestion;
    profile = { ...profile, ...s };
    await api('/api/org/geo/profile', { method: 'PUT', body: {
      publicName: profile.publicName || '', summary: profile.summary || '',
      description: profile.description || '', province: profile.province || '',
      city: profile.city || '', district: profile.district || '',
      publicPhone: profile.publicPhone || '', publicEmail: profile.publicEmail || '',
      services: profile.services || '', serviceArea: profile.serviceArea || '',
      targetCustomers: profile.targetCustomers || '', keywords: profile.keywords || '',
      websiteUrl: profile.websiteUrl || '', weChat: profile.weChat || '',
      mapUrl: profile.mapUrl || '', businessRegistryUrl: profile.businessRegistryUrl || '',
      externalLinks: profile.externalLinks || '', isPublished: true
    }});
    const questions = await api('/api/org/geo/questions/suggest', {
      method: 'POST', body: { count, referenceText: '' }, timeout: 180000
    });
    let published = 0;
    for (const q of (questions.questions || [])) {
      const generated = await api('/api/org/geo/generate', {
        method: 'POST',
        body: { title: q.title, targetQuestion: q.targetQuestion, extraInstructions: '' },
        timeout: 180000
      });
      let current = generated.content;
      let score = 0;
      for (let round = 1; round <= 3; round += 1) {
        const diagnosis = await api(`/api/org/geo/contents/${current.id}/diagnose`, { method: 'POST', timeout: 180000 });
        score = diagnosis.score;
        if (score >= 80 || round === 3) break;
        const improved = await api(`/api/org/geo/contents/${current.id}/improve`, {
          method: 'POST', body: { issues: diagnosis.issues, suggestions: diagnosis.suggestions }, timeout: 180000
        });
        current = improved.content;
      }
      await api(`/api/org/geo/contents/${current.id}/publish`, { method: 'POST' });
      published += 1;
    }
    const audit = await api('/api/org/geo/audit', { method: 'POST', timeout: 180000 });
    state.geo.audit = audit;
    toast(`一键优化完成：生成 ${published} 篇，发布 ${published} 篇`);
  }

  const forms = {
    'login-password': async (data) => {
      try {
        const result = await api('/api/auth/login/password', {
          method: 'POST', body: { phone: data.phone, password: data.password }
        });
        await loginDone(result);
      } catch (error) { toast(error.message, true); }
    },
    'login-sms': async (data) => {
      try {
        const result = await api('/api/auth/login/sms', {
          method: 'POST', body: { phone: data.phone, code: data.code }
        });
        await loginDone(result);
      } catch (error) { toast(error.message, true); }
    },
    'save-base': (data) => {
      const value = (data.baseUrl || '').trim().replace(/\/+$/, '');
      if (!/^https?:\/\//i.test(value)) { toast('请输入 http(s) 地址', true); return; }
      state.baseUrl = value;
      localStorage.setItem(BASE_KEY, value);
      render();
      toast('服务器地址已保存');
    },
    'register': async (data) => {
      try {
        const result = await api('/api/auth/register', { method: 'POST', body: data });
        closeModal();
        if (result?.status === 'PendingJoin') {
          toast(`入会申请已提交，等待 ${result.organizationName || '该组织'} 会长或秘书长审核`);
        } else {
          toast('入驻申请已提交，请等待审核');
        }
      } catch (error) { toast(error.message, true); }
    },
    'save-personal': async (data) => {
      const body = { ...data };
      delete body.phone;
      if (body.solarBirthday) {
        body.solarBirthday = new Date(`${body.solarBirthday}T00:00:00`).toISOString();
      } else {
        delete body.solarBirthday;
      }

      try {
        state.user = await api('/api/auth/profile', { method: 'PUT', body });
        toast('个人资料已保存');
        loadView();
      } catch (error) { toast(error.message, true); }
    },
    'change-password': async (data) => {
      if (data.newPassword !== data.confirmPassword) { toast('两次输入的新密码不一致', true); return; }
      const code = (data.code || '').trim();
      if (!code) { toast('请先填写短信验证码', true); return; }
      try {
        await api('/api/auth/password', {
          method: 'PUT', body: { code, newPassword: data.newPassword }
        });
        toast('密码已修改');
        loadView();
      } catch (error) { toast(error.message, true); }
    },
    'save-org': async (data) => {
      try {
        await api('/api/org/profile', { method: 'PUT', body: data });
        toast('组织资料已保存');
        loadView();
      } catch (error) { toast(error.message, true); }
    },
    'create-website': async (data) => {
      try {
        await api('/api/org/website', {
          method: 'POST',
          body: {
            host: data.host || '',
            templateId: data.templateId || 'default',
            companyName: data.companyName || '',
            shortName: data.shortName || '',
            englishName: data.englishName || '',
            tagline: data.tagline || '',
            description: data.description || '',
            phone: data.phone || '',
            email: data.email || '',
            address: data.address || '',
            wechat: data.wechat || '',
            keywords: data.keywords || '',
            services: data.services || '',
            serviceArea: data.serviceArea || '',
            generateWithAi: data.generateWithAi === 'on',
            instructions: data.instructions || '',
            publish: data.publish === 'on'
          },
          timeout: 300000
        });
        toast('官网已创建');
        loadView();
      } catch (error) { toast(error.message, true); }
    },
    'update-website': async (data) => {
      try {
        const content = websiteParseContent(data.content);
        await api('/api/org/website', {
          method: 'PUT',
          body: {
            host: data.host || '',
            templateId: data.templateId || 'default',
            content
          }
        });
        toast('官网内容已保存');
        loadView();
      } catch (error) { toast(error.message, true); }
    },
    'add-member-type': async (data) => {
      try { await api('/api/org/member-types', { method: 'POST', body: { name: data.name } }); loadView(); }
      catch (error) { toast(error.message, true); }
    },
    'create-opportunity': async (data) => {
      try {
        await api('/api/org/opportunities', { method: 'POST', body: {
          title: data.title, content: data.content,
          eventTime: new Date(data.eventTime).toISOString(), location: data.location
        }});
        toast('商机已发布'); loadView();
      } catch (error) { toast(error.message, true); }
    },
    'create-activity': async (data) => {
      try {
        await api('/api/org/activities', { method: 'POST', body: {
          title: data.title, content: data.content,
          startTime: new Date(data.startTime).toISOString(),
          endTime: new Date(data.endTime).toISOString(),
          location: data.location, maxParticipants: Number(data.maxParticipants)
        }});
        toast('活动已发布'); loadView();
      } catch (error) { toast(error.message, true); }
    },
    'create-procurement': async (data) => {
      try {
        const body = {
          title: data.title, content: data.content,
          bidDeadline: new Date(data.bidDeadline).toISOString(),
          openingTime: new Date(data.openingTime).toISOString(),
          openingLocation: data.openingLocation,
          contactName: data.contactName, contactPhone: data.contactPhone
        };
        if (data.budgetAmount) body.budgetAmount = Number(data.budgetAmount);
        await api('/api/org/procurements', { method: 'POST', body });
        toast('招标采购已发布'); loadView();
      } catch (error) { toast(error.message, true); }
    },
    'create-courtesy': async (data) => {
      const editing = state.data.courtesyEditing;
      const body = { ...data };
      for (const name of COURTESY_DATE_FIELDS) {
        if (body[name]) {
          body[name] = new Date(`${body[name]}T00:00:00`).toISOString();
        } else {
          delete body[name];
        }
      }

      try {
        if (editing) {
          await api(`/api/org/courtesy-notes/${editing.id}`, { method: 'PUT', body });
        } else {
          await api('/api/org/courtesy-notes', { method: 'POST', body });
        }
        state.data.courtesyEditing = null;
        state.data.courtesyTab = 'list';
        state.data.courtesyPage = 1;
        toast('记录已保存');
        loadView();
      } catch (error) { toast(error.message, true); }
    },
    'search-enterprises': (data) => {
      state.data.enterpriseFilters = {
        keyword: (data.keyword || '').trim(),
        creditCode: (data.creditCode || '').trim(),
        province: (data.province || '').trim(),
        city: (data.city || '').trim(),
        district: (data.district || '').trim()
      };
      state.data.enterprisePage = 1;
      loadView();
    },
    'send-ai': async (data) => {
      const content = (data.content || '').trim();
      if (!content) return;
      document.querySelector('form[data-form="send-ai"] textarea').value = '';
      try { await sendAIMessage(content); } catch (error) { toast(error.message, true); }
    },
    'save-geo-profile': async (data) => {
      try {
        const body = {
          ...data,
          isPublished: Boolean(data.isPublished)
        };
        await api('/api/org/geo/profile', { method: 'PUT', body });
        toast('GEO 资料已保存');
        loadView();
      } catch (error) { toast(error.message, true); }
    },
    'geo-generate': async (data) => {
      await generateGeoOne(null);
    },
    'pc-generate': async (data) => {
      const pc = state.platformContent;
      const topic = (data.topic || '').trim();
      if (topic.length < 2) { toast('请填写选题（至少 2 个字）', true); return; }
      try {
        const result = await api('/api/org/geo/platform-contents/generate', {
          method: 'POST',
          body: {
            platform: pc.platform,
            title: data.title || '',
            topic,
            extraInstructions: data.extraInstructions || ''
          },
          timeout: 180000
        });
        pc.draft = { id: null, title: result.title, body: result.body };
        toast(`已生成，扣 ${result.totalCostStones} 原石，余额 ${result.balanceAfter}`);
        renderPlatformContentView();
      } catch (error) { toast(error.message, true); }
    },
    'pc-save': async (data) => {
      const pc = state.platformContent;
      const title = (data.title || '').trim();
      const body = data.body || '';
      if (title.length < 2) { toast('标题至少需要 2 个字', true); return; }
      if (!body.trim()) { toast('正文不能为空', true); return; }
      try {
        if (data.id) {
          await api(`/api/org/geo/platform-contents/${data.id}`, {
            method: 'PUT',
            body: { platform: pc.platform, title, body }
          });
        } else {
          await api('/api/org/geo/platform-contents', {
            method: 'POST',
            body: { platform: pc.platform, title, body }
          });
        }
        pc.draft = null;
        toast('内容已保存');
        loadView();
      } catch (error) { toast(error.message, true); }
    },
    'submit-feedback': async (data) => {
      try {
        const result = await api('/api/org/feedback', { method: 'POST', body: data });
        toast(`反馈已提交，工单号 ${result.ticketNo || ''}`);
      } catch (error) { toast(error.message, true); }
    }
  };

  document.addEventListener('change', (event) => {
    const select = event.target.closest('select[data-region]');
    if (!select) return;
    const form = select.closest('form');
    if (!form) return;
    const province = form.querySelector('select[name="province"]')?.value || '';
    const city = form.querySelector('select[name="city"]')?.value || '';
    if (select.dataset.region === 'province') {
      fillRegionSelect(form, 'city', regionChildren(province), '');
      fillRegionSelect(form, 'district', [], '');
    } else if (select.dataset.region === 'city') {
      fillRegionSelect(form, 'district', regionChildren(province, city), '');
    }
  });

  document.addEventListener('change', async (event) => {
    const input = event.target;
    if (input.id !== 'pc-media-file' || !input.files?.length) return;

    const file = input.files[0];
    const kind = state.data.pcMediaKind === 'video' ? 'video' : 'image';
    input.value = '';
    try {
      toast(kind === 'video' ? '正在上传视频…' : '正在上传图片…');
      const base64 = await fileToBase64(file);
      const result = await api('/api/org/geo/platform-contents/upload', {
        method: 'POST',
        body: {
          fileName: file.name,
          contentType: file.type,
          kind,
          base64
        },
        timeout: 300000
      });
      insertDraftMedia(kind === 'video'
        ? `<video src="${result.url}" controls></video>`
        : `![图片](${result.url})`);
      toast('已插入正文');
    } catch (error) {
      toast(error.message, true);
    }
  });

  document.addEventListener('input', (event) => {
    const input = event.target.closest('[data-credit-code]');
    if (!input) return;
    clearTimeout(state.data.creditTimer);
    state.data.creditTimer = setTimeout(() => lookupCreditCode(input), 350);
  });

  document.addEventListener('click', (event) => {
    const dateInput = event.target.closest('input[type="date"], input[type="datetime-local"]');
    if (dateInput && typeof dateInput.showPicker === 'function') {
      try { dateInput.showPicker(); } catch { /* 选择器已打开或当前不可用 */ }
      return;
    }

    if (!event.target.closest('.sidebar-footer')) {
      const userMenu = document.getElementById('user-menu');
      if (userMenu) userMenu.hidden = true;
    }
    const nav = event.target.closest('[data-nav]');
    if (nav) {
      navTo(nav.dataset.nav);
      return;
    }
    if (event.target.classList.contains('modal-backdrop')
        && !event.target.hasAttribute('data-modal-locked')) {
      closeModal();
      return;
    }
    const el = event.target.closest('[data-action]');
    if (!el) return;
    const fn = actions[el.dataset.action];
    if (fn) {
      event.preventDefault();
      Promise.resolve(fn(el)).catch((error) => toast(error.message, true));
    }
  });

  document.addEventListener('submit', async (event) => {
    const form = event.target.closest('form[data-form]');
    if (!form) return;
    event.preventDefault();
    const handler = forms[form.dataset.form];
    if (!handler) return;
    const data = Object.fromEntries(new FormData(form));
    try {
      await handler(data, form);
    } catch (error) {
      toast(error.message, true);
    }
  });

  // 全局只订阅一次下载进度：状态记在 state 里，切换页面回来也能恢复。
  window.desktop?.onUpdateProgress?.((progress) => {
    const key = progress?.key;
    if (!key) return;
    const record = state.downloads[key];
    if (!record || record.status !== 'downloading') return;
    record.percent = progress.percent ?? null;
    record.received = Number(progress.received || 0);
    record.total = Number(progress.total || 0);
    refreshDownloadButtons();
  });

  window.addEventListener('DOMContentLoaded', init);
})();
