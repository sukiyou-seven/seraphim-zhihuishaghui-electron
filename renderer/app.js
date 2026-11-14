(() => {
  'use strict';

  const BASE_KEY = 'qtb_base_url';
  const DEFAULT_BASE = 'https://qserver.deepbit001.com';

  const state = {
    token: '',
    user: null,
    baseUrl: localStorage.getItem(BASE_KEY) || DEFAULT_BASE,
    view: 'home',
    authTab: 'password',
    geoTab: 'content',
    data: {},
    geo: { profile: null, contents: [], usage: [], audit: null, index: null, push: null },
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

  function showModal(title, html) {
    $('#modal-root').innerHTML = `
      <div class="modal-backdrop" data-modal-backdrop>
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
    if (state.user) loadView();
  }

  const NAV = [
    ['home', '首页'],
    ['personal', '个人资料'],
    ['org', '组织资料'],
    ['members', '成员与身份'],
    ['activities', '活动'],
    ['opportunities', '商机'],
    ['procurements', '招标采购'],
    ['courtesy', '人情簿'],
    ['preferred', '温商优选'],
    ['enterprises', '企业查询'],
    ['messages', '站内消息'],
    ['ai', 'DeepBit AI'],
    ['geo', 'GEO 优化'],
    ['website', '官网', true],
    ['pro', 'Pro 与原石'],
    ['feedback', '投诉与建议']
  ];

  function render() {
    const app = $('#app');
    if (!state.user) {
      app.innerHTML = authHTML();
      return;
    }
    const name = state.user.organization?.name || '组织';
    const orgName = state.user.organization?.name || '';
    app.innerHTML = `
      <div class="app-shell">
        <aside class="sidebar">
          <div class="brand">
            <h1>企通宝</h1>
            <p>${esc(orgName)} · ${esc(state.user.memberTypeName || '')}</p>
          </div>
          ${NAV.filter(([,, manageOnly]) => !manageOnly || state.user.canManage).map(([key, label]) => `
            <button class="nav-item ${state.view === key ? 'active' : ''}" data-nav="${key}">${esc(label)}</button>
          `).join('')}
          <div class="sidebar-footer">
            <div class="org">${esc(state.user.nickname || state.user.phone || '')}</div>
            <div>${esc(state.user.realName || '')}</div>
            <div class="small">Electron 1.0.10003</div>
            <div class="row" style="margin-top:8px">
              <button class="btn-sm" data-action="logout">退出登录</button>
            </div>
          </div>
        </aside>
        <main class="main">
          <div class="topbar">
            <h2>${esc((NAV.find(([k]) => k === state.view) || [, ''])[1])}</h2>
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
      <div class="auth-wrap">
        <div class="card auth-card">
          <h1>企通宝</h1>
          <div class="card-sub">智慧商会 · 桌面客户端</div>
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
        case 'personal': await loadPersonal(main); break;
        case 'org': await loadOrg(main); break;
        case 'members': await loadMembers(main); break;
        case 'activities': await loadActivities(main); break;
        case 'opportunities': await loadOpportunities(main); break;
        case 'procurements': await loadProcurements(main); break;
        case 'courtesy': await loadCourtesy(main); break;
        case 'preferred': await loadPreferred(main); break;
        case 'enterprises': await loadEnterprises(main); break;
        case 'messages': await loadMessages(main); break;
        case 'ai': await loadAI(main); break;
        case 'geo': await loadGeo(main); break;
        case 'website': await loadWebsite(main); break;
        case 'pro': await loadPro(main); break;
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

  function dataKey(name) {
    return (state.data[name] || []);
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
    main.innerHTML = `
      <div class="split">
        <div class="card">
          <h3>个人资料</h3>
          <form data-form="save-personal">
            ${field('昵称', 'nickname', state.user.nickname)}
            ${field('真实姓名', 'realName', state.user.realName)}
            ${field('手机号', 'phone', state.user.phone, 'text', 'disabled')}
            <button class="primary" type="submit">保存</button>
          </form>
        </div>
        <div class="card">
          <h3>修改密码</h3>
          <form data-form="change-password">
            ${field('当前密码', 'currentPassword', '', 'password')}
            ${field('新密码', 'newPassword', '', 'password')}
            ${field('确认新密码', 'confirmPassword', '', 'password')}
            <button class="primary" type="submit">修改密码</button>
          </form>
        </div>
      </div>`;
  }

  async function loadOrg(main) {
    const [org, logs] = await Promise.all([
      api('/api/org/profile'),
      api('/api/org/audit-logs').catch(() => [])
    ]);
    state.data.org = org;
    main.innerHTML = `
      <div class="card">
        <h3>组织资料</h3>
        <form data-form="save-org">
          <div class="split">
            ${field('组织名称', 'name', org.name, 'text', 'disabled')}
            ${field('统一社会信用代码', 'creditCode', org.creditCode, 'text', 'disabled')}
          </div>
          ${field('地址', 'address', org.address || '')}
          <div class="split">
            ${field('省', 'province', org.province || '')}
            ${field('市', 'city', org.city || '')}
          </div>
          <div class="split">
            ${field('区/县', 'district', org.district || '')}
            ${field('联系电话', 'contactPhone', org.contactPhone || '')}
          </div>
          ${textareaField('组织介绍', 'introduction', org.introduction || '')}
          <button class="primary" type="submit">保存组织资料</button>
        </form>
      </div>
      <div class="card">
        <h3>证照与电子印章</h3>
        <div class="row">
          <span>营业执照：${org.hasBusinessLicense ? pill('已上传', 'ok') : pill('未上传')}</span>
          <button data-action="upload-asset" data-kind="license">上传营业执照</button>
          <button class="danger" data-action="delete-asset" data-kind="license">删除</button>
        </div>
        <div class="row" style="margin-top:10px">
          <span>电子公章：${org.hasSeal ? pill('已上传', 'ok') : pill('未上传')}</span>
          <button data-action="upload-asset" data-kind="seal">上传公章</button>
          <button class="danger" data-action="delete-asset" data-kind="seal">删除</button>
        </div>
        <div class="row" style="margin-top:10px">
          <span>法人签名：${org.hasSignature ? pill('已上传', 'ok') : pill('未上传')}</span>
          <button data-action="upload-asset" data-kind="signature">上传签名</button>
          <button class="danger" data-action="delete-asset" data-kind="signature">删除</button>
        </div>
      </div>
      <div class="card">
        <h3>用章与签名留痕</h3>
        <div class="card-sub">只追加、不修改；记录操作人、时间、设备与对象，作为平台内部审计依据。</div>
        <table style="margin-top:10px">
          <tr><th>时间</th><th>操作人</th><th>动作</th><th>对象</th><th>文件摘要</th></tr>
          ${logs.slice(0, 50).map(log => `
            <tr>
              <td class="small">${fmtDate(log.createdAt)}</td>
              <td>${esc(log.userName || log.userPhone || '')}</td>
              <td>${esc(log.action || '')}</td>
              <td>${esc(log.targetTitle || log.targetType || '')}</td>
              <td class="mono small">${esc((log.fileHash || '').slice(0, 12))}</td>
            </tr>`).join('') || '<tr><td colspan="5" class="empty">暂无留痕记录</td></tr>'}
        </table>
      </div>`;
  }

  async function loadMembers(main) {
    const [types, members] = await Promise.all([
      api('/api/org/member-types'),
      api('/api/org/members')
    ]);
    state.data.memberTypes = types;
    state.data.members = members;
    main.innerHTML = `
      <div class="card">
        <h3>会员身份</h3>
        <form data-form="add-member-type" class="row">
          <input name="name" placeholder="新身份名称" required style="flex:1">
          <button class="primary" type="submit">新增身份</button>
        </form>
        <table style="margin-top:10px">
          <tr><th>名称</th><th>代码</th><th>成员数</th><th>操作</th></tr>
          ${types.map(t => `
            <tr>
              <td>${esc(t.name)}</td>
              <td class="mono">${esc(t.code || '')}</td>
              <td>${t.memberCount}</td>
              <td>${t.isBuiltIn ? '<span class="small muted">内置</span>' : `<button class="btn-sm danger" data-action="delete-member-type" data-id="${t.id}">删除</button>`}</td>
            </tr>`).join('')}
        </table>
      </div>
      <div class="card">
        <h3>组织成员</h3>
        <table>
          <tr><th>成员</th><th>手机号</th><th>身份</th><th>Pro</th><th>操作</th></tr>
          ${members.map(m => `
            <tr>
              <td>${esc(m.nickname)}<div class="small muted">${esc(m.realName)}</div></td>
              <td>${esc(m.phone)}</td>
              <td>
                <select data-member-type="${m.id}">
                  ${types.map(t => `<option value="${t.id}" ${t.id === m.memberTypeId ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}
                </select>
              </td>
              <td>${m.isPro ? pill('Pro', 'ok') : pill('普通')}</td>
              <td>
                <button class="btn-sm" data-action="save-member-type" data-id="${m.id}">保存身份</button>
                <button class="btn-sm" data-action="toggle-member-pro" data-id="${m.id}" data-enabled="${m.isPro ? 'false' : 'true'}">${m.isPro ? '取消 Pro' : '授予 Pro'}</button>
              </td>
            </tr>`).join('')}
        </table>
      </div>`;
  }

  function listTabs(view, tab) {
    return `
      <div class="tabs">
        <button class="tab ${tab === 'public' ? 'active' : ''}" data-action="list-tab" data-view="${view}" data-tab="public">广场</button>
        <button class="tab ${tab === 'mine' ? 'active' : ''}" data-action="list-tab" data-view="${view}" data-tab="mine">我的发布</button>
      </div>`;
  }

  async function loadOpportunities(main) {
    const tab = state.data.oppTab || 'public';
    const [pub, mine] = await Promise.all([
      api('/api/org/opportunities/public'),
      api('/api/org/opportunities/mine')
    ]);
    const list = tab === 'public' ? pub : mine;
    main.innerHTML = `
      <div class="card">
        <h3>发布商机</h3>
        <form data-form="create-opportunity">
          <div class="split">${field('标题', 'title')}${field('地点', 'location')}</div>
          ${field('活动时间', 'eventTime', '', 'datetime-local')}
          ${textareaField('内容', 'content')}
          <button class="primary" type="submit">发布</button>
        </form>
      </div>
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

  async function loadActivities(main) {
    const tab = state.data.actTab || 'public';
    const [pub, mine] = await Promise.all([
      api('/api/org/activities/public'),
      api('/api/org/activities/mine')
    ]);
    const list = tab === 'public' ? pub : mine;
    main.innerHTML = `
      <div class="card">
        <h3>发布活动</h3>
        <form data-form="create-activity">
          <div class="split">${field('标题', 'title')}${field('地点', 'location')}</div>
          <div class="split">${field('开始时间', 'startTime', '', 'datetime-local')}${field('结束时间', 'endTime', '', 'datetime-local')}</div>
          ${field('人数上限', 'maxParticipants', '30', 'number')}
          ${textareaField('活动内容', 'content')}
          <button class="primary" type="submit">发布</button>
        </form>
      </div>
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
    const tab = state.data.procTab || 'public';
    const [pub, mine] = await Promise.all([
      api('/api/org/procurements/public'),
      api('/api/org/procurements/mine')
    ]);
    const list = tab === 'public' ? pub : mine;
    main.innerHTML = `
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
      </div>
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

  async function loadCourtesy(main) {
    const notes = await api('/api/org/courtesy-notes');
    main.innerHTML = `
      <div class="card">
        <h3>新增人情簿记录</h3>
        <form data-form="create-courtesy">
          <div class="split">${field('标题', 'title')}${field('对象姓名', 'personName')}</div>
          ${field('时间', 'eventTime', '', 'datetime-local')}
          ${textareaField('内容', 'content')}
          <div class="split">${field('兴趣', 'interests')}${field('爱好', 'hobbies')}</div>
          <div class="split">${field('习惯', 'habits')}${field('备注', 'remarks')}</div>
          <button class="primary" type="submit">保存</button>
        </form>
      </div>
      <div class="card">
        <h3>记录列表</h3>
        <table>
          <tr><th>标题</th><th>对象</th><th>时间</th><th>记录人</th><th>操作</th></tr>
          ${notes.map(n => `
            <tr>
              <td>${esc(n.title)}<div class="small muted">${esc(n.content).slice(0, 50)}</div></td>
              <td>${esc(n.personName)}</td>
              <td>${fmtDate(n.eventTime)}</td>
              <td>${esc(n.creatorName)}</td>
              <td><button class="btn-sm danger" data-action="delete-courtesy" data-id="${n.id}">删除</button></td>
            </tr>`).join('') || '<tr><td colspan="5" class="empty">人情簿还是空的</td></tr>'}
        </table>
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
        <h3>企业查询</h3>
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
        <h3>站内消息</h3>
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
    state.ai.conversations = conversations;
    if (!state.ai.conversationId && conversations.length) {
      state.ai.conversationId = conversations[0].id;
    }
    if (state.ai.conversationId) {
      state.ai.messages = await api(`/api/org/ai/conversations/${state.ai.conversationId}/messages`);
    }
    main.innerHTML = `
      <div class="split" style="grid-template-columns: 240px 1fr">
        <div class="card">
          <div class="row"><h3 class="spacer">历史对话</h3><button class="btn-sm" data-action="new-ai">新对话</button></div>
          <div class="scroll-list">
            ${conversations.map(c => `
              <button class="nav-item ${c.id === state.ai.conversationId ? 'active' : ''}" data-action="open-ai" data-id="${c.id}">${esc(c.title)}</button>
            `).join('') || '<div class="empty">暂无历史对话</div>'}
          </div>
        </div>
        <div class="card">
          <div class="row">
            <h3 class="spacer">DeepBit AI 助手</h3>
            <span class="small muted">个人 ${config.personalStones} / 企业 ${config.organizationStones} 原石</span>
          </div>
          <div class="chat" id="chat-box">
            ${(state.ai.messages || []).map(m => `<div class="msg ${m.role === 'user' ? 'user' : 'assistant'}">${esc(m.content)}</div>`).join('') || '<div class="empty">选择或新建一个对话开始</div>'}
          </div>
          <form data-form="send-ai" class="chat-input">
            <textarea name="content" placeholder="给 DeepBit AI 助手发消息…" ${state.ai.conversationId ? '' : 'disabled'}></textarea>
            <button class="primary" type="submit" ${state.ai.conversationId ? '' : 'disabled'}>发送</button>
          </form>
        </div>
      </div>`;
  }

  async function loadGeo(main) {
    const [profile, contents, usage] = await Promise.all([
      api('/api/org/geo/profile'),
      api('/api/org/geo/contents'),
      api('/api/org/geo/usage')
    ]);
    state.geo.profile = profile;
    state.geo.contents = contents;
    state.geo.usage = usage;
    main.innerHTML = geoHTML();
  }

  function geoHTML() {
    const tab = state.geoTab;
    return `
      <div class="tabs">
        <button class="tab ${tab === 'content' ? 'active' : ''}" data-action="geo-tab" data-tab="content">内容优化</button>
        <button class="tab ${tab === 'check' ? 'active' : ''}" data-action="geo-tab" data-tab="check">优化检测</button>
      </div>
      ${tab === 'content' ? geoContentHTML() : geoCheckHTML()}`;
  }

  function geoContentHTML() {
    const p = state.geo.profile || {};
    const contents = state.geo.contents || [];
    const usage = state.geo.usage || [];
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
            <label class="small"><input type="checkbox" name="isPublished" ${p.isPublished ? 'checked' : ''} style="width:auto"> 公开</label>
            <span class="spacer"></span>
            <button type="button" data-action="geo-suggest-profile">AI 完善资料</button>
            <button class="primary" type="submit">保存 GEO 资料</button>
          </div>
        </form>
      </div>
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
              <td>${esc(c.title)}</td>
              <td class="small muted">${esc(c.targetQuestion)}</td>
              <td>${c.score ?? '-'}</td>
              <td>${pill(c.status === 'Published' ? '已发布' : c.status === 'Archived' ? '已下线' : '草稿', c.status === 'Published' ? 'ok' : '')}</td>
              <td class="row">
                <button class="btn-sm" data-action="geo-diagnose" data-id="${c.id}">诊断</button>
                <button class="btn-sm" data-action="geo-improve" data-id="${c.id}">AI 优化</button>
                ${c.status !== 'Published' ? `<button class="btn-sm" data-action="geo-publish" data-id="${c.id}">发布</button>` : ''}
                <button class="btn-sm danger" data-action="geo-delete" data-id="${c.id}">删除</button>
              </td>
            </tr>`).join('') || '<tr><td colspan="5" class="empty">还没有生成内容</td></tr>'}
        </table>
      </div>
      <div class="card">
        <h3>GEO 用量</h3>
        <table>
          <tr><th>时间</th><th>动作</th><th>模型</th><th>Token</th><th>扣费</th></tr>
          ${usage.slice(0, 30).map(u => `
            <tr>
              <td>${fmtDate(u.createdAt)}</td>
              <td>${esc(u.action)}</td>
              <td class="mono small">${esc(u.model)}</td>
              <td class="small">${u.promptTokens}/${u.completionTokens}</td>
              <td>${u.totalCostStones} 原石</td>
            </tr>`).join('') || '<tr><td colspan="5" class="empty">暂无用量</td></tr>'}
        </table>
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
    main.innerHTML = `
      <div class="card">
        <h3>Pro 状态</h3>
        <div class="row">
          ${pill(status.isPro ? 'Pro 已开通' : '未开通', status.isPro ? 'ok' : '')}
          <span class="small muted">个人原石 ${status.personalStoneBalance} · 企业原石 ${status.organizationStoneBalance}</span>
        </div>
      </div>
      <div class="card">
        <h3>套餐</h3>
        <table>
          <tr><th>名称</th><th>范围</th><th>价格</th><th>周期</th><th>赠送原石</th><th>操作</th></tr>
          ${(status.plans || []).map(p => `
            <tr>
              <td>${esc(p.name)}</td>
              <td>${esc(p.scope)}</td>
              <td>¥${p.price}</td>
              <td>${p.billingCycleMonths} 个月</td>
              <td>+${p.bonusStones}</td>
              <td>
                ${status.wechatAvailable ? `<button class="btn-sm" data-action="buy-pro" data-code="${esc(p.code)}" data-provider="wechat">微信支付</button>` : ''}
                ${status.alipayAvailable ? `<button class="btn-sm" data-action="buy-pro" data-code="${esc(p.code)}" data-provider="alipay">支付宝</button>` : ''}
              </td>
            </tr>`).join('') || '<tr><td colspan="6" class="empty">暂无可购买套餐</td></tr>'}
        </table>
      </div>
      <div class="card">
        <h3>原石套餐</h3>
        <table>
          <tr><th>名称</th><th>价格</th><th>原石</th><th>操作</th></tr>
          ${(status.stonePackages || []).map(p => `
            <tr>
              <td>${esc(p.name)}</td>
              <td>¥${p.price}</td>
              <td>${p.bonusStones}</td>
              <td>
                ${status.wechatAvailable ? `<button class="btn-sm" data-action="buy-pro" data-code="${esc(p.code)}" data-provider="wechat">微信</button>` : ''}
                ${status.alipayAvailable ? `<button class="btn-sm" data-action="buy-pro" data-code="${esc(p.code)}" data-provider="alipay">支付宝</button>` : ''}
              </td>
            </tr>`).join('') || '<tr><td colspan="4" class="empty">暂未配置原石套餐</td></tr>'}
        </table>
      </div>`;
  }

  function renderFeedback(main) {
    main.innerHTML = `
      <div class="card">
        <h3>投诉与建议</h3>
        <form data-form="submit-feedback">
          <div class="split">
            ${field('类型', 'type', '建议')}
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
        <div class="split">${field('真实姓名', 'realName')}${field('统一社会信用代码', 'creditCode')}</div>
        ${field('企业名称', 'companyName')}
        <div class="split">${field('省', 'province')}${field('市', 'city')}</div>
        ${field('区/县', 'district')}
        <div class="modal-actions"><button class="primary" type="submit">提交申请</button></div>
      </form>`);
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
  }

  async function sendAIMessage(content) {
    if (!state.ai.conversationId) return;
    const box = $('#chat-box');
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
      const result = await window.desktop.stream({ url, headers, body: payload, timeout: 300000 });
      if (result.error && !result.text) {
        assistant.textContent = `请求失败：${result.error}`;
        return;
      }
      assistant.textContent = result.text || (result.error ? `错误：${result.error}` : '（没有返回内容）');
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
    'logout': async () => { await clearToken(); state.user = null; render(); },
    'refresh': () => loadView(),
    'send-sms': async (el) => {
      try {
        const form = el.closest('form');
        const phone = form?.querySelector('input[name="phone"]')?.value || '';
        await sendSms(el.dataset.scene || 'login', phone);
      } catch (error) { toast(error.message, true); }
    },
    'list-tab': (el) => {
      const key = el.dataset.view === 'activities' ? 'actTab'
        : el.dataset.view === 'opportunities' ? 'oppTab' : 'procTab';
      state.data[key] = el.dataset.tab;
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
    'delete-courtesy': async (el) => {
      try { await api(`/api/org/courtesy-notes/${el.dataset.id}`, { method: 'DELETE' }); loadView(); }
      catch (error) { toast(error.message, true); }
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
        await api('/api/auth/register', { method: 'POST', body: data });
        closeModal();
        toast('入驻申请已提交，请等待审核');
      } catch (error) { toast(error.message, true); }
    },
    'save-personal': async (data) => {
      try {
        state.user = await api('/api/auth/profile', {
          method: 'PUT', body: { nickname: data.nickname, realName: data.realName }
        });
        toast('个人资料已保存');
        render();
      } catch (error) { toast(error.message, true); }
    },
    'change-password': async (data) => {
      if (data.newPassword !== data.confirmPassword) { toast('两次输入的新密码不一致', true); return; }
      try {
        await api('/api/auth/password', {
          method: 'PUT', body: { currentPassword: data.currentPassword, newPassword: data.newPassword }
        });
        toast('密码已修改');
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
      try {
        const body = {
          title: data.title, content: data.content,
          eventTime: new Date(data.eventTime).toISOString(),
          personName: data.personName
        };
        for (const key of ['interests', 'hobbies', 'habits', 'remarks']) {
          if (data[key]) body[key] = data[key];
        }
        await api('/api/org/courtesy-notes', { method: 'POST', body });
        toast('记录已保存'); loadView();
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
    'submit-feedback': async (data) => {
      try {
        const result = await api('/api/org/feedback', { method: 'POST', body: data });
        toast(`反馈已提交，工单号 ${result.ticketNo || ''}`);
      } catch (error) { toast(error.message, true); }
    }
  };

  document.addEventListener('click', (event) => {
    const nav = event.target.closest('[data-nav]');
    if (nav) {
      navTo(nav.dataset.nav);
      return;
    }
    if (event.target.classList.contains('modal-backdrop')) {
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

  window.addEventListener('DOMContentLoaded', init);
})();
