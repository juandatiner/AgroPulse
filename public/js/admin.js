/* AgroPulse Admin Panel JS */
'use strict';

const Admin = (() => {
  let _token = localStorage.getItem('agropulse_admin_token') || '';
  let _currentTab = 'dashboard';
  let _refreshInterval = null;
  let _lastRefresh = null;
  let _refreshTimer = null;
  let _modalOpen = false;

  /* ── DOM helper ── */
  function setHtmlIfChanged(el, html) {
    if (!el) return false;
    if (el.innerHTML !== html) {
      el.innerHTML = html;
      return true;
    }
    return false;
  }

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
    const validTabs = ['dashboard', 'users', 'resources', 'agreements', 'subscriptions', 'support', 'config'];
    let initial = 'dashboard';
    try {
      const saved = localStorage.getItem('agropulse_admin_tab');
      if (saved && validTabs.includes(saved)) initial = saved;
    } catch {}
    switchTab(initial);
    startAutoRefresh();
  }

  /* ── Tabs ── */
  function switchTab(tab) {
    _currentTab = tab;
    try { localStorage.setItem('agropulse_admin_tab', tab); } catch {}
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    const btn = document.querySelector(`.tab-btn[data-tab="${tab}"]`);
    if (btn) btn.classList.add('active');

    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    const panel = document.getElementById(`panel-${tab}`);
    if (panel) panel.classList.add('active');

    loadCurrentTab();
  }

  function loadCurrentTab(silent = false) {
    const loaders = {
      dashboard: loadStats,
      users: loadUsers,
      resources: loadResources,
      agreements: loadAgreements,
      subscriptions: loadSubscriptions,
      support: loadSupport,
      control: loadReports,
      config: loadConfig,
    };
    const fn = loaders[_currentTab];
    if (fn) fn(silent);
    refreshSupportBadge();
    refreshReportsBadge();
  }

  /* ── Auto-refresh ── */
  function startAutoRefresh() {
    stopAutoRefresh();
    _refreshInterval = setInterval(() => {
      if (!_modalOpen) loadCurrentTab(true);
    }, 12000);
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
  async function loadStats(silent = false) {
    try {
      const d = await apiFetch('/api/admin/stats');
      markRefreshed();

      const setText = (id, v) => { const el = document.getElementById(id); if (el && el.textContent !== String(v)) el.textContent = v; };
      setText('stat-online', d.users_online);
      setText('stat-total-users', d.users_total);
      setText('stat-resources-active', d.resources_active);
      setText('stat-agreements-active', d.agreements_active);
      setText('stat-messages-today', d.messages_today);
      setText('stat-agreements-pending', d.agreements_pending);

      renderRecentResources(d.recent_resources || []);
      renderRecentAgreements(d.recent_agreements || []);
      // Charts y mapas (no bloquean stats principales)
      loadChartsAndMaps(silent);
    } catch (e) {
      if (!silent) showToast(e.message, 'error');
    }
  }

  /* ── Charts & maps ── */
  let _chartPeriod = 'daily';
  let _adminUsersMap = null;
  let _adminResourcesMap = null;
  let _adminMapsLoaded = false;
  let _mapPopupClickBound = false;

  function bindMapPopupClick() {
    if (_mapPopupClickBound) return;
    _mapPopupClickBound = true;
    document.addEventListener('click', (e) => {
      const card = e.target.closest('.map-popup-card');
      if (!card) return;
      const action = card.dataset.action;
      const id = card.dataset.id;
      if (!action || !id) return;
      if (action === 'open-user') openUserModal(id);
      else if (action === 'open-resource') openResourceModal(id);
    });
  }

  function setChartPeriod(p) {
    _chartPeriod = p === 'monthly' ? 'monthly' : 'daily';
    document.querySelectorAll('.chart-period-btn').forEach(b => b.classList.toggle('active', b.dataset.cperiod === _chartPeriod));
    loadCharts();
  }

  async function loadChartsAndMaps(silent = false) {
    loadCharts(silent);
    if (!_adminMapsLoaded) {
      _adminMapsLoaded = true;
      // Esperar un tick a que el DOM esté listo
      setTimeout(() => loadMaps(silent), 50);
    } else {
      loadMaps(silent);
    }
  }

  async function loadCharts(silent = false) {
    try {
      const data = await apiFetch(`/api/admin/stats/timeseries?period=${_chartPeriod}`);
      drawBarChart('chart-revenue', data.revenue || [], { color: '#16a34a', formatY: formatMoney, emptyId: 'chart-revenue-empty' });
      drawBarChart('chart-users', data.users || [], { color: '#2563eb', formatY: (v) => String(Math.round(v)), emptyId: 'chart-users-empty' });
      const totEl = document.getElementById('chart-revenue-total');
      const cntEl = document.getElementById('chart-revenue-count');
      const usrEl = document.getElementById('chart-users-total');
      if (totEl) totEl.textContent = formatMoney(data.totals?.revenue || 0);
      if (cntEl) cntEl.textContent = `· ${data.totals?.paid_invoices || 0} pagos`;
      if (usrEl) usrEl.textContent = String(data.totals?.new_users || 0);
    } catch (e) { if (!silent) console.warn('charts error', e); }
  }

  function formatMoney(n) {
    return '$' + Math.round(n || 0).toLocaleString('es-CO');
  }

  function drawBarChart(canvasId, series, opts) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const empty = opts.emptyId ? document.getElementById(opts.emptyId) : null;

    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || 600;
    const cssH = canvas.clientHeight || 220;
    canvas.width = cssW * dpr;
    canvas.height = cssH * dpr;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const padL = 52, padR = 18, padT = 16, padB = 32;
    const chartW = cssW - padL - padR;
    const chartH = cssH - padT - padB;

    const valueOf = (d) => (d.amount !== undefined ? d.amount : d.count);
    const max = Math.max(1, ...series.map(s => valueOf(s)));
    const allZero = series.every(s => valueOf(s) === 0);
    if (empty) empty.style.display = allZero ? 'flex' : 'none';

    // Y axis: ticks adaptativos (4 niveles)
    ctx.fillStyle = '#9ca3af';
    ctx.font = '10px "DM Sans", system-ui, sans-serif';
    const yTicks = [0, 0.25, 0.5, 0.75, 1];
    yTicks.forEach((t, i) => {
      const y = padT + chartH - chartH * t;
      ctx.strokeStyle = i === 0 ? '#d1d5db' : '#f3f4f6';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(cssW - padR, y);
      ctx.stroke();
      const v = max * t;
      const txt = opts.formatY(v);
      ctx.fillText(txt, padL - ctx.measureText(txt).width - 6, y + 3);
    });

    // Barras
    const n = Math.max(1, series.length);
    const barSlot = chartW / n;
    const barW = Math.max(3, Math.min(32, barSlot * 0.62));
    const bars = [];

    series.forEach((d, i) => {
      const v = valueOf(d);
      const h = max > 0 ? (v / max) * chartH : 0;
      const x = padL + i * barSlot + (barSlot - barW) / 2;
      const y = padT + chartH - h;

      // Sombra inferior leve para profundidad
      if (h > 2) {
        ctx.fillStyle = 'rgba(0,0,0,0.04)';
        const r0 = Math.min(5, barW / 2);
        roundRect(ctx, x + 1, y + 2, barW, h, r0);
        ctx.fill();
      }

      // Gradient suave: tope brillante → base translúcida
      const grd = ctx.createLinearGradient(0, y, 0, padT + chartH);
      grd.addColorStop(0, opts.color);
      grd.addColorStop(0.65, opts.color);
      grd.addColorStop(1, opts.color + '55');
      ctx.fillStyle = grd;
      const r = Math.min(5, barW / 2);
      roundRect(ctx, x, y, barW, h, r);
      ctx.fill();

      // Cap top (highlight)
      if (h > 6) {
        ctx.fillStyle = 'rgba(255,255,255,0.22)';
        roundRect(ctx, x, y, barW, Math.min(4, h / 4), r);
        ctx.fill();
      }

      bars.push({ x, y, w: barW, h, slotX: padL + i * barSlot, slotW: barSlot, data: d, value: v });
    });

    // X labels — mostrar cada N para no saturar y clamp para no salir del canvas
    ctx.fillStyle = '#6b7280';
    ctx.font = '10px "DM Sans", system-ui, sans-serif';
    const labelEvery = series.length > 16 ? Math.ceil(series.length / 8) : (series.length > 8 ? 2 : 1);
    series.forEach((d, i) => {
      if (i % labelEvery !== 0 && i !== series.length - 1) return;
      const txt = d.label;
      const w = ctx.measureText(txt).width;
      let x = padL + i * barSlot + barSlot / 2 - w / 2;
      // Clamp: no salir del canvas por la derecha ni por la izquierda
      const minX = padL - 4;
      const maxX = cssW - padR - w + 4;
      if (x < minX) x = minX;
      if (x > maxX) x = maxX;
      ctx.fillText(txt, x, cssH - 10);
    });

    // Guardar para tooltip
    canvas._chartCtx = {
      bars, opts, padL, padT, chartH, cssW, cssH,
      formatY: opts.formatY,
      labelOf: (d) => d.label,
      titleOf: opts.tooltipTitle || ((d) => d.label),
      countOf: opts.tooltipCount,
    };

    // Bind hover + click una sola vez por canvas
    if (!canvas._tooltipBound) {
      canvas._tooltipBound = true;
      const tip = ensureChartTooltip();
      canvas.style.cursor = 'pointer';
      const onMove = (e) => {
        const rect = canvas.getBoundingClientRect();
        const cx = (e.clientX - rect.left) * (canvas.clientWidth / rect.width);
        const cy = (e.clientY - rect.top) * (canvas.clientHeight / rect.height);
        const data = canvas._chartCtx;
        if (!data) return;
        const hovered = data.bars.find(b => cx >= b.slotX && cx < b.slotX + b.slotW);
        if (!hovered || cy > data.padT + data.chartH || cy < data.padT - 10) {
          tip.style.opacity = '0';
          canvas.style.cursor = 'default';
          redrawIfNeeded(canvas, null);
          return;
        }
        const d = hovered.data;
        const valTxt = (d.amount !== undefined) ? data.formatY(d.amount) : String(d.count);
        const countLine = (d.amount !== undefined && d.count !== undefined && d.count > 0) ? `<small>${d.count} ${d.count === 1 ? 'pago' : 'pagos'}</small>` : '';
        const clickHint = (d.amount > 0 || d.count > 0) ? '<small style="display:block;margin-top:4px;opacity:0.7">Click para ver detalle</small>' : '';
        tip.innerHTML = `<strong>${data.titleOf(d)}</strong><div>${valTxt}</div>${countLine}${clickHint}`;
        const wrapRect = canvas.parentElement.getBoundingClientRect();
        tip.style.left = (e.clientX - wrapRect.left + 12) + 'px';
        tip.style.top = (e.clientY - wrapRect.top - 10) + 'px';
        tip.style.opacity = '1';
        canvas.style.cursor = (d.amount > 0 || d.count > 0) ? 'pointer' : 'default';
        redrawIfNeeded(canvas, hovered);
      };
      const onLeave = () => {
        tip.style.opacity = '0';
        canvas.style.cursor = 'default';
        redrawIfNeeded(canvas, null);
      };
      const onClick = (e) => {
        const rect = canvas.getBoundingClientRect();
        const cx = (e.clientX - rect.left) * (canvas.clientWidth / rect.width);
        const cy = (e.clientY - rect.top) * (canvas.clientHeight / rect.height);
        const data = canvas._chartCtx;
        if (!data) return;
        const clicked = data.bars.find(b => cx >= b.slotX && cx < b.slotX + b.slotW);
        if (!clicked) return;
        const d = clicked.data;
        const value = d.amount !== undefined ? d.amount : d.count;
        if (!value || value <= 0) return;
        const type = d.amount !== undefined ? 'revenue' : 'users';
        openBucketDetail(canvasId, type, d);
      };
      canvas.addEventListener('mousemove', onMove);
      canvas.addEventListener('mouseleave', onLeave);
      canvas.addEventListener('click', onClick);
    }
  }

  async function openBucketDetail(chartId, type, bucket) {
    const card = document.getElementById('modal-card');
    if (!card) return;
    openModal();
    card.classList.add('modal-resource-host');
    card.innerHTML = `<div class="modal-loading"><i data-lucide="loader-2" style="width:24px;height:24px"></i></div>`;
    if (window.lucide) lucide.createIcons();
    try {
      const data = await apiFetch(`/api/admin/stats/bucket?period=${_chartPeriod}&type=${type}&key=${encodeURIComponent(bucket.key)}`);
      const items = data.items || [];
      const titleType = type === 'revenue' ? 'Pagos' : 'Usuarios nuevos';
      const subtitle = _chartPeriod === 'daily' ? `Día ${bucket.label}` : `${bucket.label}`;

      let listHtml = '';
      if (!items.length) {
        listHtml = '<div class="empty-cell" style="padding:30px;text-align:center;color:var(--gray500)">Sin items en este bucket</div>';
      } else if (type === 'revenue') {
        listHtml = `<div class="bucket-list">${items.map(i => {
          const date = new Date(i.created_at);
          const time = `${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;
          const tierLbl = i.plan_tier === 'pro' ? 'Pro' : i.plan_tier === 'basic' ? 'Básico' : '';
          return `<div class="bucket-item" onclick="Admin.openUserModal('${esc(i.user_id || '')}')">
            <div class="bucket-item-main">
              <strong>${formatMoney(i.amount)}</strong>
              ${tierLbl ? `<span class="bucket-tier bucket-tier-${esc(i.plan_tier)}">${tierLbl}</span>` : ''}
              ${i.is_upgrade ? '<span class="bucket-tier bucket-tier-upgrade">Upgrade</span>' : ''}
            </div>
            <div class="bucket-item-meta">
              <span><i data-lucide="user" style="width:11px;height:11px"></i> ${esc(i.user_nombre)} ${esc(i.user_apellido)}</span>
              <span><i data-lucide="credit-card" style="width:11px;height:11px"></i> ${esc(i.card_brand)} •••• ${esc(i.card_last4)}</span>
              <span><i data-lucide="clock" style="width:11px;height:11px"></i> ${time}</span>
            </div>
            <div class="bucket-item-ref">${esc(i.reference)}</div>
          </div>`;
        }).join('')}</div>`;
      } else {
        listHtml = `<div class="bucket-list">${items.map(i => {
          const date = new Date(i.created_at);
          const time = `${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;
          const initials = ((i.nombre || '?')[0] + (i.apellido || '?')[0]).toUpperCase();
          return `<div class="bucket-item" onclick="Admin.openUserModal('${esc(i.id)}')">
            <div class="bucket-item-avatar">${initials}</div>
            <div style="flex:1;min-width:0">
              <div class="bucket-item-main">
                <strong>${esc(i.nombre)} ${esc(i.apellido)}</strong>
              </div>
              <div class="bucket-item-meta">
                <span><i data-lucide="mail" style="width:11px;height:11px"></i> ${esc(i.email)}</span>
                ${i.municipio ? `<span><i data-lucide="map-pin" style="width:11px;height:11px"></i> ${esc(i.municipio)}</span>` : ''}
                <span><i data-lucide="clock" style="width:11px;height:11px"></i> ${time}</span>
              </div>
            </div>
            <i data-lucide="chevron-right" style="width:14px;height:14px;color:var(--gray300)"></i>
          </div>`;
        }).join('')}</div>`;
      }

      const summary = type === 'revenue'
        ? `${formatMoney(bucket.amount)} · ${bucket.count} ${bucket.count === 1 ? 'pago' : 'pagos'}`
        : `${bucket.count} ${bucket.count === 1 ? 'usuario' : 'usuarios'} registrados`;

      card.innerHTML = `
        <div class="rd-header">
          <div class="rd-header-info">
            <div class="rd-badges">
              <span class="badge" style="background:#dbeafe;color:#1e40af">${titleType}</span>
              <span class="rd-chip rd-chip-scheduled">${subtitle}</span>
            </div>
            <div class="rd-title">Detalle del bucket</div>
            <div class="rd-meta">${summary} · click cualquier item para abrirlo</div>
          </div>
          <button class="btn-modal-close" onclick="Admin.closeModalDirect()" title="Cerrar">
            <i data-lucide="x" style="width:16px;height:16px;"></i>
          </button>
        </div>
        <div class="rd-body">${listHtml}</div>
      `;
      if (window.lucide) lucide.createIcons();
    } catch (e) {
      card.innerHTML = `<div class="modal-error">${esc(e.message)}</div>`;
    }
  }

  function ensureChartTooltip() {
    let tip = document.getElementById('chart-tooltip');
    if (!tip) {
      tip = document.createElement('div');
      tip.id = 'chart-tooltip';
      tip.className = 'chart-tooltip';
      document.body.appendChild(tip);
    }
    return tip;
  }

  function redrawIfNeeded(canvas, hoveredBar) {
    const data = canvas._chartCtx;
    if (!data || canvas._lastHover === hoveredBar) return;
    canvas._lastHover = hoveredBar;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Dibujar overlay highlight encima de la barra activa
    if (hoveredBar && hoveredBar.h > 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      const r = Math.min(5, hoveredBar.w / 2);
      roundRect(ctx, hoveredBar.x, hoveredBar.y, hoveredBar.w, hoveredBar.h, r);
      ctx.fill();
      // Borde
      ctx.strokeStyle = data.opts.color;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  function roundRect(ctx, x, y, w, h, r) {
    if (h <= 0) return;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  async function loadMaps(silent = false) {
    if (!window.L) return;
    bindMapPopupClick();
    try {
      const [users, resources] = await Promise.all([
        apiFetch('/api/admin/locations?type=users').catch(() => []),
        apiFetch('/api/admin/locations?type=resources').catch(() => []),
      ]);
      renderUsersMap(users || []);
      renderResourcesMap(resources || []);
    } catch (e) { if (!silent) console.warn('maps error', e); }
  }

  function ensureMap(id, ref) {
    const el = document.getElementById(id);
    if (!el) return null;
    if (ref) { ref.invalidateSize(); return ref; }
    const m = L.map(id, { scrollWheelZoom: false, zoomControl: false }).setView([4.5709, -74.2973], 5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
      maxZoom: 18,
    }).addTo(m);
    // Orden: locate arriba, luego zoom (todos abajo a la derecha)
    addLocateControl(m, 'bottomright');
    L.control.zoom({ position: 'bottomright' }).addTo(m);
    return m;
  }

  function addLocateControl(map, position) {
    const Locate = L.Control.extend({
      options: { position: position || 'topleft' },
      onAdd: function() {
        const c = L.DomUtil.create('div', 'leaflet-bar leaflet-control admin-locate-ctrl');
        c.innerHTML = `<a href="#" title="Centrar en mi ubicación" role="button" aria-label="Centrar en mi ubicación">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>
        </a>`;
        L.DomEvent.on(c, 'click', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          if (!navigator.geolocation) { showToast('Tu navegador no soporta geolocalización', 'error'); return; }
          c.classList.add('admin-locate-loading');
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              c.classList.remove('admin-locate-loading');
              const { latitude, longitude } = pos.coords;
              map.setView([latitude, longitude], 12, { animate: true });
              if (map._locateMarker) map.removeLayer(map._locateMarker);
              map._locateMarker = L.circleMarker([latitude, longitude], {
                radius: 8,
                color: '#2563eb',
                fillColor: '#3b82f6',
                fillOpacity: 0.9,
                weight: 3,
              }).addTo(map).bindPopup('<strong>Tu ubicación</strong>').openPopup();
            },
            (err) => {
              c.classList.remove('admin-locate-loading');
              const msg = err.code === 1 ? 'Permiso denegado' : err.code === 2 ? 'Ubicación no disponible' : 'Tiempo agotado';
              showToast(msg, 'error');
            },
            { timeout: 8000, enableHighAccuracy: true }
          );
        });
        L.DomEvent.disableClickPropagation(c);
        return c;
      },
    });
    map.addControl(new Locate());
  }

  function renderUsersMap(users) {
    _adminUsersMap = ensureMap('admin-users-map', _adminUsersMap);
    if (!_adminUsersMap) return;
    if (_adminUsersMap._cluster) _adminUsersMap.removeLayer(_adminUsersMap._cluster);
    const cluster = (window.L && L.markerClusterGroup) ? L.markerClusterGroup() : L.layerGroup();
    users.forEach(u => {
      const marker = L.marker([u.lat, u.lng]);
      const verifiedTxt = u.verified ? ' ✓' : '';
      marker.bindPopup(`
        <div class="map-popup-card" data-action="open-user" data-id="${escapeHtml(u.id)}">
          <strong>${escapeHtml(u.nombre)} ${escapeHtml(u.apellido)}${verifiedTxt}</strong>
          ${u.tipo ? `<small>${escapeHtml(u.tipo)}</small><br>` : ''}
          ${u.municipio ? `<small>📍 ${escapeHtml(u.municipio)}</small><br>` : ''}
          <small>⭐ ${(u.reputation || 5).toFixed(1)}</small>
          <div class="map-popup-cta"><i data-lucide="external-link" style="width:11px;height:11px"></i> Ver detalle del usuario</div>
        </div>
      `);
      cluster.addLayer(marker);
    });
    cluster.addTo(_adminUsersMap);
    _adminUsersMap._cluster = cluster;
    if (users.length) {
      try {
        const bounds = L.latLngBounds(users.map(u => [u.lat, u.lng]));
        _adminUsersMap.fitBounds(bounds, { padding: [30, 30], maxZoom: 8 });
      } catch {}
    }
    const cnt = document.getElementById('map-users-count');
    if (cnt) cnt.textContent = `${users.length} ${users.length === 1 ? 'usuario' : 'usuarios'} con ubicación`;
  }

  const TIPO_COLORS = { oferta: '#2e7d32', solicitud: '#1976d2', prestamo: '#ef6c00', trueque: '#6a1b9a' };
  const TIPO_LBL = { oferta: 'Oferta', solicitud: 'Solicitud', prestamo: 'Préstamo', trueque: 'Trueque' };

  function makeResourceIcon(tipo) {
    const color = TIPO_COLORS[tipo] || '#5C6660';
    return L.divIcon({
      html: `<div class="map-marker-resource tipo-${tipo}" style="background:${color}"><div>${(TIPO_LBL[tipo] || '?')[0]}</div></div>`,
      iconSize: [28, 28],
      className: 'map-marker-resource-wrap',
      iconAnchor: [14, 28],
      popupAnchor: [0, -24],
    });
  }

  function renderResourcesMap(resources) {
    _adminResourcesMap = ensureMap('admin-resources-map', _adminResourcesMap);
    if (!_adminResourcesMap) return;
    if (_adminResourcesMap._cluster) _adminResourcesMap.removeLayer(_adminResourcesMap._cluster);
    const cluster = (window.L && L.markerClusterGroup) ? L.markerClusterGroup() : L.layerGroup();
    resources.forEach(r => {
      const marker = L.marker([r.lat, r.lng], { icon: makeResourceIcon(r.tipo) });
      marker.bindPopup(`
        <div class="map-popup-card" data-action="open-resource" data-id="${escapeHtml(r.id)}">
          <strong>${escapeHtml(r.titulo)}</strong>
          <small style="color:${TIPO_COLORS[r.tipo] || '#5C6660'};font-weight:600">${TIPO_LBL[r.tipo] || r.tipo}</small><br>
          ${r.categoria ? `<small>${escapeHtml(r.categoria)}</small><br>` : ''}
          ${r.municipio ? `<small>📍 ${escapeHtml(r.municipio)}</small><br>` : ''}
          <small style="color:#6b7280">por ${escapeHtml(r.user_nombre)} ${escapeHtml(r.user_apellido)}</small>
          <div class="map-popup-cta"><i data-lucide="external-link" style="width:11px;height:11px"></i> Ver detalle de la publicación</div>
        </div>
      `);
      cluster.addLayer(marker);
    });
    cluster.addTo(_adminResourcesMap);
    _adminResourcesMap._cluster = cluster;
    if (resources.length) {
      try {
        const bounds = L.latLngBounds(resources.map(r => [r.lat, r.lng]));
        _adminResourcesMap.fitBounds(bounds, { padding: [30, 30], maxZoom: 8 });
      } catch {}
    }
    const cnt = document.getElementById('map-resources-count');
    if (cnt) cnt.textContent = `${resources.length} ${resources.length === 1 ? 'publicación' : 'publicaciones'} con ubicación`;
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
  }

  function renderRecentResources(items) {
    const el = document.getElementById('recent-resources-list');
    if (!el) return;
    const html = !items.length
      ? '<div class="empty-state">Sin publicaciones recientes</div>'
      : items.map(r => `
        <div class="list-item list-item-clickable" onclick="Admin.openResourceModal('${esc(r.id)}')">
          <span class="badge badge-${r.tipo}">${tipoLabel(r.tipo)}</span>
          <span class="list-item-title">${esc(r.titulo)}</span>
          <span class="list-item-sub">${esc(r.user_nombre)}</span>
          <span class="list-item-date">${formatDate(r.created_at)}</span>
          <i data-lucide="chevron-right" style="width:14px;height:14px;color:var(--gray300);flex-shrink:0;"></i>
        </div>
      `).join('');
    if (setHtmlIfChanged(el, html) && window.lucide) lucide.createIcons();
  }

  function renderRecentAgreements(items) {
    const el = document.getElementById('recent-agreements-list');
    if (!el) return;
    const html = !items.length
      ? '<div class="empty-state">Sin acuerdos recientes</div>'
      : items.map(a => `
        <div class="list-item list-item-clickable" onclick="Admin.openAgreementModal('${esc(a.id)}')">
          <span class="badge badge-status-${a.status}">${statusLabel(a.status)}</span>
          <span class="list-item-title">${esc(a.resource_titulo || '—')}</span>
          <span class="list-item-sub">${esc(a.req_nombre)} → ${esc(a.prov_nombre)}</span>
          <span class="list-item-date">${formatDate(a.created_at)}</span>
          <i data-lucide="chevron-right" style="width:14px;height:14px;color:var(--gray300);flex-shrink:0;"></i>
        </div>
      `).join('');
    if (setHtmlIfChanged(el, html) && window.lucide) lucide.createIcons();
  }

  /* ── Users ── */
  let _usersCache = [];
  let _usersSearch = '';

  function setUsersSearch(q) {
    _usersSearch = (q || '').trim().toLowerCase();
    renderUsersTable();
  }

  function renderUsersTable() {
    const tbody = document.getElementById('users-tbody');
    if (!tbody) return;
    const q = _usersSearch;
    const filtered = q
      ? _usersCache.filter(u => (u.email || '').toLowerCase().includes(q))
      : _usersCache;
    if (!filtered.length) {
      setHtmlIfChanged(tbody, `<tr><td colspan="11" class="empty-cell">${q ? 'Sin resultados' : 'No hay usuarios'}</td></tr>`);
      return;
    }
    const html = filtered.map(u => renderUserRow(u)).join('');
    if (setHtmlIfChanged(tbody, html) && window.lucide) lucide.createIcons();
  }

  function renderUserRow(u) {
    return `
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
      `;
  }

  async function loadUsers(silent = false) {
    const tbody = document.getElementById('users-tbody');
    if (!silent && !tbody.dataset.loaded) tbody.innerHTML = '<tr><td colspan="11" class="loading-cell">Cargando…</td></tr>';
    try {
      const users = await apiFetch('/api/admin/users');
      markRefreshed();
      tbody.dataset.loaded = '1';
      _usersCache = users;
      renderUsersTable();
    } catch (e) {
      if (!silent) tbody.innerHTML = `<tr><td colspan="11" class="error-cell">${esc(e.message)}</td></tr>`;
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
  let _subsUsers = [];
  let _subsFilter = { status: 'all', q: '' };

  function setSubsFilter(status) {
    _subsFilter.status = status;
    document.querySelectorAll('.subs-filter-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.status === status);
    });
    renderSubsTable();
  }

  function setSubsSearch(q) {
    _subsFilter.q = (q || '').trim().toLowerCase();
    renderSubsTable();
  }

  function renderSubsTable() {
    const tbody = document.getElementById('subs-tbody');
    if (!tbody) return;
    const q = _subsFilter.q;
    const status = _subsFilter.status;
    const filtered = _subsUsers.filter(u => {
      const s = u.subscription_status || 'trial';
      if (status !== 'all' && s !== status) return false;
      if (q && !(u.email || '').toLowerCase().includes(q)) return false;
      return true;
    });

    // Update count badges on filter buttons
    const counts = { all: _subsUsers.length, trial: 0, active: 0, expired: 0, cancelled: 0 };
    _subsUsers.forEach(u => { const s = u.subscription_status || 'trial'; counts[s] = (counts[s] || 0) + 1; });
    document.querySelectorAll('.subs-filter-btn').forEach(b => {
      const cnt = b.querySelector('.subs-filter-count');
      if (cnt) cnt.textContent = counts[b.dataset.status] || 0;
    });

    if (!filtered.length) {
      setHtmlIfChanged(tbody, '<tr><td colspan="6" class="empty-cell">Sin resultados</td></tr>');
      return;
    }
    const tierLabel = (t) => t === 'pro' ? 'Pro' : t === 'basic' ? 'Básico' : t === 'trial' ? 'Prueba Pro' : '—';
    const statusLabel = (s) => s === 'active' ? 'Activa' : s === 'trial' ? 'En prueba' : s === 'expired' ? 'Expirada' : s === 'cancelled' ? 'Cancelada' : s;
    const html = filtered.map(u => {
      const s = u.subscription_status || 'trial';
      const tier = u.plan_tier || (s === 'trial' ? 'trial' : 'none');
      const promoBadge = u.promo_applied ? ` <span class="sub-pill sub-pill-trial" title="Se registró durante una promoción" style="margin-left:4px">PROMO</span>` : '';

      const tierCell = tier === 'none'
        ? `<div class="sub-tier-cell"><span class="muted">—</span><small class="sub-tier-status">${statusLabel(s)}</small></div>`
        : `<div class="sub-tier-cell"><span class="sub-pill sub-pill-${tier}">${tierLabel(tier)}</span><small class="sub-tier-status sub-tier-status-${s}">${statusLabel(s)}</small></div>`;

      const daysLeft = computeDaysLeft(u, s);
      const daysCell = daysLeft === null
        ? '<span class="muted">—</span>'
        : daysLeft === 0
          ? '<span style="color:var(--danger);font-weight:700">0</span>'
          : `<strong>${daysLeft}</strong>`;

      // Fecha de terminación: usa la del estado actual
      let endDate = null;
      if (s === 'active' && u.subscription_end) endDate = u.subscription_end;
      else if (s === 'trial' && u.trial_end) endDate = u.trial_end;
      else if (s === 'expired') endDate = u.subscription_end || u.trial_end;
      const endCell = endDate
        ? `<span class="sub-end-date">${formatDate(endDate)}</span>`
        : '<span class="muted">—</span>';

      return `
      <tr>
        <td><strong>${esc(u.nombre)} ${esc(u.apellido)}</strong>${promoBadge}</td>
        <td class="td-small">${esc(u.email)}</td>
        <td>${tierCell}</td>
        <td class="td-center">${daysCell}</td>
        <td class="td-small muted">${endCell}</td>
        <td class="td-center">
          <div class="sub-actions">
            <button class="sub-btn sub-btn-primary" title="Ver y gestionar suscripción" onclick="Admin.openSubModal('${esc(u.id)}')">
              <i data-lucide="settings-2"></i> Gestionar
            </button>
            <button class="sub-btn sub-btn-danger" title="Quitar suscripción" onclick="Admin.subAction('${esc(u.id)}', 'cancel')">
              <i data-lucide="x-circle"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
    }).join('');
    setHtmlIfChanged(tbody, html);
    if (window.lucide) lucide.createIcons();
  }

  async function loadSubscriptions(silent = false) {
    const tbody = document.getElementById('subs-tbody');
    if (!silent && !tbody.dataset.loaded) tbody.innerHTML = '<tr><td colspan="8" class="loading-cell">Cargando…</td></tr>';
    try {
      const users = await apiFetch('/api/admin/users');
      markRefreshed();
      tbody.dataset.loaded = '1';
      _subsUsers = users;

      // Stats
      const stats = { trial: 0, active: 0, expired: 0, cancelled: 0 };
      users.forEach(u => { stats[u.subscription_status || 'trial'] = (stats[u.subscription_status || 'trial'] || 0) + 1; });
      const grid = document.getElementById('sub-stats-grid');
      const gridHtml = `
        <div class="stat-card"><div class="stat-card-label">En prueba</div><div class="stat-card-value">${stats.trial || 0}</div></div>
        <div class="stat-card highlight"><div class="stat-card-label">Activos (pagando)</div><div class="stat-card-value">${stats.active || 0}</div></div>
        <div class="stat-card amber-card"><div class="stat-card-label">Expirados</div><div class="stat-card-value">${stats.expired || 0}</div></div>
        <div class="stat-card"><div class="stat-card-label">Cancelados</div><div class="stat-card-value">${stats.cancelled || 0}</div></div>
      `;
      setHtmlIfChanged(grid, gridHtml);

      renderSubsTable();
      if (window.lucide) lucide.createIcons();
    } catch (e) {
      if (!silent) setHtmlIfChanged(tbody, `<tr><td colspan="8" class="error-cell">${esc(e.message)}</td></tr>`);
    }
  }

  function computeDaysLeft(u, status) {
    let endStr = null;
    if (status === 'trial') endStr = u.trial_end;
    else if (status === 'active') endStr = u.subscription_end;
    if (!endStr) return null;
    const ms = new Date(endStr).getTime() - Date.now();
    if (!Number.isFinite(ms)) return null;
    return Math.max(0, Math.ceil(ms / 86400000));
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
    else if (action === 'cancel') {
      const ok = await confirmDialog({
        title: 'Quitar suscripción',
        message: '¿Quitar la suscripción de este usuario? Pasa a estado cancelado, plan se limpia y pierde acceso premium al instante.',
        okText: 'Sí, quitar',
        cancelText: 'Volver',
        danger: true,
      });
      if (!ok) return;
      body = { subscription_status: 'cancelled' };
      msg = 'Suscripción quitada';
    }
    try {
      await apiFetch(`/api/admin/users/${userId}/subscription`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      showToast(msg, 'success');
      loadSubscriptions();
      closeModalDirect();
    } catch (e) { showToast(e.message, 'error'); }
  }

  async function grantSub(userId) {
    const tierEl = document.getElementById('grant-tier');
    const daysEl = document.getElementById('grant-days');
    if (!tierEl || !daysEl) return;
    const tier = tierEl.value;
    const days = parseInt(daysEl.value || '0', 10);
    if (tier !== 'basic' && tier !== 'pro') return showToast('Plan inválido', 'error');
    if (!Number.isFinite(days) || days < 1 || days > 3650) return showToast('Días inválidos (1-3650)', 'error');
    const tierLbl = tier === 'pro' ? 'Pro' : 'Básico';
    const ok = await confirmDialog({
      title: `Otorgar plan ${tierLbl}`,
      message: `Se asigna plan ${tierLbl} por ${days} ${days === 1 ? 'día' : 'días'}. Reemplaza cualquier estado actual (trial, cancelado, expirado).`,
      okText: 'Sí, otorgar',
      cancelText: 'Volver',
    });
    if (!ok) return;
    try {
      await apiFetch(`/api/admin/users/${userId}/subscription`, {
        method: 'PATCH',
        body: JSON.stringify({ grant: { tier, days } }),
      });
      showToast(`Plan ${tierLbl} otorgado por ${days} días`, 'success');
      closeModalDirect();
      loadSubscriptions();
    } catch (e) { showToast(e.message, 'error'); }
  }

  async function openSubModal(userId) {
    const card = document.getElementById('modal-card');
    card.innerHTML = '<div class="modal-loading"><i data-lucide="loader-2" style="width:24px;height:24px;"></i></div>';
    openModal();
    if (window.lucide) lucide.createIcons();
    try {
      const sub = await apiFetch(`/api/admin/users/${userId}/subscription`);
      const trialEndStr = sub.trial_end ? formatDate(sub.trial_end) : '—';
      const subEndStr = sub.subscription_end ? formatDate(sub.subscription_end) : '—';
      const tierLbl = sub.plan_tier === 'pro' ? 'Pro'
        : sub.plan_tier === 'basic' ? 'Básico'
        : sub.plan_tier === 'trial' ? 'Prueba (Pro)'
        : '—';
      const pendingBanner = sub.pending_change ? `
          <div class="modal-pending-banner">
            <i data-lucide="calendar-clock" style="width:14px;height:14px"></i>
            Plan agendado: <strong>${sub.pending_change.tier === 'pro' ? 'Pro' : 'Básico'}</strong> arranca cuando termine el actual${sub.pending_change.starts ? ` (${formatDate(sub.pending_change.starts)})` : ''}.
          </div>` : '';
      card.innerHTML = `
        <div class="modal-header">
          <div>
            <div class="modal-title">Suscripción</div>
            <div class="modal-subtitle">Plan: <strong>${tierLbl}</strong> · Estado: <strong>${sub.status}</strong> · ${sub.is_premium ? 'Premium activo' : 'Sin premium'}</div>
          </div>
          <button class="btn-modal-close" onclick="Admin.closeModalDirect()"><i data-lucide="x" style="width:16px;height:16px;"></i></button>
        </div>
        <div class="modal-body">
          ${pendingBanner}
          <div class="modal-stats-row">
            <div class="modal-stat"><span class="modal-stat-label">Trial termina</span><span class="modal-stat-value">${trialEndStr}</span></div>
            <div class="modal-stat"><span class="modal-stat-label">Días trial</span><span class="modal-stat-value">${sub.trial_days_left}</span></div>
            <div class="modal-stat"><span class="modal-stat-label">Sub termina</span><span class="modal-stat-value">${subEndStr}</span></div>
            <div class="modal-stat"><span class="modal-stat-label">Días sub</span><span class="modal-stat-value">${sub.subscription_days_left || 0}</span></div>
            <div class="modal-stat"><span class="modal-stat-label">Posts mes</span><span class="modal-stat-value">${sub.monthly_post_count} / ${sub.free_posts_per_month}</span></div>
          </div>

          <div class="modal-section-title">Editar días del estado actual</div>
          <div class="modal-field-group">
            <div class="modal-field">
              <label>Días (1 a 90)</label>
              <input class="modal-input" id="sub-edit-days" type="number" min="1" max="90" value="${Math.max(1, Math.min(90, sub.trial_days_left || sub.subscription_days_left || 1))}" oninput="Admin.updateDaysPreview(${sub.status === 'active' ? (sub.subscription_days_left || 0) : (sub.trial_days_left || 0)})">
              <small style="color:var(--gray500);font-size:11px">Aplica al trial si está en prueba, o a la sub activa si está pagando. Máximo 3 meses (90 días).</small>
            </div>
          </div>
          <div class="days-change-preview" id="days-change-preview" style="margin-top:14px;padding:12px 14px;background:var(--gray50,#f7f7f7);border-radius:8px;border-left:4px solid var(--harvest);font-size:14px">
            Pasa de <strong>${sub.status === 'active' ? (sub.subscription_days_left || 0) : (sub.trial_days_left || 0)} días</strong> → <strong id="days-preview-new">${Math.max(1, Math.min(90, sub.trial_days_left || sub.subscription_days_left || 1))} días</strong>
          </div>

          <div class="modal-section-title" style="margin-top:22px">Otorgar suscripción manualmente</div>
          <small style="color:var(--gray500);font-size:11px;display:block;margin-bottom:8px">Reemplaza el estado actual (trial / cancelado / expirado) por una suscripción activa con el plan y duración elegidos.</small>
          <div class="modal-field-group" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <div class="modal-field">
              <label>Plan</label>
              <select class="modal-input" id="grant-tier">
                <option value="pro">Pro</option>
                <option value="basic">Básico</option>
              </select>
            </div>
            <div class="modal-field">
              <label>Días (1 a 3650)</label>
              <input class="modal-input" id="grant-days" type="number" min="1" max="3650" value="30">
            </div>
          </div>
          <button class="btn-primary" style="margin-top:10px;width:100%" onclick="Admin.grantSub('${esc(userId)}')">
            <i data-lucide="gift" style="width:14px;height:14px"></i> Otorgar plan
          </button>
        </div>
        <div class="modal-footer">
          <button class="btn-secondary" onclick="Admin.closeModalDirect()">Cerrar</button>
          <button class="quick-btn danger" onclick="Admin.subAction('${esc(userId)}', 'cancel')">🗑 Quitar suscripción</button>
          <button class="btn-primary" onclick="Admin.saveSubDays('${esc(userId)}')"><i data-lucide="save" style="width:14px;height:14px"></i> Guardar días</button>
        </div>
      `;
      if (window.lucide) lucide.createIcons();
    } catch (e) {
      card.innerHTML = `<div class="modal-error">${esc(e.message)}</div>`;
    }
  }

  function openEditDaysModal(userId, name, status, currentDays) {
    const card = document.getElementById('modal-card');
    openModal();
    const cur = (currentDays === null || currentDays === undefined) ? '—' : currentDays;
    const initVal = (currentDays === null || currentDays === undefined) ? 30 : Math.max(1, Math.min(90, currentDays || 30));
    card.innerHTML = `
      <div class="modal-header">
        <div>
          <div class="modal-title">Cambiar días</div>
          <div class="modal-subtitle">${esc(name)} · estado actual: <strong>${esc(status)}</strong></div>
        </div>
        <button class="btn-modal-close" onclick="Admin.closeModalDirect()"><i data-lucide="x" style="width:16px;height:16px;"></i></button>
      </div>
      <div class="modal-body">
        <div class="modal-field-group">
          <div class="modal-field">
            <label>Días (1 a 90)</label>
            <input class="modal-input" id="sub-edit-days" type="number" min="1" max="90" value="${initVal}" oninput="Admin.updateDaysPreview(${cur === '—' ? 'null' : cur})">
            <small style="color:var(--gray500);font-size:11px">Mayor a 0 y máximo 3 meses (90 días). Aplica al trial si estado es trial, o a la suscripción si es activa.</small>
          </div>
        </div>
        <div class="days-change-preview" id="days-change-preview" style="margin-top:14px;padding:12px 14px;background:var(--gray50,#f7f7f7);border-radius:8px;border-left:4px solid var(--harvest);font-size:14px">
          Pasa de <strong>${cur}${cur === '—' ? '' : ' días'}</strong> → <strong id="days-preview-new">${initVal} días</strong>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-secondary" onclick="Admin.closeModalDirect()">Cancelar</button>
        <button class="btn-primary" onclick="Admin.saveSubDays('${esc(userId)}')"><i data-lucide="save" style="width:14px;height:14px"></i> Guardar</button>
      </div>
    `;
    if (window.lucide) lucide.createIcons();
  }

  function updateDaysPreview(currentDays) {
    const input = document.getElementById('sub-edit-days');
    const out = document.getElementById('days-preview-new');
    if (!input || !out) return;
    const v = parseInt(input.value || '0', 10);
    out.textContent = (Number.isFinite(v) && v > 0) ? `${v} ${v === 1 ? 'día' : 'días'}` : '—';
  }

  async function saveSubDays(userId) {
    const input = document.getElementById('sub-edit-days');
    if (!input) return;
    let days = parseInt(input.value || '0', 10);
    if (!Number.isFinite(days) || days < 1 || days > 90) {
      showToast('Los días deben estar entre 1 y 90', 'error');
      return;
    }
    // Determinar si aplicar a trial o a sub activa: traer estado actual
    try {
      const current = await apiFetch(`/api/admin/users/${userId}/subscription`);
      const minutes = days * 24 * 60;
      let body;
      if (current.status === 'active') {
        body = { subscription_end_offset_minutes: minutes, subscription_status: 'active' };
      } else {
        body = { trial_end_offset_minutes: minutes, subscription_status: 'trial' };
      }
      await apiFetch(`/api/admin/users/${userId}/subscription`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      showToast(`Días actualizados a ${days}`, 'success');
      closeModalDirect();
      loadSubscriptions();
    } catch (e) { showToast(e.message, 'error'); }
  }

  /* ── Support tab ── */
  function renderSupportRow(t) {
    return `
      <tr class="clickable-row" onclick="Admin.openTicket('${esc(t.id)}')">
        <td><strong>${esc(t.subject)}</strong>${t.unread_for_admin > 0 ? ` <span class="support-badge">${t.unread_for_admin}</span>` : ''}</td>
        <td class="td-small">${esc(t.user_nombre || '')} ${esc(t.user_apellido || '')}<br><small class="muted">${esc(t.user_email)}</small></td>
        <td><span class="badge badge-status-${t.status}">${t.status}</span></td>
        <td class="td-small muted">${formatDate(t.updated_at)}</td>
        <td class="td-actions">
          <button class="btn-icon btn-view" onclick="event.stopPropagation(); Admin.openTicket('${esc(t.id)}')">
            <i data-lucide="eye"></i>
          </button>
        </td>
      </tr>
    `;
  }

  async function loadSupport(silent = false) {
    const vipT = document.getElementById('support-vip-tbody');
    const norT = document.getElementById('support-normal-tbody');
    if (!silent) {
      if (vipT && !vipT.dataset.loaded) vipT.innerHTML = '<tr><td colspan="5" class="loading-cell">Cargando…</td></tr>';
      if (norT && !norT.dataset.loaded) norT.innerHTML = '<tr><td colspan="5" class="loading-cell">Cargando…</td></tr>';
    }
    try {
      const tickets = await apiFetch('/api/admin/support');
      markRefreshed();
      if (vipT) vipT.dataset.loaded = '1';
      if (norT) norT.dataset.loaded = '1';
      const vip = tickets.filter(t => t.priority === 'priority');
      const normal = tickets.filter(t => t.priority !== 'priority');
      const vipCount = document.getElementById('support-vip-count');
      const norCount = document.getElementById('support-normal-count');
      if (vipCount && vipCount.textContent !== String(vip.length)) vipCount.textContent = vip.length;
      if (norCount && norCount.textContent !== String(normal.length)) norCount.textContent = normal.length;
      let changed = false;
      const vipHtml = vip.length ? vip.map(renderSupportRow).join('') : '<tr><td colspan="5" class="empty-cell">Sin tickets VIP</td></tr>';
      const norHtml = normal.length ? normal.map(renderSupportRow).join('') : '<tr><td colspan="5" class="empty-cell">Sin tickets normales</td></tr>';
      if (setHtmlIfChanged(vipT, vipHtml)) changed = true;
      if (setHtmlIfChanged(norT, norHtml)) changed = true;
      if (changed && window.lucide) lucide.createIcons();
    } catch (e) {
      if (!silent) {
        if (vipT) vipT.innerHTML = `<tr><td colspan="5" class="error-cell">${esc(e.message)}</td></tr>`;
        if (norT) norT.innerHTML = `<tr><td colspan="5" class="error-cell">${esc(e.message)}</td></tr>`;
      }
    }
  }

  let _ticketPollTimer = null;
  function _adminChatTimeStr(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')} · ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  }

  function _adminRenderTicketMessages(t) {
    const msgs = t.messages || [];
    if (!msgs.length) return '<div class="admin-chat-empty">Sin mensajes en este ticket.</div>';
    const userName = t.user ? `${t.user.nombre || ''}` : 'Usuario';
    const userInitial = (userName[0] || 'U').toUpperCase();
    return msgs.map(m => {
      const isAdmin = m.from === 'admin';
      const initial = isAdmin ? 'A' : userInitial;
      return `
        <div class="admin-chat-msg ${isAdmin ? 'admin-chat-msg-admin' : 'admin-chat-msg-user'}">
          <div class="admin-chat-avatar">${initial}</div>
          <div class="admin-chat-bubble">
            <div class="admin-chat-bubble-author">${isAdmin ? 'Soporte' : esc(userName)}</div>
            <div class="admin-chat-bubble-text">${esc(m.message)}</div>
            <div class="admin-chat-bubble-time">${_adminChatTimeStr(m.created_at)}</div>
          </div>
        </div>
      `;
    }).join('');
  }

  async function openTicket(id) {
    try {
      const t = await apiFetch(`/api/admin/support/${id}`);
      const overlay = document.getElementById('modal-overlay');
      const card = document.getElementById('modal-card');
      // Activar overlay correctamente
      overlay.classList.add('active');
      // Modo chat: card sin restricciones de altura/scroll
      card.classList.add('modal-chat-host');
      _modalOpen = true;
      document.body.style.overflow = 'hidden';
      const msgsHtml = _adminRenderTicketMessages(t);
      const userLine = t.user ? `${esc(t.user.nombre)} ${esc(t.user.apellido)}` : 'Usuario';
      const userEmail = t.user ? esc(t.user.email || '') : '';
      const initial = (t.user?.nombre?.[0] || 'U').toUpperCase();
      const priorityCls = t.priority === 'priority' ? 'admin-chat-priority-high' : '';
      const statusLbls = { open: 'Abierto', pending: 'Pendiente', closed: 'Cerrado' };
      const statusLbl = statusLbls[t.status] || t.status;

      card.innerHTML = `
        <div class="admin-chat-modal">
          <div class="admin-chat-header">
            <div class="admin-chat-user">
              <div class="admin-chat-user-avatar">${initial}</div>
              <div class="admin-chat-user-info">
                <strong>${userLine}</strong>
                <small>${userEmail}</small>
              </div>
            </div>
            <div class="admin-chat-meta">
              <span class="admin-chat-pill admin-chat-status-${t.status}">${statusLbl}</span>
              ${t.priority === 'priority' ? `<span class="admin-chat-pill ${priorityCls}"><i data-lucide="zap"></i> Pro</span>` : ''}
              <button class="admin-chat-close-btn" onclick="Admin.closeModalDirect()" title="Cerrar"><i data-lucide="x"></i></button>
            </div>
          </div>
          <div class="admin-chat-subject">
            <i data-lucide="message-square"></i>
            <span>${esc(t.subject)}</span>
          </div>
          <div id="admin-ticket-msgs" class="admin-chat-msgs">${msgsHtml}</div>
          <div class="admin-chat-input-wrap">
            <textarea id="admin-ticket-reply" rows="2" class="admin-chat-input" placeholder="Escribe una respuesta…"
              onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();Admin.replyTicket('${esc(id)}')}"></textarea>
            <button class="admin-chat-send" onclick="Admin.replyTicket('${esc(id)}')" title="Enviar (Enter)">
              <i data-lucide="send"></i>
            </button>
          </div>
          <div class="admin-chat-actions">
            <button class="quick-btn" onclick="Admin.ticketStatus('${esc(id)}', 'pending')"><i data-lucide="clock"></i> Marcar pendiente</button>
            <button class="quick-btn danger" onclick="Admin.ticketStatus('${esc(id)}', 'closed')"><i data-lucide="check-circle"></i> Cerrar ticket</button>
          </div>
        </div>
      `;
      if (window.lucide) lucide.createIcons();
      // Auto-scroll abajo
      const msgsEl = document.getElementById('admin-ticket-msgs');
      if (msgsEl) msgsEl.scrollTop = msgsEl.scrollHeight;
      // Focus en input
      const reply = document.getElementById('admin-ticket-reply');
      if (reply) setTimeout(() => reply.focus(), 100);
      // Polling
      if (_ticketPollTimer) clearInterval(_ticketPollTimer);
      _ticketPollTimer = setInterval(async () => {
        if (!_modalOpen) { clearInterval(_ticketPollTimer); _ticketPollTimer = null; return; }
        try {
          const t2 = await apiFetch(`/api/admin/support/${id}`);
          const ct = document.getElementById('admin-ticket-msgs');
          if (!ct) return;
          const nearBottom = (ct.scrollHeight - ct.scrollTop - ct.clientHeight) < 80;
          const newHtml = _adminRenderTicketMessages(t2);
          if (ct.innerHTML !== newHtml) {
            ct.innerHTML = newHtml;
            if (nearBottom) ct.scrollTop = ct.scrollHeight;
            if (window.lucide) lucide.createIcons();
          }
        } catch { /* ignore */ }
      }, 4000);
    } catch (e) { showToast(e.message, 'error'); }
  }

  async function replyTicket(id) {
    const ta = document.getElementById('admin-ticket-reply');
    const msg = (ta.value || '').trim();
    if (!msg) return showToast('Escribe un mensaje', 'error');
    const sendBtn = document.querySelector('.admin-chat-send');
    if (sendBtn) sendBtn.disabled = true;
    try {
      await apiFetch(`/api/admin/support/${id}`, {
        method: 'POST',
        body: JSON.stringify({ message: msg }),
      });
      ta.value = '';
      ta.style.height = 'auto';
      // Refrescar mensajes inmediatamente sin recargar modal
      const t2 = await apiFetch(`/api/admin/support/${id}`);
      const ct = document.getElementById('admin-ticket-msgs');
      if (ct) {
        ct.innerHTML = _adminRenderTicketMessages(t2);
        ct.scrollTop = ct.scrollHeight;
        if (window.lucide) lucide.createIcons();
      }
      ta.focus();
    } catch (e) { showToast(e.message, 'error'); }
    finally { if (sendBtn) sendBtn.disabled = false; }
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

  /* ── Control / Reports tab ── */
  let _reportsAll = [];
  let _reportsFilter = { status: 'pending', type: 'all' };

  const REPORT_REASON_LABELS = {
    // Publicación
    spam_ad: 'Spam o publicidad engañosa',
    misleading_photo: 'Foto no coincide con lo ofrecido',
    fake_info: 'Información falsa o engañosa',
    unauthorized_sale: 'Venta no autorizada',
    illegal_product: 'Producto peligroso o ilegal',
    misleading_price: 'Precio engañoso',
    duplicate: 'Publicación duplicada',
    inappropriate_content: 'Contenido inapropiado',
    other_resource: 'Otro (publicación)',
    // Usuario
    harassment: 'Acoso o lenguaje violento',
    impersonation: 'Suplantación de identidad',
    fake_account: 'Cuenta falsa o bot',
    fraud_scam: 'Estafa o intento de fraude',
    inappropriate_behavior: 'Comportamiento inapropiado',
    no_show: 'No respondió tras acuerdo',
    abusive_language: 'Lenguaje ofensivo en chat',
    other_user: 'Otro (usuario)',
    // Legacy
    spam: 'Spam o publicidad',
    inappropriate: 'Contenido inapropiado',
    fraud: 'Posible fraude',
    fake: 'Información falsa',
    misleading: 'No coincide con la foto',
    other: 'Otro',
  };
  const REPORT_STATUS_LABELS = {
    pending: 'Pendiente',
    resolved: 'Resuelto',
    // Legacy (reportes antiguos pueden tener estos estados → se muestran como resuelto)
    reviewing: 'Resuelto',
    dismissed: 'Resuelto',
  };

  function normalizeReportStatus(s) {
    return s === 'pending' ? 'pending' : 'resolved';
  }

  function setReportsFilter(s) {
    _reportsFilter.status = s;
    document.querySelectorAll('.reports-filter-btn').forEach(b => b.classList.toggle('active', b.dataset.rstatus === s));
    renderReportsList();
  }
  function setReportsType(t) {
    _reportsFilter.type = t;
    document.querySelectorAll('.reports-type-btn').forEach(b => b.classList.toggle('active', b.dataset.rtype === t));
    renderReportsList();
  }

  async function loadReports(silent = false) {
    const list = document.getElementById('reports-list');
    if (!silent && list) list.innerHTML = '<div class="loading-cell">Cargando reportes…</div>';
    try {
      const reports = await apiFetch('/api/admin/reports');
      markRefreshed();
      _reportsAll = Array.isArray(reports) ? reports : [];
      renderReportsList();
      refreshReportsBadge();
    } catch (e) { if (!silent && list) list.innerHTML = `<div class="error-cell">${esc(e.message)}</div>`; }
  }

  async function refreshReportsBadge() {
    try {
      let pending;
      if (Array.isArray(_reportsAll) && _reportsAll.length) {
        pending = _reportsAll.filter(r => r.status === 'pending').length;
      } else {
        const reports = await apiFetch('/api/admin/reports?status=pending');
        pending = reports.length;
      }
      const badge = document.getElementById('reports-badge');
      if (!badge) return;
      if (pending > 0) { badge.textContent = pending; badge.style.display = 'inline-block'; }
      else badge.style.display = 'none';
    } catch {}
  }

  function renderReportsList() {
    const list = document.getElementById('reports-list');
    if (!list) return;
    const counts = { all: _reportsAll.length, pending: 0, resolved: 0 };
    _reportsAll.forEach(r => { counts[normalizeReportStatus(r.status)] += 1; });
    document.querySelectorAll('.reports-filter-btn').forEach(b => {
      const cnt = b.querySelector('.reports-filter-count');
      if (cnt) cnt.textContent = counts[b.dataset.rstatus] || 0;
    });

    const filtered = _reportsAll.filter(r => {
      const norm = normalizeReportStatus(r.status);
      if (_reportsFilter.status !== 'all' && norm !== _reportsFilter.status) return false;
      if (_reportsFilter.type !== 'all' && r.type !== _reportsFilter.type) return false;
      return true;
    });

    if (!filtered.length) {
      list.innerHTML = '<div class="empty-cell" style="padding:30px;text-align:center;color:var(--gray500)">Sin reportes con estos filtros</div>';
      return;
    }

    list.innerHTML = filtered.map(r => {
      const isResource = r.type === 'resource';
      const tipoIcon = isResource ? 'package' : 'user';
      const tipoLbl = isResource ? 'Publicación' : 'Usuario';
      const targetName = isResource
        ? (r.target_titulo || '(eliminado)')
        : `${r.target_user_nombre || ''} ${r.target_user_apellido || ''}`.trim() || '(eliminado)';
      const reasonLbl = REPORT_REASON_LABELS[r.reason] || r.reason;
      const normStatus = normalizeReportStatus(r.status);
      const statusLbl = REPORT_STATUS_LABELS[normStatus];
      const reporterName = `${r.reporter_nombre || ''} ${r.reporter_apellido || ''}`.trim() || r.reporter_email || '—';
      const dateStr = formatDate(r.created_at);

      return `
        <div class="report-card report-${normStatus}" onclick="Admin.openReportDetail('${esc(r.id)}')">
          <div class="report-head">
            <span class="report-type-pill report-type-${r.type}"><i data-lucide="${tipoIcon}"></i> ${tipoLbl}</span>
            <span class="report-reason-pill">${esc(reasonLbl)}</span>
            <span class="report-status-pill report-status-${normStatus}">${statusLbl}</span>
          </div>
          <div class="report-card-target">
            ${esc(targetName)}
            ${isResource && r.target_resource_status ? `<small>· ${esc(r.target_resource_status)}</small>` : ''}
          </div>
          ${r.description ? `<div class="report-card-desc">${esc(r.description)}</div>` : ''}
          <div class="report-card-meta">
            <span class="report-card-meta-item"><i data-lucide="user"></i> ${esc(reporterName)}</span>
            <span class="report-card-meta-item"><i data-lucide="calendar"></i> ${dateStr}</span>
          </div>
        </div>
      `;
    }).join('');
    if (window.lucide) lucide.createIcons();
  }

  async function openReportDetail(id) {
    const r = _reportsAll.find(x => x.id === id);
    if (!r) return;
    const card = document.getElementById('modal-card');
    if (!card) return;
    openModal();
    card.classList.add('modal-resource-host');

    const isResource = r.type === 'resource';
    const reasonLbl = REPORT_REASON_LABELS[r.reason] || r.reason;
    const normStatus = normalizeReportStatus(r.status);
    const statusLbl = REPORT_STATUS_LABELS[normStatus];
    const reporterName = `${r.reporter_nombre || ''} ${r.reporter_apellido || ''}`.trim() || '—';

    // Preview visual del objeto reportado
    let targetPreview = '';
    if (isResource) {
      const tipo = r.target_resource_tipo || '';
      const tipoLbl = tipoLabel(tipo);
      const status = r.target_resource_status || '';
      const desc = (r.target_resource_descripcion || '').trim();
      const descShort = desc.length > 200 ? desc.slice(0, 198) + '…' : desc;
      const meta = [r.target_resource_categoria, r.target_resource_municipio].filter(Boolean).join(' · ');
      const hasImg = !!r.target_resource_image;
      targetPreview = `
        <div class="report-target-card report-target-resource" onclick="Admin.openResourceModal('${esc(r.target_id)}')" title="Abrir publicación">
          <div class="report-target-media">
            ${hasImg ? `<img src="${r.target_resource_image}" alt="">` : `<div class="report-target-media-empty"><i data-lucide="image-off"></i></div>`}
          </div>
          <div class="report-target-body">
            <div class="report-target-badges">
              ${tipo ? `<span class="badge badge-${esc(tipo)}">${esc(tipoLbl)}</span>` : ''}
              ${status ? `<span class="badge badge-status-${esc(status)}">${esc(status)}</span>` : ''}
              <span class="report-target-go"><i data-lucide="external-link"></i> Abrir</span>
            </div>
            <h3 class="report-target-title">${esc(r.target_titulo || '(eliminado)')}</h3>
            ${meta ? `<div class="report-target-meta">${esc(meta)}</div>` : ''}
            ${descShort ? `<p class="report-target-desc">${esc(descShort)}</p>` : ''}
          </div>
        </div>
      `;
    } else {
      const fullName = `${r.target_user_nombre || ''} ${r.target_user_apellido || ''}`.trim() || '(eliminado)';
      const initials = ((r.target_user_nombre || '?')[0] + (r.target_user_apellido || '?')[0]).toUpperCase();
      const repu = (r.target_user_reputation || 5).toFixed(1);
      const verifiedBadge = r.target_user_verified ? '<span class="report-target-verified" title="Verificado">✓</span>' : '';
      const bio = (r.target_user_bio || '').trim();
      const bioShort = bio.length > 200 ? bio.slice(0, 198) + '…' : bio;
      targetPreview = `
        <div class="report-target-card report-target-user" onclick="Admin.openUserModal('${esc(r.target_id)}')" title="Abrir perfil del usuario">
          <div class="report-target-avatar">${esc(initials)}</div>
          <div class="report-target-body">
            <div class="report-target-badges">
              <span class="report-target-rating">⭐ ${repu}</span>
              ${r.target_user_tipo ? `<span class="report-target-chip">${esc(r.target_user_tipo)}</span>` : ''}
              <span class="report-target-go"><i data-lucide="external-link"></i> Abrir</span>
            </div>
            <h3 class="report-target-title">${esc(fullName)} ${verifiedBadge}</h3>
            <div class="report-target-meta">
              ${r.target_user_email ? `<span><i data-lucide="mail" style="width:11px;height:11px"></i> ${esc(r.target_user_email)}</span>` : ''}
              ${r.target_user_municipio ? `<span><i data-lucide="map-pin" style="width:11px;height:11px"></i> ${esc(r.target_user_municipio)}</span>` : ''}
            </div>
            ${bioShort ? `<p class="report-target-desc">"${esc(bioShort)}"</p>` : ''}
          </div>
        </div>
      `;
    }

    // Acciones simplificadas: solo si está pendiente. Si ya resolvió, mostrar info.
    const isPending = normStatus === 'pending';
    const actionsHtml = isPending ? `
      <div class="report-actions-grid">
        <button class="report-action-btn report-action-correct" onclick="Admin.openCorrectionDialog('${esc(id)}')">
          <i data-lucide="message-circle-warning"></i>
          <div>
            <strong>Enviar mensaje de corrección</strong>
            <small>${isResource ? 'Le avisas al dueño qué corregir' : 'Le envías una advertencia al usuario'}</small>
          </div>
        </button>
        <button class="report-action-btn report-action-dismiss" onclick="Admin.updateReportStatus('${esc(id)}','resolved')">
          <i data-lucide="x-circle"></i>
          <div>
            <strong>Descartar reporte</strong>
            <small>El reporte no aplica, marcar como resuelto</small>
          </div>
        </button>
        ${isResource ? `
          <button class="report-action-btn report-action-delete" onclick="Admin.applyReportSanction('${esc(id)}','delete_resource')">
            <i data-lucide="trash-2"></i>
            <div>
              <strong>Eliminar publicación</strong>
              <small>Borra el recurso permanentemente</small>
            </div>
          </button>
        ` : `
          <button class="report-action-btn report-action-delete" onclick="Admin.confirmDeleteUser('${esc(r.target_id)}','${esc(`${r.target_user_nombre} ${r.target_user_apellido}`)}','${esc(id)}')">
            <i data-lucide="user-x"></i>
            <div>
              <strong>Eliminar usuario</strong>
              <small>Borra la cuenta y todos sus datos</small>
            </div>
          </button>
        `}
      </div>
    ` : `
      <div class="report-resolved-info">
        <i data-lucide="check-circle-2"></i>
        <div>
          <strong>Reporte resuelto</strong>
          <small>Este reporte ya fue gestionado el ${r.resolved_at ? formatDate(r.resolved_at) : '—'}.</small>
        </div>
      </div>
    `;

    card.innerHTML = `
      <div class="rd-header">
        <div class="rd-header-info">
          <div class="rd-badges">
            <span class="badge" style="background:${isResource ? '#dbeafe' : '#fde68a'};color:${isResource ? '#1e40af' : '#92400e'}">
              <i data-lucide="${isResource ? 'package' : 'user'}" style="width:11px;height:11px"></i> ${isResource ? 'Publicación' : 'Usuario'}
            </span>
            <span class="report-status-pill report-status-${normStatus}">${statusLbl}</span>
          </div>
          <div class="rd-title">Reporte de ${isResource ? 'publicación' : 'usuario'}</div>
          <div class="rd-meta">Reportado ${formatDate(r.created_at)}${r.resolved_at ? ` · Resuelto ${formatDate(r.resolved_at)}` : ''}</div>
        </div>
        <button class="btn-modal-close" onclick="Admin.closeModalDirect()" title="Cerrar"><i data-lucide="x" style="width:16px;height:16px"></i></button>
      </div>

      <div class="rd-body">
        <div class="report-reason-highlight">
          <div class="report-reason-label">Motivo del reporte</div>
          <div class="report-reason-value">${esc(reasonLbl)}</div>
        </div>

        <div class="rd-section-title">${isResource ? 'Publicación reportada' : 'Usuario reportado'}</div>
        ${targetPreview}

        ${r.description ? `
          <div class="rd-section-title">Detalles del reportador</div>
          <div class="report-description-box">
            <i data-lucide="quote" style="width:14px;height:14px;color:#92400e;flex-shrink:0;margin-top:2px"></i>
            <div>
              <p>${esc(r.description)}</p>
              <small>— ${esc(reporterName)}${r.reporter_email ? ` · ${esc(r.reporter_email)}` : ''}</small>
            </div>
          </div>
        ` : `
          <div class="rd-section-title">Reportado por</div>
          <div style="font-size:13px;color:var(--gray700)">${esc(reporterName)}<br><small style="color:var(--gray500)">${esc(r.reporter_email || '')}</small></div>
        `}

        <div class="rd-section-title">Notas internas (opcional)</div>
        <textarea id="report-admin-notes" class="modal-input" rows="2" placeholder="Anotación interna para futuro contexto…">${esc(r.admin_notes || '')}</textarea>

        <div class="rd-section-title">Acciones</div>
        ${actionsHtml}
      </div>
    `;
    if (window.lucide) lucide.createIcons();
  }

  function openCorrectionDialog(reportId) {
    const r = _reportsAll.find(x => x.id === reportId);
    if (!r) return;
    const isResource = r.type === 'resource';
    const targetName = isResource
      ? (r.target_titulo || '')
      : `${r.target_user_nombre || ''} ${r.target_user_apellido || ''}`.trim();
    const card = document.getElementById('modal-card');
    if (!card) return;

    const defaultTemplates = isResource ? [
      'Hola, recibimos un reporte sobre tu publicación. Por favor revisa que la foto y descripción coincidan con lo que ofreces.',
      'Hola, tu publicación parece duplicada. Por favor borra las repetidas para mantener la calidad del catálogo.',
      'Hola, el precio o cantidad no es claro. Edita la publicación para incluir esa info.',
    ] : [
      'Hola, recibimos un reporte sobre tu comportamiento en el chat. Por favor mantén un trato respetuoso con la comunidad.',
      'Hola, recibimos un reporte de un acuerdo donde no respondiste. Te recordamos cumplir tus compromisos.',
      'Hola, tu cuenta tiene un reporte por información incompleta. Completa tu perfil para generar más confianza.',
    ];

    card.innerHTML = `
      <div class="rd-header">
        <div class="rd-header-info">
          <div class="rd-badges">
            <span class="badge" style="background:#fef3c7;color:#92400e"><i data-lucide="message-circle-warning" style="width:11px;height:11px"></i> Mensaje de corrección</span>
          </div>
          <div class="rd-title">Aviso para ${esc(targetName || 'el usuario')}</div>
          <div class="rd-meta">Le llega como ticket de soporte de prioridad alta</div>
        </div>
        <button class="btn-modal-close" onclick="Admin.openReportDetail('${esc(reportId)}')" title="Volver"><i data-lucide="arrow-left" style="width:16px;height:16px"></i></button>
      </div>
      <div class="rd-body">
        <div class="rd-section-title">Plantillas rápidas</div>
        <div class="correction-templates">
          ${defaultTemplates.map(t => `<button class="correction-template" onclick="Admin.fillCorrection('${esc(t.replace(/'/g, '\\\''))}')">${esc(t)}</button>`).join('')}
        </div>
        <div class="rd-section-title">Mensaje</div>
        <textarea id="correction-msg" class="modal-input" rows="6" placeholder="Escribe el mensaje que recibirá el usuario…" style="font-size:14px"></textarea>
        <div class="report-modal-actions" style="margin-top:14px">
          <button class="quick-btn" onclick="Admin.openReportDetail('${esc(reportId)}')"><i data-lucide="arrow-left"></i> Volver</button>
          <button class="ra-review" onclick="Admin.sendCorrection('${esc(reportId)}')" style="background:#fef3c7;color:#92400e;border-color:#fcd34d">
            <i data-lucide="send"></i> Enviar y resolver
          </button>
        </div>
      </div>
    `;
    if (window.lucide) lucide.createIcons();
  }

  function fillCorrection(text) {
    const ta = document.getElementById('correction-msg');
    if (ta) { ta.value = text; ta.focus(); }
  }

  async function sendCorrection(reportId) {
    const ta = document.getElementById('correction-msg');
    const msg = (ta?.value || '').trim();
    if (!msg) { showToast('Escribe un mensaje', 'error'); return; }
    if (msg.length < 10) { showToast('El mensaje es muy corto', 'error'); return; }
    const notesEl = document.getElementById('report-admin-notes');
    const admin_notes = notesEl ? notesEl.value : undefined;
    try {
      await apiFetch(`/api/admin/reports/${reportId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: 'resolved',
          sanction: 'send_correction',
          correction_message: msg,
          admin_notes,
        }),
      });
      showToast('Mensaje enviado al usuario', 'success');
      closeModalDirect();
      loadReports();
    } catch (e) { showToast(e.message, 'error'); }
  }

  async function confirmDeleteUser(userId, userName, reportId) {
    const ok = await confirmDialog({
      title: 'Eliminar usuario',
      message: `¿Eliminar a "${userName}" y todos sus datos? Esta acción no se puede deshacer.`,
      okText: 'Sí, eliminar',
      cancelText: 'Volver',
      danger: true,
    });
    if (!ok) return;
    try {
      await apiFetch(`/api/admin/users/${userId}`, { method: 'DELETE' });
      // Marcar reporte como resuelto
      await apiFetch(`/api/admin/reports/${reportId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'resolved' }),
      });
      showToast('Usuario eliminado y reporte resuelto', 'success');
      closeModalDirect();
      loadReports();
    } catch (e) { showToast(e.message, 'error'); }
  }

  async function updateReportStatus(id, status) {
    const notesEl = document.getElementById('report-admin-notes');
    const admin_notes = notesEl ? notesEl.value : undefined;
    try {
      await apiFetch(`/api/admin/reports/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status, admin_notes }),
      });
      showToast('Reporte actualizado', 'success');
      closeModalDirect();
      loadReports();
    } catch (e) { showToast(e.message, 'error'); }
  }

  async function applyReportSanction(id, sanction) {
    const labels = {
      deactivate_resource: 'desactivar la publicación',
      delete_resource: 'ELIMINAR la publicación (no se puede deshacer)',
    };
    const ok = await confirmDialog({
      title: `Aplicar sanción`,
      message: `¿Confirmás ${labels[sanction] || sanction}? El reporte queda como Resuelto.`,
      okText: 'Sí, aplicar',
      cancelText: 'Volver',
      danger: true,
    });
    if (!ok) return;
    const notesEl = document.getElementById('report-admin-notes');
    const admin_notes = notesEl ? notesEl.value : undefined;
    try {
      await apiFetch(`/api/admin/reports/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'resolved', sanction, admin_notes }),
      });
      showToast('Sanción aplicada', 'success');
      closeModalDirect();
      loadReports();
    } catch (e) { showToast(e.message, 'error'); }
  }

  /* ── Config tab ── */
  async function loadConfig(silent = false) {
    try {
      const c = await apiFetch('/api/admin/config');
      markRefreshed();
      const set = (id, v) => {
        const el = document.getElementById(id);
        if (!el) return;
        // Don't clobber while user is editing the field
        if (document.activeElement === el) return;
        if (el.value !== String(v)) el.value = v;
      };
      set('cfg-trial-days', c.trial_days);
      set('cfg-price-basic', c.price_basic ?? c.subscription_price);
      set('cfg-price-pro', c.price_pro ?? 12900);
      set('cfg-free-posts', c.free_posts_per_month);
      set('cfg-basic-max', c.basic_max_posts ?? 20);
      set('cfg-promo-discount', c.promo_discount_percent);
      const promoActive = document.getElementById('cfg-promo-active');
      if (promoActive && document.activeElement !== promoActive && promoActive.checked !== !!c.promo_active) promoActive.checked = !!c.promo_active;
      const promoEnd = document.getElementById('cfg-promo-end');
      if (promoEnd && document.activeElement !== promoEnd) {
        let target = '';
        if (c.promo_end_date) {
          const d = new Date(c.promo_end_date);
          const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
          target = local.toISOString().slice(0, 16);
        }
        if (promoEnd.value !== target) promoEnd.value = target;
      }
    } catch (e) { if (!silent) showToast(e.message, 'error'); }
  }

  async function saveConfig() {
    const getNum = (id) => parseInt((document.getElementById(id) || {}).value || '0', 10);
    const promoEndVal = (document.getElementById('cfg-promo-end') || {}).value || '';
    const payload = {
      trial_days: getNum('cfg-trial-days'),
      price_basic: getNum('cfg-price-basic'),
      price_pro: getNum('cfg-price-pro'),
      subscription_price: getNum('cfg-price-basic'),
      free_posts_per_month: getNum('cfg-free-posts'),
      basic_max_posts: getNum('cfg-basic-max'),
      promo_discount_percent: getNum('cfg-promo-discount'),
      promo_active: !!(document.getElementById('cfg-promo-active') || {}).checked,
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
  async function loadResources(silent = false) {
    const tbody = document.getElementById('resources-tbody');
    if (!silent && !tbody.dataset.loaded) tbody.innerHTML = '<tr><td colspan="7" class="loading-cell">Cargando…</td></tr>';
    try {
      const resources = await apiFetch('/api/admin/resources');
      markRefreshed();
      tbody.dataset.loaded = '1';
      if (!resources.length) {
        setHtmlIfChanged(tbody, '<tr><td colspan="7" class="empty-cell">No hay publicaciones</td></tr>');
        return;
      }
      const html = resources.map(r => `
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
      if (setHtmlIfChanged(tbody, html) && window.lucide) lucide.createIcons();
    } catch (e) {
      if (!silent) tbody.innerHTML = `<tr><td colspan="7" class="error-cell">${esc(e.message)}</td></tr>`;
    }
  }

  /* ── Agreements ── */
  async function loadAgreements(silent = false) {
    const tbody = document.getElementById('agreements-tbody');
    if (!silent && !tbody.dataset.loaded) tbody.innerHTML = '<tr><td colspan="6" class="loading-cell">Cargando…</td></tr>';
    try {
      const agreements = await apiFetch('/api/admin/agreements');
      markRefreshed();
      tbody.dataset.loaded = '1';
      if (!agreements.length) {
        setHtmlIfChanged(tbody, '<tr><td colspan="6" class="empty-cell">No hay acuerdos</td></tr>');
        return;
      }
      const html = agreements.map(a => `
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
      if (setHtmlIfChanged(tbody, html) && window.lucide) lucide.createIcons();
    } catch (e) {
      if (!silent) tbody.innerHTML = `<tr><td colspan="6" class="error-cell">${esc(e.message)}</td></tr>`;
    }
  }

  /* ── Delete actions ── */
  async function deleteUser(id, name) {
    const ok = await confirmDialog({
      title: 'Eliminar usuario',
      message: `¿Eliminar al usuario "${name}" y todos sus datos? Esta acción no se puede deshacer.`,
      okText: 'Eliminar',
      cancelText: 'Cancelar',
      danger: true,
    });
    if (!ok) return;
    try {
      await apiFetch(`/api/admin/users/${id}`, { method: 'DELETE' });
      showToast(`Usuario "${name}" eliminado`, 'success');
      loadUsers();
    } catch (e) {
      showToast(e.message, 'error');
    }
  }

  async function deleteResource(id, title) {
    const ok = await confirmDialog({
      title: 'Eliminar publicación',
      message: `¿Eliminar la publicación "${title}"?`,
      okText: 'Eliminar',
      cancelText: 'Cancelar',
      danger: true,
    });
    if (!ok) return;
    try {
      await apiFetch(`/api/admin/resources/${id}`, { method: 'DELETE' });
      showToast(`Publicación eliminada`, 'success');
      loadResources();
    } catch (e) {
      showToast(e.message, 'error');
    }
  }

  /* ── Confirm dialog ── */
  let _confirmResolve = null;
  function confirmDialog({ title = '¿Confirmar?', message = '', okText = 'Confirmar', cancelText = 'Cancelar', danger = false } = {}) {
    return new Promise((resolve) => {
      _confirmResolve = resolve;
      const overlay = document.getElementById('confirm-overlay');
      const card = overlay.querySelector('.confirm-card');
      card.classList.toggle('danger', !!danger);
      document.getElementById('confirm-title').textContent = title;
      document.getElementById('confirm-message').textContent = message;
      document.getElementById('confirm-ok-btn').textContent = okText;
      document.getElementById('confirm-cancel-btn').textContent = cancelText;
      overlay.classList.add('active');
      document.body.style.overflow = 'hidden';
      if (window.lucide) lucide.createIcons({ nodes: [overlay] });
      setTimeout(() => document.getElementById('confirm-cancel-btn').focus(), 50);
    });
  }
  function confirmOk() { _confirmFinish(true); }
  function confirmCancel(e) {
    if (e && e.target && e.target.id !== 'confirm-overlay' && !e.target.matches('#confirm-cancel-btn')) return;
    _confirmFinish(false);
  }
  function _confirmFinish(value) {
    const overlay = document.getElementById('confirm-overlay');
    overlay.classList.remove('active');
    if (!_modalOpen) document.body.style.overflow = '';
    const r = _confirmResolve;
    _confirmResolve = null;
    if (r) r(value);
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
    const card = document.getElementById('modal-card');
    if (card) {
      card.classList.remove('modal-chat-host');
      card.classList.remove('modal-resource-host');
    }
    if (_ticketPollTimer) { clearInterval(_ticketPollTimer); _ticketPollTimer = null; }
    if (_adminResourceEditMap) { _adminResourceEditMap.remove(); _adminResourceEditMap = null; _adminResourceEditMarker = null; }
    _editingResourceImage = '';
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
  let _editingResourceImage = '';

  async function openResourceModal(id) {
    const card = document.getElementById('modal-card');
    card.innerHTML = '<div class="modal-loading"><i data-lucide="loader-2" style="width:24px;height:24px;"></i></div>';
    openModal();
    card.classList.add('modal-resource-host');
    if (window.lucide) lucide.createIcons();
    try {
      const r = await apiFetch(`/api/admin/resources/${id}`);
      _editingResourceImage = r.image_data || '';

      const initials = ((r.user_nombre || '?')[0] + (r.user_apellido || '?')[0]).toUpperCase();
      const repu = (r.user_reputation || 5).toFixed(1);
      const verifiedBadge = r.user_verified ? ' <span class="rd-verified-tick" title="Verificado">✓</span>' : '';

      const categoriaOptionsHtml = categoriaOptions(r.categoria || '');
      const hasImg = !!r.image_data;
      const hasMap = r.latitude != null && r.longitude != null && Number.isFinite(parseFloat(r.latitude)) && Number.isFinite(parseFloat(r.longitude));

      card.innerHTML = `
        <div class="rd-header">
          <div class="rd-header-info">
            <div class="rd-badges">
              <span class="badge badge-${esc(r.tipo)}">${tipoLabel(r.tipo)}</span>
              <span class="badge badge-status-${esc(r.status)}">${statusResLabel(r.status)}</span>
              ${r.scheduled_at ? `<span class="rd-chip rd-chip-scheduled"><i data-lucide="calendar-clock" style="width:11px;height:11px"></i> Programada</span>` : ''}
            </div>
            <div class="rd-title">${esc(r.titulo || 'Sin título')}</div>
            <div class="rd-meta">${esc(r.categoria || '—')} · ${esc(r.municipio || 'Sin ubicación')} · Publicada ${formatDateShort(r.created_at)}</div>
          </div>
          <button class="btn-modal-close" onclick="Admin.closeModalDirect()" title="Cerrar">
            <i data-lucide="x" style="width:16px;height:16px;"></i>
          </button>
        </div>

        <div class="rd-body">

          <div class="rd-owner-card" onclick="Admin.openUserModal('${esc(r.user_id)}')" title="Ver usuario">
            <div class="rd-owner-avatar">${initials}</div>
            <div class="rd-owner-info">
              <strong>${esc(r.user_nombre)} ${esc(r.user_apellido)}${verifiedBadge}</strong>
              <small>${esc(r.user_tipo || '')}${r.user_municipio ? ' · ' + esc(r.user_municipio) : ''}</small>
              <small>${esc(r.user_email || '')}</small>
            </div>
            <div class="rd-owner-rating">⭐ ${repu}</div>
          </div>

          <div class="rd-media-row">
            <div class="rd-media-block">
              <div class="rd-block-label"><i data-lucide="image" style="width:13px;height:13px"></i> Foto del recurso</div>
              <div class="rd-image-wrap">
                <img id="rf-image-preview" src="${hasImg ? r.image_data : ''}" alt="" style="${hasImg ? '' : 'display:none'}">
                <div id="rf-image-empty" class="rd-image-empty" style="${hasImg ? 'display:none' : ''}">
                  <i data-lucide="image-off" style="width:32px;height:32px"></i>
                  <span>Sin foto</span>
                </div>
              </div>
              <div class="rd-image-actions">
                <button class="sub-btn sub-btn-primary" onclick="document.getElementById('rf-image-input').click()">
                  <i data-lucide="upload"></i> ${hasImg ? 'Cambiar' : 'Subir'} foto
                </button>
                ${hasImg ? `<button class="sub-btn sub-btn-danger" onclick="Admin.clearResourceImage()">
                  <i data-lucide="trash-2"></i> Quitar
                </button>` : ''}
                <input type="file" id="rf-image-input" accept="image/*" style="display:none" onchange="Admin.handleResourceImageUpload(this)">
              </div>
            </div>

            <div class="rd-media-block">
              <div class="rd-block-label"><i data-lucide="map-pin" style="width:13px;height:13px"></i> Ubicación</div>
              <div id="rf-map" class="rd-map" ${hasMap ? '' : 'style="display:none"'}></div>
              <div id="rf-map-empty" class="rd-image-empty" style="${hasMap ? 'display:none' : 'height:160px'}">
                <i data-lucide="map-off" style="width:32px;height:32px"></i>
                <span>Sin coordenadas</span>
              </div>
              <div class="rd-coord-row">
                <div class="modal-field" style="flex:1">
                  <label>Latitud</label>
                  <input class="modal-input" id="rf-lat" value="${r.latitude ?? ''}" placeholder="4.5709">
                </div>
                <div class="modal-field" style="flex:1">
                  <label>Longitud</label>
                  <input class="modal-input" id="rf-lng" value="${r.longitude ?? ''}" placeholder="-74.2973">
                </div>
              </div>
              <div class="rd-image-actions">
                <button class="sub-btn" onclick="Admin.applyResourceCoords()">
                  <i data-lucide="check"></i> Aplicar coordenadas
                </button>
                ${hasMap ? `<button class="sub-btn sub-btn-danger" onclick="Admin.clearResourceCoords()">
                  <i data-lucide="trash-2"></i> Quitar
                </button>` : ''}
              </div>
            </div>
          </div>

          <div class="rd-section-title">Datos principales</div>
          <div class="modal-field-group">
            <div class="modal-field">
              <label>Tipo</label>
              <select class="modal-select" id="rf-tipo">
                <option value="oferta" ${r.tipo === 'oferta' ? 'selected' : ''}>Oferta</option>
                <option value="solicitud" ${r.tipo === 'solicitud' ? 'selected' : ''}>Solicitud</option>
                <option value="prestamo" ${r.tipo === 'prestamo' ? 'selected' : ''}>Préstamo</option>
                <option value="trueque" ${r.tipo === 'trueque' ? 'selected' : ''}>Trueque</option>
              </select>
            </div>
            <div class="modal-field">
              <label>Estado</label>
              <select class="modal-select" id="rf-status">
                <option value="active" ${r.status === 'active' ? 'selected' : ''}>Activo</option>
                <option value="scheduled" ${r.status === 'scheduled' ? 'selected' : ''}>Programado</option>
                <option value="closed" ${r.status === 'closed' ? 'selected' : ''}>Cerrado</option>
              </select>
            </div>
          </div>
          <div class="modal-field-group modal-field-full">
            <div class="modal-field">
              <label>Título</label>
              <input class="modal-input" id="rf-titulo" value="${esc(r.titulo)}" placeholder="Título">
            </div>
          </div>
          <div class="modal-field-group modal-field-full">
            <div class="modal-field">
              <label>Descripción</label>
              <textarea class="modal-textarea" id="rf-descripcion" rows="4" placeholder="Descripción">${esc(r.descripcion)}</textarea>
            </div>
          </div>
          <div class="modal-field-group">
            <div class="modal-field">
              <label>Categoría</label>
              <select class="modal-select" id="rf-categoria">${categoriaOptionsHtml}</select>
            </div>
            <div class="modal-field">
              <label>Municipio</label>
              <input class="modal-input" id="rf-municipio" value="${esc(r.municipio)}" placeholder="Municipio">
            </div>
          </div>

          <div class="rd-section-title">Detalles del recurso</div>
          <div class="modal-field-group">
            <div class="modal-field">
              <label>Cantidad</label>
              <input class="modal-input" id="rf-cantidad" value="${esc(r.cantidad || '')}" placeholder="Ej: 100">
            </div>
            <div class="modal-field">
              <label>Unidad</label>
              <input class="modal-input" id="rf-unidad" value="${esc(r.unidad || '')}" placeholder="kg, bultos, hectárea…">
            </div>
          </div>
          <div class="modal-field-group">
            <div class="modal-field">
              <label>Condición</label>
              <input class="modal-input" id="rf-condicion" value="${esc(r.condicion || '')}" placeholder="Buen estado, Nuevo, Usado…">
            </div>
            <div class="modal-field">
              <label>Disponibilidad</label>
              <input class="modal-input" id="rf-disponibilidad" value="${esc(r.disponibilidad || '')}" placeholder="Inmediata, Esta semana…">
            </div>
          </div>
          <div class="modal-field-group">
            <div class="modal-field">
              <label>Modalidad</label>
              <input class="modal-input" id="rf-modalidad" value="${esc(r.modalidad || '')}" placeholder="Pago, Gratis, Trueque…">
            </div>
            <div class="modal-field">
              <label>Precio referencia</label>
              <input class="modal-input" id="rf-precio" value="${esc(r.precio_referencia || '')}" placeholder="$50.000 / día">
            </div>
          </div>
          ${(r.tipo === 'prestamo' || r.duracion_prestamo) ? `
          <div class="modal-field-group">
            <div class="modal-field">
              <label>Duración del préstamo</label>
              <input class="modal-input" id="rf-duracion" value="${esc(r.duracion_prestamo || '')}" placeholder="3 días, 1 semana…">
            </div>
            <div class="modal-field">
              <label>Garantía / condiciones devolución</label>
              <input class="modal-input" id="rf-garantia" value="${esc(r.garantia || '')}" placeholder="Se devuelve limpio…">
            </div>
          </div>
          ` : `
          <input type="hidden" id="rf-duracion" value="${esc(r.duracion_prestamo || '')}">
          <input type="hidden" id="rf-garantia" value="${esc(r.garantia || '')}">
          `}
          ${(r.tipo === 'trueque' || r.ofrece || r.recibe) ? `
          <div class="modal-field-group">
            <div class="modal-field">
              <label>Ofrece (trueque)</label>
              <input class="modal-input" id="rf-ofrece" value="${esc(r.ofrece || '')}" placeholder="Lo que ofrece a cambio">
            </div>
            <div class="modal-field">
              <label>Recibe (trueque)</label>
              <input class="modal-input" id="rf-recibe" value="${esc(r.recibe || '')}" placeholder="Lo que desea recibir">
            </div>
          </div>
          ` : `
          <input type="hidden" id="rf-ofrece" value="${esc(r.ofrece || '')}">
          <input type="hidden" id="rf-recibe" value="${esc(r.recibe || '')}">
          `}
          <div class="modal-field-group modal-field-full">
            <div class="modal-field">
              <label>Cómo llegar / referencias</label>
              <textarea class="modal-textarea" id="rf-location-notes" rows="2" placeholder="Indicaciones de cómo llegar, referencias del lugar…">${esc(r.location_notes || '')}</textarea>
            </div>
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn-secondary" onclick="Admin.closeModalDirect()">Cancelar</button>
          <button class="quick-btn danger" onclick="Admin.deleteResource('${esc(id)}')" style="margin-right:auto">
            <i data-lucide="trash-2" style="width:13px;height:13px"></i> Eliminar
          </button>
          <button class="btn-primary" id="btn-save-resource" onclick="Admin.saveResource('${esc(id)}')">
            <i data-lucide="save" style="width:14px;height:14px;"></i>
            Guardar cambios
          </button>
        </div>
      `;
      if (window.lucide) lucide.createIcons();

      // Inicializar mapa si hay coords
      if (hasMap) initResourceMapEdit(parseFloat(r.latitude), parseFloat(r.longitude));
    } catch (e) {
      card.innerHTML = `<div class="modal-error">${esc(e.message)}</div>`;
    }
  }

  let _adminResourceEditMap = null;
  let _adminResourceEditMarker = null;

  function initResourceMapEdit(lat, lng) {
    const el = document.getElementById('rf-map');
    if (!el || !window.L) return;
    // Reset map (modal se reabre)
    if (_adminResourceEditMap) { _adminResourceEditMap.remove(); _adminResourceEditMap = null; }
    _adminResourceEditMap = L.map(el, { scrollWheelZoom: false }).setView([lat, lng], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap', maxZoom: 18,
    }).addTo(_adminResourceEditMap);
    _adminResourceEditMarker = L.marker([lat, lng], { draggable: true }).addTo(_adminResourceEditMap);
    _adminResourceEditMarker.on('dragend', (e) => {
      const p = e.target.getLatLng();
      const latI = document.getElementById('rf-lat');
      const lngI = document.getElementById('rf-lng');
      if (latI) latI.value = p.lat.toFixed(6);
      if (lngI) lngI.value = p.lng.toFixed(6);
    });
    _adminResourceEditMap.on('click', (e) => {
      _adminResourceEditMarker.setLatLng(e.latlng);
      const latI = document.getElementById('rf-lat');
      const lngI = document.getElementById('rf-lng');
      if (latI) latI.value = e.latlng.lat.toFixed(6);
      if (lngI) lngI.value = e.latlng.lng.toFixed(6);
    });
    setTimeout(() => _adminResourceEditMap?.invalidateSize(), 100);
  }

  function applyResourceCoords() {
    const lat = parseFloat(document.getElementById('rf-lat')?.value);
    const lng = parseFloat(document.getElementById('rf-lng')?.value);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      showToast('Lat/Lng inválidos', 'error');
      return;
    }
    document.getElementById('rf-map').style.display = '';
    document.getElementById('rf-map-empty').style.display = 'none';
    initResourceMapEdit(lat, lng);
    showToast('Coordenadas aplicadas (recordá guardar)', 'success');
  }

  function clearResourceCoords() {
    document.getElementById('rf-lat').value = '';
    document.getElementById('rf-lng').value = '';
    if (_adminResourceEditMap) { _adminResourceEditMap.remove(); _adminResourceEditMap = null; _adminResourceEditMarker = null; }
    const m = document.getElementById('rf-map'); if (m) m.style.display = 'none';
    const e = document.getElementById('rf-map-empty'); if (e) e.style.display = '';
  }

  function handleResourceImageUpload(input) {
    const file = input.files && input.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { showToast('Imagen muy grande (máx 5MB)', 'error'); return; }
    const reader = new FileReader();
    reader.onload = (e) => {
      _editingResourceImage = e.target.result;
      const img = document.getElementById('rf-image-preview');
      const empty = document.getElementById('rf-image-empty');
      if (img) { img.src = _editingResourceImage; img.style.display = ''; }
      if (empty) empty.style.display = 'none';
      showToast('Foto cargada (recordá guardar)', 'success');
    };
    reader.readAsDataURL(file);
  }

  function clearResourceImage() {
    _editingResourceImage = '';
    const img = document.getElementById('rf-image-preview');
    const empty = document.getElementById('rf-image-empty');
    if (img) { img.src = ''; img.style.display = 'none'; }
    if (empty) empty.style.display = '';
  }

  async function saveResource(id) {
    const btn = document.getElementById('btn-save-resource');
    if (!btn) return;
    btn.disabled = true;
    btn.textContent = 'Guardando…';
    const val = (i) => (document.getElementById(i) ? document.getElementById(i).value : '');
    const lat = (document.getElementById('rf-lat')?.value || '').trim();
    const lng = (document.getElementById('rf-lng')?.value || '').trim();
    try {
      await apiFetch(`/api/admin/resources/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          tipo: val('rf-tipo'),
          titulo: val('rf-titulo'),
          descripcion: val('rf-descripcion'),
          categoria: val('rf-categoria'),
          municipio: val('rf-municipio'),
          status: val('rf-status'),
          modalidad: val('rf-modalidad'),
          cantidad: val('rf-cantidad'),
          unidad: val('rf-unidad'),
          condicion: val('rf-condicion'),
          disponibilidad: val('rf-disponibilidad'),
          precio_referencia: val('rf-precio'),
          duracion_prestamo: val('rf-duracion'),
          garantia: val('rf-garantia'),
          ofrece: val('rf-ofrece'),
          recibe: val('rf-recibe'),
          location_notes: val('rf-location-notes'),
          image_data: _editingResourceImage,
          latitude: lat === '' ? null : parseFloat(lat),
          longitude: lng === '' ? null : parseFloat(lng),
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

  function categoriaOptions(selected) {
    const groups = {
      'Herramientas y equipos': ['Herramientas y maquinaria','Riego y sistemas de agua','Energía (solar, generadores)','Transporte y logística','Empaque y almacenamiento'],
      'Insumos agrícolas': ['Semillas e insumos','Fertilizantes y abonos','Compost y abono orgánico','Control de plagas','Viveros y plántulas'],
      'Producción': ['Frutas y verduras','Granos y cereales','Hortalizas','Tubérculos','Ganadería','Aves de corral','Productos lácteos','Miel y apicultura','Excedentes de producción','Cosecha y postcosecha'],
      'Servicios y conocimiento': ['Mano de obra','Asesoría técnica','Capacitación y cursos','Tierra en arriendo'],
    };
    const sel = selected || '';
    let html = `<option value="" ${!sel ? 'selected' : ''}>Seleccionar categoría...</option>`;
    for (const [label, items] of Object.entries(groups)) {
      html += `<optgroup label="${esc(label)}">`;
      for (const it of items) {
        html += `<option value="${esc(it)}" ${it === sel ? 'selected' : ''}>${esc(it)}</option>`;
      }
      html += `</optgroup>`;
    }
    html += `<option value="Otros recursos" ${sel === 'Otros recursos' ? 'selected' : ''}>Otros recursos</option>`;
    // Si la categoría actual no está en la lista, añadirla para no perderla
    const all = Object.values(groups).flat().concat(['Otros recursos']);
    if (sel && !all.includes(sel)) {
      html += `<option value="${esc(sel)}" selected>${esc(sel)} (custom)</option>`;
    }
    return html;
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
              <span class="modal-stat-label">Creado</span>
              <span class="modal-stat-value">${formatDateShort(a.created_at)}</span>
            </div>
            <div class="modal-stat">
              <span class="modal-stat-label">Última actualización</span>
              <span class="modal-stat-value">${formatDateShort(a.updated_at)}</span>
            </div>
          </div>

          ${a.cancel_reason ? `
            <div class="modal-section-title">Motivo de cancelación</div>
            <div class="message-bubble" style="border-left:3px solid #c0392b;background:#fbeaea">
              <strong>${a.cancelled_by_nombre ? esc(a.cancelled_by_nombre) + ':' : 'Cancelado:'}</strong>
              ${esc(a.cancel_reason)}
            </div>
          ` : ''}

          ${a.resource_descripcion ? `
            <div class="modal-section-title">Descripción del recurso</div>
            <div class="message-bubble">${esc(a.resource_descripcion)}</div>
          ` : ''}

          <div class="modal-section-title">Chat del acuerdo (${a.message_count || 0})</div>
          <div class="agr-chat-log" style="max-height:45vh;overflow-y:auto;padding:8px;background:var(--gray50);border-radius:8px;display:flex;flex-direction:column;gap:8px">
            ${(a.messages || []).length ? a.messages.map(m => {
              const mine = m.sender_id === a.requester_id;
              const side = mine ? 'flex-start' : 'flex-end';
              const bg = mine ? '#f3f4f6' : '#e8f1ff';
              return `<div style="align-self:${side};max-width:80%;background:${bg};border-radius:10px;padding:8px 10px">
                <div style="font-size:11px;color:var(--gray500);margin-bottom:2px"><strong>${esc((m.sender_nombre || '') + ' ' + (m.sender_apellido || ''))}</strong> · ${formatDate(m.created_at)}</div>
                <div style="font-size:13px;white-space:pre-wrap;word-break:break-word">${esc(m.content)}</div>
              </div>`;
            }).join('') : '<div class="empty-state">Sin mensajes en el chat</div>'}
          </div>

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
    handleResourceImageUpload, clearResourceImage, applyResourceCoords, clearResourceCoords,
    openAgreementModal,
    closeModal, closeModalDirect,
    confirmDialog, confirmOk, confirmCancel,
    startAutoRefresh, stopAutoRefresh,
    formatDate, showToast,
    toggleVerify,
    loadSubscriptions, subAction, grantSub, openSubModal, openEditDaysModal, saveSubDays, updateDaysPreview,
    setSubsFilter, setSubsSearch,
    setUsersSearch,
    loadSupport, openTicket, replyTicket, ticketStatus,
    loadReports, setReportsFilter, setReportsType, openReportDetail, updateReportStatus, applyReportSanction,
    openCorrectionDialog, fillCorrection, sendCorrection, confirmDeleteUser,
    setChartPeriod,
    loadConfig, saveConfig,
  };
})();

document.addEventListener('DOMContentLoaded', () => Admin.init());
