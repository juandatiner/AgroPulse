/* AgroPulse Admin Panel JS */
'use strict';

const Admin = (() => {
  let _token = localStorage.getItem('agropulse_admin_token') || '';
  let _currentTab = 'dashboard';
  let _refreshInterval = null;
  let _lastRefresh = null;
  let _refreshTimer = null;
  let _modalOpen = false;

  /* ── Token ── */
  function getToken() { return _token; }
  function setToken(t) {
    _token = t;
    if (t) localStorage.setItem('agropulse_admin_token', t);
    else localStorage.removeItem('agropulse_admin_token');
  }

  /* ── Auth ── */
  async function login(password) {
    try {
      const res = await fetch('/api/admin/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error de autenticación');
      setToken(data.token);
      showApp();
      return true;
    } catch (e) {
      showToast(e.message, 'error');
      return false;
    }
  }

  function logout() {
    setToken('');
    stopAutoRefresh();
    showLogin();
  }

  /* ── Screen switching ── */
  function showLogin() {
    document.getElementById('login-screen').style.display = 'flex';
    document.getElementById('app-screen').style.display = 'none';
    document.getElementById('login-password').value = '';
  }

  function showApp() {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app-screen').style.display = 'flex';
    switchTab('dashboard');
    startAutoRefresh();
  }

  /* ── Tabs ── */
  function switchTab(tab) {
    _currentTab = tab;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    const btn = document.querySelector(`.tab-btn[data-tab="${tab}"]`);
    if (btn) btn.classList.add('active');

    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    const panel = document.getElementById(`panel-${tab}`);
    if (panel) panel.classList.add('active');

    loadCurrentTab();
  }

  function loadCurrentTab() {
    const loaders = {
      dashboard: loadStats,
      users: loadUsers,
      resources: loadResources,
      agreements: loadAgreements,
      subscriptions: loadSubscriptions,
      support: loadSupport,
      config: loadConfig,
    };
    const fn = loaders[_currentTab];
    if (fn) fn();
    refreshSupportBadge();
  }

  /* ── Auto-refresh ── */
  function startAutoRefresh() {
    stopAutoRefresh();
    _refreshInterval = setInterval(() => {
      if (!_modalOpen) loadCurrentTab();
    }, 8000);
    startRefreshTimer();
  }

  function stopAutoRefresh() {
    if (_refreshInterval) { clearInterval(_refreshInterval); _refreshInterval = null; }
    if (_refreshTimer) { clearInterval(_refreshTimer); _refreshTimer = null; }
  }

  function startRefreshTimer() {
    if (_refreshTimer) clearInterval(_refreshTimer);
    _lastRefresh = Date.now();
    updateRefreshBadge();
    _refreshTimer = setInterval(updateRefreshBadge, 1000);
  }

  function updateRefreshBadge() {
    const el = document.getElementById('refresh-badge');
    if (!el || !_lastRefresh) return;
    const secs = Math.round((Date.now() - _lastRefresh) / 1000);
    el.textContent = secs < 5 ? 'Actualizando…' : `Actualizado hace ${secs}s`;
  }

  function markRefreshed() {
    _lastRefresh = Date.now();
    updateRefreshBadge();
  }

  /* ── API helper ── */
  async function apiFetch(url, opts = {}) {
    const res = await fetch(url, {
      ...opts,
      headers: {
        'Authorization': 'Bearer ' + _token,
        'Content-Type': 'application/json',
        ...(opts.headers || {}),
      },
    });
    if (res.status === 401) { logout(); throw new Error('Sesión expirada'); }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error del servidor');
    return data;
  }

  /* ── Dashboard ── */
  async function loadStats() {
    try {
      const d = await apiFetch('/api/admin/stats');
      markRefreshed();

      document.getElementById('stat-online').textContent = d.users_online;
      document.getElementById('stat-total-users').textContent = d.users_total;
      document.getElementById('stat-resources-active').textContent = d.resources_active;
      document.getElementById('stat-agreements-active').textContent = d.agreements_active;
      document.getElementById('stat-messages-today').textContent = d.messages_today;
      document.getElementById('stat-agreements-pending').textContent = d.agreements_pending;

      renderRecentResources(d.recent_resources || []);
      renderRecentAgreements(d.recent_agreements || []);
    } catch (e) {
      showToast(e.message, 'error');
    }
  }

  function renderRecentResources(items) {
    const el = document.getElementById('recent-resources-list');
    if (!items.length) { el.innerHTML = '<div class="empty-state">Sin publicaciones recientes</div>'; return; }
    el.innerHTML = items.map(r => `
      <div class="list-item list-item-clickable" onclick="Admin.openResourceModal('${esc(r.id)}')">
        <span class="badge badge-${r.tipo}">${tipoLabel(r.tipo)}</span>
        <span class="list-item-title">${esc(r.titulo)}</span>
        <span class="list-item-sub">${esc(r.user_nombre)}</span>
        <span class="list-item-date">${formatDate(r.created_at)}</span>
        <i data-lucide="chevron-right" style="width:14px;height:14px;color:var(--gray300);flex-shrink:0;"></i>
      </div>
    `).join('');
    if (window.lucide) lucide.createIcons();
  }

  function renderRecentAgreements(items) {
    const el = document.getElementById('recent-agreements-list');
    if (!items.length) { el.innerHTML = '<div class="empty-state">Sin acuerdos recientes</div>'; return; }
    el.innerHTML = items.map(a => `
      <div class="list-item list-item-clickable" onclick="Admin.openAgreementModal('${esc(a.id)}')">
        <span class="badge badge-status-${a.status}">${statusLabel(a.status)}</span>
        <span class="list-item-title">${esc(a.resource_titulo || '—')}</span>
        <span class="list-item-sub">${esc(a.req_nombre)} → ${esc(a.prov_nombre)}</span>
        <span class="list-item-date">${formatDate(a.created_at)}</span>
        <i data-lucide="chevron-right" style="width:14px;height:14px;color:var(--gray300);flex-shrink:0;"></i>
      </div>
    `).join('');
    if (window.lucide) lucide.createIcons();
  }

  /* ── Users ── */
  async function loadUsers() {
    const tbody = document.getElementById('users-tbody');
    tbody.innerHTML = '<tr><td colspan="11" class="loading-cell">Cargando…</td></tr>';
    try {
      const users = await apiFetch('/api/admin/users');
      markRefreshed();
      if (!users.length) {
        tbody.innerHTML = '<tr><td colspan="11" class="empty-cell">No hay usuarios</td></tr>';
        return;
      }
      tbody.innerHTML = users.map(u => `
        <tr class="clickable-row" onclick="Admin.openUserModal('${esc(u.id)}')">
          <td class="td-center">
            <span class="online-dot ${u.is_online ? 'online' : 'offline'}" title="${u.is_online ? 'En línea' : 'Desconectado'}"></span>
          </td>
          <td><strong>${esc(u.nombre)} ${esc(u.apellido)}</strong><br><small class="muted">${esc(u.municipio || '')}</small></td>
          <td class="td-small">${esc(u.email)}</td>
          <td>${tipoUserLabel(u.tipo)}</td>
          <td class="td-center">⭐ ${Number(u.reputation_score || 5).toFixed(1)}<br><small class="muted">(${u.total_ratings})</small></td>
          <td class="td-center">${u.resources_count}</td>
          <td class="td-center">${u.agreements_count}</td>
          <td class="td-small muted">${formatDate(u.created_at)}</td>
          <td class="td-center">
            <button class="btn-icon ${u.verified ? 'verified-yes' : 'verified-no'}" title="${u.verified ? 'Verificado (clic para quitar)' : 'No verificado (clic para verificar)'}"
                    onclick="event.stopPropagation(); Admin.toggleVerify('${esc(u.id)}', ${!u.verified})">
              <i data-lucide="${u.verified ? 'badge-check' : 'badge'}"></i>
            </button>
          </td>
          <td class="td-center">
            <span class="sub-pill sub-pill-${u.subscription_status || 'trial'}">${u.subscription_status || 'trial'}</span>
          </td>
          <td class="td-actions">
            <button class="btn-icon btn-view" title="Ver perfil" onclick="event.stopPropagation(); Admin.openUserModal('${esc(u.id)}')">
              <i data-lucide="eye"></i>
            </button>
            <button class="btn-delete" title="Eliminar" onclick="event.stopPropagation(); Admin.deleteUser('${esc(u.id)}', '${esc(u.nombre + ' ' + u.apellido)}')">
              <i data-lucide="trash-2"></i>
            </button>
          </td>
        </tr>
      `).join('');
      if (window.lucide) lucide.createIcons();
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="11" class="error-cell">${esc(e.message)}</td></tr>`;
    }
  }

  async function toggleVerify(id, verified) {
    try {
      await apiFetch(`/api/admin/users/${id}/verify`, {
        method: 'PATCH',
        body: JSON.stringify({ verified }),
      });
      showToast(verified ? 'Usuario verificado' : 'Verificación retirada', 'success');
      loadUsers();
    } catch (e) { showToast(e.message, 'error'); }
  }

  /* ── Subscriptions tab ── */
  async function loadSubscriptions() {
    const tbody = document.getElementById('subs-tbody');
    tbody.innerHTML = '<tr><td colspan="7" class="loading-cell">Cargando…</td></tr>';
    try {
      const users = await apiFetch('/api/admin/users');
      markRefreshed();

      // Stats
      const stats = { trial: 0, active: 0, expired: 0, cancelled: 0 };
      users.forEach(u => { stats[u.subscription_status || 'trial'] = (stats[u.subscription_status || 'trial'] || 0) + 1; });
      const grid = document.getElementById('sub-stats-grid');
      grid.innerHTML = `
        <div class="stat-card"><div class="stat-card-label">En prueba</div><div class="stat-card-value">${stats.trial || 0}</div></div>
        <div class="stat-card highlight"><div class="stat-card-label">Activos (pagando)</div><div class="stat-card-value">${stats.active || 0}</div></div>
        <div class="stat-card amber-card"><div class="stat-card-label">Expirados</div><div class="stat-card-value">${stats.expired || 0}</div></div>
        <div class="stat-card"><div class="stat-card-label">Cancelados</div><div class="stat-card-value">${stats.cancelled || 0}</div></div>
      `;

      if (!users.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">Sin usuarios</td></tr>';
        return;
      }
      tbody.innerHTML = users.map(u => {
        const promoBadge = u.promo_applied ? ` <span class="sub-pill sub-pill-trial" title="Se registró durante una promoción">PROMO ${u.trial_days_granted || '?'}d</span>` : '';
        return `
        <tr>
          <td><strong>${esc(u.nombre)} ${esc(u.apellido)}</strong>${promoBadge}</td>
          <td class="td-small">${esc(u.email)}</td>
          <td><span class="sub-pill sub-pill-${u.subscription_status || 'trial'}">${u.subscription_status || 'trial'}</span></td>
          <td class="td-center">${u.monthly_post_count || 0}</td>
          <td class="td-small muted">${u.trial_end ? formatDate(u.trial_end) : '—'}${u.trial_days_granted ? `<br><small style="color:var(--harvest)">Prometido: ${u.trial_days_granted}d</small>` : ''}</td>
          <td class="td-small muted">${u.subscription_end ? formatDate(u.subscription_end) : '—'}</td>
          <td>
            <button class="quick-btn warn" title="Pone trial a 2 minutos — ideal para probar el bloqueo" onclick="Admin.subAction('${esc(u.id)}', 'trial2min')">Trial 2min</button>
            <button class="quick-btn warn" title="Pone trial a 30 segundos" onclick="Admin.subAction('${esc(u.id)}', 'trial30s')">Trial 30s</button>
            <button class="quick-btn danger" title="Forzar expiración inmediata" onclick="Admin.subAction('${esc(u.id)}', 'expire')">Expirar ya</button>
            <button class="quick-btn success" title="Activar suscripción 30 días sin pago" onclick="Admin.subAction('${esc(u.id)}', 'activate')">Activar 30d</button>
            <button class="quick-btn" title="Reiniciar contador mensual" onclick="Admin.subAction('${esc(u.id)}', 'resetPosts')">Reset posts</button>
            <button class="quick-btn success" title="Restaurar el trial prometido al usuario al momento del registro" onclick="Admin.subAction('${esc(u.id)}', 'restorePromise')">Restaurar promesa</button>
            <button class="quick-btn" title="Cancelar suscripción" onclick="Admin.subAction('${esc(u.id)}', 'cancel')">Cancelar</button>
          </td>
        </tr>
      `;
      }).join('');
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="7" class="error-cell">${esc(e.message)}</td></tr>`;
    }
  }

  async function subAction(userId, action) {
    let body = {};
    let msg = '';
    if (action === 'trial2min') { body = { trial_end_offset_minutes: 2 }; msg = 'Trial ajustado a 2 minutos'; }
    else if (action === 'trial30s') { body = { trial_end_offset_minutes: 0.5 }; msg = 'Trial ajustado a 30 segundos'; }
    else if (action === 'expire') { body = { subscription_status: 'expired' }; msg = 'Forzado a expirado'; }
    else if (action === 'activate') { body = { subscription_status: 'active', subscription_end_offset_minutes: 30 * 24 * 60 }; msg = 'Suscripción activada 30 días'; }
    else if (action === 'resetPosts') { body = { reset_posts: true }; msg = 'Contador reiniciado'; }
    else if (action === 'restorePromise') { body = { restore_promised_trial: true }; msg = 'Trial restaurado al prometido al registrarse'; }
    else if (action === 'cancel') { body = { subscription_status: 'cancelled' }; msg = 'Suscripción cancelada'; }
    try {
      await apiFetch(`/api/admin/users/${userId}/subscription`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      showToast(msg, 'success');
      loadSubscriptions();
    } catch (e) { showToast(e.message, 'error'); }
  }

  /* ── Support tab ── */
  async function loadSupport() {
    const tbody = document.getElementById('support-tbody');
    tbody.innerHTML = '<tr><td colspan="7" class="loading-cell">Cargando…</td></tr>';
    try {
      const tickets = await apiFetch('/api/admin/support');
      markRefreshed();
      if (!tickets.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">Sin tickets</td></tr>';
        return;
      }
      tbody.innerHTML = tickets.map(t => `
        <tr class="clickable-row" onclick="Admin.openTicket('${esc(t.id)}')">
          <td>${t.priority === 'priority' ? '<span class="priority-cell">⚡ PRO</span>' : 'Normal'}</td>
          <td><strong>${esc(t.subject)}</strong>${t.unread_for_admin > 0 ? ` <span class="support-badge">${t.unread_for_admin}</span>` : ''}</td>
          <td class="td-small">${esc(t.user_nombre || '')} ${esc(t.user_apellido || '')}<br><small class="muted">${esc(t.user_email)}</small></td>
          <td><span class="sub-pill sub-pill-${t.user_subscription_status || 'trial'}">${t.user_subscription_status || 'trial'}</span></td>
          <td><span class="badge badge-status-${t.status}">${t.status}</span></td>
          <td class="td-small muted">${formatDate(t.updated_at)}</td>
          <td class="td-actions">
            <button class="btn-icon btn-view" onclick="event.stopPropagation(); Admin.openTicket('${esc(t.id)}')">
              <i data-lucide="eye"></i>
            </button>
          </td>
        </tr>
      `).join('');
      if (window.lucide) lucide.createIcons();
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="7" class="error-cell">${esc(e.message)}</td></tr>`;
    }
  }

  async function openTicket(id) {
    try {
      const t = await apiFetch(`/api/admin/support/${id}`);
      _modalOpen = true;
      const overlay = document.getElementById('modal-overlay');
      const card = document.getElementById('modal-card');
      const msgsHtml = t.messages.map(m => `
        <div style="margin-bottom:10px;padding:10px 12px;border-radius:8px;background:${m.from === 'admin' ? '#e8f1ff' : '#f3f4f6'};">
          <div style="font-size:11px;color:var(--gray500);margin-bottom:4px">
            <strong>${m.from === 'admin' ? 'Soporte (Admin)' : (t.user ? t.user.nombre : 'Usuario')}</strong> · ${formatDate(m.created_at)}
          </div>
          <div style="font-size:13px;white-space:pre-wrap">${esc(m.message)}</div>
        </div>
      `).join('');
      card.innerHTML = `
        <div style="padding:20px;max-height:80vh;overflow-y:auto">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
            <h3 style="font-family:var(--font-serif);font-size:18px">${esc(t.subject)}</h3>
            <button onclick="Admin.closeModalDirect()" style="background:var(--gray100);border:none;padding:6px 10px;border-radius:6px;cursor:pointer">✕</button>
          </div>
          <div style="font-size:12px;color:var(--gray500);margin-bottom:14px">
            ${t.user ? `${esc(t.user.nombre)} ${esc(t.user.apellido)} · ${esc(t.user.email)}` : ''}
            · Estado: <strong>${t.status}</strong>
            · Prioridad: <strong>${t.priority}</strong>
          </div>
          <div id="admin-ticket-msgs" style="max-height:45vh;overflow-y:auto;margin-bottom:14px;padding:8px;background:var(--gray50);border-radius:8px">
            ${msgsHtml}
          </div>
          <textarea id="admin-ticket-reply" rows="3" style="width:100%;padding:10px;border:1px solid var(--gray300);border-radius:8px;font-family:var(--font);font-size:13px" placeholder="Escribe una respuesta..."></textarea>
          <div style="display:flex;gap:8px;margin-top:10px;justify-content:space-between">
            <div>
              <button onclick="Admin.ticketStatus('${esc(id)}', 'closed')" class="quick-btn">Cerrar ticket</button>
              <button onclick="Admin.ticketStatus('${esc(id)}', 'pending')" class="quick-btn">Marcar pendiente</button>
            </div>
            <button onclick="Admin.replyTicket('${esc(id)}')" style="background:var(--earth);color:var(--white);border:none;padding:8px 16px;border-radius:8px;cursor:pointer;font-weight:600">
              Enviar respuesta
            </button>
          </div>
        </div>
      `;
      overlay.style.display = 'flex';
      if (window.lucide) lucide.createIcons();
    } catch (e) { showToast(e.message, 'error'); }
  }

  async function replyTicket(id) {
    const ta = document.getElementById('admin-ticket-reply');
    const msg = (ta.value || '').trim();
    if (!msg) return showToast('Escribe un mensaje', 'error');
    try {
      await apiFetch(`/api/admin/support/${id}`, {
        method: 'POST',
        body: JSON.stringify({ message: msg }),
      });
      showToast('Respuesta enviada', 'success');
      openTicket(id);
    } catch (e) { showToast(e.message, 'error'); }
  }

  async function ticketStatus(id, status) {
    try {
      await apiFetch(`/api/admin/support/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      showToast('Estado actualizado', 'success');
      closeModalDirect();
      loadSupport();
    } catch (e) { showToast(e.message, 'error'); }
  }

  async function refreshSupportBadge() {
    try {
      const tickets = await apiFetch('/api/admin/support');
      const unread = tickets.reduce((a, t) => a + (t.unread_for_admin || 0), 0);
      const badge = document.getElementById('support-badge');
      if (!badge) return;
      if (unread > 0) { badge.textContent = unread; badge.style.display = 'inline-block'; }
      else badge.style.display = 'none';
    } catch {}
  }

  /* ── Config tab ── */
  async function loadConfig() {
    try {
      const c = await apiFetch('/api/admin/config');
      markRefreshed();
      document.getElementById('cfg-trial-days').value = c.trial_days;
      document.getElementById('cfg-price').value = c.subscription_price;
      document.getElementById('cfg-free-posts').value = c.free_posts_per_month;
      document.getElementById('cfg-promo-discount').value = c.promo_discount_percent;
      document.getElementById('cfg-promo-active').checked = !!c.promo_active;
      if (c.promo_end_date) {
        const d = new Date(c.promo_end_date);
        const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
        document.getElementById('cfg-promo-end').value = local.toISOString().slice(0, 16);
      } else {
        document.getElementById('cfg-promo-end').value = '';
      }
    } catch (e) { showToast(e.message, 'error'); }
  }

  async function saveConfig() {
    const promoEndVal = document.getElementById('cfg-promo-end').value;
    const payload = {
      trial_days: parseInt(document.getElementById('cfg-trial-days').value || '0', 10),
      subscription_price: parseInt(document.getElementById('cfg-price').value || '0', 10),
      free_posts_per_month: parseInt(document.getElementById('cfg-free-posts').value || '0', 10),
      promo_discount_percent: parseInt(document.getElementById('cfg-promo-discount').value || '0', 10),
      promo_active: document.getElementById('cfg-promo-active').checked,
      promo_end_date: promoEndVal ? new Date(promoEndVal).toISOString() : null,
    };
    try {
      await apiFetch('/api/admin/config', {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      showToast('Configuración guardada', 'success');
      loadConfig();
    } catch (e) { showToast(e.message, 'error'); }
  }

  /* ── Resources ── */
  async function loadResources() {
    const tbody = document.getElementById('resources-tbody');
    tbody.innerHTML = '<tr><td colspan="7" class="loading-cell">Cargando…</td></tr>';
    try {
      const resources = await apiFetch('/api/admin/resources');
      markRefreshed();
      if (!resources.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">No hay publicaciones</td></tr>';
        return;
      }
      tbody.innerHTML = resources.map(r => `
        <tr class="clickable-row" onclick="Admin.openResourceModal('${esc(r.id)}')">
          <td><span class="badge badge-${r.tipo}">${tipoLabel(r.tipo)}</span></td>
          <td>
            <strong>${esc(r.titulo)}</strong>
            ${r.image_data ? '<span class="img-indicator" title="Tiene imagen">📷</span>' : ''}
          </td>
          <td class="td-small">${esc(r.categoria || '—')}</td>
          <td class="td-small">${esc(r.user_nombre)} ${esc(r.user_apellido)}</td>
          <td><span class="badge badge-status-${r.status}">${statusResLabel(r.status)}</span></td>
          <td class="td-small muted">${formatDate(r.created_at)}</td>
          <td class="td-actions">
            <button class="btn-icon btn-view" title="Ver detalle" onclick="event.stopPropagation(); Admin.openResourceModal('${esc(r.id)}')">
              <i data-lucide="eye"></i>
            </button>
            <button class="btn-delete" title="Eliminar" onclick="event.stopPropagation(); Admin.deleteResource('${esc(r.id)}', '${esc(r.titulo)}')">
              <i data-lucide="trash-2"></i>
            </button>
          </td>
        </tr>
      `).join('');
      if (window.lucide) lucide.createIcons();
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="7" class="error-cell">${esc(e.message)}</td></tr>`;
    }
  }

  /* ── Agreements ── */
  async function loadAgreements() {
    const tbody = document.getElementById('agreements-tbody');
    tbody.innerHTML = '<tr><td colspan="6" class="loading-cell">Cargando…</td></tr>';
    try {
      const agreements = await apiFetch('/api/admin/agreements');
      markRefreshed();
      if (!agreements.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">No hay acuerdos</td></tr>';
        return;
      }
      tbody.innerHTML = agreements.map(a => `
        <tr class="clickable-row" onclick="Admin.openAgreementModal('${esc(a.id)}')">
          <td>${esc(a.resource_titulo || '—')}</td>
          <td class="td-small">
            <strong>${esc(a.req_nombre)} ${esc(a.req_apellido)}</strong>
            <span class="arrow">→</span>
            <strong>${esc(a.prov_nombre)} ${esc(a.prov_apellido)}</strong>
          </td>
          <td><span class="badge badge-status-${a.status}">${statusLabel(a.status)}</span></td>
          <td class="td-small muted">${formatDate(a.updated_at)}</td>
          <td class="td-small">
            ${a.rating_requester != null ? `⭐ ${a.rating_requester}` : '—'} /
            ${a.rating_provider != null ? `⭐ ${a.rating_provider}` : '—'}
          </td>
          <td class="td-actions">
            <button class="btn-icon btn-view" title="Ver detalle" onclick="event.stopPropagation(); Admin.openAgreementModal('${esc(a.id)}')">
              <i data-lucide="eye"></i>
            </button>
          </td>
        </tr>
      `).join('');
      if (window.lucide) lucide.createIcons();
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="6" class="error-cell">${esc(e.message)}</td></tr>`;
    }
  }

  /* ── Delete actions ── */
  async function deleteUser(id, name) {
    if (!confirm(`¿Eliminar al usuario "${name}" y todos sus datos? Esta acción no se puede deshacer.`)) return;
    try {
      await apiFetch(`/api/admin/users/${id}`, { method: 'DELETE' });
      showToast(`Usuario "${name}" eliminado`, 'success');
      loadUsers();
    } catch (e) {
      showToast(e.message, 'error');
    }
  }

  async function deleteResource(id, title) {
    if (!confirm(`¿Eliminar la publicación "${title}"?`)) return;
    try {
      await apiFetch(`/api/admin/resources/${id}`, { method: 'DELETE' });
      showToast(`Publicación eliminada`, 'success');
      loadResources();
    } catch (e) {
      showToast(e.message, 'error');
    }
  }

  /* ── Modal core ── */
  function openModal() {
    const overlay = document.getElementById('modal-overlay');
    overlay.classList.add('active');
    _modalOpen = true;
    document.body.style.overflow = 'hidden';
  }

  function closeModal(e) {
    if (e && e.target.id !== 'modal-overlay') return;
    closeModalDirect();
  }

  function closeModalDirect() {
    const overlay = document.getElementById('modal-overlay');
    overlay.classList.remove('active');
    _modalOpen = false;
    document.body.style.overflow = '';
  }

  /* ── User modal ── */
  async function openUserModal(id) {
    const card = document.getElementById('modal-card');
    card.innerHTML = '<div class="modal-loading"><i data-lucide="loader-2" style="width:24px;height:24px;"></i></div>';
    openModal();
    if (window.lucide) lucide.createIcons();
    try {
      const u = await apiFetch(`/api/admin/users/${id}`);
      const initials = ((u.nombre?.[0] || '') + (u.apellido?.[0] || '')).toUpperCase() || '?';
      card.innerHTML = `
        <div class="modal-header">
          <div class="modal-header-info">
            <div class="modal-avatar">${esc(initials)}</div>
            <div>
              <div class="modal-title">${esc(u.nombre)} ${esc(u.apellido)}</div>
              <div class="modal-subtitle">${esc(u.email)} · ${tipoUserLabel(u.tipo)}</div>
            </div>
          </div>
          <button class="btn-modal-close" onclick="Admin.closeModalDirect()">
            <i data-lucide="x" style="width:16px;height:16px;"></i>
          </button>
        </div>
        <div class="modal-body">
          <div class="modal-stats-row">
            <div class="modal-stat">
              <span class="modal-stat-value">${u.is_online ? '<span class="online-chip">En línea</span>' : '<span class="offline-chip">Desconectado</span>'}</span>
            </div>
            <div class="modal-stat">
              <span class="modal-stat-label">Reputación</span>
              <span class="modal-stat-value">⭐ ${Number(u.reputation_score).toFixed(1)}<small> (${u.total_ratings})</small></span>
            </div>
            <div class="modal-stat">
              <span class="modal-stat-label">Publicaciones</span>
              <span class="modal-stat-value">${u.resources_count}</span>
            </div>
            <div class="modal-stat">
              <span class="modal-stat-label">Acuerdos</span>
              <span class="modal-stat-value">${u.agreements_count}</span>
            </div>
            <div class="modal-stat">
              <span class="modal-stat-label">Miembro desde</span>
              <span class="modal-stat-value">${formatDateShort(u.created_at)}</span>
            </div>
          </div>

          <div class="modal-section-title">Editar datos</div>

          <div class="modal-field-group">
            <div class="modal-field">
              <label>Nombre</label>
              <input class="modal-input" id="uf-nombre" value="${esc(u.nombre)}" placeholder="Nombre">
            </div>
            <div class="modal-field">
              <label>Apellido</label>
              <input class="modal-input" id="uf-apellido" value="${esc(u.apellido)}" placeholder="Apellido">
            </div>
          </div>
          <div class="modal-field-group">
            <div class="modal-field">
              <label>Email</label>
              <input class="modal-input" id="uf-email" type="email" value="${esc(u.email)}" placeholder="Email">
            </div>
            <div class="modal-field">
              <label>Teléfono</label>
              <input class="modal-input" id="uf-telefono" value="${esc(u.telefono)}" placeholder="Teléfono">
            </div>
          </div>
          <div class="modal-field-group">
            <div class="modal-field">
              <label>Tipo de usuario</label>
              <select class="modal-select" id="uf-tipo">
                <option value="agricultor" ${u.tipo === 'agricultor' ? 'selected' : ''}>Agricultor</option>
                <option value="proveedor" ${u.tipo === 'proveedor' ? 'selected' : ''}>Proveedor</option>
                <option value="comercializador" ${u.tipo === 'comercializador' ? 'selected' : ''}>Comercializador</option>
                <option value="consumidor" ${u.tipo === 'consumidor' ? 'selected' : ''}>Consumidor</option>
              </select>
            </div>
            <div class="modal-field">
              <label>Municipio</label>
              <input class="modal-input" id="uf-municipio" value="${esc(u.municipio)}" placeholder="Municipio">
            </div>
          </div>
          <div class="modal-field-group modal-field-full">
            <div class="modal-field">
              <label>Bio</label>
              <textarea class="modal-textarea" id="uf-bio" placeholder="Descripción del perfil">${esc(u.bio)}</textarea>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-secondary" onclick="Admin.closeModalDirect()">Cancelar</button>
          <button class="btn-primary" id="btn-save-user" onclick="Admin.saveUser('${esc(id)}')">
            <i data-lucide="save" style="width:14px;height:14px;"></i>
            Guardar cambios
          </button>
        </div>
      `;
      if (window.lucide) lucide.createIcons();
    } catch (e) {
      card.innerHTML = `<div class="modal-error">${esc(e.message)}</div>`;
    }
  }

  async function saveUser(id) {
    const btn = document.getElementById('btn-save-user');
    if (!btn) return;
    btn.disabled = true;
    btn.textContent = 'Guardando…';
    try {
      await apiFetch(`/api/admin/users/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          nombre: document.getElementById('uf-nombre').value,
          apellido: document.getElementById('uf-apellido').value,
          email: document.getElementById('uf-email').value,
          telefono: document.getElementById('uf-telefono').value,
          tipo: document.getElementById('uf-tipo').value,
          municipio: document.getElementById('uf-municipio').value,
          bio: document.getElementById('uf-bio').value,
        }),
      });
      showToast('Usuario actualizado correctamente', 'success');
      closeModalDirect();
      if (_currentTab === 'users') loadUsers();
    } catch (e) {
      showToast(e.message, 'error');
      btn.disabled = false;
      btn.innerHTML = '<i data-lucide="save" style="width:14px;height:14px;"></i> Guardar cambios';
      if (window.lucide) lucide.createIcons();
    }
  }

  /* ── Resource modal ── */
  async function openResourceModal(id) {
    const card = document.getElementById('modal-card');
    card.innerHTML = '<div class="modal-loading"><i data-lucide="loader-2" style="width:24px;height:24px;"></i></div>';
    openModal();
    if (window.lucide) lucide.createIcons();
    try {
      const r = await apiFetch(`/api/admin/resources/${id}`);

      let extraFields = '';
      if (r.cantidad || r.unidad) {
        extraFields += `
          <div class="modal-field-group">
            <div class="modal-field">
              <label>Cantidad</label>
              <input class="modal-input" value="${esc(r.cantidad || '—')}" readonly>
            </div>
            <div class="modal-field">
              <label>Unidad</label>
              <input class="modal-input" value="${esc(r.unidad || '—')}" readonly>
            </div>
          </div>`;
      }
      if (r.precio_referencia || r.condicion) {
        extraFields += `
          <div class="modal-field-group">
            <div class="modal-field">
              <label>Precio referencia</label>
              <input class="modal-input" value="${esc(r.precio_referencia || '—')}" readonly>
            </div>
            <div class="modal-field">
              <label>Condición</label>
              <input class="modal-input" value="${esc(r.condicion || '—')}" readonly>
            </div>
          </div>`;
      }
      if (r.disponibilidad) {
        extraFields += `
          <div class="modal-field-group modal-field-full">
            <div class="modal-field">
              <label>Disponibilidad</label>
              <input class="modal-input" value="${esc(r.disponibilidad)}" readonly>
            </div>
          </div>`;
      }
      if (r.ofrece || r.recibe) {
        extraFields += `
          <div class="modal-field-group">
            <div class="modal-field">
              <label>Ofrece (trueque)</label>
              <input class="modal-input" value="${esc(r.ofrece || '—')}" readonly>
            </div>
            <div class="modal-field">
              <label>Recibe (trueque)</label>
              <input class="modal-input" value="${esc(r.recibe || '—')}" readonly>
            </div>
          </div>`;
      }
      if (r.duracion_prestamo || r.garantia) {
        extraFields += `
          <div class="modal-field-group">
            <div class="modal-field">
              <label>Duración préstamo</label>
              <input class="modal-input" value="${esc(r.duracion_prestamo || '—')}" readonly>
            </div>
            <div class="modal-field">
              <label>Garantía</label>
              <input class="modal-input" value="${esc(r.garantia || '—')}" readonly>
            </div>
          </div>`;
      }

      card.innerHTML = `
        <div class="modal-header">
          <div>
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
              <span class="badge badge-${esc(r.tipo)}">${tipoLabel(r.tipo)}</span>
              <span class="badge badge-status-${esc(r.status)}">${statusResLabel(r.status)}</span>
              ${r.has_image ? '<span style="font-size:12px;">📷</span>' : ''}
            </div>
            <div class="modal-title">${esc(r.titulo)}</div>
            <div class="modal-subtitle">por <strong>${esc(r.user_nombre)} ${esc(r.user_apellido)}</strong>${r.user_email ? ' · ' + esc(r.user_email) : ''} · ${esc(r.municipio || '—')}</div>
          </div>
          <button class="btn-modal-close" onclick="Admin.closeModalDirect()">
            <i data-lucide="x" style="width:16px;height:16px;"></i>
          </button>
        </div>
        <div class="modal-body">
          <div class="modal-stats-row">
            <div class="modal-stat">
              <span class="modal-stat-label">Categoría</span>
              <span class="modal-stat-value">${esc(r.categoria || '—')}</span>
            </div>
            <div class="modal-stat">
              <span class="modal-stat-label">Municipio</span>
              <span class="modal-stat-value">${esc(r.municipio || '—')}</span>
            </div>
            <div class="modal-stat">
              <span class="modal-stat-label">Publicado</span>
              <span class="modal-stat-value">${formatDateShort(r.created_at)}</span>
            </div>
            ${r.scheduled_at ? `
              <div class="modal-stat">
                <span class="modal-stat-label">Programado</span>
                <span class="modal-stat-value">${formatDateShort(r.scheduled_at)}</span>
              </div>
            ` : ''}
          </div>

          ${extraFields ? `<div class="modal-section-title">Detalles del recurso</div>${extraFields}` : ''}

          <div class="modal-section-title">Editar datos</div>

          <div class="modal-field-group modal-field-full">
            <div class="modal-field">
              <label>Título</label>
              <input class="modal-input" id="rf-titulo" value="${esc(r.titulo)}" placeholder="Título">
            </div>
          </div>
          <div class="modal-field-group modal-field-full">
            <div class="modal-field">
              <label>Descripción</label>
              <textarea class="modal-textarea" id="rf-descripcion" placeholder="Descripción">${esc(r.descripcion)}</textarea>
            </div>
          </div>
          <div class="modal-field-group">
            <div class="modal-field">
              <label>Categoría</label>
              <input class="modal-input" id="rf-categoria" value="${esc(r.categoria)}" placeholder="Categoría">
            </div>
            <div class="modal-field">
              <label>Municipio</label>
              <input class="modal-input" id="rf-municipio" value="${esc(r.municipio)}" placeholder="Municipio">
            </div>
          </div>
          <div class="modal-field-group">
            <div class="modal-field">
              <label>Estado</label>
              <select class="modal-select" id="rf-status">
                <option value="active" ${r.status === 'active' ? 'selected' : ''}>Activo</option>
                <option value="scheduled" ${r.status === 'scheduled' ? 'selected' : ''}>Programado</option>
                <option value="closed" ${r.status === 'closed' ? 'selected' : ''}>Cerrado</option>
              </select>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-secondary" onclick="Admin.closeModalDirect()">Cancelar</button>
          <button class="btn-primary" id="btn-save-resource" onclick="Admin.saveResource('${esc(id)}')">
            <i data-lucide="save" style="width:14px;height:14px;"></i>
            Guardar cambios
          </button>
        </div>
      `;
      if (window.lucide) lucide.createIcons();
    } catch (e) {
      card.innerHTML = `<div class="modal-error">${esc(e.message)}</div>`;
    }
  }

  async function saveResource(id) {
    const btn = document.getElementById('btn-save-resource');
    if (!btn) return;
    btn.disabled = true;
    btn.textContent = 'Guardando…';
    try {
      await apiFetch(`/api/admin/resources/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          titulo: document.getElementById('rf-titulo').value,
          descripcion: document.getElementById('rf-descripcion').value,
          categoria: document.getElementById('rf-categoria').value,
          municipio: document.getElementById('rf-municipio').value,
          status: document.getElementById('rf-status').value,
        }),
      });
      showToast('Publicación actualizada correctamente', 'success');
      closeModalDirect();
      if (_currentTab === 'resources') loadResources();
      if (_currentTab === 'dashboard') loadStats();
    } catch (e) {
      showToast(e.message, 'error');
      btn.disabled = false;
      btn.innerHTML = '<i data-lucide="save" style="width:14px;height:14px;"></i> Guardar cambios';
      if (window.lucide) lucide.createIcons();
    }
  }

  /* ── Agreement modal ── */
  async function openAgreementModal(id) {
    const card = document.getElementById('modal-card');
    card.innerHTML = '<div class="modal-loading"><i data-lucide="loader-2" style="width:24px;height:24px;"></i></div>';
    openModal();
    if (window.lucide) lucide.createIcons();
    try {
      const a = await apiFetch(`/api/admin/agreements/${id}`);

      const reqInitials = ((a.req_nombre?.[0] || '') + (a.req_apellido?.[0] || '')).toUpperCase() || '?';
      const provInitials = ((a.prov_nombre?.[0] || '') + (a.prov_apellido?.[0] || '')).toUpperCase() || '?';

      const hasRatings = a.rating_requester != null || a.rating_provider != null;
      const ratingsHtml = hasRatings ? `
        <div class="modal-section-title">Calificaciones</div>
        <div class="rating-block">
          ${a.rating_requester != null ? `
            <div class="rating-item">
              <div class="rating-by">Calificó ${esc(a.req_nombre)}</div>
              <div class="rating-score">⭐ ${a.rating_requester}<span>/5</span></div>
              ${a.review_requester ? `<div class="rating-review">${esc(a.review_requester)}</div>` : '<div class="rating-review muted">Sin comentario</div>'}
            </div>
          ` : ''}
          ${a.rating_provider != null ? `
            <div class="rating-item">
              <div class="rating-by">Calificó ${esc(a.prov_nombre)}</div>
              <div class="rating-score">⭐ ${a.rating_provider}<span>/5</span></div>
              ${a.review_provider ? `<div class="rating-review">${esc(a.review_provider)}</div>` : '<div class="rating-review muted">Sin comentario</div>'}
            </div>
          ` : ''}
        </div>
      ` : '';

      card.innerHTML = `
        <div class="modal-header">
          <div>
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
              <span class="badge badge-status-${esc(a.status)}">${statusLabel(a.status)}</span>
              ${a.resource_tipo ? `<span class="badge badge-${esc(a.resource_tipo)}">${tipoLabel(a.resource_tipo)}</span>` : ''}
            </div>
            <div class="modal-title">${esc(a.resource_titulo) || 'Acuerdo'}</div>
            <div class="modal-subtitle">${esc(a.resource_categoria || '')}${a.resource_categoria ? ' · ' : ''}${formatDate(a.created_at)}</div>
          </div>
          <button class="btn-modal-close" onclick="Admin.closeModalDirect()">
            <i data-lucide="x" style="width:16px;height:16px;"></i>
          </button>
        </div>
        <div class="modal-body">

          <div class="agreement-parties">
            <div class="party-card">
              <div class="party-avatar">${esc(reqInitials)}</div>
              <div class="party-name">${esc(a.req_nombre)} ${esc(a.req_apellido)}</div>
              <div class="party-role">Solicitante</div>
              ${a.req_email ? `<div class="party-email">${esc(a.req_email)}</div>` : ''}
            </div>
            <div class="party-arrow">
              <i data-lucide="arrow-right" style="width:20px;height:20px;"></i>
            </div>
            <div class="party-card">
              <div class="party-avatar" style="background:var(--field);">${esc(provInitials)}</div>
              <div class="party-name">${esc(a.prov_nombre)} ${esc(a.prov_apellido)}</div>
              <div class="party-role">Proveedor</div>
              ${a.prov_email ? `<div class="party-email">${esc(a.prov_email)}</div>` : ''}
            </div>
          </div>

          <div class="modal-stats-row">
            <div class="modal-stat">
              <span class="modal-stat-label">Mensajes</span>
              <span class="modal-stat-value">💬 ${a.message_count}</span>
            </div>
            <div class="modal-stat">
              <span class="modal-stat-label">Completado por solicitante</span>
              <span class="modal-stat-value">${a.complete_requester ? '✅ Sí' : '⏳ No'}</span>
            </div>
            <div class="modal-stat">
              <span class="modal-stat-label">Completado por proveedor</span>
              <span class="modal-stat-value">${a.complete_provider ? '✅ Sí' : '⏳ No'}</span>
            </div>
            <div class="modal-stat">
              <span class="modal-stat-label">Última actualización</span>
              <span class="modal-stat-value">${formatDateShort(a.updated_at)}</span>
            </div>
          </div>

          ${a.message ? `
            <div class="modal-section-title">Mensaje inicial</div>
            <div class="message-bubble">${esc(a.message)}</div>
          ` : ''}

          ${a.resource_descripcion ? `
            <div class="modal-section-title">Descripción del recurso</div>
            <div class="message-bubble">${esc(a.resource_descripcion)}</div>
          ` : ''}

          ${ratingsHtml}

        </div>
        <div class="modal-footer">
          <button class="btn-secondary" onclick="Admin.closeModalDirect()">Cerrar</button>
        </div>
      `;
      if (window.lucide) lucide.createIcons();
    } catch (e) {
      card.innerHTML = `<div class="modal-error">${esc(e.message)}</div>`;
    }
  }

  /* ── Formatting helpers ── */
  function formatDate(str) {
    if (!str) return '—';
    try {
      const d = new Date(str);
      return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch { return str; }
  }

  function formatDateShort(str) {
    if (!str) return '—';
    try {
      const d = new Date(str);
      return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch { return str; }
  }

  function tipoLabel(tipo) {
    const labels = { oferta: 'Oferta', demanda: 'Demanda', prestamo: 'Préstamo', trueque: 'Trueque' };
    return labels[tipo] || tipo || '—';
  }

  function tipoUserLabel(tipo) {
    const labels = { agricultor: 'Agricultor', proveedor: 'Proveedor', comercializador: 'Comercializador', consumidor: 'Consumidor' };
    return labels[tipo] || tipo || '—';
  }

  function statusLabel(status) {
    const labels = {
      pending: 'Pendiente', active: 'Activo', completed: 'Completado',
      rejected: 'Rechazado', cancelled: 'Cancelado',
    };
    return labels[status] || status || '—';
  }

  function statusResLabel(status) {
    const labels = { active: 'Activo', scheduled: 'Programado', closed: 'Cerrado' };
    return labels[status] || status || '—';
  }

  function esc(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* ── Toast ── */
  function showToast(msg, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = msg;
    container.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  /* ── Init ── */
  function init() {
    if (_token) {
      showApp();
    } else {
      showLogin();
    }

    document.getElementById('login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const pw = document.getElementById('login-password').value;
      if (!pw) return;
      const btn = document.getElementById('login-btn');
      btn.disabled = true;
      btn.textContent = 'Verificando…';
      await login(pw);
      btn.disabled = false;
      btn.textContent = 'Ingresar';
    });

    document.getElementById('login-password').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('login-form').dispatchEvent(new Event('submit'));
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && _modalOpen) closeModalDirect();
    });
  }

  return {
    get token() { return _token; },
    login, logout, init,
    switchTab,
    loadStats, loadUsers, loadResources, loadAgreements,
    deleteUser, deleteResource,
    openUserModal, saveUser,
    openResourceModal, saveResource,
    openAgreementModal,
    closeModal, closeModalDirect,
    startAutoRefresh, stopAutoRefresh,
    formatDate, showToast,
    toggleVerify,
    loadSubscriptions, subAction,
    loadSupport, openTicket, replyTicket, ticketStatus,
    loadConfig, saveConfig,
  };
})();

document.addEventListener('DOMContentLoaded', () => Admin.init());
