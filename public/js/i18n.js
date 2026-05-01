/* === i18n: español + inglés === */
const I18N = (() => {
  const dict = {
    es: {
      // Tabs nav
      'nav.inicio': 'Inicio',
      'nav.mercado': 'Mercado',
      'nav.publicar': 'Publicar',
      'nav.intercambios': 'Acuerdos',
      'nav.perfil': 'Perfil',

      // Pantalla landing
      'landing.title': 'Conecta tu comunidad agrícola',
      'landing.subtitle': 'Comparte recursos, intercambia productos, presta herramientas y crece con otros productores.',
      'landing.cta.signup': 'Crear cuenta',
      'landing.cta.login': 'Ya tengo cuenta',
      'landing.benefits': 'Beneficios',

      // Login / registro
      'auth.login.title': 'Iniciar sesión',
      'auth.register.title': 'Crear cuenta',
      'auth.email': 'Correo electrónico',
      'auth.password': 'Contraseña',
      'auth.name': 'Nombre',
      'auth.lastname': 'Apellido',
      'auth.phone': 'Teléfono',
      'auth.tipo': 'Tipo de productor',
      'auth.location': 'Municipio',
      'auth.bio': 'Cuéntanos de ti',
      'auth.submit.login': 'Entrar',
      'auth.submit.register': 'Crear cuenta',
      'auth.have_account': '¿Ya tienes cuenta?',
      'auth.no_account': '¿No tienes cuenta?',

      // Perfil
      'profile.section.account': 'Cuenta',
      'profile.section.pro': 'AgroPulse Pro',
      'profile.section.support': 'Soporte',
      'profile.account.config': 'Configuración de cuenta',
      'profile.account.config.sub': 'Nombre, ubicación, tipo de productor',
      'profile.stats.title': 'Mis estadísticas',
      'profile.stats.sub': 'Publicaciones, acuerdos, calificaciones',
      'profile.plan.see': 'Ver planes',
      'profile.matches': 'Alertas de match',
      'profile.matches.sub': 'Cruza tus publicaciones con demanda',
      'profile.export': 'Exportar acuerdos',
      'profile.export.sub': 'Descarga un resumen en imagen',
      'profile.invoices': 'Historial de pagos',
      'profile.invoices.sub': 'Facturas y referencias',
      'profile.support': 'Soporte',
      'profile.support.sub': 'Contáctanos si tienes dudas',
      'profile.logout': 'Cerrar sesión',
      'profile.stat.deals': 'Acuerdos',
      'profile.stat.posts': 'Publicaciones',
      'profile.stat.rating': 'Calificación',

      // Apariencia / Idioma
      'appearance.theme': 'Apariencia',
      'appearance.theme.sub': 'Modo claro u oscuro',
      'theme.light': 'Claro',
      'theme.dark': 'Oscuro',
      'theme.auto': 'Sistema',
      'language.title': 'Idioma / Language',
      'language.sub': 'Español o inglés',

      // Tipos
      'tipo.oferta': 'Oferta',
      'tipo.solicitud': 'Solicitud',
      'tipo.prestamo': 'Préstamo',
      'tipo.trueque': 'Trueque',

      // Acuerdos / status
      'status.pending': 'Pendiente',
      'status.active': 'En curso',
      'status.completed': 'Completado',
      'status.rejected': 'Rechazado',
      'status.cancelled': 'Cancelado',

      // Comunes
      'common.cancel': 'Cancelar',
      'common.save': 'Guardar',
      'common.delete': 'Eliminar',
      'common.edit': 'Editar',
      'common.send': 'Enviar',
      'common.close': 'Cerrar',
      'common.back': 'Volver',
      'common.next': 'Siguiente',
      'common.continue': 'Continuar',
      'common.search': 'Buscar',
      'common.loading': 'Cargando…',
      'common.error': 'Error',
      'common.success': 'Listo',
      'common.yes': 'Sí',
      'common.no': 'No',
      'common.optional': 'Opcional',

      // Mercado
      'market.title': 'Mercado',
      'market.search.placeholder': 'Buscar publicaciones…',
      'market.empty.title': 'Nada por aquí... todavía',
      'market.empty.sub': 'Sé el primero en publicar algo o intenta con otros filtros',
      'market.empty.cta': 'Publicar recurso',
      'market.view.list': 'Vista lista',
      'market.view.map': 'Vista mapa',

      // Acuerdos
      'agreements.title': 'Acuerdos',
      'agreements.empty.title': 'Sin acuerdos aún',
      'agreements.empty.sub': 'Cuando aceptes una solicitud o alguien acepte la tuya, los acuerdos aparecerán aquí.',
      'agreements.empty.cta': 'Explorar publicaciones',
      'agreements.tab.all': 'Todos',
      'agreements.tab.pending': 'Pendientes',
      'agreements.tab.active': 'En curso',
      'agreements.tab.completed': 'Completados',
      'agreements.tab.cancelled': 'Cancelados',
      'agreements.btn.chat': 'Chat',
      'agreements.btn.accept': 'Aceptar',
      'agreements.btn.complete': 'Completar',
      'agreements.btn.rate': 'Calificar',
      'agreements.btn.waiting': 'Esperando',

      // Reportes
      'report.publication': 'Reportar publicación',
      'report.user': 'Reportar usuario',
      'report.section.reason': 'Motivo',
      'report.section.details': 'Detalles adicionales (opcional)',
      'report.placeholder': 'Cuéntanos qué pasó. Mientras más contexto, mejor podremos revisar.',
      'report.send': 'Enviar reporte',
      'report.legal': 'Los reportes falsos o reiterados pueden afectar tu cuenta.',
      'report.thanks': '¡Gracias! Tu reporte fue enviado.',

      // Soporte
      'support.title': 'Soporte',
      'support.priority': 'Tus tickets se atienden con prioridad',
      'support.normal': 'Tus tickets se atienden en orden normal.',
      'support.new': 'Nuevo ticket',
      'support.subject': 'Asunto',
      'support.message': 'Mensaje',

      // Suscripción
      'sub.upgrade': 'Mejorar a Pro',
      'sub.subscribe': 'Suscribirme',
      'sub.renew': 'Renovar',
      'sub.trial.left': 'Tu prueba termina en',
    },
    en: {
      // Tabs nav
      'nav.inicio': 'Home',
      'nav.mercado': 'Market',
      'nav.publicar': 'Publish',
      'nav.intercambios': 'Deals',
      'nav.perfil': 'Profile',

      // Landing
      'landing.title': 'Connect your farming community',
      'landing.subtitle': 'Share resources, exchange products, lend tools and grow with other farmers.',
      'landing.cta.signup': 'Create account',
      'landing.cta.login': 'I already have an account',
      'landing.benefits': 'Benefits',

      // Auth
      'auth.login.title': 'Sign in',
      'auth.register.title': 'Create account',
      'auth.email': 'Email',
      'auth.password': 'Password',
      'auth.name': 'First name',
      'auth.lastname': 'Last name',
      'auth.phone': 'Phone',
      'auth.tipo': 'Producer type',
      'auth.location': 'Municipality',
      'auth.bio': 'Tell us about yourself',
      'auth.submit.login': 'Sign in',
      'auth.submit.register': 'Create account',
      'auth.have_account': 'Already have an account?',
      'auth.no_account': 'Don\'t have an account?',

      // Profile
      'profile.section.account': 'Account',
      'profile.section.pro': 'AgroPulse Pro',
      'profile.section.support': 'Support',
      'profile.account.config': 'Account settings',
      'profile.account.config.sub': 'Name, location, producer type',
      'profile.stats.title': 'My statistics',
      'profile.stats.sub': 'Posts, deals, ratings',
      'profile.plan.see': 'View plans',
      'profile.matches': 'Match alerts',
      'profile.matches.sub': 'Cross your posts with demand',
      'profile.export': 'Export deals',
      'profile.export.sub': 'Download a summary as image',
      'profile.invoices': 'Payment history',
      'profile.invoices.sub': 'Invoices and references',
      'profile.support': 'Support',
      'profile.support.sub': 'Contact us if you have questions',
      'profile.logout': 'Sign out',
      'profile.stat.deals': 'Deals',
      'profile.stat.posts': 'Posts',
      'profile.stat.rating': 'Rating',

      // Theme / Lang
      'appearance.theme': 'Appearance',
      'appearance.theme.sub': 'Light or dark mode',
      'theme.light': 'Light',
      'theme.dark': 'Dark',
      'theme.auto': 'System',
      'language.title': 'Language / Idioma',
      'language.sub': 'English or Spanish',

      // Types
      'tipo.oferta': 'Offer',
      'tipo.solicitud': 'Request',
      'tipo.prestamo': 'Loan',
      'tipo.trueque': 'Barter',

      // Status
      'status.pending': 'Pending',
      'status.active': 'In progress',
      'status.completed': 'Completed',
      'status.rejected': 'Rejected',
      'status.cancelled': 'Cancelled',

      // Common
      'common.cancel': 'Cancel',
      'common.save': 'Save',
      'common.delete': 'Delete',
      'common.edit': 'Edit',
      'common.send': 'Send',
      'common.close': 'Close',
      'common.back': 'Back',
      'common.next': 'Next',
      'common.continue': 'Continue',
      'common.search': 'Search',
      'common.loading': 'Loading…',
      'common.error': 'Error',
      'common.success': 'Done',
      'common.yes': 'Yes',
      'common.no': 'No',
      'common.optional': 'Optional',

      // Market
      'market.title': 'Market',
      'market.search.placeholder': 'Search posts…',
      'market.empty.title': 'Nothing here... yet',
      'market.empty.sub': 'Be the first to post something or try other filters',
      'market.empty.cta': 'Publish a resource',
      'market.view.list': 'List view',
      'market.view.map': 'Map view',

      // Agreements
      'agreements.title': 'Deals',
      'agreements.empty.title': 'No deals yet',
      'agreements.empty.sub': 'When you accept a request or someone accepts yours, deals will appear here.',
      'agreements.empty.cta': 'Browse posts',
      'agreements.tab.all': 'All',
      'agreements.tab.pending': 'Pending',
      'agreements.tab.active': 'Active',
      'agreements.tab.completed': 'Completed',
      'agreements.tab.cancelled': 'Cancelled',
      'agreements.btn.chat': 'Chat',
      'agreements.btn.accept': 'Accept',
      'agreements.btn.complete': 'Complete',
      'agreements.btn.rate': 'Rate',
      'agreements.btn.waiting': 'Waiting',

      // Reports
      'report.publication': 'Report post',
      'report.user': 'Report user',
      'report.section.reason': 'Reason',
      'report.section.details': 'Additional details (optional)',
      'report.placeholder': 'Tell us what happened. The more context, the better we can review.',
      'report.send': 'Send report',
      'report.legal': 'False or repeated reports may affect your account.',
      'report.thanks': 'Thank you! Your report was sent.',

      // Support
      'support.title': 'Support',
      'support.priority': 'Your tickets are handled with priority',
      'support.normal': 'Your tickets are handled in normal order.',
      'support.new': 'New ticket',
      'support.subject': 'Subject',
      'support.message': 'Message',

      // Subscription
      'sub.upgrade': 'Upgrade to Pro',
      'sub.subscribe': 'Subscribe',
      'sub.renew': 'Renew',
      'sub.trial.left': 'Your trial ends in',
    },
  };

  let currentLang = 'es';

  function _initFromStorage() {
    try {
      const stored = localStorage.getItem('agropulse_lang');
      if (stored === 'es' || stored === 'en') currentLang = stored;
    } catch {}
  }

  function getLang() { return currentLang; }
  function setLang(l) {
    if (l !== 'es' && l !== 'en') return;
    currentLang = l;
    try { localStorage.setItem('agropulse_lang', l); } catch {}
    applyAll();
  }

  function t(key, fallback) {
    const lang = currentLang;
    if (dict[lang] && dict[lang][key] != null) return dict[lang][key];
    if (dict.es[key] != null) return dict.es[key];
    return fallback != null ? fallback : key;
  }

  function applyAll(lang) {
    if (lang) { currentLang = lang; }
    document.documentElement.setAttribute('lang', currentLang);
    // Aplica a todo elemento con data-i18n="key" → textContent
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const k = el.getAttribute('data-i18n');
      const original = el.getAttribute('data-i18n-original');
      // Guardar texto original (es) la primera vez para fallback
      if (!original) el.setAttribute('data-i18n-original', el.textContent);
      const val = t(k, el.getAttribute('data-i18n-original') || '');
      // Solo reemplazar nodos de texto, preservar hijos como <span>
      if (el.children.length === 0) {
        el.textContent = val;
      } else {
        // Reemplazar primer text node si existe
        let replaced = false;
        for (const node of el.childNodes) {
          if (node.nodeType === 3 && node.textContent.trim()) {
            node.textContent = val + (node.textContent.endsWith(' ') ? ' ' : '');
            replaced = true;
            break;
          }
        }
        if (!replaced) el.textContent = val;
      }
    });
    // Atributos: data-i18n-placeholder, data-i18n-title
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const k = el.getAttribute('data-i18n-placeholder');
      el.setAttribute('placeholder', t(k));
    });
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
      const k = el.getAttribute('data-i18n-title');
      el.setAttribute('title', t(k));
    });
  }

  _initFromStorage();

  return { t, setLang, getLang, applyAll };
})();

// Helper global
window.t = (k, f) => I18N.t(k, f);
