import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

const live = process.env.YAVKA_E2E_LIVE === '1';
const apiUrl = process.env.SUPABASE_TEST_URL;
const options = { auth: { persistSession: false, autoRefreshToken: false } };

test('Russian authentication screen and responsive original branding', async ({ page }) => {
  await page.goto('/auth');
  await expect(page.getByRole('link', { name: 'ЯВКА — на главную' })).toBeVisible();
  await expect(page.getByRole('heading', { name: live ? 'Снова увидимся' : /^(Снова увидимся|Подключение пока не настроено)$/ })).toBeVisible();
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await expect(page.getByRole('button', { name: 'Demo', exact: true })).toHaveCount(0);
});

async function mailLink(email, mailUrl) {
  const until = Date.now() + 30000;
  while (Date.now() < until) {
    const list = await (await fetch(`${mailUrl}/api/v1/messages`)).json();
    const found = (list.messages || []).find(m => m.To?.some(r => r.Address === email));
    if (found) {
      const detail = await (await fetch(`${mailUrl}/api/v1/message/${found.ID}`)).json();
      const match = `${detail.Text}\n${detail.HTML}`.replaceAll('&amp;', '&').match(/https?:\/\/[^\s"<>]+\/auth\/v1\/verify\?[^\s"<>]+/);
      if (match) return match[0];
    }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error('Auth email was not delivered to local Mailpit');
}

test('two independent accounts share a meeting, chat, statuses, photos and persistent history', async ({ browser }, testInfo) => {
  test.skip(!live, 'Requires actual local Supabase; run npm run test:e2e:live');
  test.setTimeout(180000);
  const run = randomUUID().slice(0, 8);
  const admin = createClient(apiUrl, process.env.SUPABASE_TEST_SERVICE_ROLE_KEY, options);
  const contexts = [], actors = [], uploaded = [];
  const baseURL = testInfo.project.use.baseURL;
  async function register(name) {
    const context = await browser.newContext({ baseURL, viewport: testInfo.project.use.viewport, isMobile: !!testInfo.project.use.isMobile, hasTouch: !!testInfo.project.use.hasTouch, timezoneId: 'Asia/Tashkent' });
    contexts.push(context); const page = await context.newPage();
    const email = `yavka-e2e-${name === 'Алиса' ? 'alice' : 'bob'}-${run}@example.com`, password = `Mvp-${randomUUID()}-1a!`;
    await page.goto('/auth?mode=register');
    await page.getByLabel('Ваше имя', { exact: true }).fill(name);
    await page.getByLabel('Электронная почта', { exact: true }).fill(email);
    await page.getByLabel('Пароль', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Создать аккаунт', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Проверьте почту' })).toBeVisible();
    const link = await mailLink(email, process.env.SUPABASE_TEST_MAILPIT_URL);
    const lookup = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const account = lookup.data.users.find(u => u.email === email);
    expect(account).toBeTruthy();
    actors.push({ id: account.id, email, password, page, context });
    await page.goto(link);
    await expect(page.getByRole('heading', { name: /Хорошая компания/ })).toBeVisible();
    return actors.at(-1);
  }
  try {
    const alice = await register('Алиса');
    const bob = await register('Борис');
    expect(alice.id).not.toBe(bob.id);
    const profile = await admin.from('profiles').select('public_id').eq('id', bob.id).single();
    expect(profile.error).toBeNull();
    await alice.page.goto('/friends');
    await alice.page.getByLabel('Имя или ID', { exact: true }).fill(profile.data.public_id);
    await alice.page.getByRole('button', { name: 'Найти', exact: true }).click();
    await alice.page.getByRole('button', { name: 'Добавить', exact: true }).click();
    await bob.page.goto('/friends');
    await bob.page.getByRole('button', { name: 'Принять', exact: true }).click();
    await expect(bob.page.locator('.people-list').getByText('Алиса', { exact: true }).first()).toBeVisible();
    await alice.page.goto('/create');
    await alice.page.getByLabel('Название встречи').fill(`Встреча ${run}`);
    await alice.page.getByLabel('Название места').fill('Кофейня');
    await alice.page.getByRole('button', { name: 'Создать встречу', exact: true }).click();
    await expect(alice.page).toHaveURL(/\/meetings\/[a-f0-9-]+$/);
    const meetingId = new URL(alice.page.url()).pathname.split('/').at(-1);
    await alice.page.getByLabel('Друг', { exact: true }).selectOption(bob.id);
    await alice.page.getByRole('button', { name: 'Пригласить друга', exact: true }).click();
    await bob.page.goto('/invitations');
    await bob.page.getByRole('button', { name: 'Принять', exact: true }).click();
    await expect(bob.page).toHaveURL(new RegExp(`/meetings/${meetingId}$`));
    await expect(bob.page.getByRole('heading', { name: `Встреча ${run}`, exact: true })).toBeVisible();
    await alice.page.getByLabel('Сообщение', { exact: true }).fill('Встретимся у входа');
    await alice.page.getByRole('button', { name: 'Отправить', exact: true }).click();
    await expect(bob.page.getByRole('log').getByText('Встретимся у входа', { exact: true })).toBeVisible({ timeout: 15000 });
    await bob.page.getByRole('button', { name: 'Готов', exact: true }).click();
    await expect(alice.page.locator('.mp-person-row').filter({ hasText: 'Борис' }).getByText('Готов', { exact: true })).toBeVisible({ timeout: 15000 });
    await alice.page.getByRole('button', { name: 'Пришёл', exact: true }).click();
    const advance = await admin.from('meetings').update({ starts_at: new Date().toISOString() }).eq('id', meetingId);
    expect(advance.error).toBeNull();
    await bob.page.getByRole('button', { name: 'Пришёл', exact: true }).click();
    await alice.page.goto(`/meetings/${meetingId}/memory`);
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ2kAAAAASUVORK5CYII=', 'base64');
    await alice.page.getByLabel('Добавить фотографии', { exact: true }).setInputFiles({ name: 'moment.png', mimeType: 'image/png', buffer: png });
    await expect(alice.page.locator('.memory-photo img')).toHaveCount(1);
    const photos = await admin.from('meeting_photos').select('path').eq('meeting_id', meetingId);
    uploaded.push(...photos.data.map(p => p.path));
    await bob.page.goto(`/meetings/${meetingId}/memory`);
    await expect(bob.page.locator('.memory-photo img')).toHaveCount(1);
    await expect(bob.page.getByRole('button', { name: /Удалить свою фотографию/ })).toHaveCount(0);
    await alice.page.goto(`/meetings/${meetingId}`);
    await alice.page.getByRole('button', { name: 'Завершить встречу', exact: true }).click();
    const completionDialog = alice.page.getByRole('dialog');
    await expect(completionDialog).toBeVisible();
    await expect.poll(() => completionDialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
    for (let step = 0; step < 5; step++) {
      await alice.page.keyboard.press('Tab');
      await expect.poll(() => completionDialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
    }
    await completionDialog.getByRole('button', { name: 'Завершить встречу', exact: true }).click();
    await expect(alice.page.getByText('Встреча состоялась', { exact: true })).toBeVisible();
    await bob.page.reload();
    await expect(bob.page.locator('.memory-photo img')).toHaveCount(1);
    await bob.page.goto(`/meetings/${meetingId}`);
    await bob.page.reload();
    await expect(bob.page.getByRole('heading', { name: `Встреча ${run}`, exact: true })).toBeVisible();
    await expect(bob.page.getByRole('log').getByText('Встретимся у входа', { exact: true })).toBeVisible();
    await bob.page.goto('/profile');
    await expect(bob.page.getByRole('heading', { name: 'Рейтинг явки', exact: true })).toBeVisible();
    await expect(bob.page.getByText('Опоздал', { exact: false }).first()).toBeVisible();
    await bob.page.getByRole('button', { name: 'Выйти', exact: true }).click();
    await bob.page.getByLabel('Электронная почта', { exact: true }).fill(bob.email);
    await bob.page.getByLabel('Пароль', { exact: true }).fill(bob.password);
    await bob.page.getByRole('button', { name: 'Войти', exact: true }).click();
    await expect(bob.page).not.toHaveURL(/\/auth(?:[/?#]|$)/);
    await bob.page.goto(`/meetings/${meetingId}`);
    await expect(bob.page.getByRole('log').getByText('Встретимся у входа', { exact: true })).toBeVisible();
    await bob.context.setOffline(true);
    await bob.page.getByRole('button', { name: 'Обновить историю', exact: true }).click();
    await expect(bob.page.locator('.meeting-chat [role="alert"]')).toBeVisible();
    await expect(bob.page.getByRole('heading', { name: `Встреча ${run}`, exact: true })).toBeVisible();
    await expect(bob.page.getByRole('log').getByText('Встретимся у входа', { exact: true })).toBeVisible();
    await alice.page.getByLabel('Сообщение', { exact: true }).fill('После восстановления сети');
    await alice.page.getByRole('button', { name: 'Отправить', exact: true }).click();
    await expect(alice.page.getByRole('log').getByText('После восстановления сети', { exact: true })).toBeVisible();
    await bob.context.setOffline(false);
    await bob.page.getByRole('button', { name: 'Обновить историю', exact: true }).click();
    await expect(bob.page.getByRole('log').getByText('После восстановления сети', { exact: true })).toBeVisible();
    await expect(bob.page.locator('.meeting-chat [role="alert"]')).toHaveCount(0);
    expect(await bob.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const domainData = await bob.page.evaluate(() => localStorage.getItem('yavka:repository:v1'));
    expect(domainData).toBeNull();
  } finally {
    for (const context of contexts) await context.close();
    if (uploaded.length) await admin.storage.from('meeting-photos').remove(uploaded);
    for (const actor of actors) await admin.auth.admin.deleteUser(actor.id);
  }
});
