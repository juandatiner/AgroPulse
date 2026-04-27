import { chromium, devices, Page, BrowserContext } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const OUT = path.resolve(__dirname, '../tests/screenshots');

const viewports = [
  { name: 'mobile-360', width: 360, height: 740 },
  { name: 'mobile-390', width: 390, height: 844 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'tablet-1024', width: 1024, height: 768 },
  { name: 'desktop-1440', width: 1440, height: 900 },
];

async function shoot(page: Page, name: string) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log(`  ✓ ${name}.png`);
  return file;
}

async function checkOverflow(page: Page, label: string) {
  const r = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    cw: document.documentElement.clientWidth,
  }));
  const overflow = r.sw - r.cw;
  const status = overflow <= 1 ? '✓' : '✗';
  console.log(`    ${status} ${label} overflow=${overflow}px`);
  return overflow <= 1;
}

async function registerUser() {
  const id = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const tel = `3${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
  const email = `e2e_${id}@e2e.test`;
  const password = 'Test1234!';
  const r = await fetch(`${BASE}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      nombre: 'E2E', apellido: 'Tester', email, password,
      tipo: 'agricultor', telefono: tel, municipio: 'Tunja',
    }),
  });
  if (!r.ok) throw new Error(`register failed: ${r.status} ${await r.text()}`);
  return await r.json();
}

async function authedContext(browser: any, vp: { width: number; height: number }, auth: any) {
  const ctx = await browser.newContext({ viewport: vp });
  await ctx.addInitScript(({ token, user }) => {
    localStorage.setItem('agropulse_token', token);
    localStorage.setItem('agropulse_user', JSON.stringify(user));
    localStorage.setItem('agropulse_tour_completed_v2', '1');
  }, { token: auth.token, user: auth.user });
  return ctx;
}

(async () => {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  for (const f of fs.readdirSync(OUT)) fs.unlinkSync(path.join(OUT, f));

  const browser = await chromium.launch();
  const auth = await registerUser();
  console.log(`\nUser: ${auth.user.email}`);
  const allOk: boolean[] = [];

  for (const vp of viewports) {
    console.log(`\n=== ${vp.name} (${vp.width}x${vp.height}) ===`);

    const pubCtx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const pubPage = await pubCtx.newPage();
    await pubPage.goto(`${BASE}/`);
    await pubPage.waitForLoadState('networkidle');
    allOk.push(await checkOverflow(pubPage, 'landing'));
    await shoot(pubPage, `${vp.name}-01-landing`);
    await pubCtx.close();

    const ctx = await authedContext(browser, { width: vp.width, height: vp.height }, auth);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/app.html`);
    await page.waitForFunction(() => document.getElementById('screen-app')?.classList.contains('active'));
    await page.waitForTimeout(1200);
    allOk.push(await checkOverflow(page, 'home'));
    await shoot(page, `${vp.name}-02-home`);

    for (const tab of ['mercado', 'publicar', 'intercambios', 'perfil']) {
      await page.locator(`.tab-btn[data-tab="${tab}"]`).click();
      await page.waitForTimeout(700);
      allOk.push(await checkOverflow(page, tab));
      await shoot(page, `${vp.name}-03-${tab}`);
    }

    await ctx.close();
  }

  await browser.close();

  const total = allOk.length;
  const pass = allOk.filter(Boolean).length;
  console.log(`\n=== Result: ${pass}/${total} no-overflow checks pass ===`);
  console.log(`Screenshots: ${OUT}`);
  process.exit(pass === total ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
