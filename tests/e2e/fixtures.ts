import { test as base, expect, request as pwRequest, APIRequestContext } from '@playwright/test';

type AuthData = { token: string; user: any };

async function registerOrLogin(api: APIRequestContext, baseURL: string): Promise<AuthData> {
  const id = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const tel = `3${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
  const email = `e2e_${id}@e2e.test`;
  const password = 'Test1234!';
  const reg = await api.post(`${baseURL}/api/register`, {
    data: {
      nombre: 'E2E',
      apellido: 'Tester',
      email,
      password,
      tipo: 'agricultor',
      telefono: tel,
      municipio: 'Tunja',
    },
  });
  if (reg.ok()) return await reg.json();
  const login = await api.post(`${baseURL}/api/login`, { data: { email, password } });
  if (!login.ok()) throw new Error(`auth failed: ${reg.status()}/${login.status()} ${await reg.text()}`);
  return await login.json();
}

export const test = base.extend<{ auth: AuthData; authedPage: import('@playwright/test').Page }>({
  auth: async ({ baseURL }, use) => {
    const api = await pwRequest.newContext();
    const data = await registerOrLogin(api, baseURL!);
    await use(data);
    await api.dispose();
  },
  authedPage: async ({ page, auth, baseURL }, use) => {
    await page.addInitScript(({ token, user }) => {
      localStorage.setItem('agropulse_token', token);
      localStorage.setItem('agropulse_user', JSON.stringify(user));
      localStorage.setItem('agropulse_tour_completed_v2', '1');
    }, { token: auth.token, user: auth.user });
    await page.goto(`${baseURL}/app.html`);
    await page.waitForFunction(() => document.getElementById('screen-app')?.classList.contains('active'));
    await use(page);
  },
});

export { expect };
