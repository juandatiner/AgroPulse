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
            body: 'Aquí ves tus publicaciones recientes y puedes acceder rápido al formulario de publicar.',
            target: '#section-mis-pub',
            tab: 'inicio',
        },
        {
            title: 'De la comunidad',
            body: 'Las publicaciones más recientes de otros productores aparecen aquí. Toca cualquier tarjeta para ver el detalle, fotos y ubicación.',
            target: '#section-comunidad',
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
            body: '1) Abre una publicación de la comunidad. 2) Toca "Contactar" para enviar tu propuesta al dueño. 3) Se crea un acuerdo y se abre el chat para coordinar precio, cantidad, fecha y lugar.',
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
            body: 'Cada acuerdo tiene su chat privado. Allí puedes mandar mensajes, fotos y compartir tu ubicación para coordinar la entrega.',
            target: null,
            tab: 'intercambios',
        },
        {
            title: 'Marcar como completado',
            body: 'Cuando el intercambio se cumpla, ambas partes lo marcan como completado desde la tarjeta del acuerdo. Solo así pasa a estado "Completado".',
            target: null,
            tab: 'intercambios',
        },
        {
            title: 'Calificar a la otra parte',
            body: 'Tras completar el acuerdo, califica con estrellas y deja un comentario. Tu calificación construye la reputación de la comunidad y aparece en el perfil público.',
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
        document.getElementById('tour-body').textContent = step.body;
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
        const pad = 8;
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

        let top, left;
        const spaceBelow = vh - (rect.top + rect.height);
        const spaceAbove = rect.top;

        if (spaceBelow >= th + margin) {
            top = rect.top + rect.height + margin;
        } else if (spaceAbove >= th + margin) {
            top = rect.top - th - margin;
        } else {
            // Center vertically as fallback
            top = Math.max(margin, (vh - th) / 2);
        }

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
        window.addEventListener('resize', this._resizeHandler);
        window.addEventListener('scroll', this._scrollHandler, true);
    },

    _unbindViewportHandlers() {
        if (this._resizeHandler) window.removeEventListener('resize', this._resizeHandler);
        if (this._scrollHandler) window.removeEventListener('scroll', this._scrollHandler, true);
        this._resizeHandler = null;
        this._scrollHandler = null;
    },
};
