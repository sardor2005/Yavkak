import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEMO_MEETING_ID, setStorageAdapter, getMeetings, getMeeting, createMeeting, updateMeeting,
  joinMeeting, vote, confirmPlan, updateAttendance, updateArrivalStatus, completeMeeting,
  saveMemory, resetDemo, getActiveParticipantId, setActiveParticipantId, createInviteUrl, importInvite,
} from '../src/services/storage.js';
import { createCalendarEvent } from '../src/services/calendar.js';
import { processPhotos } from '../src/services/photos.js';

function freshStorage() {
  const values = new Map();
  setStorageAdapter({ getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) });
  return values;
}
function confirmDemo() {
  const meeting = getMeeting(DEMO_MEETING_ID);
  return confirmPlan(meeting.id, meeting.organizer.id, { timeId: meeting.timeOptions[0].id, placeId: meeting.placeOptions[0].id });
}
function newMeetingInput() {
  return { title: 'Вечер с друзьями', organizerName: 'Алия', description: 'Встретимся в центре', timeOptions: [{ id: 't1', date: '2026-10-12', time: '18:30' }], placeOptions: [{ id: 'p1', name: 'Surf Coffee', address: 'Центр' }] };
}

test('demo seeds only once, stores identity and returns independent snapshots', () => {
  freshStorage();
  const meeting = getMeeting(DEMO_MEETING_ID);
  assert.deepEqual(meeting.participants.map((person) => person.name), ['Сардор', 'Нуржигит', 'Наталья', 'Данияр', 'Камила']);
  assert.equal(meeting.participants.length, 5);
  assert.equal(meeting.participants[0].role, 'organizer');
  assert.ok(meeting.participants.slice(1).every((person) => person.role === 'guest'));
  assert.equal(meeting.status, 'planning');
  assert.equal(meeting.timeOptions[0].time, '18:30');
  assert.equal(meeting.placeOptions[0].name, 'Surf Coffee');
  assert.equal(meeting.participants.filter((person) => person.votesSaved).length, 4);
  assert.ok(meeting.participants.every((person) => person.attendance === 'pending'));
  assert.equal(getActiveParticipantId(meeting.id), meeting.organizer.id);
  meeting.participants[0].name = 'Mutated';
  assert.equal(getMeeting(meeting.id).participants[0].name, 'Сардор');
  assert.equal(getMeetings().length, 1);
});

test('organizer can confirm before all votes, changing the plan resets EVERY participant', () => {
  freshStorage();
  let meeting = confirmDemo();
  assert.equal(meeting.status, 'confirmed');
  assert.equal(meeting.planVersion, 1);
  const guest = meeting.participants[1];
  setActiveParticipantId(meeting.id, guest.id);
  updateAttendance(meeting.id, guest.id, 'going');
  updateArrivalStatus(meeting.id, guest.id, 'late', 15);
  setActiveParticipantId(meeting.id, meeting.organizer.id);
  updateAttendance(meeting.id, meeting.organizer.id, 'going');
  updateArrivalStatus(meeting.id, meeting.organizer.id, 'leaving');
  meeting = confirmPlan(meeting.id, meeting.organizer.id, { date: '2026-12-01', time: '20:15', placeName: 'Новое кафе', placeAddress: 'Другая улица' });
  assert.equal(meeting.planVersion, 2);
  assert.equal(meeting.confirmedTime.time, '20:15');
  assert.equal(meeting.confirmedPlace.name, 'Новое кафе');
  assert.ok(meeting.participants.every((person) => person.attendance === 'pending' && person.arrivalStatus === 'home' && person.lateMinutes === 0));
  assert.equal(meeting.participants[1].votesSaved, true);
});

