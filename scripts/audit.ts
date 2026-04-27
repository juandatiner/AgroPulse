import { chromium, Page, Browser } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const OUT = path.resolve(__dirname, '../tests/audit');

const VIEWPORTS = [
  { name: 'mobile', w: 390, h: 844 },
  { name: 'tablet', w: 768, h: 1024 },
  { name: 'desktop', w: 1440, h: 900 },
];

type Issue = { section: string; viewport: string; severity: 'high'|'medium'|'low'; kind: string; detail: string };
const issues: Issue[] = [];

function log(s: string) { console.log(s); }
function add(i: Issue) { issues.push(i); console.log(`  [${i.severity}] ${i.section}@${i.viewport} ${i.kind}: ${i.detail}`); }

async function shoot(page: Page, dir: string, name: string) {
  const d = path.join(OUT, dir);
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  await page.screenshot({ path: path.join(d, `${name}.png`), fullPage: true });
}

const AUDIT_JS = `(() => {
  const docW = document.documentElement.clientWidth;
  const docSW = document.documentElement.scrollWidth;
  const out = [];
  const inScroller = (el) => {
    let p = el.parentElement;
    while (p) {
      const cs = getComputedStyle(p);
      if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && p.scrollWidth > p.clientWidth + 2) return true;
      p = p.parentElement;
    }
    return false;
  };
  if (docSW > docW + 1) out.push({ kind: 'page-overflow-x', sw: docSW, cw: docW });
  document.querySelectorAll('body *').forEach(e => {
    const cs = getComputedStyle(e);
    if (cs.position === 'fixed' || cs.display === 'none' || cs.visibility === 'hidden') return;
    if (inScroller(e)) return;
    const r = e.getBoundingClientRect();
    if (r.width < 50 || r.height < 5) return;
    if (cs.animationName && cs.animationName !== 'none' && cs.position === 'absolute') return;
    if (r.right > docW + 2) {
      const sel = e.tagName.toLowerCase() + (e.className ? '.' + String(e.className).split(' ').slice(0, 2).join('.') : '');
      out.push({ kind: 'el-overflow-x', sel, right: Math.round(r.right), docW, w: Math.round(r.width) });
    }
  });
  document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,label,button,a,td').forEach(e => {
    if (e.children.length > 0) return;
    const cs = getComputedStyle(e);
    if (cs.display === 'none' || cs.visibility === 'hidden') return;
    if (e.scrollWidth > e.clientWidth + 2 && cs.textOverflow !== 'ellipsis' && cs.overflowX !== 'hidden') {
      const r = e.getBoundingClientRect();
      if (r.width < 30) return;
      const txt = (e.textContent || '').trim().slice(0, 60);
      out.push({ kind: 'text-clipped', sel: e.tagName.toLowerCase() + '.' + String(e.className).split(' ')[0], txt, w: Math.round(r.width) });
    }
  });
  if (window.innerWidth < 768) {
    document.querySelectorAll('button:not([disabled]):not(.tab-btn-publish):not(.rating-star-btn):not(.my-pub-chip)').forEach(e => {
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden' || e.offsetParent === null) return;
      const r = e.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      if ((r.height < 30 || r.width < 30) && !inScroller(e)) {
        out.push({ kind: 'btn-too-small', sel: '.' + String(e.className).split(' ').slice(0, 2).join('.'), w: Math.round(r.width), h: Math.round(r.height) });
      }
    });
  }
  document.querySelectorAll('.promo-banner, .nav, .app-nav, .market-header, .agreements-header').forEach(e => {
    const cs = getComputedStyle(e);
    if (cs.display === 'none') return;
    const r = e.getBoundingClientRect();
    Array.from(e.querySelectorAll('*')).forEach(c => {
      const ccs = getComputedStyle(c);
      if (ccs.position === 'absolute' || ccs.position === 'fixed') return;
      const cr = c.getBoundingClientRect();
      if (cr.right > r.right + 2 && cr.width > 30) {
        out.push({ kind: 'banner-child-overflow', parent: '.' + String(e.className).split(' ')[0], child: c.tagName.toLowerCase() + '.' + String(c.className).split(' ')[0], over: Math.round(cr.right - r.right) });
      }
    });
  });
  return out;
})()`;

