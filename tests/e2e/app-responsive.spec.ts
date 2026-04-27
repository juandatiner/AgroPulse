import { test, expect } from './fixtures';

const viewports = [
  { name: 'mobile-small', width: 360, height: 740 },
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet-portrait', width: 768, height: 1024 },
  { name: 'tablet-landscape', width: 1024, height: 768 },
];

async function getOverflow(page: any): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

for (const vp of viewports) {
  test.describe(`authed @ ${vp.name} ${vp.width}x${vp.height}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test('home no overflow + tab bar visible', async ({ authedPage: page }) => {
      const overflow = await getOverflow(page);
      expect(overflow).toBeLessThanOrEqual(1);
      await expect(page.locator('.tab-bar')).toBeVisible();
    });

    test('comunidad scroll: cards align with section title and no partial cards', async ({ authedPage: page }) => {
      await page.waitForTimeout(800);
      const scroll = page.locator('#recent-resources');
      const titleEl = page.locator('#section-comunidad .section-title');
      if (!(await scroll.count())) test.skip();
      const cards = scroll.locator('.resource-card');
      const cardCount = await cards.count();
      if (cardCount === 0) test.skip();

      const titleBox = await titleEl.boundingBox();
      const firstCardBox = await cards.first().boundingBox();
      expect(Math.abs(firstCardBox!.x - titleBox!.x)).toBeLessThanOrEqual(2);

      const scrollBox = await scroll.boundingBox();
      const lastCardBox = await cards.nth(cardCount - 1).boundingBox();
      expect(lastCardBox!.x + lastCardBox!.width).toBeLessThanOrEqual(scrollBox!.x + scrollBox!.width + 1);

      const overflowX = await scroll.evaluate(el => el.scrollWidth - el.clientWidth);
      expect(overflowX).toBeLessThanOrEqual(1);
    });

    test('agreements tab: only "todos" count shown', async ({ authedPage: page }) => {
      await page.locator('.tab-btn[data-tab="intercambios"]').click();
      await page.waitForTimeout(500);
      const todosCount = page.locator('.status-tab[data-status="todos"] .count');
      if (vp.width >= 768) await expect(todosCount).toBeVisible();
      const otherStatuses = ['pending', 'active', 'completed', 'cancelled'];
      for (const s of otherStatuses) {
        const c = page.locator(`.status-tab[data-status="${s}"] .count`);
        await expect(c).toBeHidden();
      }
      const overflow = await getOverflow(page);
      expect(overflow).toBeLessThanOrEqual(1);
    });

    test('publish tab no overflow', async ({ authedPage: page }) => {
      await page.locator('.tab-btn[data-tab="publicar"]').click();
      await page.waitForTimeout(400);
      const overflow = await getOverflow(page);
      expect(overflow).toBeLessThanOrEqual(1);
    });

    test('mercado tab no overflow', async ({ authedPage: page }) => {
      await page.locator('.tab-btn[data-tab="mercado"]').click();
      await page.waitForTimeout(400);
      const overflow = await getOverflow(page);
      expect(overflow).toBeLessThanOrEqual(1);
    });

    test('perfil tab no overflow', async ({ authedPage: page }) => {
      await page.locator('.tab-btn[data-tab="perfil"]').click();
      await page.waitForTimeout(400);
      const overflow = await getOverflow(page);
      expect(overflow).toBeLessThanOrEqual(1);
    });
  });
}
