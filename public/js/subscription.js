const Subscription = {
    state: null,
    lastState: null,

    isPremium() { return !!(this.state && this.state.is_premium); },
    isPro() { return !!(this.state && this.state.is_pro); },
    isBlocked() { return !!(this.state && this.state.needs_payment); },

    async refresh() {
        try {
            this.state = await API.getSubscription();
            this.renderBanner();
            this.renderHomeCards();
            this.renderAds();
            this.updateVerifiedBadge();
            return this.state;
        } catch (e) {
            return null;
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
        if (s.status === 'active') { el.classList.add('hidden'); return; }
        // Si no hay trial configurado (0 días) y el usuario nunca tuvo prueba, ocultar
        if (s.status !== 'trial' && (!s.trial_days_granted || s.trial_days_granted <= 0) && !s.trial_end) {
            el.classList.add('hidden'); return;
        }
        // Si el user lo cerró en esta sesión, mantener oculto hasta próximo login
        try {
            if (sessionStorage.getItem('agropulse_promo_banner_closed') === '1') {
                el.classList.add('hidden');
                return;
            }
        } catch {}
        el.classList.remove('hidden');
        const priceReg = this.formatPrice(s.price_regular);
        const pricePromo = this.formatPrice(s.price_promo);
        const promoText = s.promo_active
            ? `<span class="promo-tag">50% OFF</span> <s>${priceReg}</s> ahora <strong>${pricePromo}</strong>/mes`
            : `Desde ${pricePromo}/mes`;

        let countdown = '';
        if (s.status === 'trial' && s.trial_days_left > 0) {
            countdown = `🎁 Prueba gratuita: <strong>${s.trial_days_left} ${s.trial_days_left === 1 ? 'día' : 'días'}</strong> restantes · `;
        } else if (s.status === 'trial' && s.trial_days_left === 0) {
            countdown = `⏰ Tu prueba gratis termina hoy · `;
        } else if (s.status === 'expired') {
            countdown = `⛔ Prueba vencida · `;
        } else if (s.promo_active && s.promo_days_left > 0) {
            countdown = `🔥 Promo termina en <strong>${s.promo_days_left} ${s.promo_days_left === 1 ? 'día' : 'días'}</strong> · `;
        }

        el.innerHTML = `
            <div class="promo-banner-inner">
                <span class="promo-banner-text">${countdown}${promoText}</span>
                <button class="promo-banner-cta">Ver suscripción <i data-lucide="chevron-right"></i></button>
                <button class="promo-banner-close" onclick="event.stopPropagation(); Subscription.closeBanner()" aria-label="Cerrar banner">
                    <i data-lucide="x"></i>
                </button>
            </div>
        `;
        if (window.lucide) lucide.createIcons();
    },

    closeBanner() {
        const el = document.getElementById('promo-banner');
        if (el) el.classList.add('hidden');
        try { sessionStorage.setItem('agropulse_promo_banner_closed', '1'); } catch {}
    },

    // ========== Home cards: trial progreso + posts remaining ==========
    renderHomeCards() {
        const host = document.getElementById('panel-inicio');
        if (!host) return;
        let card = document.getElementById('sub-home-card');
        if (!this.state) return;
        const s = this.state;
        if (s.status === 'active') { if (card) card.remove(); return; }

        if (!card) {
            card = document.createElement('div');
            card.id = 'sub-home-card';
            card.className = 'sub-home-card';
            const hero = host.querySelector('.home-hero');
            if (hero) host.insertBefore(card, hero.nextSibling);
            else host.insertBefore(card, host.firstChild);
        }

        const inTrial = s.status === 'trial' && s.trial_days_left > 0;
        let statusText = '';
        let statusClass = '';
        let bodyHtml = '';

        if (inTrial) {
            statusText = `<strong>${s.trial_days_left}</strong> ${s.trial_days_left === 1 ? 'día' : 'días'} de prueba Pro`;
            statusClass = 'sub-card-trial';
            const trialTotal = Math.max(1, s.trial_days_granted || s.trial_days_left || 1);
            const trialPct = Math.max(2, Math.round(((trialTotal - s.trial_days_left) / trialTotal) * 100));
            bodyHtml = `
                <p class="sub-home-card-hint" style="margin-bottom:8px">
                    Acceso <strong>ilimitado</strong> a todas las funciones Pro durante tu prueba
                </p>
                <div class="sub-posts-bar"><div class="sub-posts-fill" style="width:${trialPct}%"></div></div>
                <p class="sub-home-card-hint" style="margin-top:6px">
                    Suscríbete antes de que termine y mantén todos los beneficios
                </p>
            `;
        } else if (s.status === 'expired') {
            statusText = `Tu prueba gratuita terminó`;
            statusClass = 'sub-card-expired';
            const remaining = s.posts_remaining;
            const used = s.monthly_post_count;
            const total = s.free_posts_per_month;
            const pct = Math.min(100, Math.round((used / Math.max(1, total)) * 100));
            bodyHtml = `
                <div class="sub-posts-line">
                    <span>Publicaciones de este mes</span>
                    <span class="sub-posts-count"><strong>${used}</strong> / ${total}</span>
                </div>
                <div class="sub-posts-bar"><div class="sub-posts-fill" style="width:${pct}%"></div></div>
                <p class="sub-home-card-hint">
                    ${remaining > 0
                        ? `Te quedan <strong>${remaining}</strong> ${remaining === 1 ? 'publicación' : 'publicaciones'} gratuitas este mes`
                        : `Alcanzaste el límite mensual. Suscríbete para publicar sin límite`}
                </p>
            `;
        } else {
            statusText = `Plan gratuito`;
            statusClass = 'sub-card-free';
            const remaining = s.posts_remaining;
            const used = s.monthly_post_count;
            const total = s.free_posts_per_month;
            const pct = Math.min(100, Math.round((used / Math.max(1, total)) * 100));
            bodyHtml = `
                <div class="sub-posts-line">
                    <span>Publicaciones de este mes</span>
                    <span class="sub-posts-count"><strong>${used}</strong> / ${total}</span>
                </div>
                <div class="sub-posts-bar"><div class="sub-posts-fill" style="width:${pct}%"></div></div>
                <p class="sub-home-card-hint">
                    ${remaining > 0
                        ? `Te quedan <strong>${remaining}</strong> ${remaining === 1 ? 'publicación' : 'publicaciones'} gratuitas este mes`
                        : `Alcanzaste el límite mensual. Suscríbete para publicar sin límite`}
                </p>
            `;
        }

        card.className = 'sub-home-card ' + statusClass;
        card.innerHTML = `
            <div class="sub-home-card-head">
                <div class="sub-home-card-title">
                    <i data-lucide="sparkles"></i>
                    <span>${statusText}</span>
                </div>
                <button class="sub-home-card-action" onclick="Subscription.openPlans()">${inTrial ? 'Suscribirme' : 'Mejorar plan'}</button>
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
        mercado: 'top',
        publicar: 'top',
        intercambios: 'top',
        perfil: 'right',
    },
    _adRotationIdx: 0,
    _adRotationTimer: null,

    renderAds() {
        const panels = ['inicio', 'mercado', 'publicar', 'intercambios', 'perfil'];
        if (this.isPro()) {
            panels.forEach(p => {
                const host = document.getElementById('panel-' + p);
                const old = document.getElementById('sub-ads-slot-' + p);
                if (old) old.remove();
                if (host) host.classList.remove('panel-with-right-ad');
            });
            const legacy = document.getElementById('sub-ads-bar');
            if (legacy) legacy.remove();
            if (this._adRotationTimer) { clearInterval(this._adRotationTimer); this._adRotationTimer = null; }
            return;
        }
        const legacy = document.getElementById('sub-ads-bar');
        if (legacy) legacy.remove();

        panels.forEach((panelName, idx) => {
            const host = document.getElementById('panel-' + panelName);
            if (!host) return;
            const slotId = 'sub-ads-slot-' + panelName;
            const position = this._slotPositions[panelName] || 'top';
            let slot = document.getElementById(slotId);
            if (!slot) {
                slot = document.createElement('div');
                slot.id = slotId;
            }
            slot.className = 'sub-ads-slot sub-ads-slot-' + position;
            if (slot.parentNode) slot.parentNode.removeChild(slot);

            if (position === 'right') {
                host.classList.add('panel-with-right-ad');
                // Insertar como PRIMER hijo para que float:right funcione con el contenido siguiente
                host.insertBefore(slot, host.firstChild);
            } else {
                host.classList.remove('panel-with-right-ad');
                if (position === 'bottom') host.appendChild(slot);
                else host.insertBefore(slot, host.firstChild);
            }

            const vertical = position === 'right';
            const count = vertical ? 4 : 3;
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

        const basicFeatures = [
            { text: 'Publicaciones ilimitadas', ok: true },
            { text: 'Sin anuncios', ok: false },
            { text: 'Alertas de match inteligente', ok: false },
            { text: 'Chat con fotos y ubicación', ok: false },
            { text: 'Exportar acuerdos a CSV', ok: false },
            { text: 'Soporte prioritario', ok: false },
        ];
        const proFeatures = [
            { text: 'Publicaciones ilimitadas', ok: true },
            { text: 'Sin anuncios', ok: true },
            { text: 'Alertas de match inteligente', ok: true },
            { text: 'Chat con fotos y ubicación', ok: true },
            { text: 'Exportar acuerdos a CSV', ok: true },
            { text: 'Soporte prioritario', ok: true },
        ];

        const renderFeatures = (arr) => arr.map(f => `
            <li class="${f.ok ? 'plan-feat-ok' : 'plan-feat-no'}">
                <i data-lucide="${f.ok ? 'check-circle-2' : 'x-circle'}"></i>
                <span>${this._esc(f.text)}</span>
            </li>
        `).join('');

        const ctaBasic = (alreadyActive && currentTier === 'basic')
            ? `<button class="btn btn-outline btn-full" disabled>Tu plan actual</button>`
            : (alreadyActive && currentTier === 'pro'
                ? `<button class="btn btn-outline btn-full" disabled>Ya tienes Pro</button>`
                : `<button class="btn btn-primary btn-full" onclick="Subscription.openCheckout('basic')">
                     <i data-lucide="credit-card"></i> Suscribirme al Básico
                   </button>`);

        const ctaPro = (alreadyActive && currentTier === 'pro')
            ? `<button class="btn btn-outline btn-full" disabled>Tu plan actual</button>`
            : `<button class="btn btn-primary btn-full" onclick="Subscription.openCheckout('pro')">
                 <i data-lucide="credit-card"></i> Suscribirme al Pro
               </button>`;

        const html = `
            <div class="plans-overlay-inner">
                <button class="plans-close" onclick="Subscription.closePlans()"><i data-lucide="x"></i></button>
                <div class="plans-hero plans-hero-compact">
                    <div class="plans-crown"><i data-lucide="crown"></i></div>
                    <h2>Elige tu plan</h2>
                    <p>Dos opciones pensadas para tu actividad</p>
                    ${promo && s.promo_days_left > 0 ? `<p class="plans-price-promo-hint">🔥 Promo ${discountLabel} termina en ${s.promo_days_left} ${s.promo_days_left === 1 ? 'día' : 'días'}</p>` : ''}
                </div>

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

                <p class="plans-legal">Pago mensual · Cancela cuando quieras · Simulación de pago (demo)</p>
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
        if (s.is_premium && s.plan_tier === 'pro') {
            App.showToast('Ya tienes el plan Pro activo', 'info');
            return;
        }
        if (s.is_premium && s.status === 'trial') {
            App.showToast('Ya tienes tu prueba gratuita activa', 'info');
            return;
        }
        const selectedPlan = plan === 'pro' ? 'pro' : (plan === 'basic' ? 'basic' : 'basic');
        this._selectedPlan = selectedPlan;
        const planLabel = selectedPlan === 'pro' ? 'Pro' : 'Básico';
        const priceAmount = selectedPlan === 'pro' ? (s.price_pro || 12900) : (s.price_basic || 7900);
        const pricePromo = this.formatPrice(priceAmount);
        const html = `
            <div class="checkout-overlay-inner">
                <button class="plans-close" onclick="Subscription.closeCheckout()"><i data-lucide="x"></i></button>
                <div class="checkout-secure-bar">
                    <i data-lucide="shield-check"></i>
                    <span>Conexión segura — Pago cifrado</span>
                    <div class="checkout-brands">
                        <span>VISA</span><span>MC</span><span>AMEX</span>
                    </div>
                </div>
                <h2>Suscripción AgroPulse ${planLabel}</h2>
                <div class="checkout-summary">
                    <div><span>Plan ${planLabel} (mensual)</span><strong>${pricePromo}</strong></div>
                    <div><span>IVA (19%)</span><strong>Incluido</strong></div>
                    <div class="checkout-total"><span>Total hoy</span><strong>${pricePromo}</strong></div>
                </div>
                <form id="checkout-form" class="checkout-form" onsubmit="event.preventDefault(); Subscription.submitCheckout()">
                    <div class="form-group">
                        <label class="form-label">Titular de la tarjeta</label>
                        <input type="text" id="ck-holder" class="form-input" placeholder="Como aparece en la tarjeta" autocomplete="cc-name">
                    </div>
                    <div class="form-group">
                        <label class="form-label">Número de tarjeta</label>
                        <input type="text" id="ck-card" class="form-input" placeholder="4242 4242 4242 4242"
                               inputmode="numeric" maxlength="23" autocomplete="cc-number"
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
                                   inputmode="numeric" maxlength="4" autocomplete="cc-csc">
                        </div>
                    </div>
                    <div class="checkout-demo-note">
                        <i data-lucide="info"></i>
                        <span>Demo: prueba con <code>4242 4242 4242 4242</code>, expiración futura y CVV <code>123</code></span>
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

    _formatExp(input) {
        let v = input.value.replace(/\D/g, '').slice(0, 4);
        if (v.length >= 3) input.value = v.slice(0, 2) + ' / ' + v.slice(2);
        else input.value = v;
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
            this._openOverlay('success-overlay', `
                <div class="success-overlay-inner">
                    <div class="success-check"><i data-lucide="check-circle-2"></i></div>
                    <h2>¡Suscripción activada!</h2>
                    <p>Gracias por unirte a AgroPulse Pro</p>
                    <div class="success-receipt">
                        <div><span>Referencia</span><strong>${result.reference}</strong></div>
                        <div><span>Renovación</span><strong>${new Date(this.state.subscription_end).toLocaleDateString()}</strong></div>
                    </div>
                    <button class="btn btn-primary btn-full" onclick="Subscription._closeOverlay('success-overlay'); Subscription.refresh(); App.loadHome && App.loadHome();">
                        Continuar
                    </button>
                </div>
            `);
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
    async openMatches() {
        if (!this.isPro()) {
            this.openPaywall('Las alertas inteligentes cruzan tus publicaciones con las de otros productores. Disponibles solo en el plan Pro.');
            return;
        }
        this._openOverlay('matches-overlay', `
            <div class="matches-overlay-inner">
                <button class="plans-close" onclick="Subscription._closeOverlay('matches-overlay')"><i data-lucide="x"></i></button>
                <h2><i data-lucide="bell-ring"></i> Alertas de match</h2>
                <p class="matches-intro">Otras publicaciones que coinciden con las tuyas por categoría y municipio</p>
                <div id="matches-list" class="matches-list"><div class="skeleton-card skeleton"></div></div>
            </div>
        `);
        try {
            const matches = await API.getMatches();
            const list = document.getElementById('matches-list');
            if (!matches.length) {
                list.innerHTML = `<div class="empty-state">
                    <i data-lucide="inbox"></i>
                    <p>Aún no hay coincidencias. Sigue publicando para generar matches.</p>
                </div>`;
            } else {
                list.innerHTML = matches.map(m => `
                    <div class="match-card">
                        <div class="match-head">
                            <span class="match-tipo ${m.match_tipo}">${m.match_tipo}</span>
                            <small>${m.match_municipio || ''}</small>
                        </div>
                        <strong>${this._esc(m.match_titulo)}</strong>
                        <p>${this._esc((m.match_descripcion || '').slice(0, 140))}</p>
                        <div class="match-foot">
                            <span>Publicado por ${this._esc(m.match_user_nombre || '')} ${this._esc(m.match_user_apellido || '')} ${m.match_user_verified ? '<i data-lucide="badge-check" class="verified-inline"></i>' : ''}</span>
                            <button class="btn btn-outline btn-sm" onclick="Subscription._closeOverlay('matches-overlay'); App.showResourceDetail('${m.match_id}')">
                                Ver publicación
                            </button>
                        </div>
                        <div class="match-hint">↔ coincide con tu publicación "<em>${this._esc(m.my_resource_titulo)}</em>"</div>
                    </div>
                `).join('');
            }
            if (window.lucide) lucide.createIcons();
        } catch (e) {
            App.showToast(e.message || 'Error al cargar matches', 'error');
        }
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
                    <textarea id="nt-message" class="form-input" rows="5" placeholder="Cuéntanos qué ocurre..."></textarea>
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
    async openInvoices() {
        this._openOverlay('invoices-overlay', `
            <div class="invoices-overlay-inner">
                <button class="plans-close" onclick="Subscription._closeOverlay('invoices-overlay')"><i data-lucide="x"></i></button>
                <h2><i data-lucide="receipt"></i> Historial de pagos</h2>
                <div id="invoices-list" class="invoices-list"><div class="skeleton-card skeleton"></div></div>
            </div>
        `);
        try {
            const invoices = await API.getInvoices();
            const host = document.getElementById('invoices-list');
            if (!invoices.length) {
                host.innerHTML = `<div class="empty-state"><i data-lucide="inbox"></i><p>Aún no tienes pagos registrados</p></div>`;
            } else {
                host.innerHTML = invoices.map(inv => `
                    <div class="invoice-item">
                        <div class="invoice-head">
                            <strong>${this.formatPrice(inv.amount)}</strong>
                            <span class="invoice-status invoice-${inv.status}">${inv.status === 'paid' ? 'Pagado' : 'Rechazado'}</span>
                        </div>
                        <small>${inv.card_brand} •••• ${inv.card_last4 || '----'} · ${new Date(inv.created_at).toLocaleString()}</small>
                        <small class="invoice-ref">Ref: ${inv.reference}</small>
                    </div>
                `).join('');
            }
            if (window.lucide) lucide.createIcons();
        } catch (e) { App.showToast(e.message, 'error'); }
    },

    async downloadCsv() {
        if (!this.isPro()) {
            this.openPaywall('La exportación a CSV está disponible solo en el plan Pro.');
            return;
        }
        try {
            const res = await fetch('/api/agreements/export', {
                headers: { 'Authorization': 'Bearer ' + API.token },
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.message || err.error || 'Error al exportar');
            }
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'agropulse-acuerdos.csv';
            a.click();
            URL.revokeObjectURL(url);
            App.showToast('CSV descargado');
        } catch (e) {
            App.showToast(e.message, 'error');
        }
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
