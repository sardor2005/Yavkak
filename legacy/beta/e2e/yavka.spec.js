import { test as base, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const test = base.extend({
  browserErrors: [async ({ page }, use) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await use(errors);
    expect(errors, 'The application must run without browser errors').toEqual([]);
  }, { auto: true }],
});

async function storedMeeting(page, meetingId = 'demo-yavka') {
  return page.evaluate(async id => (await import('/src/services/storage.js')).getMeeting(id), meetingId);
}

async function noOverflow(page) {
  const dimensions = await page.evaluate(() => ({
    width: window.innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(dimensions.document, 'Document must fit the viewport').toBeLessThanOrEqual(dimensions.width);
  expect(dimensions.body, 'Body must fit the viewport').toBeLessThanOrEqual(dimensions.width);
}

async function screenshot(page, testInfo, name) {
  await noOverflow(page);
  await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true });
}

async function createMeeting(page, title = 'Кофе с тестовой компанией') {
  await page.goto('/create');
  await page.getByLabel('Название встречи').fill(title);
  await page.getByLabel('Описание').fill('Обсудим планы и увидимся без длинной переписки.');
  await page.getByLabel('Ваше имя', { exact: true }).fill('Сардор');
  await page.getByLabel('Дата 1', { exact: true }).fill('2026-10-12');
  await page.getByLabel('Время 1', { exact: true }).fill('18:30');
  await page.getByRole('button', { name: 'Добавить время', exact: true }).click();
  await page.getByLabel('Дата 2', { exact: true }).fill('2026-10-13');
  await page.getByLabel('Время 2', { exact: true }).fill('19:00');
  await page.getByLabel('Название места', { exact: true }).first().fill('Surf Coffee');
  await page.getByRole('button', { name: 'Добавить место', exact: true }).click();
  await page.getByLabel('Название места', { exact: true }).nth(1).fill('Парк Анхор');
  await page.getByRole('button', { name: 'Создать встречу', exact: true }).click();
  await expect(page).toHaveURL(/\/meetings\/meeting-/);
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  return page.url().split('/meetings/')[1];
}

test('create, copy portable invitation, join as guest and preserve votes', async ({ page, context, browser }, testInfo) => {
  const id = await createMeeting(page);
  let meeting = await storedMeeting(page, id);
  expect(meeting.timeOptions).toHaveLength(2);
  expect(meeting.placeOptions).toHaveLength(2);
  await expect(page.locator('.mp-qr svg')).toBeVisible();
  await page.getByRole('button', { name: 'Скрыть QR-код', exact: true }).click();
  await expect(page.locator('.mp-qr svg')).toHaveCount(0);
  await page.getByRole('button', { name: 'Показать QR-код', exact: true }).click();
  await expect(page.locator('.mp-qr svg')).toBeVisible();
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: 'Скопировать ссылку', exact: true }).click();
  const invite = await page.evaluate(() => navigator.clipboard.readText());
  expect(invite).toContain(`/join/${id}#invite=`);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Кофе с тестовой компанией', exact: true })).toBeVisible();
  await screenshot(page, testInfo, 'created-meeting');

  const guestContext = await browser.newContext({ viewport: page.viewportSize(), timezoneId: 'Asia/Tashkent' });
  const guest = await guestContext.newPage();
  const guestErrors = [];
  guest.on('pageerror', error => guestErrors.push(error.message));
  guest.on('console', message => { if (message.type() === 'error') guestErrors.push(message.text()); });
  try {
    await guest.goto(invite);
    await expect(guest.getByRole('heading', { name: 'Вас приглашают на встречу', exact: true })).toBeVisible();
    await expect(guest.getByRole('heading', { name: 'Кофе с тестовой компанией', exact: true })).toBeVisible();
    await screenshot(guest, testInfo, 'guest-invitation');
    await guest.getByLabel('Ваше имя', { exact: true }).fill('Нуржигит');
    await guest.getByRole('button', { name: 'Присоединиться', exact: true }).click();
    await expect(guest).toHaveURL(new RegExp(`/meetings/${id}$`));
    await expect(guest.getByRole('button', { name: 'Подтвердить план', exact: true })).toHaveCount(0);
    await expect(guest.getByRole('button', { name: 'Завершить встречу', exact: true })).toHaveCount(0);
    const choices = guest.locator('.mp-vote-option');
    await choices.nth(0).click();
    await choices.nth(1).click();
    await choices.nth(2).click();
    await guest.getByRole('button', { name: 'Сохранить ответы', exact: true }).click();
    meeting = await storedMeeting(guest, id);
    const joined = meeting.participants.find(person => person.name === 'Нуржигит');
    expect(joined.timeVotes).toHaveLength(2);
    expect(joined.placeVotes).toHaveLength(1);
    expect(joined.votesSaved).toBe(true);
    await guest.reload();
    await expect(guest.getByRole('heading', { name: 'Кофе с тестовой компанией', exact: true })).toBeVisible();
    await expect(guest.getByRole('checkbox').nth(0)).toBeChecked();
    await expect(guest.getByRole('checkbox').nth(1)).toBeChecked();
    await expect(guest.getByRole('checkbox').nth(2)).toBeChecked();
    await expect(guest.getByRole('button', { name: 'Подтвердить план', exact: true })).toHaveCount(0);
    expect(guestErrors).toEqual([]);
  } finally { await guestContext.close(); }
});