async function audit(page: Page, section: string, vp: string) {
  const findings: any[] = await page.evaluate(AUDIT_JS);

  // Dedupe
  const seen = new Set<string>();
  findings.forEach((f: any) => {
    const k = `${f.kind}:${f.sel || f.parent || ''}:${f.txt || ''}`;
    if (seen.has(k)) return;
    seen.add(k);
    const sev = (f.kind === 'page-overflow-x' || f.kind === 'el-overflow-x' || f.kind === 'banner-child-overflow') ? 'high'
              : f.kind === 'btn-too-small' ? 'medium' : 'low';
    add({ section, viewport: vp, severity: sev, kind: f.kind, detail: JSON.stringify(f) });
  });
}

async function safeClick(page: Page, selector: string, opts: { force?: boolean } = {}): Promise<boolean> {
  try {
    const el = page.locator(selector).first();
    if (!(await el.count())) return false;
    await el.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
    await el.click({ timeout: 3000, force: opts.force }).catch(async () => {
      await el.click({ timeout: 3000, force: true });
    });
    return true;
  } catch { return false; }
}

async function registerUser(): Promise<{ token: string; user: any }> {
  const id = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const tel = `3${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
  const r = await fetch(`${BASE}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      nombre: 'Audit', apellido: 'Tester',
      email: `audit_${id}@e2e.test`, password: 'Test1234!',
      tipo: 'agricultor', telefono: tel, municipio: 'Tunja',
    }),
  });
  if (!r.ok) throw new Error(`register: ${r.status} ${await r.text()}`);
  return await r.json();
}

async function createResources(token: string) {
  const samples = [
    { tipo: 'oferta', titulo: 'Tractor Massey Ferguson disponible para arado', descripcion: 'Disponible para arado y siembra. Buen estado, bajo consumo de combustible.', categoria: 'Maquinaria agrícola', municipio: 'Tunja' },
    { tipo: 'solicitud', titulo: 'Necesito semillas de papa criolla', descripcion: 'Busco 50kg de semillas certificadas para cultivo en altura.', categoria: 'Semillas', municipio: 'Sogamoso' },
    { tipo: 'prestamo', titulo: 'Presto bomba de fumigar 20L', descripcion: 'Por días, en buen estado. Devolver limpia.', categoria: 'Herramientas', municipio: 'Duitama' },
    { tipo: 'trueque', titulo: 'Cambio maíz por abono orgánico', descripcion: 'Tengo 100kg de maíz amarillo, busco abono orgánico equivalente.', categoria: 'Granos', ofrece: '100kg maíz', recibe: 'abono', municipio: 'Paipa' },
  ];
  for (const s of samples) {
    await fetch(`${BASE}/api/resources`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify(s),
    });
  }
}

async function authedPage(browser: Browser, vp: { w: number; h: number }, auth: any): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
  await ctx.addInitScript(({ token, user }) => {
    localStorage.setItem('agropulse_token', token);
    localStorage.setItem('agropulse_user', JSON.stringify(user));
    localStorage.setItem('agropulse_tour_completed_v2', '1');
  }, { token: auth.token, user: auth.user });
  return await ctx.newPage();
}