test('unchanged confirmation preserves attendance and plan version; address-only change resets', () => {
  freshStorage();
  let meeting = confirmDemo();
  updateAttendance(meeting.id, meeting.organizer.id, 'going');
  updateArrivalStatus(meeting.id, meeting.organizer.id, 'arrived');
  meeting = confirmPlan(meeting.id, meeting.organizer.id, { timeId: meeting.confirmedTime.id, placeId: meeting.confirmedPlace.id });
  assert.equal(meeting.planVersion, 1);
  assert.equal(meeting.participants[0].arrivalStatus, 'arrived');
  meeting = confirmPlan(meeting.id, meeting.organizer.id, { date: meeting.confirmedTime.date, time: meeting.confirmedTime.time, placeName: meeting.confirmedPlace.name, placeAddress: 'Новый адрес' });
  assert.equal(meeting.planVersion, 2);
  assert.equal(meeting.participants[0].attendance, 'pending');
});

test('organizer-only actions and participant identity cannot be impersonated', () => {
  freshStorage();
  const meeting = getMeeting(DEMO_MEETING_ID);
  const guest = meeting.participants[1];
  setActiveParticipantId(meeting.id, guest.id);
  assert.throws(() => confirmPlan(meeting.id, guest.id, { timeId: meeting.timeOptions[0].id, placeId: meeting.placeOptions[0].id }), /организатору/);
  assert.throws(() => confirmPlan(meeting.id, meeting.organizer.id, { timeId: meeting.timeOptions[0].id, placeId: meeting.placeOptions[0].id }), /свой ответ/);
  assert.throws(() => vote(meeting.id, meeting.organizer.id, { timeVotes: [meeting.timeOptions[0].id], placeVotes: [meeting.placeOptions[0].id] }), /свой ответ/);
  assert.throws(() => updateMeeting(meeting.id, { title: 'Переименовать' }), /организатору/);
});

test('votes validate options, update summary status, and close after confirmation', () => {
  freshStorage();
  const meeting = getMeeting(DEMO_MEETING_ID);
  assert.throws(() => vote(meeting.id, meeting.organizer.id, { timeVotes: [], placeVotes: [meeting.placeOptions[0].id] }), /хотя бы один/);
  assert.throws(() => vote(meeting.id, meeting.organizer.id, { timeVotes: ['unknown'], placeVotes: [meeting.placeOptions[0].id] }), /хотя бы один/);
  assert.equal(getMeeting(meeting.id).participants[0].votesSaved, false);
  const voted = vote(meeting.id, meeting.organizer.id, { timeVotes: [meeting.timeOptions[0].id, meeting.timeOptions[0].id], placeVotes: [meeting.placeOptions[0].id] });
  assert.equal(voted.status, 'awaiting');
  assert.equal(voted.participants[0].timeVotes.length, 1);
  confirmDemo();
  assert.throws(() => vote(meeting.id, meeting.organizer.id, { timeVotes: [meeting.timeOptions[0].id], placeVotes: [meeting.placeOptions[0].id] }), /Голосование закрыто/);
});

test('joining validates names, caps group at 8 and stores guest identity', () => {
  freshStorage();
  const created = createMeeting(newMeetingInput());
  assert.equal(getActiveParticipantId(created.id), created.organizer.id);
  assert.throws(() => joinMeeting(created.id, '  '), /Укажите/);
  assert.throws(() => joinMeeting(created.id, '  аЛиЯ  '), /уже есть/);
  let meeting;
  for (let index = 0; index < 7; index += 1) meeting = joinMeeting(created.id, `Гость ${index}`);
  assert.equal(meeting.participants.length, 8);
  assert.equal(getActiveParticipantId(created.id), meeting.participants[7].id);
  assert.throws(() => joinMeeting(created.id, 'Девятый'), /8 участников/);
  assert.throws(() => setActiveParticipantId(created.id, created.organizer.id), /демонстрационной/);
});

