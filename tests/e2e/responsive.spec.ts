import { test, expect, devices } from '@playwright/test';

const viewports = [
  { name: 'mobile-small', width: 360, height: 740 },
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet-portrait', width: 768, height: 1024 },
  { name: 'tablet-landscape', width: 1024, height: 768 },
];

for (const vp of viewports) {
  test.describe(`landing @ ${vp.name} ${vp.width}x${vp.height}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test('no horizontal overflow', async ({ page }) => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');
      const overflow = await page.evaluate(() => {
        const d = document.documentElement;
        return { sw: d.scrollWidth, cw: d.clientWidth };
      });
      expect(overflow.sw).toBeLessThanOrEqual(overflow.cw + 1);
    });

    test('CTAs visible and tappable', async ({ page }) => {
      await page.goto('/');
      const reg = page.getByRole('button', { name: /crear cuenta/i });
      const log = page.getByRole('button', { name: /ya tengo cuenta/i });
      await expect(reg).toBeVisible();
      await expect(log).toBeVisible();
      const box = await reg.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(40);
    });

    test('title within viewport', async ({ page }) => {
      await page.goto('/');
      const title = page.locator('.landing-title').first();
      await expect(title).toBeVisible();
      const box = await title.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(vp.width + 1);
    });
  });
}

test.describe('register form responsive @ mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('register screen no overflow', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /crear cuenta/i }).click();
    await page.waitForTimeout(300);
    const overflow = await page.evaluate(() => {
      const d = document.documentElement;
      return d.scrollWidth - d.clientWidth;
    });
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

const deviceCases = [
  { name: 'iPhone 13', vp: devices['iPhone 13'].viewport, ua: devices['iPhone 13'].userAgent },
  { name: 'iPad Pro 11', vp: devices['iPad Pro 11'].viewport, ua: devices['iPad Pro 11'].userAgent },
];

for (const dc of deviceCases) {
  test.describe(`device: ${dc.name}`, () => {
    test.use({ viewport: dc.vp, userAgent: dc.ua });
    test('landing renders, no overflow', async ({ page }) => {
      await page.goto('/');
      await expect(page.locator('.landing-title')).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
    });
  });
}