(async () => {
  if (fs.existsSync(OUT)) fs.rmSync(OUT, { recursive: true });
  fs.mkdirSync(OUT, { recursive: true });

  log('Registering audit user…');
  const auth = await registerUser();
  log(`User: ${auth.user.email}`);
  log('Creating sample resources…');
  await createResources(auth.token);

  const browser = await chromium.launch();

  for (const vp of VIEWPORTS) {
    log(`\n========== ${vp.name} ${vp.w}x${vp.h} ==========`);

    // Public flows
    const pubCtx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
    const pub = await pubCtx.newPage();

    await pub.goto(`${BASE}/`);
    await pub.waitForLoadState('networkidle');
    await shoot(pub, vp.name, '01-landing');
    await audit(pub, 'landing', vp.name);

    await safeClick(pub, 'button:has-text("Crear cuenta")');
    await pub.waitForTimeout(400);
    await shoot(pub, vp.name, '02-register');
    await audit(pub, 'register', vp.name);

    await pub.goto(`${BASE}/`);
    await pub.waitForLoadState('networkidle');
    await safeClick(pub, 'button:has-text("Ya tengo cuenta")');
    await pub.waitForTimeout(400);
    await shoot(pub, vp.name, '03-login');
    await audit(pub, 'login', vp.name);

    await pubCtx.close();

    // Authed flows
    const page = await authedPage(browser, vp, auth);
    await page.goto(`${BASE}/app.html`);
    await page.waitForFunction(() => document.getElementById('screen-app')?.classList.contains('active'));
    await page.waitForTimeout(1500);

    await shoot(page, vp.name, '10-home');
    await audit(page, 'home', vp.name);

    if (await safeClick(page, '.tab-btn[data-tab="mercado"]', { force: true })) {
      await page.waitForTimeout(800);
      await shoot(page, vp.name, '20-mercado');
      await audit(page, 'mercado', vp.name);

      // First market card detail
      const card = page.locator('.market-item').first();
      if (await card.count()) {
        await card.click({ force: true }).catch(() => {});
        await page.waitForTimeout(700);
        await shoot(page, vp.name, '21-resource-detail');
        await audit(page, 'resource-detail', vp.name);
        await page.locator('.detail-back').first().click({ force: true }).catch(() => {});
        await page.waitForTimeout(300);
      }
    }

    if (await safeClick(page, '.tab-btn[data-tab="publicar"]', { force: true })) {
      await page.waitForTimeout(600);
      await shoot(page, vp.name, '30-publicar-types');
      await audit(page, 'publicar-types', vp.name);

      for (const tipo of ['oferta', 'solicitud', 'prestamo', 'trueque']) {
        await safeClick(page, `[onclick*="setPublishType('${tipo}'"], [data-tipo="${tipo}"]`, { force: true });
        await page.waitForTimeout(700);
        await shoot(page, vp.name, `31-publicar-${tipo}`);
        await audit(page, `publicar-${tipo}`, vp.name);
        await safeClick(page, '.tab-btn[data-tab="publicar"]', { force: true });
        await page.waitForTimeout(400);
      }
    }

    if (await safeClick(page, '.tab-btn[data-tab="intercambios"]', { force: true })) {
      await page.waitForTimeout(600);
      await shoot(page, vp.name, '40-intercambios-todos');
      await audit(page, 'intercambios', vp.name);
      for (const st of ['pending', 'active', 'completed', 'cancelled']) {
        await safeClick(page, `.status-tab[data-status="${st}"]`, { force: true });
        await page.waitForTimeout(300);
        await shoot(page, vp.name, `41-intercambios-${st}`);
        await audit(page, `intercambios-${st}`, vp.name);
      }
    }

    if (await safeClick(page, '.tab-btn[data-tab="perfil"]', { force: true })) {
      await page.waitForTimeout(800);
      await shoot(page, vp.name, '50-perfil');
      await audit(page, 'perfil', vp.name);
    }

    // Home: open my resource detail (to verify resource card actions area)
    await safeClick(page, '.tab-btn[data-tab="inicio"]', { force: true });
    await page.waitForTimeout(600);
    const myCard = page.locator('.my-resource-item').first();
    if (await myCard.count()) {
      await myCard.click({ force: true }).catch(() => {});
      await page.waitForTimeout(700);
      await shoot(page, vp.name, '11-my-resource-detail');
      await audit(page, 'my-resource-detail', vp.name);
    }

    await page.context().close();
  }

  await browser.close();

  // Group + report
  const high = issues.filter(i => i.severity === 'high');
  const med = issues.filter(i => i.severity === 'medium');
  const low = issues.filter(i => i.severity === 'low');
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(issues, null, 2));

  // Summary by section+kind
  const byKey = new Map<string, number>();
  issues.forEach(i => {
    const k = `${i.kind} :: ${i.section}@${i.viewport}`;
    byKey.set(k, (byKey.get(k) || 0) + 1);
  });

  log(`\n=================== SUMMARY ===================`);
  log(`HIGH: ${high.length}  MEDIUM: ${med.length}  LOW: ${low.length}`);
  log(`Top issues:`);
  Array.from(byKey.entries()).sort((a, b) => b[1] - a[1]).slice(0, 30).forEach(([k, n]) => {
    log(`  ${n}× ${k}`);
  });
  log(`\nReport: ${path.join(OUT, 'report.json')}`);
  log(`Screenshots: ${OUT}`);
})().catch(e => { console.error(e); process.exit(1); });