test('attendance and arrival guard lifecycle, numeric delay and completion', () => {
  freshStorage();
  let meeting = getMeeting(DEMO_MEETING_ID);
  assert.throws(() => updateAttendance(meeting.id, meeting.organizer.id, 'going'), /после подтверждения/);
  meeting = confirmDemo();
  assert.throws(() => updateArrivalStatus(meeting.id, meeting.organizer.id, 'arrived'), /Сначала подтвердите/);
  updateAttendance(meeting.id, meeting.organizer.id, 'going');
  assert.throws(() => updateArrivalStatus(meeting.id, meeting.organizer.id, 'late', -1), /от 1 до 180/);
  updateArrivalStatus(meeting.id, meeting.organizer.id, 'late', 10);
  meeting = updateAttendance(meeting.id, meeting.organizer.id, 'maybe');
  assert.equal(meeting.participants[0].arrivalStatus, 'home');
  assert.equal(meeting.participants[0].lateMinutes, 0);
  meeting = completeMeeting(meeting.id, meeting.organizer.id);
  assert.equal(meeting.status, 'completed');
  assert.throws(() => updateAttendance(meeting.id, meeting.organizer.id, 'going'), /после подтверждения/);
  assert.throws(() => joinMeeting(meeting.id, 'Новый'), /завершена/);
  assert.throws(() => confirmPlan(meeting.id, meeting.organizer.id, { timeId: meeting.timeOptions[0].id, placeId: meeting.placeOptions[0].id }), /завершена/);
});

test('memory is completed-only, stored locally and excluded from portable invites', () => {
  freshStorage();
  const meeting = confirmDemo();
  const memory = { photos: [{ id: 'photo-one', name: 'Друзья', url: 'data:image/jpeg;base64,SGVsbG8=' }], memoryNote: 'Отличный вечер' };
  assert.throws(() => saveMemory(meeting.id, meeting.organizer.id, memory), /после завершения/);
  completeMeeting(meeting.id, meeting.organizer.id);
  const saved = saveMemory(meeting.id, meeting.organizer.id, memory);
  assert.equal(saved.photos.length, 1);
  assert.equal(saved.memoryNote, 'Отличный вечер');
  const invite = new URL(createInviteUrl(meeting.id));
  freshStorage();
  // Same demo ID is seeded locally, so simulate a genuinely new-browser meeting ID.
  const importedId = 'meeting-portable';
  const encoded = new URLSearchParams(invite.hash.slice(1)).get('invite');
  const raw = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(encoded.replace(/-/g, '+').replace(/_/g, '/')), (character) => character.charCodeAt(0))));
  raw.i = importedId;
  const bytes = new TextEncoder().encode(JSON.stringify(raw));
  const payload = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const imported = importInvite(importedId, `#invite=${payload}`);
  assert.equal(imported.photos.length, 0);
  assert.equal(imported.memoryNote, '');
  assert.equal(imported.isDemo, false);
  assert.equal(getActiveParticipantId(imported.id), null);
});

test('portable invitation imports once and never overwrites an existing local meeting', () => {
  freshStorage();
  const created = createMeeting(newMeetingInput());
  const invite = new URL(createInviteUrl(created.id));
  freshStorage();
  const imported = importInvite(created.id, invite.hash);
  assert.equal(imported.title, created.title);
  assert.equal(imported.participants[0].name, 'Алия');
  assert.equal(imported.participants[0].role, 'organizer');
  const joined = joinMeeting(created.id, 'Гость');
  assert.equal(importInvite(created.id, invite.hash).participants.length, 2);
  assert.equal(getMeeting(created.id).participants.length, joined.participants.length);
  assert.throws(() => importInvite('wrong-id', invite.hash), /Некорректная/);
  assert.throws(() => importInvite('missing-id', '#invite=not-valid-json'), /Не удалось|Некорректная/);
  assert.equal(importInvite('missing-id', ''), null);
});

test('fresh-browser demo invites import confirmed snapshot before seeding and grant no identity', () => {
  freshStorage();
  const meeting = confirmDemo();
  const invite = new URL(createInviteUrl(meeting.id));
  freshStorage();
  const imported = importInvite(meeting.id, invite.hash);
  assert.equal(imported.status, 'confirmed');
  assert.equal(imported.isDemo, false);
  assert.equal(getActiveParticipantId(meeting.id), null);
  assert.equal(getMeetings().length, 1);
  const joined = joinMeeting(meeting.id, 'Новый гость');
  const active = joined.participants.find((person) => person.id === getActiveParticipantId(meeting.id));
  assert.equal(active.role, 'guest');
  assert.throws(() => completeMeeting(meeting.id, active.id), /организатору/);
});

