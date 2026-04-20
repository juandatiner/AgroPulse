/* AgroPulse Admin Panel JS */
'use strict';

const Admin = (() => {
  let _token = localStorage.getItem('agropulse_admin_token') || '';
  let _currentTab = 'dashboard';
  let _refreshInterval = null;
  let _lastRefresh = null;
  let _refreshTimer = null;

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
    };
    const fn = loaders[_currentTab];
    if (fn) fn();
  }

  /* ── Auto-refresh ── */
  function startAutoRefresh() {
    stopAutoRefresh();
    _refreshInterval = setInterval(() => {
      loadCurrentTab();
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
      <div class="list-item">
        <span class="badge badge-${r.tipo}">${tipoLabel(r.tipo)}</span>
        <span class="list-item-title">${esc(r.titulo)}</span>
        <span class="list-item-sub">${esc(r.user_nombre)}</span>
        <span class="list-item-date">${formatDate(r.created_at)}</span>
      </div>
    `).join('');
  }

  function renderRecentAgreements(items) {
    const el = document.getElementById('recent-agreements-list');
    if (!items.length) { el.innerHTML = '<div class="empty-state">Sin acuerdos recientes</div>'; return; }
    el.innerHTML = items.map(a => `
      <div class="list-item">
        <span class="badge badge-status-${a.status}">${statusLabel(a.status)}</span>
        <span class="list-item-title">${esc(a.resource_titulo || '—')}</span>
        <span class="list-item-sub">${esc(a.req_nombre)} → ${esc(a.prov_nombre)}</span>
        <span class="list-item-date">${formatDate(a.created_at)}</span>
      </div>
    `).join('');
  }

  /* ── Users ── */
  async function loadUsers() {
    const tbody = document.getElementById('users-tbody');
    tbody.innerHTML = '<tr><td colspan="9" class="loading-cell">Cargando…</td></tr>';
    try {
      const users = await apiFetch('/api/admin/users');
      markRefreshed();
      if (!users.length) {
        tbody.innerHTML = '<tr><td colspan="9" class="empty-cell">No hay usuarios</td></tr>';
        return;
      }
      tbody.innerHTML = users.map(u => `
        <tr>
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
          <td>
            <button class="btn-delete" onclick="Admin.deleteUser('${esc(u.id)}', '${esc(u.nombre + ' ' + u.apellido)}')">
              <i data-lucide="trash-2"></i>
            </button>
          </td>
        </tr>
      `).join('');
      if (window.lucide) lucide.createIcons();
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="9" class="error-cell">${esc(e.message)}</td></tr>`;
    }
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
        <tr>
          <td><span class="badge badge-${r.tipo}">${tipoLabel(r.tipo)}</span></td>
          <td>
            <strong>${esc(r.titulo)}</strong>
            ${r.image_data ? '<span class="img-indicator" title="Tiene imagen">📷</span>' : ''}
          </td>
          <td class="td-small">${esc(r.categoria || '—')}</td>
          <td class="td-small">${esc(r.user_nombre)} ${esc(r.user_apellido)}</td>
          <td><span class="badge badge-status-${r.status}">${statusResLabel(r.status)}</span></td>
          <td class="td-small muted">${formatDate(r.created_at)}</td>
          <td>
            <button class="btn-delete" onclick="Admin.deleteResource('${esc(r.id)}', '${esc(r.titulo)}')">
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
    tbody.innerHTML = '<tr><td colspan="5" class="loading-cell">Cargando…</td></tr>';
    try {
      const agreements = await apiFetch('/api/admin/agreements');
      markRefreshed();
      if (!agreements.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="empty-cell">No hay acuerdos</td></tr>';
        return;
      }
      tbody.innerHTML = agreements.map(a => `
        <tr>
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
        </tr>
      `).join('');
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="5" class="error-cell">${esc(e.message)}</td></tr>`;
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

  /* ── Formatting helpers ── */
  function formatDate(str) {
    if (!str) return '—';
    try {
      const d = new Date(str);
      return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
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
  }

  return {
    get token() { return _token; },
    login, logout, init,
    switchTab,
    loadStats, loadUsers, loadResources, loadAgreements,
    deleteUser, deleteResource,
    startAutoRefresh, stopAutoRefresh,
    formatDate, showToast,
  };
})();

document.addEventListener('DOMContentLoaded', () => Admin.init());