async function viewAs(page, name) {
  const selector = page.getByRole('combobox', { name: 'Демо: вы смотрите как', exact: true });
  const value = await selector.locator('option').filter({ hasText: name }).getAttribute('value');
  await selector.selectOption(value);
  await expect(page.getByText(`Вы: ${name}`, { exact: true })).toBeVisible();
}

test('full meeting lifecycle resets all attendance and preserves the memory', async ({ page }, testInfo) => {
  await page.goto('/meetings/demo-yavka');
  await expect(page.getByRole('heading', { name: 'Кофе после пар', exact: true })).toBeVisible();
  await page.locator('.mp-vote-option').nth(0).click();
  await page.locator('.mp-vote-option').nth(1).click();
  await page.locator('.mp-vote-option').nth(3).click();
  await page.getByRole('button', { name: 'Сохранить ответы', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Ответы сохранены', exact: true })).toBeDisabled();
  await page.getByRole('combobox', { name: 'Итоговое время', exact: true }).selectOption('demo-time-1');
  await page.getByRole('combobox', { name: 'Итоговое место', exact: true }).selectOption('demo-place-1');
  await page.getByRole('button', { name: 'Подтвердить план', exact: true }).click();
  await expect(page.getByText('Встреча подтверждена', { exact: true })).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Добавить в календарь', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.ics$/);
  const calendar = await readFile(await download.path(), 'utf8');
  expect(calendar).toContain('BEGIN:VCALENDAR\r\n');
  expect(calendar.replace(/\r\n /g, '')).toContain('SUMMARY:Кофе после пар');
  expect(calendar).toMatch(/DTSTART:\d{8}T\d{6}/);

  await page.getByRole('button', { name: 'Буду', exact: true }).click();
  await page.getByRole('button', { name: 'Выхожу', exact: true }).click();
  await viewAs(page, 'Нуржигит');
  await expect(page.getByRole('button', { name: 'Изменить план', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Завершить встречу', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Буду', exact: true }).click();
  await page.getByRole('button', { name: 'Прибыл', exact: true }).click();
  await viewAs(page, 'Наталья');
  await page.getByRole('button', { name: 'Не уверен', exact: true }).click();
  await viewAs(page, 'Данияр');
  await page.getByRole('button', { name: 'Не смогу', exact: true }).click();
  const oldPlan = await storedMeeting(page);
  expect(oldPlan.participants.map(person => person.attendance)).toEqual(['going', 'going', 'maybe', 'declined', 'pending']);
  await viewAs(page, 'Сардор');
  await page.getByRole('button', { name: 'Изменить план', exact: true }).click();
  await page.getByLabel('Время', { exact: true }).fill('20:00');
  await page.getByLabel('Место', { exact: true }).fill('Парк Анхор');
  await page.getByRole('button', { name: 'Сохранить новый план', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('План изменён. Участникам необходимо подтвердить участие заново.');
  const newPlan = await storedMeeting(page);
  expect(newPlan.confirmedTime.time).toBe('20:00');
  expect(newPlan.confirmedPlace.name).toBe('Парк Анхор');
  expect(newPlan.planVersion).toBe(oldPlan.planVersion + 1);
  expect(newPlan.participants.every(person => person.attendance === 'pending' && person.arrivalStatus === 'home' && person.lateMinutes === 0)).toBe(true);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Буду', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('button', { name: 'Выхожу', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Буду', exact: true }).click();
  await page.getByRole('button', { name: 'Выхожу', exact: true }).click();
  await page.getByRole('button', { name: 'Задерживаюсь', exact: true }).click();
  await page.getByRole('button', { name: '10 мин', exact: true }).click();
  await page.getByRole('button', { name: 'Сообщить', exact: true }).click();
  await expect(page.getByText('Задерживается на 10 мин', { exact: true })).toBeVisible();
  await page.reload();
  let meeting = await storedMeeting(page);
  expect(meeting.participants[0].arrivalStatus).toBe('late');
  expect(meeting.participants[0].lateMinutes).toBe(10);
  await page.getByRole('button', { name: 'Прибыл', exact: true }).click();
  meeting = await storedMeeting(page);
  expect(meeting.participants[0].arrivalStatus).toBe('arrived');
  expect(meeting.participants[0].lateMinutes).toBe(0);
  await screenshot(page, testInfo, 'confirmed-gathering');
  await page.getByRole('button', { name: 'Завершить встречу', exact: true }).click();
  await expect(page).toHaveURL('/meetings/demo-yavka/memory');
  await expect(page.getByRole('heading', { name: 'Встреча состоялась 🎉', exact: true })).toBeVisible();
  await page.getByLabel('Добавить фотографии', { exact: true }).setInputFiles({
    name: 'coffee.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aKJcAAAAASUVORK5CYII=', 'base64'),
  });
  await expect(page.getByAltText('Фотография встречи 1', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Пара слов на память', exact: true }).fill('Наконец-то увиделись. Кофе, смех и планы на следующую встречу.');
  await screenshot(page, testInfo, 'memory-editor');
  await page.getByRole('button', { name: 'Сохранить воспоминание', exact: true }).click();
  await expect(page).toHaveURL('/meetings/demo-yavka');
  await expect(page.getByText('Наконец-то увиделись. Кофе, смех и планы на следующую встречу.', { exact: true })).toBeVisible();
  await page.reload();
  meeting = await storedMeeting(page);
  expect(meeting.status).toBe('completed');
  expect(meeting.photos).toHaveLength(1);
  expect(meeting.memoryNote).toContain('Наконец-то увиделись.');
  await expect(page.getByAltText('coffee.png', { exact: true })).toBeVisible();
  await page.goto('/meetings/demo-yavka/memory');
  await expect(page.getByRole('textbox', { name: 'Пара слов на память', exact: true })).toHaveValue('Наконец-то увиделись. Кофе, смех и планы на следующую встречу.');
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Пара слов на память', exact: true })).toHaveValue('Наконец-то увиделись. Кофе, смех и планы на следующую встречу.');
  await expect(page.getByAltText('Фотография встречи 1', { exact: true })).toBeVisible();
  await page.goto('/history');
  await expect(page.getByRole('heading', { name: 'Кофе после пар', exact: true })).toBeVisible();
  await expect(page.getByAltText('Воспоминание: Кофе после пар', { exact: true })).toBeVisible();
  await screenshot(page, testInfo, 'history-completed');
  await page.getByRole('link', { name: /Кофе после пар/ }).click();
  await expect(page.getByText('Наконец-то увиделись. Кофе, смех и планы на следующую встречу.', { exact: true })).toBeVisible();
});

test('Demo restores the requested initial scenario and clears custom meetings', async ({ page }) => {
  await createMeeting(page, 'Встреча перед сбросом');
  await page.getByRole('button', { name: 'Demo', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Восстановить Demo', exact: true }).click();
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('heading', { name: 'Кофе после пар', exact: true })).toBeVisible();
  await expect(page.getByText('Встреча перед сбросом', { exact: true })).toHaveCount(0);
  const demo = await storedMeeting(page);
  expect(demo.organizer.name).toBe('Сардор');
  expect(demo.participants.map(person => person.name)).toEqual(['Сардор', 'Нуржигит', 'Наталья', 'Данияр', 'Камила']);
  expect(demo.status).toBe('planning');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Кофе после пар', exact: true })).toBeVisible();
});

test('responsive home, create and history have usable navigation without overflow', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Кофе после пар', exact: true })).toBeVisible();
  await screenshot(page, testInfo, 'home');
  const mobile = testInfo.project.name.startsWith('mobile');
  const navigation = page.getByRole('navigation', { name: mobile ? 'Мобильная навигация' : 'Основная навигация', exact: true });
  await expect(navigation).toBeVisible();
  await navigation.getByRole('link', { name: 'Создать', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Создадим встречу', exact: true })).toBeVisible();
  await screenshot(page, testInfo, 'create');
  await navigation.getByRole('link', { name: 'История', exact: true }).click();
  await expect(page.getByRole('heading', { name: /История встреч/ })).toBeVisible();
  await screenshot(page, testInfo, 'history-empty');
});