test('demo placeholder eagerly seeded by app can import invite while edited demo is preserved', () => {
  freshStorage();
  const meeting = confirmDemo();
  const invite = new URL(createInviteUrl(meeting.id));
  freshStorage();
  getMeetings();
  assert.equal(importInvite(meeting.id, invite.hash).status, 'confirmed');
  assert.equal(getActiveParticipantId(meeting.id), null);
  freshStorage();
  getMeetings();
  updateMeeting(meeting.id, { title: 'Моя изменённая встреча' });
  assert.equal(importInvite(meeting.id, invite.hash).title, 'Моя изменённая встреча');
});

test('browser storage denial is reported rather than silently switching to volatile memory', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  setStorageAdapter(undefined);
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: () => { throw new Error('SecurityError'); } });
  try { assert.throws(() => getMeetings(), /прочитать локальные данные|Хранилище браузера недоступно/); }
  finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else delete globalThis.localStorage;
    freshStorage();
  }
});

test('explicit demo reset removes custom meetings and full invite remains small enough for QR', () => {
  freshStorage();
  const created = createMeeting(newMeetingInput());
  confirmDemo();
  const reset = resetDemo();
  assert.equal(reset.status, 'planning');
  assert.equal(reset.planVersion, 0);
  assert.equal(getActiveParticipantId(reset.id), reset.organizer.id);
  assert.equal(getMeeting(created.id), null);
  assert.equal(getActiveParticipantId(created.id), null);
  assert.ok(createInviteUrl(reset.id).length < 2500);
});

test('corrupted local storage is reported without silently overwriting user data', () => {
  const values = freshStorage();
  getMeetings();
  values.set('yavka:repository:v1', '{broken user data');
  assert.throws(() => getMeetings(), /данные повреждены/);
  assert.equal(values.get('yavka:repository:v1'), '{broken user data');
  assert.equal(resetDemo().id, DEMO_MEETING_ID);
  assert.equal(getMeetings().length, 1);
});

test('quota failure is readable and leaves saved meeting unchanged', () => {
  const values = freshStorage();
  const meeting = getMeeting(DEMO_MEETING_ID);
  setStorageAdapter({
    getItem: (key) => values.get(key) ?? null,
    setItem: () => { throw new Error('QuotaExceededError'); },
  });
  assert.throws(() => updateMeeting(meeting.id, { title: 'Unsaved title' }), /Освободите место/);
  assert.equal(getMeeting(meeting.id).title, 'Кофе после пар');
});

test('calendar export escapes content and uses confirmed plan with valid folded CRLF lines', () => {
  freshStorage();
  const planning = getMeeting(DEMO_MEETING_ID);
  assert.throws(() => createCalendarEvent(planning), /Сначала подтвердите/);
  updateMeeting(planning.id, { title: 'Кофе, друзья; вечер', description: 'Первая строка\nВторая строка' });
  const meeting = confirmDemo();
  const event = createCalendarEvent(meeting);
  assert.match(event, /BEGIN:VCALENDAR\r\nVERSION:2.0/);
  assert.match(event, /SUMMARY:Кофе\\, друзья\\; вечер/);
  assert.match(event, /DESCRIPTION:Первая строка\\nВторая строка/);
  assert.match(event, /DTSTART:\d{8}T183000/);
  assert.match(event, /DTEND:\d{8}T200000/);
  assert.ok(event.endsWith('END:VCALENDAR\r\n'));
  assert.ok(event.split('\r\n').every((line) => new TextEncoder().encode(line).length <= 75));
});

test('photo input checks reject unsupported types, oversize inputs and excessive counts', async () => {
  await assert.rejects(processPhotos([{ name: 'vector.svg', type: 'image/svg+xml', size: 100 }]), /JPG, PNG и WebP/);
  await assert.rejects(processPhotos([{ name: 'large.jpg', type: 'image/jpeg', size: 2 * 1024 * 1024 + 1 }]), /2 МБ/);
  await assert.rejects(processPhotos(Array.from({ length: 7 }, () => ({ name: 'photo.jpg', type: 'image/jpeg', size: 10 }))), /6 фотографий/);
  assert.deepEqual(await processPhotos([]), []);
});
