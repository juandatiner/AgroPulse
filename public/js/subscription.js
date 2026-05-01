const Subscription = {
    state: null,
    lastState: null,

    isPremium() { return !!(this.state && this.state.is_premium); },
    isPro() { return !!(this.state && this.state.is_pro); },
    isBlocked() { return !!(this.state && this.state.needs_payment); },

    _tierRank(t) { return t === 'pro' ? 2 : (t === 'basic' ? 1 : 0); },
    // Calcula cobro de upgrade (mejorar a tier mayor) prorrateado por días restantes.
    // Retorna null si no aplica (sin sub activa, mismo tier, o downgrade).
    _computeUpgradeCost(targetTier) {
        const s = this.state || {};
        if (!s.is_premium || s.status !== 'active') return null;
        const curTier = s.plan_tier;
        if (curTier !== 'basic' && curTier !== 'pro') return null;
        if (this._tierRank(targetTier) <= this._tierRank(curTier)) return null;
        const curPrice = curTier === 'pro' ? (s.price_pro || 0) : (s.price_basic || 0);
        const tgtPrice = targetTier === 'pro' ? (s.price_pro || 0) : (s.price_basic || 0);
        const daysLeft = Math.max(0, s.subscription_days_left || 0);
        const charged = Math.max(0, Math.round((tgtPrice - curPrice) * (daysLeft / 30)));
        return { charged, days_left: daysLeft, full_price: tgtPrice, from: curTier, to: targetTier };
    },

    async refresh() {
        try {
            this.state = await API.getSubscription();
            this.renderBanner();
            this.renderHomeCards();
            this.renderAds();
            this.updateVerifiedBadge();
            this._updateAdTop();
            if (typeof App !== 'undefined' && App.updateMapLockUI) App.updateMapLockUI();
            this._maybeShowTrimOverlay();
            return this.state;
        } catch (e) {
            return null;
        }
    },

    _maybeShowTrimOverlay() {
        const s = this.state;
        if (!s || !s.must_trim_active) return;
        const existing = document.getElementById('trim-overlay');
        if (existing && existing.classList.contains('visible')) return;
        this.openTrimOverlay();
    },

    _trimSelected: new Set(),
    async openTrimOverlay() {
        const s = this.state || {};
        const limit = s.free_active_limit || 3;
        const userId = (typeof API !== 'undefined' && API.user) ? API.user.id : null;
        if (!userId) return;
        this._trimSelected = new Set();
        this._openOverlay('trim-overlay', `
            <div class="trim-overlay-inner">
                <div class="trim-header">
                    <div class="trim-icon"><i data-lucide="alert-triangle"></i></div>
                    <h2>Tu suscripción terminó</h2>
                    <p class="trim-sub">Sin plan activo solo puedes tener <strong>${limit} publicaciones activas</strong>. Selecciona cuáles conservar; el resto se eliminarán. O reanuda tu plan para mantener todas.</p>
                </div>
                <div class="trim-counter" id="trim-counter">Seleccionadas: <strong>0</strong> / ${limit}</div>
                <div id="trim-list" class="trim-list">
                    <div class="empty-state"><i data-lucide="loader"></i><p>Cargando publicaciones...</p></div>
                </div>
                <div class="trim-actions">
                    <button class="btn btn-cancel btn-full" onclick="Subscription.openPlans()">
                        <i data-lucide="credit-card"></i> Reanudar plan y conservar todas
                    </button>
                    <button id="trim-confirm" class="btn btn-primary btn-full" disabled onclick="Subscription.confirmTrim()">
                        <i data-lucide="check"></i> Conservar seleccionadas y eliminar resto
                    </button>
                </div>
            </div>
        `);
        try {
            const list = await API.getResources({ owner: userId });
            const active = (list || []).filter(r => r.status === 'active');
            const container = document.getElementById('trim-list');
            if (!container) return;
            if (active.length === 0) {
                container.innerHTML = '<div class="empty-state"><p>No tienes publicaciones activas.</p></div>';
                this._closeOverlay('trim-overlay');
                return;
            }
            container.innerHTML = active.map(r => `
                <label class="trim-item" data-id="${r.id}">
                    <input type="checkbox" value="${r.id}" onchange="Subscription._toggleTrim(this)">
                    <div class="trim-item-body">
                        ${r.image_data ? `<img class="trim-thumb" src="${r.image_data}" alt="">` : `<div class="trim-thumb trim-thumb-empty"><i data-lucide="image"></i></div>`}
                        <div class="trim-item-text">
                            <strong>${this._esc(r.titulo || '')}</strong>
                            <span>${this._esc(r.tipo || '')} · ${this._esc(r.categoria || '')}</span>
                            <small>${this._esc(r.municipio || '')}</small>
                        </div>
                    </div>
                </label>
            `).join('');
            if (window.lucide) lucide.createIcons();
        } catch (e) {
            const container = document.getElementById('trim-list');
            if (container) container.innerHTML = '<div class="empty-state"><p>Error al cargar.</p></div>';
        }
    },

    _toggleTrim(input) {
        const limit = (this.state && this.state.free_active_limit) || 3;
        const id = input.value;
        if (input.checked) {
            if (this._trimSelected.size >= limit) {
                input.checked = false;
                if (typeof App !== 'undefined') App.showToast(`Máximo ${limit} publicaciones`, 'error');
                return;
            }
            this._trimSelected.add(id);
        } else {
            this._trimSelected.delete(id);
        }
        const counter = document.getElementById('trim-counter');
        if (counter) counter.innerHTML = `Seleccionadas: <strong>${this._trimSelected.size}</strong> / ${limit}`;
        const btn = document.getElementById('trim-confirm');
        if (btn) btn.disabled = this._trimSelected.size === 0;
    },

    async confirmTrim() {
        const ids = Array.from(this._trimSelected);
        const btn = document.getElementById('trim-confirm');
        if (btn) { btn.disabled = true; btn.classList.add('loading'); }
        try {
            const res = await API.trimResources(ids);
            this.state = res.subscription || this.state;
            this._closeOverlay('trim-overlay');
            if (typeof App !== 'undefined') {
                App.showToast(`Se eliminaron ${res.deleted || 0} publicaciones`);
                if (App.loadMyResources) App.loadMyResources();
                if (App.loadHome) App.loadHome();
            }
            this.refresh();
        } catch (e) {
            if (btn) { btn.disabled = false; btn.classList.remove('loading'); }
            if (typeof App !== 'undefined') App.showToast(e.message || 'Error al eliminar', 'error');
        }
    },

    // ========== Banner promo (top de la app) ==========
    ensureBannerNode() {
        if (document.getElementById('promo-banner')) return;
        const app = document.getElementById('screen-app');
        if (!app) return;
        const nav = app.querySelector('.app-nav');
        const banner = document.createElement('div');
        banner.id = 'promo-banner';
        banner.className = 'promo-banner hidden';
        banner.onclick = () => Subscription.openPlans();
        if (nav && nav.parentNode) {
            nav.parentNode.insertBefore(banner, nav.nextSibling);
        }
    },

    renderBanner() {
        this.ensureBannerNode();
        const el = document.getElementById('promo-banner');
        if (!el || !this.state) return;
        const s = this.state;

        let countdown = '';
        let mainText = '';
        let ctaText = 'Ver suscripción';
        let urgentDays = Infinity;
        let endTs = null;
        let useRotator = false;
        const discount = s.promo_discount_percent || 50;
        const dayLbl = (n) => n === 1 ? 'día' : 'días';

        if (s.status === 'active') {
            // Aviso de límite Básico: si está al 80%+ del tope mensual, mostrar banner promocionando Pro.
            const isBasic = s.plan_tier === 'basic';
            const used = s.monthly_post_count || 0;
            const max = s.basic_max_posts || 0;
            const ratio = (isBasic && max > 0) ? used / max : 0;
            const showBasicLimit = isBasic && max > 0 && ratio >= 0.8;
            const daysLeft = s.subscription_days_left || 0;

            if (!showBasicLimit && daysLeft > 10) { el.classList.add('hidden'); return; }

            if (showBasicLimit) {
                ctaText = 'Mejorar a Pro';
                const remaining = Math.max(0, max - used);
                if (remaining === 0) {
                    countdown = `🚜 Llegaste al tope: <strong>${used} / ${max}</strong> publicaciones este mes en plan Básico`;
                    mainText = ` <span class="promo-grab">Mejora a Pro y publica sin límites.</span>`;
                } else {
                    countdown = `📊 Has usado <strong>${used} / ${max}</strong> publicaciones del plan Básico`;
                    mainText = ` <span class="promo-grab">Te quedan ${remaining}. Pasa a Pro para no parar.</span>`;
                }
                urgentDays = remaining === 0 ? 0 : (remaining <= 2 ? 1 : 5);
            } else {
                urgentDays = daysLeft;
                endTs = s.subscription_end ? new Date(s.subscription_end).getTime() : null;
                ctaText = 'Renovar';
                if (daysLeft === 1 && endTs) {
                    countdown = `⏳ Tu suscripción termina en ${this.leafCountdown(endTs)}`;
                } else if (daysLeft > 0) {
                    countdown = `⏳ Tu suscripción termina en <strong>${daysLeft} ${dayLbl(daysLeft)}</strong>`;
                } else {
                    countdown = `⏳ Tu suscripción termina hoy`;
                }
            }
        } else if (s.status === 'trial' && s.trial_days_left > 0) {
            urgentDays = s.trial_days_left;
            endTs = s.trial_end ? new Date(s.trial_end).getTime() : null;
            ctaText = 'Suscribirme';
            if (s.trial_days_left === 1 && endTs) {
                countdown = `🎁 Tu prueba termina en ${this.leafCountdown(endTs)}`;
            } else {
                countdown = `🎁 Tu prueba termina en <strong>${s.trial_days_left} ${dayLbl(s.trial_days_left)}</strong>`;
            }
            useRotator = true;
            this._setupBannerPlans(s);
            const tag = s.promo_active ? `<span class="promo-tag">${discount}% OFF</span> ` : '';
            countdown = `${countdown}<span class="promo-banner-sep"> · </span>`;
            mainText = `${tag}<span class="promo-rotator" data-idx="0">${this._planRotText(this._bannerPlans[0])}</span> <span class="promo-grab">¡Aprovéchalo!</span>`;
        } else {
            // sin suscripción (expired, trial 0, o sin trial) → rotador de planes
            useRotator = true;
            ctaText = 'Ver suscripciones';
            this._setupBannerPlans(s);
            const tag = s.promo_active ? `<span class="promo-tag">${discount}% OFF</span> ` : '';
            mainText = `${tag}<span class="promo-rotator" data-idx="0">${this._planRotText(this._bannerPlans[0])}</span> <span class="promo-grab">¡Aprovéchalo!</span>`;
        }

        // Cerrado en sesión actual → ocultar (excepto si bloqueado por urgencia)
        const cantClose = urgentDays < 3;
        try {
            if (!cantClose && sessionStorage.getItem('agropulse_promo_banner_closed') === '1') {
                el.classList.add('hidden');
                return;
            }
        } catch {}
        el.classList.remove('hidden');

        const closeBtn = cantClose ? '' : `<button class="promo-banner-close" onclick="event.stopPropagation(); Subscription.closeBanner()" aria-label="Cerrar banner"><i data-lucide="x"></i></button>`;

        el.classList.toggle('promo-banner-locked', cantClose);
        el.innerHTML = `
            <div class="promo-banner-figs promo-banner-figs-left" aria-hidden="true">
                <span>🌱</span><span>🌾</span><span>🚜</span><span>🌻</span>
            </div>
            <div class="promo-banner-figs promo-banner-figs-right" aria-hidden="true">
                <span>🌿</span><span>🥕</span><span>🍅</span><span>🌽</span>
            </div>
            <div class="promo-banner-inner">
                <span class="promo-banner-text">${countdown ? `<span class="promo-banner-countdown">${countdown}</span>` : ''}${mainText}</span>
                <button class="promo-banner-cta"><span class="promo-banner-cta-label">${ctaText}</span> <i data-lucide="chevron-right"></i></button>
            </div>
            ${closeBtn}
        `;
        if (window.lucide) lucide.createIcons();
        this.startLeafTimer();
        if (useRotator) this.startPlanRotator(); else if (this._planTimer) { clearInterval(this._planTimer); this._planTimer = null; }
        this._updateAdTop();
    },

    _updateAdTop() {
        const nav = document.querySelector('.app-nav');
        const banner = document.getElementById('promo-banner');
        const navH = nav ? nav.offsetHeight : 64;
        const bannerH = (banner && !banner.classList.contains('hidden') && banner.offsetHeight) ? banner.offsetHeight : 0;
        document.body.style.setProperty('--ad-top', (navH + bannerH) + 'px');
    },

    _launchFireworks(burstCount = 5, particlesPerBurst = 22) {
        let layer = document.getElementById('fireworks-layer');
        if (!layer) {
            layer = document.createElement('div');
            layer.id = 'fireworks-layer';
            document.body.appendChild(layer);
        }
        const colors = ['#ff5e62','#ffd166','#06d6a0','#118ab2','#ff9966','#c8962a','#e8b84b','#ef476f'];
        for (let b = 0; b < burstCount; b++) {
            setTimeout(() => {
                const cx = 10 + Math.random() * 80;
                const cy = 10 + Math.random() * 60;
                const burst = document.createElement('div');
                burst.className = 'firework-burst';
                burst.style.left = cx + 'vw';
                burst.style.top = cy + 'vh';
                for (let i = 0; i < particlesPerBurst; i++) {
                    const p = document.createElement('span');
                    p.className = 'firework-particle';
                    const angle = (Math.PI * 2 * i) / particlesPerBurst;
                    const dist = 60 + Math.random() * 60;
                    p.style.setProperty('--dx', Math.cos(angle) * dist + 'px');
                    p.style.setProperty('--dy', Math.sin(angle) * dist + 'px');
                    p.style.background = colors[Math.floor(Math.random() * colors.length)];
                    p.style.animationDelay = (Math.random() * 0.05) + 's';
                    burst.appendChild(p);
                }
                layer.appendChild(burst);
                setTimeout(() => burst.remove(), 1400);
            }, b * 220);
        }
    },

    _planRotText(p) {
        return `Plan <strong>${p.label}</strong>: <s>${p.reg}</s> ahora <strong>${p.now}</strong>/mes`;
    },

    _setupBannerPlans(s) {
        const basicReg = this.formatPrice(s.price_basic_regular || s.price_basic || 7900);
        const basicNow = this.formatPrice(s.price_basic || 7900);
        const proReg = this.formatPrice(s.price_pro_regular || s.price_pro || 12900);
        const proNow = this.formatPrice(s.price_pro || 12900);
        this._bannerPlans = [
            { label: 'Básico', reg: basicReg, now: basicNow },
            { label: 'Pro', reg: proReg, now: proNow },
        ];
    },

    startPlanRotator() {
        if (this._planTimer) { clearInterval(this._planTimer); this._planTimer = null; }
        if (!this._bannerPlans || this._bannerPlans.length < 2) return;
        let idx = 0;
        this._planTimer = setInterval(() => {
            const node = document.querySelector('#promo-banner .promo-rotator');
            if (!node || !this._bannerPlans) { clearInterval(this._planTimer); this._planTimer = null; return; }
            idx = (idx + 1) % this._bannerPlans.length;
            node.classList.remove('rot-in');
            node.classList.add('rot-out');
            setTimeout(() => {
                node.innerHTML = this._planRotText(this._bannerPlans[idx]);
                node.dataset.idx = String(idx);
                node.classList.remove('rot-out');
                node.classList.add('rot-in');
            }, 280);
        }, 4500);
    },

    leafCountdown(endTs) {
        return `<span class="promo-leaf-countdown" data-end="${endTs}">`
            + `<span class="leaf-unit"><span class="leaf-num" data-u="h">--</span><span class="leaf-lbl">h</span></span>`
            + `<span class="leaf-sep">🍃</span>`
            + `<span class="leaf-unit"><span class="leaf-num" data-u="m">--</span><span class="leaf-lbl">m</span></span>`
            + `<span class="leaf-sep">🍃</span>`
            + `<span class="leaf-unit"><span class="leaf-num" data-u="s">--</span><span class="leaf-lbl">s</span></span>`
            + `</span>`;
    },

    startLeafTimer() {
        if (this._leafTimer) { clearInterval(this._leafTimer); this._leafTimer = null; }
        const root = document.querySelector('#promo-banner .promo-leaf-countdown');
        if (!root) return;
        const tick = () => {
            const node = document.querySelector('#promo-banner .promo-leaf-countdown');
            if (!node) { clearInterval(this._leafTimer); this._leafTimer = null; return; }
            const end = parseInt(node.dataset.end, 10);
            let diff = Math.max(0, Math.floor((end - Date.now()) / 1000));
            const h = Math.floor(diff / 3600); diff -= h * 3600;
            const m = Math.floor(diff / 60);
            const sec = diff - m * 60;
            const setNum = (u, v) => {
                const el = node.querySelector(`.leaf-num[data-u="${u}"]`);
                if (!el) return;
                const txt = String(v).padStart(2, '0');
                if (el.textContent !== txt) {
                    el.textContent = txt;
                    el.classList.remove('flip');
                    void el.offsetWidth;
                    el.classList.add('flip');
                }
            };
            setNum('h', h); setNum('m', m); setNum('s', sec);
            if (end - Date.now() <= 0) {
                clearInterval(this._leafTimer);
                this._leafTimer = null;
                Subscription.refresh();
            }
        };
        tick();
        this._leafTimer = setInterval(tick, 1000);
    },

    closeBanner() {
        const el = document.getElementById('promo-banner');
        if (el) el.classList.add('hidden');
        try { sessionStorage.setItem('agropulse_promo_banner_closed', '1'); } catch {}
        this._updateAdTop();
        this.renderAds();
    },

    // ========== Home cards: trial progreso + posts remaining ==========
    renderHomeCards() {
        const host = document.getElementById('panel-inicio');
        if (!host) return;
        let card = document.getElementById('sub-home-card');
        if (!this.state) return;
        const s = this.state;
        // Pro: sin límite → no mostrar card. Basic: mostrar contador. Trial vigente: ocultar.
        if (s.status === 'active' && s.plan_tier === 'pro') { if (card) card.remove(); return; }
        if (s.status === 'trial' && s.trial_days_left > 0) { if (card) card.remove(); return; }

        if (!card) {
            card = document.createElement('div');
            card.id = 'sub-home-card';
            card.className = 'sub-home-card';
            const hero = host.querySelector('.home-hero');
            if (hero) host.insertBefore(card, hero.nextSibling);
            else host.insertBefore(card, host.firstChild);
        }

        let statusText = '';
        let statusClass = '';
        let bodyHtml = '';

        const isBasic = s.plan_tier === 'basic' && s.status === 'active';
        const used = s.monthly_post_count;
        const total = isBasic ? s.basic_max_posts : s.free_posts_per_month;
        const remaining = s.posts_remaining;
        const pct = Math.min(100, Math.round((used / Math.max(1, total)) * 100));
        const wordPub = (n) => n === 1 ? 'publicación' : 'publicaciones';
        const limitHint = remaining > 0
            ? (isBasic
                ? `Te quedan <strong>${remaining}</strong> ${wordPub(remaining)} este mes`
                : `Te quedan <strong>${remaining}</strong> ${wordPub(remaining)} gratuitas este mes`)
            : (isBasic
                ? `Alcanzaste el límite del Básico. Mejora a Pro para publicar sin límite`
                : `Alcanzaste el límite mensual. Suscríbete para publicar sin límite`);

        if (isBasic) {
            statusText = 'Plan Básico';
            statusClass = 'sub-card-basic';
        } else if (s.status === 'expired') {
            statusText = 'Tu prueba gratuita terminó';
            statusClass = 'sub-card-expired';
        } else {
            statusText = 'Plan gratuito';
            statusClass = 'sub-card-free';
        }
        bodyHtml = `
            <div class="sub-posts-line">
                <span>Publicaciones de este mes</span>
                <span class="sub-posts-count"><strong>${used}</strong> / ${total}</span>
            </div>
            <div class="sub-posts-bar"><div class="sub-posts-fill" style="width:${pct}%"></div></div>
            <p class="sub-home-card-hint">${limitHint}</p>
        `;

        const ctaLabel = isBasic ? 'Mejorar a Pro' : (s.status === 'expired' ? 'Suscribirme' : 'Mejorar plan');
        card.className = 'sub-home-card ' + statusClass;
        card.innerHTML = `
            <div class="sub-home-card-head">
                <div class="sub-home-card-title">
                    <i data-lucide="sparkles"></i>
                    <span>${statusText}</span>
                </div>
                <button class="sub-home-card-action" onclick="Subscription.openPlans()">${ctaLabel}</button>
            </div>
            <div class="sub-home-card-body">${bodyHtml}</div>
        `;
        if (window.lucide) lucide.createIcons();
    },

    // ========== Ads simulados (free only) ==========
    _ADS: [
        { id: 'tractores', icon: '🚜', title: 'Tractores Boyacá', text: 'Renta diaria desde $80.000', cta: 'Ver más',
          long: 'Tractores modernos con operador incluido. Servicio puerta a puerta en Boyacá, Cundinamarca y Santander. Tarifas por jornada, semana o temporada.', phone: '300 123 4567' },
        { id: 'semillas', icon: '🌱', title: 'Semillas certificadas', text: 'Variedades resistentes a plagas', cta: 'Comprar',
          long: 'Semillas certificadas por el ICA: papa, maíz, frijol y hortalizas resistentes a plagas. Entrega en finca con asesoría técnica incluida.', phone: '310 555 7890' },
        { id: 'suelos', icon: '🧪', title: 'Análisis de suelos', text: 'Laboratorio con 24h de entrega', cta: 'Cotizar',
          long: 'Análisis completo: pH, nutrientes mayores y menores, textura y materia orgánica. Informe con recomendaciones técnicas en 24 horas.', phone: '320 741 8520' },
        { id: 'feria', icon: '🐄', title: 'Feria ganadera', text: 'Tunja · 15 de octubre', cta: 'Info',
          long: 'Gran feria ganadera de Boyacá: subastas lecheras y de carne, remate de sementales, charlas técnicas y maquinaria. Entrada gratuita.', phone: '301 234 5678' },
        { id: 'credito', icon: '💰', title: 'Crédito rural', text: 'Tasa preferencial 1.2% mensual', cta: 'Aplicar',
          long: 'Créditos agropecuarios con periodo de gracia. Desde $2M hasta $100M. Aprobación en 48h. Requiere cédula y certificado predial.', phone: '018000-AGRO' },
        { id: 'riego', icon: '💧', title: 'Riego por goteo', text: 'Ahorra 60% de agua', cta: 'Cotizar',
          long: 'Sistemas de riego por goteo diseñados para tu cultivo y terreno. Kits completos con instalación incluida. Financiación hasta 12 meses sin intereses.', phone: '311 456 7890' },
        { id: 'capacitacion', icon: '🎓', title: 'Curso SENA gratis', text: 'Buenas prácticas agrícolas', cta: 'Inscribirme',
          long: 'Curso virtual certificado por el SENA en buenas prácticas agrícolas (BPA). 40 horas, inicio cada mes. Certificado válido para comercialización.', phone: '800-SENA' },
        { id: 'veterinario', icon: '🐑', title: 'Veterinario rural', text: 'Visita a finca $50.000', cta: 'Agendar',
          long: 'Servicio veterinario a domicilio para ganado, ovinos, caprinos y aves. Vacunación, desparasitación y diagnóstico. Disponible fines de semana.', phone: '315 222 3344' },
        { id: 'abono', icon: '🌾', title: 'Abono orgánico Certificado', text: 'Bulto 50kg desde $38.000', cta: 'Comprar',
          long: 'Abono orgánico certificado para cultivos orgánicos y convencionales. Fabricado con residuos vegetales compostados y enriquecido con micorrizas.', phone: '320 111 2233' },
        { id: 'maquila', icon: '⚙️', title: 'Servicio de maquila', text: 'Molienda y empaque', cta: 'Info',
          long: 'Maquila de granos: molienda, selección, tostado y empaque al vacío. Planta con registro INVIMA. Ideal para pequeños productores sin infraestructura.', phone: '310 999 8877' },
        { id: 'seguro', icon: '🛡️', title: 'Seguro de cosecha', text: 'Protege tu inversión', cta: 'Cotizar',
          long: 'Seguro agrícola subsidiado hasta 80% por FINAGRO. Cubre granizo, inundación, sequía y plagas. Para todos los cultivos transitorios y permanentes.', phone: '018000-FNGR' },
    ],

    _slotPositions: {
        inicio: 'right',
        mercado: 'right',
        publicar: 'right',
        intercambios: 'right',
        perfil: 'right',
    },
    // Mobile (≤520px): tipo de slot por panel
    _mobileSlot: {
        inicio: 'sticky',
        mercado: 'sticky',
        publicar: 'sticky',
        intercambios: 'sticky',
        perfil: 'sticky',
    },
    _adRotationIdx: 0,
    _adRotationTimer: null,

    _isMobileAds() { return window.matchMedia('(max-width: 520px)').matches; },

    // HTML para una tarjeta sponsored (in-feed o nativa móvil)
    adCardHtml(idx = 0) {
        const ad = this._ADS[((this._adRotationIdx + idx) % this._ADS.length + this._ADS.length) % this._ADS.length];
        return `
            <div class="ad-infeed" onclick="Subscription.openAdCard('${ad.id}')">
                <span class="ad-infeed-tag">Publicidad</span>
                <div class="ad-infeed-body">
                    <div class="ad-infeed-icon">${ad.icon}</div>
                    <div class="ad-infeed-text">
                        <strong>${this._esc(ad.title)}</strong>
                        <span>${this._esc(ad.text)}</span>
                    </div>
                    <button class="ad-infeed-cta" onclick="event.stopPropagation(); Subscription.openAdCard('${ad.id}')">${this._esc(ad.cta)}</button>
                </div>
            </div>
        `;
    },

    // Intercala una tarjeta cada N items en un array de HTML strings (solo móvil + free)
    injectInFeed(itemsHtmlArr, every = 5) {
        if (this.isPro() || !this._isMobileAds()) return itemsHtmlArr.join('');
        const out = [];
        let adIdx = 0;
        for (let i = 0; i < itemsHtmlArr.length; i++) {
            out.push(itemsHtmlArr[i]);
            if ((i + 1) % every === 0 && i < itemsHtmlArr.length - 1) {
                out.push(this.adCardHtml(adIdx++));
            }
        }
        return out.join('');
    },

    renderAds() {
        const panels = ['inicio', 'mercado', 'publicar', 'intercambios', 'perfil'];
        const cleanupPanel = (p) => {
            const host = document.getElementById('panel-' + p);
            const old = document.getElementById('sub-ads-slot-' + p);
            if (old) old.remove();
            if (host) host.classList.remove('panel-with-right-ad');
        };
        if (this.isPro()) {
            panels.forEach(cleanupPanel);
            document.querySelectorAll('[id^="sub-ads-sticky"]').forEach(el => el.remove());
            const legacy = document.getElementById('sub-ads-bar');
            if (legacy) legacy.remove();
            document.body.classList.remove('has-right-ad');
            if (this._adRotationTimer) { clearInterval(this._adRotationTimer); this._adRotationTimer = null; }
            return;
        }
        document.body.classList.toggle('has-right-ad', !this._isMobileAds());
        const legacy = document.getElementById('sub-ads-bar');
        if (legacy) legacy.remove();

        const isMobile = this._isMobileAds();
        document.querySelectorAll('[id^="sub-ads-sticky"]').forEach(el => el.remove());

        panels.forEach((panelName, idx) => {
            const host = document.getElementById('panel-' + panelName);
            if (!host) return;
            const slotId = 'sub-ads-slot-' + panelName;
            let slot = document.getElementById(slotId);
            if (slot) { slot.remove(); slot = null; }
            host.classList.remove('panel-with-right-ad');

            if (isMobile) {
                const kind = this._mobileSlot[panelName];
                if (kind === 'skip') return; // in-feed lo maneja app.js
                if (kind === 'sticky') {
                    const stickyEl = document.createElement('div');
                    stickyEl.id = 'sub-ads-sticky-' + panelName;
                    stickyEl.className = 'sub-ads-sticky';
                    stickyEl.innerHTML = `
                        <button class="sub-ads-sticky-close" aria-label="Cerrar publicidad" onclick="event.stopPropagation(); this.parentElement.remove();"><i data-lucide="x"></i></button>
                        ${this.adCardHtml(idx)}
                    `;
                    host.appendChild(stickyEl);
                    if (window.lucide) lucide.createIcons({ nodes: [stickyEl] });
                    return;
                }
                slot = document.createElement('div');
                slot.id = slotId;
                slot.className = 'sub-ads-slot sub-ads-mobile-native';
                if (kind === 'native-end') {
                    host.appendChild(slot);
                } else {
                    const hero = host.querySelector('.home-hero');
                    if (hero && hero.nextSibling) host.insertBefore(slot, hero.nextSibling);
                    else host.insertBefore(slot, host.firstChild);
                }
                slot.innerHTML = this.adCardHtml(idx);
                return;
            }

            // Desktop: sidebar derecho (lógica original)
            const position = this._slotPositions[panelName] || 'top';
            slot = document.createElement('div');
            slot.id = slotId;
            slot.className = 'sub-ads-slot sub-ads-slot-' + position;
            if (position === 'right') {
                host.classList.add('panel-with-right-ad');
                host.insertBefore(slot, host.firstChild);
            } else {
                if (position === 'bottom') host.appendChild(slot);
                else host.insertBefore(slot, host.firstChild);
            }

            const vertical = position === 'right';
            let count;
            const MIN_TILE = 110;
            const MAX_TILE = 180;
            const HEADER_H = 30;
            const PAD = 16;
            const GAP = 8;
            if (vertical) {
                // Altura disponible real = viewport - top dinámico (nav + banner) - bottom(100) - padding slot
                const adTopStr = getComputedStyle(document.body).getPropertyValue('--ad-top').trim();
                const adTop = parseInt(adTopStr, 10) || 64;
                const avail = Math.max(180, window.innerHeight - adTop - 100 - 24 - HEADER_H);
                // Cuántos tiles de mínimo 110 caben? tope por MAX_TILE también
                const maxByMin = Math.floor((avail + GAP) / (MIN_TILE + GAP));
                const minByMax = Math.ceil((avail + GAP) / (MAX_TILE + GAP));
                // Rango entre minByMax y maxByMin: usar el mayor que quepa sin pasar MAX
                count = Math.max(1, Math.min(this._ADS.length, maxByMin));
                // Garantizar que no sea menor que el mínimo necesario para no exceder MAX_TILE
                count = Math.max(count, Math.min(this._ADS.length, minByMax));
            } else {
                count = 3;
            }
            const picks = [];
            for (let k = 0; k < count; k++) {
                picks.push(this._ADS[(this._adRotationIdx + idx + k) % this._ADS.length]);
            }
            const cardsHtml = picks.map(pick => `
                <div class="ad-tile ${vertical ? 'ad-tile-v' : 'ad-tile-h'}" onclick="Subscription.openAdCard('${pick.id}')">
                    <div class="ad-tile-icon">${pick.icon}</div>
                    <div class="ad-tile-text">
                        <strong>${this._esc(pick.title)}</strong>
                        <span>${this._esc(pick.text)}</span>
                    </div>
                    <button class="ad-tile-cta" onclick="event.stopPropagation(); Subscription.openAdCard('${pick.id}')">${this._esc(pick.cta)}</button>
                </div>
            `).join('');
            slot.innerHTML = `
                <div class="ad-slot-header">
                    <span class="ad-sponsored">Publicidad</span>
                    <button class="ad-remove" onclick="event.stopPropagation(); Subscription.openPlans()" title="Quitar anuncios con Pro">
                        <i data-lucide="x"></i>
                    </button>
                </div>
                <div class="ad-tiles ${vertical ? 'ad-tiles-v' : 'ad-tiles-h'}">
                    ${cardsHtml}
                </div>
            `;
        });
        if (window.lucide) lucide.createIcons();

        if (!this._adRotationTimer) {
            this._adRotationTimer = setInterval(() => {
                this._adRotationIdx = (this._adRotationIdx + 1) % this._ADS.length;
                if (!this.isPro()) this.renderAds();
            }, 10000);
        }
        if (!this._adResizeHandler) {
            this._adResizeHandler = () => { if (!this.isPro()) this.renderAds(); };
            window.addEventListener('resize', this._adResizeHandler);
        }
    },

    openAdCard(id) {
        const ad = this._ADS.find(a => a.id === id);
        if (!ad) return;
        this._openOverlay('ad-card-overlay', `
            <div class="ad-card-overlay-inner">
                <button class="plans-close" onclick="Subscription._closeOverlay('ad-card-overlay')"><i data-lucide="x"></i></button>
                <div class="ad-card-hero">
                    <div class="ad-card-icon">${ad.icon}</div>
                    <span class="ad-sponsored">Publicidad</span>
                </div>
                <h2 style="margin:10px 0 4px">${this._esc(ad.title)}</h2>
                <p style="color:var(--text-muted);margin-bottom:12px">${this._esc(ad.text)}</p>
                <div style="background:var(--cream);border-radius:10px;padding:12px 14px;margin-bottom:14px">
                    <p style="margin:0;line-height:1.5">${this._esc(ad.long)}</p>
                </div>
                ${ad.phone ? `<div style="font-size:0.88rem;margin-bottom:14px">📞 <strong>${this._esc(ad.phone)}</strong></div>` : ''}
                <button class="btn btn-primary btn-full" onclick="App.showToast('Anuncio simulado — demo', 'info')">
                    <i data-lucide="external-link"></i> Contactar anunciante
                </button>
                <button class="btn btn-outline btn-full" onclick="Subscription._closeOverlay('ad-card-overlay'); Subscription.openPlans()" style="margin-top:8px">
                    <i data-lucide="shield-off"></i> Quitar anuncios con Pro
                </button>
            </div>
        `);
    },

    updateVerifiedBadge() {
        const avatar = document.getElementById('nav-avatar');
        if (!avatar) return;
        const existing = avatar.querySelector('.verified-tick');
        if (existing) existing.remove();
        if (API.user && API.user.verified) {
            const tick = document.createElement('span');
            tick.className = 'verified-tick';
            tick.innerHTML = '<i data-lucide="badge-check"></i>';
            tick.title = 'Cuenta verificada';
            avatar.appendChild(tick);
            if (window.lucide) lucide.createIcons();
        }
    },

    // ========== Pantalla de planes (overlay) ==========
    openPlans() {
        const s = this.state || {};
        const priceBasic = this.formatPrice(s.price_basic || 7900);
        const priceBasicReg = this.formatPrice(s.price_basic_regular || s.price_basic || 7900);
        const pricePro = this.formatPrice(s.price_pro || 12900);
        const priceProReg = this.formatPrice(s.price_pro_regular || s.price_pro || 12900);
        const alreadyActive = !!s.is_premium;
        const currentTier = s.plan_tier || 'none';
        const promo = !!s.promo_active;
        const discountLabel = s.promo_discount_percent ? `-${s.promo_discount_percent}%` : '-50%';

        const basicMax = s.basic_max_posts || 20;
        const basicFeatures = [
            { text: `Hasta ${basicMax} publicaciones por mes`, ok: true },
            { text: 'Vista mapa de publicaciones', ok: true },
            { text: 'Chat con fotos y ubicación', ok: true },
            { text: 'Sin anuncios', ok: false },
            { text: 'Alertas de match inteligente', ok: false },
            { text: 'Exportar resumen de acuerdos en imagen', ok: false },
            { text: 'Soporte prioritario', ok: false },
        ];
        const proFeatures = [
            { text: 'Publicaciones ilimitadas', ok: true },
            { text: 'Vista mapa de publicaciones', ok: true },
            { text: 'Chat con fotos y ubicación', ok: true },
            { text: 'Sin anuncios', ok: true },
            { text: 'Alertas de match inteligente', ok: true },
            { text: 'Exportar resumen de acuerdos en imagen', ok: true },
            { text: 'Soporte prioritario', ok: true },
        ];

        const renderFeatures = (arr) => arr.map(f => `
            <li class="${f.ok ? 'plan-feat-ok' : 'plan-feat-no'}">
                <i data-lucide="${f.ok ? 'check-circle-2' : 'x-circle'}"></i>
                <span>${this._esc(f.text)}</span>
            </li>
        `).join('');

        const isActiveSub = alreadyActive && s.status === 'active';
        const ctaFor = (tier, label) => {
            if (isActiveSub && currentTier === tier) {
                return `<button class="btn btn-primary btn-full" onclick="Subscription.openCheckout('${tier}')"><i data-lucide="refresh-cw"></i> Renovar ${label} (+30 días)</button>`;
            }
            if (isActiveSub && currentTier && currentTier !== tier) {
                const up = this._computeUpgradeCost(tier);
                if (up) {
                    const upLabel = up.charged > 0
                        ? `${this.formatPrice(up.charged)} por ${up.days_left} ${up.days_left === 1 ? 'día' : 'días'}`
                        : 'sin costo extra';
                    return `<button class="btn btn-primary btn-full" onclick="Subscription.openCheckout('${tier}')"><i data-lucide="trending-up"></i> Mejorar a ${label} · ${upLabel}</button>`;
                }
                return `<button class="btn btn-primary btn-full" onclick="Subscription.openCheckout('${tier}')"><i data-lucide="repeat"></i> Cambiar a ${label}</button>`;
            }
            return `<button class="btn btn-primary btn-full" onclick="Subscription.openCheckout('${tier}')"><i data-lucide="credit-card"></i> Suscribirme al ${label}</button>`;
        };
        const ctaBasic = ctaFor('basic', 'Básico');
        const ctaPro = ctaFor('pro', 'Pro');

        const fmtFecha = (iso) => new Date(iso).toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric' });
        let currentBanner = '';
        if (s.is_premium && s.subscription_end) {
            const tier = s.plan_tier === 'pro' ? 'Pro' : (s.plan_tier === 'basic' ? 'Básico' : 'Pro');
            currentBanner = `<div class="plans-current-info">
                <i data-lucide="calendar-check"></i>
                <span>Tu plan <strong>${tier}</strong> está activo hasta el <strong>${fmtFecha(s.subscription_end)}</strong>. Mejorar a un plan mayor solo cobra la diferencia por los días restantes; bajar a uno menor se aplica al terminar.</span>
            </div>`;
        } else if (s.status === 'trial' && s.trial_days_left > 0 && s.trial_end) {
            currentBanner = `<div class="plans-current-info">
                <i data-lucide="gift"></i>
                <span>Tu prueba gratuita va hasta el <strong>${fmtFecha(s.trial_end)}</strong>. Suscríbete para no perder los beneficios.</span>
            </div>`;
        }

        const html = `
            <div class="plans-overlay-inner">
                <button class="plans-close" onclick="Subscription.closePlans()"><i data-lucide="x"></i></button>
                <div class="plans-hero plans-hero-compact">
                    <div class="plans-crown"><i data-lucide="crown"></i></div>
                    <h2>Elige tu plan</h2>
                    <p>Dos opciones pensadas para tu actividad</p>
                    ${promo && s.promo_days_left > 0 ? `<p class="plans-price-promo-hint">🔥 Promo ${discountLabel} termina en ${s.promo_days_left} ${s.promo_days_left === 1 ? 'día' : 'días'}</p>` : ''}
                </div>
                ${currentBanner}

                <div class="plan-cards">
                    <div class="plan-card plan-card-basic">
                        <div class="plan-card-head">
                            <div class="plan-card-icon"><i data-lucide="sprout"></i></div>
                            <h3>Básico</h3>
                            <p class="plan-card-tag">Publica sin límite</p>
                        </div>
                        <div class="plan-card-price">
                            ${promo ? `<s>${priceBasicReg}</s>` : ''}
                            <strong>${priceBasic}</strong><span>/mes</span>
                            ${promo ? `<span class="plan-card-disc">${discountLabel}</span>` : ''}
                        </div>
                        <ul class="plan-card-features">${renderFeatures(basicFeatures)}</ul>
                        ${ctaBasic}
                    </div>

                    <div class="plan-card plan-card-pro plan-card-highlight">
                        <span class="plan-card-ribbon">⭐ Recomendado</span>
                        <div class="plan-card-head">
                            <div class="plan-card-icon"><i data-lucide="crown"></i></div>
                            <h3>Pro</h3>
                            <p class="plan-card-tag">Todos los beneficios</p>
                        </div>
                        <div class="plan-card-price">
                            ${promo ? `<s>${priceProReg}</s>` : ''}
                            <strong>${pricePro}</strong><span>/mes</span>
                            ${promo ? `<span class="plan-card-disc">${discountLabel}</span>` : ''}
                        </div>
                        <ul class="plan-card-features">${renderFeatures(proFeatures)}</ul>
                        ${ctaPro}
                    </div>
                </div>

                <p class="plans-legal">Pago mensual · Cancela cuando quieras</p>
                <button class="btn btn-outline btn-full" onclick="Subscription.closePlans()">Volver</button>
            </div>
        `;
        this._openOverlay('plans-overlay', html);
    },

    closePlans() { this._closeOverlay('plans-overlay'); },

    openPaywall(message) {
        const s = this.state || {};
        const pricePromo = this.formatPrice(s.price_promo || 7900);
        const priceReg = this.formatPrice(s.price_regular || 15800);
        const html = `
            <div class="paywall-overlay-inner">
                <button class="plans-close" onclick="Subscription.closePaywall()"><i data-lucide="x"></i></button>
                <div class="paywall-icon"><i data-lucide="lock"></i></div>
                <h2>Mejora a AgroPulse Pro</h2>
                <p class="paywall-message">${message || 'Alcanzaste el límite del plan gratuito.'}</p>
                <div class="paywall-price">
                    ${s.promo_active ? `<s>${priceReg}</s>` : ''}
                    <strong>${pricePromo}</strong><span>/mes</span>
                    ${s.promo_active ? `<span class="paywall-discount">${s.promo_discount_percent || 50}% OFF</span>` : ''}
                </div>
                <button class="btn btn-primary btn-full" onclick="Subscription.closePaywall(); Subscription.openCheckout();">
                    <i data-lucide="credit-card"></i> Suscribirme ahora
                </button>
                <button class="btn btn-outline btn-full" onclick="Subscription.closePaywall(); Subscription.openPlans();" style="margin-top:8px">
                    Ver todos los beneficios
                </button>
                <button class="btn btn-cancel btn-full" onclick="Subscription.closePaywall()" style="margin-top:8px">
                    Ahora no
                </button>
            </div>
        `;
        this._openOverlay('paywall-overlay', html);
    },

    closePaywall() { this._closeOverlay('paywall-overlay'); },

    // ========== Pasarela de pago simulada ==========
    openCheckout(plan) {
        const s = this.state || {};
        const selectedPlan = plan === 'pro' ? 'pro' : (plan === 'basic' ? 'basic' : 'basic');
        this._selectedPlan = selectedPlan;
        const planLabel = selectedPlan === 'pro' ? 'Pro' : 'Básico';
        const upgrade = this._computeUpgradeCost(selectedPlan);
        const priceAmount = upgrade
            ? upgrade.charged
            : (selectedPlan === 'pro' ? (s.price_pro || 12900) : (s.price_basic || 7900));
        const pricePromo = this.formatPrice(priceAmount);
        const summaryLabel = upgrade
            ? `Mejora a ${planLabel} · ${upgrade.days_left} ${upgrade.days_left === 1 ? 'día' : 'días'}`
            : `Plan ${planLabel}`;
        const upgradeNote = upgrade
            ? `<p class="checkout-upgrade-note">Pagas solo la diferencia entre tu plan actual y ${planLabel} por los ${upgrade.days_left} ${upgrade.days_left === 1 ? 'día restante' : 'días restantes'} de tu suscripción. Tu fecha de vencimiento no cambia.</p>`
            : '';
        const html = `
            <div class="checkout-overlay-inner">
                <button class="plans-close" onclick="Subscription.closeCheckout()"><i data-lucide="x"></i></button>
                <div class="checkout-wompi-header">
                    <div class="wompi-brand">
                        <span class="wompi-logo">w</span>
                        <span class="wompi-name">Wompi</span>
                    </div>
                    <div class="wompi-secure">
                        <i data-lucide="shield-check"></i> Pago seguro
                    </div>
                </div>
                <div class="checkout-test-banner">
                    <i data-lucide="flask-conical"></i>
                    <div>
                        <strong>Modo prueba</strong>
                        <span>No se cobra dinero real. Usa cualquier número de 16 dígitos o el botón de abajo.</span>
                    </div>
                    <button type="button" class="checkout-test-fill" onclick="Subscription._fillTestCard()">Usar tarjeta de prueba</button>
                </div>
                <div class="checkout-summary checkout-summary-slim">
                    <span>${summaryLabel}</span>
                    <strong>${pricePromo}</strong>
                </div>
                ${upgradeNote}
                <form id="checkout-form" class="checkout-form" onsubmit="event.preventDefault(); Subscription.submitCheckout()">
                    <div class="form-group">
                        <label class="form-label">Titular de la tarjeta</label>
                        <input type="text" id="ck-holder" class="form-input" placeholder="Como aparece en la tarjeta"
                               autocomplete="cc-name" maxlength="40"
                               oninput="Subscription._formatHolder(this)">
                    </div>
                    <div class="form-group">
                        <label class="form-label">Número de tarjeta</label>
                        <input type="text" id="ck-card" class="form-input" placeholder="1234 5678 9012 3456"
                               inputmode="numeric" maxlength="19" autocomplete="cc-number"
                               oninput="Subscription._formatCard(this)">
                        <span class="form-hint" id="ck-brand-hint"></span>
                    </div>
                    <div class="form-row">
                        <div class="form-group">
                            <label class="form-label">MM / AA</label>
                            <input type="text" id="ck-exp" class="form-input" placeholder="12 / 28"
                                   inputmode="numeric" maxlength="7" autocomplete="cc-exp"
                                   oninput="Subscription._formatExp(this)">
                        </div>
                        <div class="form-group">
                            <label class="form-label">CVV</label>
                            <input type="text" id="ck-cvv" class="form-input" placeholder="123"
                                   inputmode="numeric" maxlength="4" autocomplete="cc-csc"
                                   oninput="Subscription._formatCvv(this)">
                        </div>
                    </div>
                    <button type="submit" class="btn btn-primary btn-full" id="btn-ck-submit">
                        <i data-lucide="lock"></i> Pagar ${pricePromo}
                    </button>
                    <p class="checkout-legal">
                        Al continuar aceptas los Términos del servicio. Puedes cancelar en cualquier momento desde tu perfil.
                    </p>
                </form>
            </div>
        `;
        this._openOverlay('checkout-overlay', html);
    },

    closeCheckout() { this._closeOverlay('checkout-overlay'); },

    _formatCard(input) {
        let v = input.value.replace(/\D/g, '').slice(0, 19);
        input.value = v.replace(/(\d{4})(?=\d)/g, '$1 ').trim();
        const brand = this._detectBrand(v);
        const hint = document.getElementById('ck-brand-hint');
        if (hint) hint.textContent = brand;
    },

    _fillTestCard() {
        const set = (id, val) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.value = val;
            el.dispatchEvent(new Event('input', { bubbles: true }));
        };
        set('ck-holder', 'JUAN PEREZ');
        set('ck-card', '4242 4242 4242 4242');
        set('ck-exp', '12 / 30');
        set('ck-cvv', '123');
    },

    _formatExp(input) {
        let v = input.value.replace(/\D/g, '').slice(0, 4);
        if (v.length >= 3) input.value = v.slice(0, 2) + ' / ' + v.slice(2);
        else input.value = v;
    },

    _formatHolder(input) {
        // Solo letras (incluye acentos/ñ) y espacios. Mayúsculas como en tarjeta real.
        input.value = input.value.replace(/[^A-Za-zÁÉÍÓÚáéíóúÑñ\s]/g, '').toUpperCase().slice(0, 40);
    },

    _formatCvv(input) {
        input.value = input.value.replace(/\D/g, '').slice(0, 4);
    },

    _detectBrand(num) {
        if (/^4/.test(num)) return 'Visa';
        if (/^5[1-5]/.test(num)) return 'Mastercard';
        if (/^3[47]/.test(num)) return 'American Express';
        if (/^6(011|5)/.test(num)) return 'Discover';
        return '';
    },

    async submitCheckout() {
        const btn = document.getElementById('btn-ck-submit');
        const card = (document.getElementById('ck-card').value || '').replace(/\s/g, '');
        const cvv = (document.getElementById('ck-cvv').value || '').trim();
        const holder = (document.getElementById('ck-holder').value || '').trim();
        const exp = (document.getElementById('ck-exp').value || '').replace(/\s/g, '');
        const [mm, yy] = exp.split('/');

        if (!holder) return App.showToast('Ingresa el titular', 'error');
        if (!card) return App.showToast('Ingresa el número de tarjeta', 'error');
        if (!mm || !yy) return App.showToast('Ingresa MM / AA', 'error');
        if (!cvv) return App.showToast('Ingresa el CVV', 'error');

        btn.classList.add('loading');
        btn.disabled = true;
        btn.innerHTML = '<i data-lucide="loader-2" class="spin"></i> Procesando pago...';
        if (window.lucide) lucide.createIcons();

        // Artificial 2s delay for realism
        await new Promise(r => setTimeout(r, 2000));

        try {
            const result = await API.checkout({
                plan: this._selectedPlan || 'basic',
                card_number: card,
                cvv,
                exp_month: parseInt(mm, 10),
                exp_year: parseInt(yy, 10),
                holder,
            });
            this.state = result.subscription;
            this.closeCheckout();
            this.closePlans();
            this._launchFireworks();
            const untilDate = new Date(result.until || this.state.subscription_end);
            const fmt = (d) => d.toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric' });
            const untilStr = fmt(untilDate);
            const sched = result.scheduled;
            const upg = result.upgrade;
            const tierLabel = (t) => t === 'pro' ? 'Pro' : (t === 'basic' ? 'Básico' : 'Prueba');
            let title, subtitle, bonusLine = '';
            if (upg) {
                title = `¡Mejorado a ${tierLabel(upg.to)}!`;
                subtitle = `Tu plan cambió de <strong>${tierLabel(upg.from)}</strong> a <strong>${tierLabel(upg.to)}</strong> al instante. La fecha de vencimiento no cambia.`;
                bonusLine = `<div><span>Tipo</span><strong>Upgrade prorrateado</strong></div>
                             <div><span>Cobro</span><strong>${this.formatPrice(result.charged || 0)} por ${upg.days_left} ${upg.days_left === 1 ? 'día' : 'días'}</strong></div>`;
            } else if (sched) {
                const startsStr = fmt(new Date(sched.current_until));
                title = `¡${tierLabel(sched.next_tier)} agendado!`;
                subtitle = `Tu ${tierLabel(sched.current_tier)} sigue hasta el <strong>${startsStr}</strong>. Después arranca <strong>${tierLabel(sched.next_tier)}</strong> por 30 días.`;
                bonusLine = `<div><span>Plan actual</span><strong>${tierLabel(sched.current_tier)} hasta ${startsStr}</strong></div>
                             <div><span>Próximo plan</span><strong>${tierLabel(sched.next_tier)}</strong></div>`;
            } else if (result.is_renewal) {
                title = '¡Suscripción renovada!';
                subtitle = `Extendimos tu plan ${tierLabel(this.state.plan_tier)} 30 días más`;
                bonusLine = `<div><span>Tipo</span><strong>Renovación · +30 días</strong></div>`;
            } else {
                title = `¡${tierLabel(this.state.plan_tier)} activado!`;
                subtitle = `Gracias por unirte a AgroPulse ${tierLabel(this.state.plan_tier)}`;
            }
            const activeTier = (upg && upg.to) || (this.state && this.state.plan_tier) || this._selectedPlan || 'pro';
            const featuresByTier = {
                pro: [
                    'Publicaciones ilimitadas',
                    'Alertas de match inteligente',
                    'Chat con fotos y ubicación',
                    'Soporte prioritario',
                    'Sin anuncios',
                ],
                basic: [
                    'Más publicaciones al mes',
                    'Chat con fotos y ubicación',
                ],
            };
            const featuresList = (featuresByTier[activeTier] || featuresByTier.pro)
                .map(f => `<li><i data-lucide="check-circle-2"></i> ${f}</li>`).join('');
            this._openOverlay('success-overlay', `
                <div class="welcome-overlay-inner success-paid-inner">
                    <div class="welcome-gift success-trophy"><i data-lucide="party-popper"></i></div>
                    <h2>${title}</h2>
                    <p class="welcome-sub">${subtitle}</p>
                    <ul class="welcome-features">
                        ${featuresList}
                    </ul>
                    <div class="success-receipt">
                        <div><span>Referencia</span><strong>${result.reference}</strong></div>
                        ${bonusLine}
                        <div><span>Tu suscripción va hasta</span><strong>${untilStr}</strong></div>
                    </div>
                    <button class="btn btn-primary btn-full" onclick="Subscription._closeOverlay('success-overlay'); Subscription.refresh(); App.loadHome && App.loadHome();">
                        Continuar
                    </button>
                </div>
            `);
            setTimeout(() => this._launchFireworks(), 250);
            setTimeout(() => this._launchFireworks(), 900);
        } catch (e) {
            btn.classList.remove('loading');
            btn.disabled = false;
            btn.innerHTML = '<i data-lucide="lock"></i> Reintentar pago';
            if (window.lucide) lucide.createIcons();
            if (e.code === 'payment_declined') {
                App.showToast(e.message || 'Pago rechazado', 'error');
            } else {
                App.showToast(e.message || 'Error al procesar el pago', 'error');
            }
        }
    },

    // ========== Matches (pro) ==========
    _matchTypeLabels: { oferta: 'Oferta', solicitud: 'Solicitud', prestamo: 'Préstamo', trueque: 'Trueque' },
    _matchTypeIcons: { oferta: 'package-check', solicitud: 'hand', prestamo: 'key', trueque: 'repeat' },

    _matchTimeAgo(iso) {
        if (!iso) return '';
        const ms = Date.now() - new Date(iso).getTime();
        const m = Math.floor(ms / 60000);
        if (m < 1) return 'ahora';
        if (m < 60) return `hace ${m} min`;
        const h = Math.floor(m / 60);
        if (h < 24) return `hace ${h} h`;
        const d = Math.floor(h / 24);
        if (d < 7) return `hace ${d} ${d === 1 ? 'día' : 'días'}`;
        return new Date(iso).toLocaleDateString();
    },

    async openMatches() {
        if (!this.isPro()) {
            this.openPlans();
            return;
        }
        this._openOverlay('matches-overlay', `
            <div class="matches-overlay-inner">
                <button class="plans-close" onclick="Subscription._closeOverlay('matches-overlay')"><i data-lucide="x"></i></button>
                <div class="matches-header">
                    <div class="matches-title-row">
                        <div class="matches-icon-wrap"><i data-lucide="bell-ring"></i></div>
                        <div>
                            <h2>Alertas de match</h2>
                            <p class="matches-intro">Cruzamos tus publicaciones con las de otros: ofertas ↔ solicitudes, préstamos y trueques que coinciden por categoría y municipio.</p>
                        </div>
                    </div>
                    <div class="matches-filter-row" id="matches-filter-row" style="display:none">
                        <button class="match-filter-chip active" data-mfilter="todos" onclick="Subscription.setMatchFilter('todos')">Todos <span class="match-filter-count" data-count="todos">0</span></button>
                        <button class="match-filter-chip" data-mfilter="oferta" onclick="Subscription.setMatchFilter('oferta')"><i data-lucide="package-check"></i> Ofertas <span class="match-filter-count" data-count="oferta">0</span></button>
                        <button class="match-filter-chip" data-mfilter="solicitud" onclick="Subscription.setMatchFilter('solicitud')"><i data-lucide="hand"></i> Solicitudes <span class="match-filter-count" data-count="solicitud">0</span></button>
                        <button class="match-filter-chip" data-mfilter="prestamo" onclick="Subscription.setMatchFilter('prestamo')"><i data-lucide="key"></i> Préstamos <span class="match-filter-count" data-count="prestamo">0</span></button>
                        <button class="match-filter-chip" data-mfilter="trueque" onclick="Subscription.setMatchFilter('trueque')"><i data-lucide="repeat"></i> Trueques <span class="match-filter-count" data-count="trueque">0</span></button>
                    </div>
                </div>
                <div id="matches-list" class="matches-list"><div class="skeleton-card skeleton"></div><div class="skeleton-card skeleton"></div></div>
            </div>
        `);
        try {
            const matches = await API.getMatches();
            this._matchesCache = matches;
            this._matchFilter = 'todos';
            this._renderMatches();
        } catch (e) {
            App.showToast(e.message || 'Error al cargar matches', 'error');
        }
    },

    setMatchFilter(f) {
        this._matchFilter = f;
        document.querySelectorAll('.match-filter-chip').forEach(b => b.classList.toggle('active', b.dataset.mfilter === f));
        this._renderMatches();
    },

    _renderMatches() {
        const list = document.getElementById('matches-list');
        if (!list) return;
        const all = this._matchesCache || [];

        // Counts per type
        const counts = { todos: all.length, oferta: 0, solicitud: 0, prestamo: 0, trueque: 0 };
        all.forEach(m => { counts[m.match_tipo] = (counts[m.match_tipo] || 0) + 1; });
        const filterRow = document.getElementById('matches-filter-row');
        if (filterRow) {
            filterRow.style.display = all.length ? 'flex' : 'none';
            filterRow.querySelectorAll('.match-filter-count').forEach(el => {
                el.textContent = counts[el.dataset.count] || 0;
            });
        }

        const f = this._matchFilter || 'todos';
        const filtered = f === 'todos' ? all : all.filter(m => m.match_tipo === f);

        if (!all.length) {
            list.innerHTML = `<div class="empty-state matches-empty">
                <i data-lucide="bell-off"></i>
                <h3>Sin coincidencias todavía</h3>
                <p>Publica más recursos para generar matches automáticos. Cruzamos tu categoría y municipio con otras publicaciones activas.</p>
                <button class="btn btn-primary btn-sm" onclick="Subscription._closeOverlay('matches-overlay'); App.switchTab('publicar')"><i data-lucide="plus"></i> Publicar recurso</button>
            </div>`;
        } else if (!filtered.length) {
            list.innerHTML = `<div class="empty-state matches-empty">
                <i data-lucide="filter"></i>
                <p>Sin matches de este tipo</p>
            </div>`;
        } else {
            list.innerHTML = filtered.map(m => {
                const typeLbl = this._matchTypeLabels[m.match_tipo] || m.match_tipo;
                const typeIcon = this._matchTypeIcons[m.match_tipo] || 'package';
                const ago = this._matchTimeAgo(m.match_created_at);
                const repu = (m.match_user_reputation || 5).toFixed(1);
                const desc = (m.match_descripcion || '').trim();
                const verified = m.match_user_verified ? '<i data-lucide="badge-check" class="verified-inline"></i>' : '';
                const keywords = Array.isArray(m.match_keywords) ? m.match_keywords : [];
                const keywordsHtml = keywords.length
                    ? `<div class="match-keywords">${keywords.map(k => `<span class="match-kw">${this._esc(k)}</span>`).join('')}</div>`
                    : '';
                const muniBadge = m.match_same_municipio ? `<span class="match-muni match-muni-same"><i data-lucide="map-pin"></i> ${this._esc(m.match_municipio)} · mismo municipio</span>` : (m.match_municipio ? `<span class="match-muni"><i data-lucide="map-pin"></i> ${this._esc(m.match_municipio)}</span>` : '');
                return `
                <div class="match-card match-card-${m.match_tipo}" onclick="Subscription._closeOverlay('matches-overlay'); App.showResourceDetail('${m.match_id}')">
                    <div class="match-card-top">
                        <span class="match-tipo-pill match-tipo-${m.match_tipo}"><i data-lucide="${typeIcon}"></i> ${typeLbl}</span>
                        ${muniBadge}
                        <span class="match-ago">${ago}</span>
                    </div>
                    ${keywordsHtml}
                    <h4 class="match-title">${this._esc(m.match_titulo)}</h4>
                    ${desc ? `<p class="match-desc">${this._esc(desc.slice(0, 160))}${desc.length > 160 ? '…' : ''}</p>` : ''}
                    <div class="match-meta-row">
                        <span class="match-author"><i data-lucide="user"></i> ${this._esc(m.match_user_nombre || '')} ${verified}<span class="match-rating">⭐ ${repu}</span></span>
                    </div>
                    <div class="match-hint">↔ coincide con tu publicación "<em>${this._esc(m.my_resource_titulo)}</em>"</div>
                    <button class="btn btn-primary btn-sm match-cta" onclick="event.stopPropagation(); Subscription._closeOverlay('matches-overlay'); App.showResourceDetail('${m.match_id}')">
                        Ver publicación <i data-lucide="arrow-right"></i>
                    </button>
                </div>`;
            }).join('');
        }
        if (window.lucide) lucide.createIcons();
    },

    // ========== Support ==========
    async openSupport() {
        this._openOverlay('support-overlay', `
            <div class="support-overlay-inner">
                <button class="plans-close" onclick="Subscription._closeOverlay('support-overlay')"><i data-lucide="x"></i></button>
                <h2><i data-lucide="life-buoy"></i> Soporte</h2>
                ${this.isPro() ? `<p class="support-priority-note"><i data-lucide="zap"></i> Tus tickets se atienden con prioridad</p>` : `<p class="support-normal-note">Tus tickets se atienden en orden normal. <a onclick="Subscription._closeOverlay('support-overlay'); Subscription.openPlans()">Mejora a Pro</a> para prioridad.</p>`}
                <button class="btn btn-primary btn-full" onclick="Subscription.openNewTicket()">
                    <i data-lucide="plus"></i> Nuevo ticket
                </button>
                <div id="support-tickets-list" class="support-tickets"><div class="skeleton-card skeleton"></div></div>
            </div>
        `);
        try {
            const tickets = await API.getSupportTickets();
            const host = document.getElementById('support-tickets-list');
            if (!tickets.length) {
                host.innerHTML = `<div class="empty-state"><i data-lucide="inbox"></i><p>No tienes tickets aún</p></div>`;
            } else {
                host.innerHTML = tickets.map(t => `
                    <div class="ticket-item ${t.priority === 'priority' ? 'ticket-priority' : ''}" onclick="Subscription.openTicket('${t.id}')">
                        <div class="ticket-head">
                            <strong>${this._esc(t.subject)}</strong>
                            <span class="ticket-status ticket-${t.status}">${t.status}</span>
                        </div>
                        <p>${this._esc((t.last_message || '').slice(0, 100))}</p>
                        <small>${new Date(t.updated_at).toLocaleString()}</small>
                    </div>
                `).join('');
            }
            if (window.lucide) lucide.createIcons();
        } catch (e) {
            App.showToast(e.message, 'error');
        }
    },

    openNewTicket() {
        this._openOverlay('new-ticket-overlay', `
            <div class="new-ticket-inner">
                <button class="plans-close" onclick="Subscription._closeOverlay('new-ticket-overlay')"><i data-lucide="x"></i></button>
                <h2>Nuevo ticket</h2>
                <div class="form-group">
                    <label class="form-label">Asunto</label>
                    <input type="text" id="nt-subject" class="form-input" placeholder="Ej: Problema al publicar">
                </div>
                <div class="form-group">
                    <label class="form-label">Mensaje</label>
                    <textarea id="nt-message" class="form-input form-input-lg" rows="10" placeholder="Cuéntanos qué ocurre con el mayor detalle posible. Incluye pasos para reproducir, capturas si aplica, y cualquier información relevante." style="min-height:220px;font-size:0.95rem;line-height:1.5;resize:vertical"></textarea>
                </div>
                <button class="btn btn-primary btn-full" onclick="Subscription.submitTicket()">
                    <i data-lucide="send"></i> Enviar
                </button>
            </div>
        `);
        if (window.lucide) lucide.createIcons();
    },

    async submitTicket() {
        const subject = document.getElementById('nt-subject').value.trim();
        const message = document.getElementById('nt-message').value.trim();
        if (!subject || !message) return App.showToast('Completa todos los campos', 'error');
        try {
            await API.createSupportTicket({ subject, message });
            this._closeOverlay('new-ticket-overlay');
            App.showToast('Ticket enviado. Te responderemos pronto.');
            this.openSupport();
        } catch (e) {
            App.showToast(e.message, 'error');
        }
    },

    async openTicket(id) {
        this._openOverlay('ticket-overlay', `
            <div class="ticket-overlay-inner ticket-chat-inner">
                <div class="ticket-chat-header">
                    <button class="plans-close" onclick="Subscription.closeTicket()"><i data-lucide="arrow-left"></i></button>
                    <div id="ticket-head-info" style="flex:1"></div>
                </div>
                <div id="ticket-messages" class="ticket-messages ticket-chat-messages"></div>
                <form class="ticket-reply-bar ticket-chat-input" onsubmit="event.preventDefault(); Subscription.replyTicket('${id}')">
                    <input type="text" id="ticket-reply-input" placeholder="Escribe un mensaje..." autocomplete="off">
                    <button class="btn btn-primary" type="submit" aria-label="Enviar">
                        <i data-lucide="send"></i>
                    </button>
                </form>
            </div>
        `);
        await this._loadTicket(id);
        this._ticketPollId = id;
        if (this._ticketPollTimer) clearInterval(this._ticketPollTimer);
        this._ticketPollTimer = setInterval(() => {
            if (this._ticketPollId) this._loadTicket(this._ticketPollId, true);
        }, 4000);
    },

    closeTicket() {
        if (this._ticketPollTimer) { clearInterval(this._ticketPollTimer); this._ticketPollTimer = null; }
        this._ticketPollId = null;
        this._closeOverlay('ticket-overlay');
        this.openSupport();
    },

    async _loadTicket(id, silent) {
        try {
            const t = await API.getSupportTicket(id);
            const head = document.getElementById('ticket-head-info');
            if (head) head.innerHTML = `
                <h3 style="margin:0;font-size:15px">${this._esc(t.subject)}</h3>
                <small>Estado: <strong>${t.status}</strong> ${t.priority === 'priority' ? '· <span class="priority-tag">⚡ Prioritario</span>' : ''}</small>
            `;
            const msgs = document.getElementById('ticket-messages');
            if (!msgs) return;
            const prevCount = msgs.dataset.msgCount ? parseInt(msgs.dataset.msgCount, 10) : 0;
            const nearBottom = (msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight) < 80;
            msgs.innerHTML = t.messages.map(m => `
                <div class="ticket-msg ticket-msg-${m.from}">
                    <div class="ticket-msg-head">${m.from === 'admin' ? 'Soporte AgroPulse' : 'Tú'} · ${new Date(m.created_at).toLocaleString()}</div>
                    <div class="ticket-msg-body">${this._esc(m.message)}</div>
                </div>
            `).join('');
            msgs.dataset.msgCount = t.messages.length;
            if (!silent || nearBottom || t.messages.length > prevCount) {
                msgs.scrollTop = msgs.scrollHeight;
            }
            if (window.lucide) lucide.createIcons();
        } catch (e) {
            if (!silent) App.showToast(e.message, 'error');
        }
    },

    async replyTicket(id) {
        const input = document.getElementById('ticket-reply-input');
        const msg = (input.value || '').trim();
        if (!msg) return;
        input.value = '';
        try {
            await API.replySupport(id, msg);
            await this._loadTicket(id);
        } catch (e) {
            App.showToast(e.message, 'error');
        }
    },

    // ========== Invoices ==========
    _MONTH_LBL: ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'],
    _formatInvoiceDate(iso) {
        const d = new Date(iso);
        const day = String(d.getDate()).padStart(2, '0');
        const mon = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'][d.getMonth()];
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        return `${day} ${mon} ${d.getFullYear()} · ${hh}:${mm}`;
    },
    _planTierLabel(tier) {
        if (tier === 'pro') return 'Pro';
        if (tier === 'basic') return 'Básico';
        return tier ? this._esc(tier) : '';
    },
    _copyToClipboard(txt) {
        try {
            navigator.clipboard.writeText(txt);
            App.showToast('Copiado al portapapeles', 'success');
        } catch { App.showToast('No se pudo copiar', 'error'); }
    },

    async openInvoices() {
        this._openOverlay('invoices-overlay', `
            <div class="invoices-overlay-inner">
                <button class="plans-close" onclick="Subscription._closeOverlay('invoices-overlay')"><i data-lucide="x"></i></button>
                <div class="invoices-header">
                    <div class="invoices-icon-wrap"><i data-lucide="receipt"></i></div>
                    <div>
                        <h2>Historial de pagos</h2>
                        <p class="invoices-intro">Tus cobros, renovaciones, upgrades e intentos rechazados.</p>
                    </div>
                </div>
                <div id="invoices-summary" class="invoices-summary"></div>
                <div id="invoices-list" class="invoices-list"><div class="skeleton-card skeleton"></div><div class="skeleton-card skeleton"></div></div>
            </div>
        `);
        try {
            const invoices = await API.getInvoices();
            const host = document.getElementById('invoices-list');
            const summary = document.getElementById('invoices-summary');

            if (!invoices.length) {
                if (summary) summary.innerHTML = '';
                host.innerHTML = `<div class="empty-state empty-state-centered"><i data-lucide="inbox"></i><h3>Sin pagos aún</h3><p>Cuando hagas tu primera suscripción, los recibos aparecerán acá.</p></div>`;
                if (window.lucide) lucide.createIcons();
                return;
            }

            // Resumen: solo rechazados (si los hay)
            const declined = invoices.filter(i => i.status === 'declined').length;
            summary.innerHTML = declined > 0
                ? `<div class="invoices-summary-card invoices-summary-warn">
                    <i data-lucide="alert-triangle"></i>
                    <div>
                        <strong>${declined} ${declined === 1 ? 'pago rechazado' : 'pagos rechazados'}</strong>
                        <small>Revisa los detalles más abajo.</small>
                    </div>
                </div>`
                : '';

            // Agrupar por mes (YYYY-MM)
            const groups = {};
            for (const inv of invoices) {
                const d = new Date(inv.created_at);
                const key = `${d.getFullYear()}-${String(d.getMonth()).padStart(2, '0')}`;
                if (!groups[key]) groups[key] = { year: d.getFullYear(), month: d.getMonth(), items: [], total: 0 };
                groups[key].items.push(inv);
                if (inv.status === 'paid') groups[key].total += (inv.amount || 0);
            }
            const sortedKeys = Object.keys(groups).sort().reverse();

            host.innerHTML = sortedKeys.map(k => {
                const g = groups[k];
                const monthName = this._MONTH_LBL[g.month];
                const itemsHtml = g.items.map(inv => {
                    const isPaid = inv.status === 'paid';
                    const statusIcon = isPaid ? 'check-circle-2' : 'x-circle';
                    const statusLbl = isPaid ? 'Pagado' : 'Rechazado';
                    const tierLbl = this._planTierLabel(inv.plan_tier);
                    const tierBadge = tierLbl ? `<span class="invoice-tier invoice-tier-${inv.plan_tier || 'none'}">${tierLbl}</span>` : '';
                    const upgradeBadge = inv.is_upgrade ? `<span class="invoice-upgrade">Upgrade prorrateado</span>` : '';
                    const declineMsg = !isPaid && inv.decline_reason
                        ? `<div class="invoice-decline"><i data-lucide="alert-triangle"></i> ${this._esc(inv.decline_reason)}</div>`
                        : '';
                    return `
                        <div class="invoice-card invoice-${inv.status}">
                            <div class="invoice-card-row">
                                <div class="invoice-amount-block">
                                    <strong class="invoice-amount">${this.formatPrice(inv.amount || 0)}</strong>
                                    <div class="invoice-tags">${tierBadge}${upgradeBadge}</div>
                                </div>
                                <span class="invoice-status invoice-status-${inv.status}">
                                    <i data-lucide="${statusIcon}"></i> ${statusLbl}
                                </span>
                            </div>
                            <div class="invoice-card-meta">
                                <span class="invoice-card-meta-item"><i data-lucide="credit-card"></i> ${this._esc(inv.card_brand || 'Tarjeta')} •••• ${this._esc(inv.card_last4 || '----')}</span>
                                <span class="invoice-card-meta-item"><i data-lucide="calendar"></i> ${this._formatInvoiceDate(inv.created_at)}</span>
                            </div>
                            <button class="invoice-ref-btn" onclick="event.stopPropagation(); Subscription._copyToClipboard('${this._esc(inv.reference)}')" title="Copiar referencia">
                                <i data-lucide="hash"></i> ${this._esc(inv.reference)}
                                <i data-lucide="copy" class="invoice-ref-copy"></i>
                            </button>
                            ${declineMsg}
                        </div>
                    `;
                }).join('');
                return `
                    <div class="invoice-month-group">
                        <div class="invoice-month-head">
                            <h3>${monthName} <span class="invoice-month-year">${g.year}</span></h3>
                            <span class="invoice-month-total">${this.formatPrice(g.total)}</span>
                        </div>
                        ${itemsHtml}
                    </div>
                `;
            }).join('');

            if (window.lucide) lucide.createIcons();
        } catch (e) { App.showToast(e.message, 'error'); }
    },

    // Genera imagen PNG con resumen de acuerdos.
    async downloadImage() {
        if (!this.isPro()) {
            this.openPlans();
            return;
        }
        let agreements;
        try {
            agreements = await API.getAgreements({}).catch(() => []);
        } catch (_) { agreements = []; }
        if (!agreements || agreements.length === 0) {
            App.showToast('Aún no tienes acuerdos para exportar', 'error');
            return;
        }
        try {
            App.showToast('Generando imagen...', 'success');
            const canvas = this._renderAgreementsCanvas(agreements);
            const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            const fname = `agropulse-acuerdos-${new Date().toISOString().slice(0, 10)}.png`;
            a.href = url;
            a.download = fname;
            a.click();
            URL.revokeObjectURL(url);
            App.showToast('Imagen descargada', 'success');
        } catch (e) {
            App.showToast(e.message || 'Error al generar imagen', 'error');
        }
    },
    // Alias compat
    async downloadCsv() { return this.downloadImage(); },

    _renderAgreementsCanvas(agreements) {
        // Layout grid modular — cards tipo "box de inicio"
        const W = 720;
        const PAD = 22;
        const HEADER_H = 110;
        const FOOTER_H = 56;
        const COLS = 3;
        const GAP = 12;
        const CARD_H = 138;
        const MAX_CARDS = 30;

        const items = agreements.slice(0, MAX_CARDS);
        const rows = Math.max(1, Math.ceil(items.length / COLS));
        const cardW = (W - PAD * 2 - GAP * (COLS - 1)) / COLS;
        const gridH = rows * CARD_H + (rows - 1) * GAP;
        const H = HEADER_H + gridH + PAD * 2 + FOOTER_H;

        const dpr = window.devicePixelRatio || 1;
        const canvas = document.createElement('canvas');
        canvas.width = W * dpr;
        canvas.height = H * dpr;
        canvas.style.width = W + 'px';
        canvas.style.height = H + 'px';
        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);

        // BG general
        ctx.fillStyle = '#FAF8F1';
        ctx.fillRect(0, 0, W, H);

        // Header gradient verde
        const grad = ctx.createLinearGradient(0, 0, W, HEADER_H);
        grad.addColorStop(0, '#2C3E1F');
        grad.addColorStop(1, '#7A9A3C');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, W, HEADER_H);

        // Patrón decorativo
        ctx.globalAlpha = 0.07;
        ctx.fillStyle = '#fff';
        for (let i = 0; i < 5; i++) {
            ctx.beginPath();
            ctx.arc(W - 50 - i * 70, 26 + (i % 2) * 38, 30, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;

        // Logo / título
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 26px "DM Sans", system-ui, sans-serif';
        ctx.fillText('🌱 AgroPulse', PAD, 42);
        ctx.font = '600 16px "DM Sans", system-ui, sans-serif';
        ctx.globalAlpha = 0.95;
        ctx.fillText('Resumen de mis acuerdos', PAD, 66);

        // Subtitle
        ctx.font = '12px "DM Sans", system-ui, sans-serif';
        ctx.globalAlpha = 0.78;
        const userName = (API.user && API.user.nombre)
            ? `${API.user.nombre} ${API.user.apellido || ''}`.trim()
            : 'Usuario';
        const dateStr = new Date().toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' });
        ctx.fillText(`${userName} · Generado el ${dateStr}`, PAD, 90);
        ctx.globalAlpha = 1;

        // Body: grid de cards
        const TYPE_COLORS = {
            oferta:    { bg: '#dcfce7', fg: '#166534', accent: '#16a34a' },
            solicitud: { bg: '#dbeafe', fg: '#1e40af', accent: '#2563eb' },
            prestamo:  { bg: '#fed7aa', fg: '#9a3412', accent: '#ea580c' },
            trueque:   { bg: '#e9d5ff', fg: '#6b21a8', accent: '#9333ea' },
        };
        const STATUS_COLORS = {
            pending:   { bg: '#fef3c7', fg: '#92400e', lbl: 'Pendiente' },
            active:    { bg: '#d1fae5', fg: '#065f46', lbl: 'En curso' },
            completed: { bg: '#dbeafe', fg: '#1e40af', lbl: 'Completado' },
            cancelled: { bg: '#f3f4f6', fg: '#4b5563', lbl: 'Cancelado' },
            rejected:  { bg: '#fee2e2', fg: '#991b1b', lbl: 'Rechazado' },
        };
        const TYPE_LABELS = { oferta: 'Oferta', solicitud: 'Solicitud', prestamo: 'Préstamo', trueque: 'Trueque' };

        const truncate = (s, max) => {
            s = String(s || '');
            return s.length > max ? s.slice(0, max - 1) + '…' : s;
        };
        const fmtDate = (iso) => {
            if (!iso) return '—';
            const d = new Date(iso);
            return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
        };

        const gridY = HEADER_H + PAD;

        items.forEach((a, idx) => {
            const col = idx % COLS;
            const row = Math.floor(idx / COLS);
            const x = PAD + col * (cardW + GAP);
            const y = gridY + row * (CARD_H + GAP);

            const tipo = a.resource_tipo || 'oferta';
            const tColor = TYPE_COLORS[tipo] || TYPE_COLORS.oferta;
            const stat = STATUS_COLORS[a.status] || STATUS_COLORS.pending;

            // Card sin fondo (transparente sobre cream). Solo borde sutil.
            ctx.strokeStyle = 'rgba(44,62,31,0.08)';
            ctx.lineWidth = 1;
            this._roundRect(ctx, x, y, cardW, CARD_H, 10);
            ctx.stroke();

            // Borde left accent (más prominente)
            ctx.fillStyle = tColor.accent;
            this._roundRect(ctx, x, y, 4, CARD_H, 10);
            ctx.fill();

            const innerX = x + 14;
            const innerW = cardW - 22;

            // Tipo pill
            ctx.fillStyle = tColor.bg;
            ctx.font = '700 9.5px "DM Sans", system-ui, sans-serif';
            const tipoLbl = (TYPE_LABELS[tipo] || tipo).toUpperCase();
            const tipoW = ctx.measureText(tipoLbl).width + 14;
            this._roundRect(ctx, innerX, y + 12, tipoW, 18, 9);
            ctx.fill();
            ctx.fillStyle = tColor.fg;
            ctx.fillText(tipoLbl, innerX + 7, y + 24);

            // Status pill (a la derecha)
            ctx.font = '700 9.5px "DM Sans", system-ui, sans-serif';
            const sLbl = stat.lbl.toUpperCase();
            const sw = ctx.measureText(sLbl).width + 14;
            ctx.fillStyle = stat.bg;
            this._roundRect(ctx, x + cardW - sw - 12, y + 12, sw, 18, 9);
            ctx.fill();
            ctx.fillStyle = stat.fg;
            ctx.fillText(sLbl, x + cardW - sw - 5, y + 24);

            // Título (puede tener 2 líneas)
            ctx.fillStyle = '#2C3E1F';
            ctx.font = 'bold 13.5px "DM Sans", system-ui, sans-serif';
            const title = a.resource_titulo || 'Recurso';
            const titleLine1 = truncate(title, Math.floor(innerW / 7.2));
            ctx.fillText(titleLine1, innerX, y + 50);

            // Contraparte
            const isProvider = a.provider_id === API.user.id;
            const otherName = isProvider
                ? `${a.req_nombre || ''} ${a.req_apellido || ''}`.trim()
                : `${a.prov_nombre || ''} ${a.prov_apellido || ''}`.trim();
            const role = isProvider ? '←' : '→';
            ctx.fillStyle = '#5C6660';
            ctx.font = '11.5px "DM Sans", system-ui, sans-serif';
            ctx.fillText(`${role} ${truncate(otherName || '—', Math.floor(innerW / 6))}`, innerX, y + 72);

            // Categoría / municipio (sutil)
            const meta = [a.resource_cat, a.resource_municipio].filter(Boolean).join(' · ');
            if (meta) {
                ctx.fillStyle = '#94a09a';
                ctx.font = '10.5px "DM Sans", system-ui, sans-serif';
                ctx.fillText(truncate(meta, Math.floor(innerW / 5.5)), innerX, y + 92);
            }

            // Footer card: fecha + rating
            ctx.fillStyle = '#7C8073';
            ctx.font = '10.5px "DM Sans", system-ui, sans-serif';
            ctx.fillText(fmtDate(a.created_at), innerX, y + CARD_H - 14);

            const rating = isProvider ? a.rating_provider : a.rating_requester;
            if (a.status === 'completed' && rating) {
                ctx.fillStyle = '#C8962A';
                ctx.font = 'bold 11px "DM Sans", system-ui, sans-serif';
                const ratingTxt = `★ ${rating}/5`;
                const rw = ctx.measureText(ratingTxt).width;
                ctx.fillText(ratingTxt, x + cardW - rw - 12, y + CARD_H - 14);
            }
        });

        // Footer
        const fy = H - FOOTER_H;
        ctx.fillStyle = '#2C3E1F';
        ctx.fillRect(0, fy, W, FOOTER_H);
        ctx.fillStyle = '#fff';
        ctx.font = '600 12px "DM Sans", system-ui, sans-serif';
        const totalTxt = agreements.length > MAX_CARDS
            ? `Mostrando ${MAX_CARDS} de ${agreements.length} acuerdos · agropulse.company`
            : `${agreements.length} ${agreements.length === 1 ? 'acuerdo' : 'acuerdos'} en total · agropulse.company`;
        ctx.fillText(totalTxt, PAD, fy + 24);
        ctx.globalAlpha = 0.55;
        ctx.font = '10.5px "DM Sans", system-ui, sans-serif';
        ctx.fillText('Conectando comunidades agrícolas', PAD, fy + 42);
        ctx.globalAlpha = 1;

        return canvas;
    },

    _roundRect(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    },

    // ========== Helpers ==========
    _esc(s) {
        return String(s || '').replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
        })[c]);
    },

    formatPrice(n) {
        return '$' + Math.round(n || 0).toLocaleString('es-CO');
    },

    _openOverlay(id, html) {
        let el = document.getElementById(id);
        if (!el) {
            el = document.createElement('div');
            el.id = id;
            el.className = 'sub-overlay';
            document.body.appendChild(el);
        }
        el.innerHTML = html;
        el.classList.add('visible');
        document.body.classList.add('no-scroll');
        if (window.lucide) lucide.createIcons();
    },

    _closeOverlay(id) {
        const el = document.getElementById(id);
        if (el) el.classList.remove('visible');
        if (!document.querySelector('.sub-overlay.visible')) {
            document.body.classList.remove('no-scroll');
        }
    },
};
