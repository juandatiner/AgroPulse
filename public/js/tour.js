// Guided tour overlay. Spotlight + tooltip + skip + restart.
const Tour = {
    STORAGE_KEY: 'agropulse_tour_completed_v2',
    _idx: 0,
    _active: false,
    _prevTarget: null,
    _resizeHandler: null,
    _scrollHandler: null,

    steps: [
        {
            title: '¡Bienvenido a AgroPulse!',
            body: 'Te haré un recorrido rápido por las funciones principales. Puedes omitirlo cuando quieras y volver a iniciarlo desde el botón de ayuda en la barra superior.',
            target: null,
            tab: 'inicio',
        },
        {
            title: 'Acciones rápidas',
            body: 'Desde aquí puedes publicar una oferta, pedir recursos, prestar equipo o proponer un trueque con un solo toque.',
            target: '.quick-actions',
            tab: 'inicio',
        },
        {
            title: 'Tus publicaciones',
            body: 'Aquí ves tus publicaciones recientes y puedes acceder rápido al formulario de publicar. Si aún no tienes ninguna, verás el mensaje vacío con un botón directo para crear la primera.',
            target: '#block-mis-pub',
            tab: 'inicio',
        },
        {
            title: 'De la comunidad',
            body: 'Las publicaciones más recientes de otros productores aparecen aquí. Desliza horizontalmente para verlas todas y toca cualquier tarjeta para abrir el detalle, fotos, ubicación y datos del dueño.',
            target: '#block-comunidad',
            tab: 'inicio',
        },
        {
            title: 'Inicio',
            body: 'Tu pantalla principal: acciones rápidas, tus publicaciones y novedades de la comunidad.',
            target: '[data-tab="inicio"]',
            tab: 'inicio',
        },
        {
            title: 'Buscar en el mercado',
            body: 'Explora ofertas, solicitudes, préstamos y trueques de toda la comunidad. Filtra por tipo o busca por palabra clave.',
            target: '[data-tab="mercado"]',
            tab: 'mercado',
        },
        {
            title: 'Buscador y filtros',
            body: 'Escribe lo que necesitas y usa los filtros para acotar resultados.',
            target: '#market-search-input',
            tab: 'mercado',
        },
        {
            title: 'Publicar',
            body: 'Crea una nueva publicación: elige tipo, agrega detalles, fotos y ubicación.',
            target: '[data-tab="publicar"]',
            tab: 'publicar',
        },
        {
            title: 'Cómo concretar un acuerdo',
            html: `
                <div class="tour-flow">
                    <div class="tour-flow-step">
                        <div class="tour-flow-num">1</div>
                        <div class="tour-flow-body">
                            <div class="tour-flow-title"><i data-lucide="search"></i> Abre una publicación</div>
                            <div class="tour-flow-desc">Explora el mercado y toca la tarjeta que te interese para ver fotos, ubicación y dueño.</div>
                        </div>
                    </div>
                    <div class="tour-flow-step">
                        <div class="tour-flow-num">2</div>
                        <div class="tour-flow-body">
                            <div class="tour-flow-title"><i data-lucide="hand"></i> Toca "Contactar"</div>
                            <div class="tour-flow-desc">Envía tu propuesta al dueño. Se crea automáticamente un acuerdo y se abre el chat.</div>
                        </div>
                    </div>
                    <div class="tour-flow-step">
                        <div class="tour-flow-num">3</div>
                        <div class="tour-flow-body">
                            <div class="tour-flow-title"><i data-lucide="message-circle"></i> Coordinen por chat</div>
                            <div class="tour-flow-desc">Acuerden <strong>precio</strong>, <strong>cantidad</strong>, <strong>fecha</strong> y <strong>lugar</strong> de entrega.</div>
                        </div>
                    </div>
                </div>`,
            target: null,
            tab: 'mercado',
        },
        {
            title: 'Servicios e intercambios',
            body: 'Aquí gestionas todos tus acuerdos. El indicador rojo avisa cuando hay algo por revisar.',
            target: '[data-tab="intercambios"]',
            tab: 'intercambios',
        },
        {
            title: 'Estados del acuerdo',
            body: 'Pendientes: esperando respuesta. Activos: aceptados, en ejecución. Completados: ya cumplidos. Cancelados: rechazados o cancelados por alguna parte.',
            target: '.status-tabs',
            tab: 'intercambios',
        },
        {
            title: 'Chat dentro del acuerdo',
            html: `
                <div class="tour-flow">
                    <div class="tour-flow-step">
                        <div class="tour-flow-icon"><i data-lucide="message-square"></i></div>
                        <div class="tour-flow-body">
                            <div class="tour-flow-title">Mensajes privados</div>
                            <div class="tour-flow-desc">Conversa solo con la otra parte del acuerdo.</div>
                        </div>
                    </div>
                    <div class="tour-flow-step">
                        <div class="tour-flow-icon"><i data-lucide="image"></i></div>
                        <div class="tour-flow-body">
                            <div class="tour-flow-title">Fotos</div>
                            <div class="tour-flow-desc">Envía imágenes del recurso o de la entrega.</div>
                        </div>
                    </div>
                    <div class="tour-flow-step">
                        <div class="tour-flow-icon"><i data-lucide="map-pin"></i></div>
                        <div class="tour-flow-body">
                            <div class="tour-flow-title">Ubicación</div>
                            <div class="tour-flow-desc">Comparte el punto exacto del encuentro.</div>
                        </div>
                    </div>
                </div>`,
            target: null,
            tab: 'intercambios',
        },
        {
            title: 'Marcar como completado',
            html: `
                <div class="tour-flow">
                    <div class="tour-flow-step">
                        <div class="tour-flow-icon"><i data-lucide="user-cog"></i></div>
                        <div class="tour-flow-body">
                            <div class="tour-flow-title">Solo el dueño de la publicación</div>
                            <div class="tour-flow-desc">Quien publicó el recurso es quien cierra el acuerdo.</div>
                        </div>
                    </div>
                    <div class="tour-flow-step">
                        <div class="tour-flow-icon"><i data-lucide="check-circle"></i></div>
                        <div class="tour-flow-body">
                            <div class="tour-flow-title">Botón "Completar"</div>
                            <div class="tour-flow-desc">Aparece en la tarjeta del acuerdo activo y dentro del chat.</div>
                        </div>
                    </div>
                    <div class="tour-flow-step">
                        <div class="tour-flow-icon"><i data-lucide="lock"></i></div>
                        <div class="tour-flow-body">
                            <div class="tour-flow-title">Acuerdo cerrado</div>
                            <div class="tour-flow-desc">Pasa al estado <strong>Completado</strong> y se habilita la calificación para ambas partes.</div>
                        </div>
                    </div>
                </div>`,
            target: null,
            tab: 'intercambios',
        },
        {
            title: 'Calificar a la otra parte',
            html: `
                <div class="tour-flow">
                    <div class="tour-flow-step">
                        <div class="tour-flow-icon tour-flow-icon-star"><i data-lucide="star"></i></div>
                        <div class="tour-flow-body">
                            <div class="tour-flow-title">Estrellas 1 a 5</div>
                            <div class="tour-flow-desc">Toca las estrellas para puntuar la experiencia.</div>
                        </div>
                    </div>
                    <div class="tour-flow-step">
                        <div class="tour-flow-icon"><i data-lucide="message-square-text"></i></div>
                        <div class="tour-flow-body">
                            <div class="tour-flow-title">Comentario y etiquetas</div>
                            <div class="tour-flow-desc">Selecciona etiquetas y deja una reseña corta.</div>
                        </div>
                    </div>
                    <div class="tour-flow-step">
                        <div class="tour-flow-icon"><i data-lucide="trophy"></i></div>
                        <div class="tour-flow-body">
                            <div class="tour-flow-title">Reputación pública</div>
                            <div class="tour-flow-desc">Tu nota suma al perfil de la otra persona.</div>
                        </div>
                    </div>
                </div>`,
            target: null,
            tab: 'intercambios',
        },
        {
            title: 'Tu perfil',
            body: 'Edita tus datos, revisa tus estadísticas, ajusta tu cuenta o cierra sesión.',
            target: '[data-tab="perfil"]',
            tab: 'perfil',
        },
        {
            title: 'Reiniciar tutorial',
            body: 'Cuando quieras volver a ver este recorrido, toca este botón en la barra superior. ¡Listo para usar AgroPulse!',
            target: '#nav-tour-btn',
            tab: 'inicio',
        },
    ],

    maybeStart() {
        try {
            if (!localStorage.getItem(this.STORAGE_KEY)) {
                setTimeout(() => this.start(), 600);
            }
        } catch (e) { /* ignore */ }
    },

    start() {
        this._idx = 0;
        this._active = true;
        const root = document.getElementById('tour-root');
        root.style.display = 'block';
        root.setAttribute('aria-hidden', 'false');
        this._bindViewportHandlers();
        this._render();
    },

    next() {
        if (this._idx >= this.steps.length - 1) return this.finish();
        this._idx++;
        this._render();
    },

    prev() {
        if (this._idx === 0) return;
        this._idx--;
        this._render();
    },

    skip() {
        this._markCompleted();
        this._close();
    },

    finish() {
        this._markCompleted();
        this._close();
    },

    _markCompleted() {
        try { localStorage.setItem(this.STORAGE_KEY, '1'); } catch (e) { /* ignore */ }
    },

    _close() {
        this._active = false;
        this._clearTargetHighlight();
        const root = document.getElementById('tour-root');
        root.style.display = 'none';
        root.setAttribute('aria-hidden', 'true');
        this._unbindViewportHandlers();
    },

    _clearTargetHighlight() {
        if (this._prevTarget) {
            this._prevTarget.classList.remove('tour-target-active');
            this._prevTarget = null;
        }
    },

    _render() {
        const step = this.steps[this._idx];
        if (!step) return this.finish();

        if (step.tab && typeof App !== 'undefined' && App.currentTab !== step.tab) {
            App.switchTab(step.tab);
        }

        document.getElementById('tour-title').textContent = step.title;
        const bodyEl = document.getElementById('tour-body');
        if (step.html) {
            bodyEl.innerHTML = step.html;
            if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [bodyEl] });
        } else {
            bodyEl.textContent = step.body || '';
        }
        document.getElementById('tour-step-num').textContent =
            `Paso ${this._idx + 1} de ${this.steps.length}`;

        const prevBtn = document.getElementById('tour-prev');
        prevBtn.disabled = this._idx === 0;

        const nextBtn = document.getElementById('tour-next');
        nextBtn.textContent = this._idx === this.steps.length - 1 ? 'Finalizar' : 'Siguiente';

        // Wait a tick so panel switch repaints before measuring target.
        requestAnimationFrame(() => requestAnimationFrame(() => this._position(step)));
    },

    _position(step) {
        this._clearTargetHighlight();
        const spotlight = document.getElementById('tour-spotlight');
        const tooltip = document.getElementById('tour-tooltip');

        if (!step.target) {
            spotlight.classList.add('tour-centered');
            spotlight.style.top = '50%';
            spotlight.style.left = '50%';
            spotlight.style.width = '0px';
            spotlight.style.height = '0px';
            this._placeTooltipCenter(tooltip);
            return;
        }

        const el = document.querySelector(step.target);
        if (!el) {
            // Fallback: center if missing
            spotlight.classList.add('tour-centered');
            this._placeTooltipCenter(tooltip);
            return;
        }

        spotlight.classList.remove('tour-centered');
        el.classList.add('tour-target-active');
        this._prevTarget = el;

        // Scroll into view if needed
        const rectInit = el.getBoundingClientRect();
        if (rectInit.top < 60 || rectInit.bottom > window.innerHeight - 60) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            setTimeout(() => this._applySpotlight(el, spotlight, tooltip), 320);
        } else {
            this._applySpotlight(el, spotlight, tooltip);
        }
    },

    _applySpotlight(el, spotlight, tooltip) {
        const r = el.getBoundingClientRect();
        // Pad reducido para no invadir espacio vertical/horizontal del vecino
        const pad = 3;
        const top = r.top - pad;
        const left = r.left - pad;
        const w = r.width + pad * 2;
        const h = r.height + pad * 2;

        spotlight.style.top = top + 'px';
        spotlight.style.left = left + 'px';
        spotlight.style.width = w + 'px';
        spotlight.style.height = h + 'px';

        this._placeTooltip(tooltip, { top, left, width: w, height: h });
    },

    _placeTooltipCenter(tooltip) {
        tooltip.style.left = '50%';
        tooltip.style.top = '50%';
        tooltip.style.transform = 'translate(-50%, -50%)';
    },

    _placeTooltip(tooltip, rect) {
        tooltip.style.transform = 'none';
        const tw = tooltip.offsetWidth || 320;
        const th = tooltip.offsetHeight || 180;
        const margin = 14;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        // Restar altura barra inferior fija si está visible para no montar el tooltip sobre los botones
        const tabBar = document.querySelector('.tab-bar');
        let bottomReserved = 0;
        if (tabBar) {
            const cs = getComputedStyle(tabBar);
            const visible = cs.display !== 'none' && cs.visibility !== 'hidden';
            if (visible) bottomReserved = tabBar.getBoundingClientRect().height + 12;
        }
        const usableBottom = vh - bottomReserved;

        let top, left;
        const spaceBelow = usableBottom - (rect.top + rect.height);
        const spaceAbove = rect.top;

        if (spaceBelow >= th + margin) {
            top = rect.top + rect.height + margin;
        } else if (spaceAbove >= th + margin) {
            top = rect.top - th - margin;
        } else {
            // Center vertically dentro del área útil
            top = Math.max(margin, (usableBottom - th) / 2);
        }
        // Clamp para que no se salga del área útil
        if (top + th > usableBottom - margin) top = Math.max(margin, usableBottom - margin - th);

        left = rect.left + rect.width / 2 - tw / 2;
        if (left < margin) left = margin;
        if (left + tw > vw - margin) left = vw - margin - tw;

        tooltip.style.top = top + 'px';
        tooltip.style.left = left + 'px';
    },

    _bindViewportHandlers() {
        this._resizeHandler = () => { if (this._active) this._render(); };
        this._scrollHandler = () => {
            if (!this._active) return;
            const step = this.steps[this._idx];
            if (step && step.target) this._position(step);
        };
        this._keyHandler = (e) => {
            if (!this._active) return;
            if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); this.next(); }
            else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); this.prev(); }
            else if (e.key === 'Escape') { e.preventDefault(); this.skip(); }
        };
        window.addEventListener('resize', this._resizeHandler);
        window.addEventListener('scroll', this._scrollHandler, true);
        document.addEventListener('keydown', this._keyHandler);
    },

    _unbindViewportHandlers() {
        if (this._resizeHandler) window.removeEventListener('resize', this._resizeHandler);
        if (this._scrollHandler) window.removeEventListener('scroll', this._scrollHandler, true);
        if (this._keyHandler) document.removeEventListener('keydown', this._keyHandler);
        this._resizeHandler = null;
        this._scrollHandler = null;
        this._keyHandler = null;
    },
};
