/**
 * Local-first meeting repository. UI modules use this API, never localStorage.
 * Invite snapshots are portable copies; there is no cross-browser synchronisation.
 */
const STORAGE_KEY = 'yavka:repository:v1';
const ACTIVE_KEY = 'yavka:participants:v1';
export const DEMO_MEETING_ID = 'demo-yavka';
const PLANNING = new Set(['planning', 'awaiting']);
const ATTENDANCE = new Set(['pending', 'going', 'maybe', 'declined']);
const ARRIVAL = new Set(['home', 'leaving', 'late', 'arrived']);
let injectedAdapter;
let seededDemoSnapshot = null;
const fallbackValues = new Map();
const fallbackAdapter = {
  getItem: (key) => fallbackValues.get(key) ?? null,
  setItem: (key, value) => fallbackValues.set(key, String(value)),
  removeItem: (key) => fallbackValues.delete(key),
};

/** Replace with any Storage-shaped repository adapter (also useful in tests). */
export function setStorageAdapter(adapter) {
  if (adapter && (typeof adapter.getItem !== 'function' || typeof adapter.setItem !== 'function')) {
    throw new Error('Хранилище должно поддерживать чтение и запись.');
  }
  injectedAdapter = adapter;
  seededDemoSnapshot = null;
}

function adapter() {
  if (injectedAdapter) return injectedAdapter;
  try {
    if (globalThis.localStorage) return globalThis.localStorage;
    if (globalThis.window) throw new Error('Browser storage unavailable');
    return fallbackAdapter;
  } catch { throw new Error('Хранилище браузера недоступно. Разрешите сохранение данных для этого сайта.'); }
}
function copy(value) { return JSON.parse(JSON.stringify(value)); }
function read(key, fallback) {
  let value;
  try { value = adapter().getItem(key); }
  catch { throw new Error('Не удалось прочитать локальные данные. Проверьте доступ к хранилищу браузера.'); }
  if (value == null) return fallback;
  try {
    return JSON.parse(value);
  } catch { throw new Error('Локальные данные повреждены. Восстановите их кнопкой Demo.'); }
}
function write(key, value) {
  try { adapter().setItem(key, JSON.stringify(value)); }
  catch { throw new Error('Не удалось сохранить встречу. Освободите место в браузере и попробуйте снова.'); }
}
function id(prefix) {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`}`;
}
function cleanText(value, label, max, required = true) {
  if (typeof value !== 'string') {
    if (!required && value == null) return '';
    throw new Error(`Укажите ${label}.`);
  }
  const text = value.trim();
  if (required && !text) throw new Error(`Укажите ${label}.`);
  if (text.length > max) throw new Error(`${label[0].toUpperCase()}${label.slice(1)}: не более ${max} символов.`);
  return text;
}
function safeId(value, prefix) {
  return typeof value === 'string' && /^[\w-]{1,100}$/.test(value) ? value : id(prefix);
}
function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function validTime(value) { return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value); }
function normalizeTime(option) {
  if (!option || !validDate(option.date) || !validTime(option.time)) throw new Error('Укажите корректные дату и время.');
  return { id: safeId(option.id, 'time'), date: option.date, time: option.time };
}
function normalizePlace(option) {
  if (!option || typeof option !== 'object') throw new Error('Укажите место встречи.');
  return { id: safeId(option.id, 'place'), name: cleanText(option.name, 'место встречи', 120), address: cleanText(option.address, 'адрес', 250, false) };
}
function normalizeOptions(options, normalizer, label) {
  if (!Array.isArray(options) || options.length < 1 || options.length > 8) throw new Error(`Добавьте от 1 до 8 вариантов ${label}.`);
  const normalized = options.map(normalizer);
  if (new Set(normalized.map((option) => option.id)).size !== normalized.length) throw new Error(`Варианты ${label} должны иметь разные идентификаторы.`);
  return normalized;
}
function participant(name, participantId = id('person'), role = 'guest') {
  return { id: participantId, name, role, timeVotes: [], placeVotes: [], votesSaved: false, attendance: 'pending', arrivalStatus: 'home', lateMinutes: 0 };
}
function localDate(offset) {
  const now = new Date();
  now.setDate(now.getDate() + offset);
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
function demoMeeting() {
  const timeOptions = [
    { id: 'demo-time-1', date: localDate(1), time: '18:30' },
    { id: 'demo-time-2', date: localDate(1), time: '19:00' },
    { id: 'demo-time-3', date: localDate(2), time: '18:30' },
  ];
  const placeOptions = [
    { id: 'demo-place-1', name: 'Surf Coffee', address: 'Ташкент, ул. Шахрисабз, 25' },
    { id: 'demo-place-2', name: 'Bon!', address: 'Ташкент, ул. Шота Руставели, 20' },
    { id: 'demo-place-3', name: 'Кофейня у парка', address: 'Ташкент, парк Анхор' },
  ];
  const participants = ['Сардор', 'Нуржигит', 'Наталья', 'Данияр', 'Камила'].map((name, index) => participant(name, `demo-person-${index + 1}`, index === 0 ? 'organizer' : 'guest'));
  participants.slice(1).forEach((person, index) => {
    person.timeVotes = index === 2 ? ['demo-time-1', 'demo-time-3'] : ['demo-time-1', 'demo-time-2'];
    person.placeVotes = index === 1 ? ['demo-place-1', 'demo-place-3'] : ['demo-place-1'];
    person.votesSaved = true;
  });
  return {
    id: DEMO_MEETING_ID, title: 'Кофе после пар', description: 'Давно не виделись! Выберем время и место, выпьем кофе и поболтаем.',
    organizer: { id: participants[0].id, name: participants[0].name }, participants, timeOptions, placeOptions,
    status: 'planning', confirmedTime: null, confirmedPlace: null, planVersion: 0,
    photos: [], memoryNote: '', isDemo: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), completedAt: null,
  };
}
function repository() {
  const stored = read(STORAGE_KEY, null);
  if (stored !== null) {
    if (!stored || stored.version !== 1 || !Array.isArray(stored.meetings) || stored.meetings.some((meeting) => !meeting || typeof meeting.id !== 'string' || !meeting.organizer || !Array.isArray(meeting.participants) || !Array.isArray(meeting.timeOptions) || !Array.isArray(meeting.placeOptions) || !['planning', 'awaiting', 'confirmed', 'completed'].includes(meeting.status))) {
      throw new Error('Локальные данные повреждены. Восстановите их кнопкой Demo.');
    }
    return stored;
  }
  const demo = demoMeeting();
  const initial = { version: 1, meetings: [demo] };
  write(STORAGE_KEY, initial);
  const identities = read(ACTIVE_KEY, {});
  write(ACTIVE_KEY, { ...identities, [demo.id]: demo.organizer.id });
  seededDemoSnapshot = JSON.stringify(demo);
  return initial;
}
function requireMeeting(meetingId) {
  const meeting = repository().meetings.find((item) => item.id === meetingId);
  if (!meeting) throw new Error('Встреча не найдена. Проверьте ссылку приглашения.');
  return copy(meeting);
}
function persist(meeting) {
  const data = repository();
  meeting.updatedAt = new Date().toISOString();
  const index = data.meetings.findIndex((item) => item.id === meeting.id);
  if (index === -1) data.meetings.unshift(meeting); else data.meetings[index] = meeting;
  write(STORAGE_KEY, data);
  return copy(meeting);
}
function requireParticipant(meeting, participantId) {
  const person = meeting.participants.find((item) => item.id === participantId);
  if (!person) throw new Error('Сначала присоединитесь к встрече.');
  if (getActiveParticipantId(meeting.id) !== participantId) throw new Error('Вы можете изменять только свой ответ.');
  return person;
}
function requireOrganizer(meeting, actorId = getActiveParticipantId(meeting.id)) {
  requireParticipant(meeting, actorId);
  if (meeting.organizer.id !== actorId) throw new Error('Это действие доступно только организатору.');
}
function requireStatus(meeting, allowed, message) {
  if (!allowed.has(meeting.status)) throw new Error(message);
}
function updatePlanningStatus(meeting) {
  meeting.status = meeting.participants.every((person) => person.votesSaved) ? 'awaiting' : 'planning';
}

export function getMeetings() { return copy(repository().meetings); }
export function getMeeting(meetingId) { return copy(repository().meetings.find((meeting) => meeting.id === meetingId) || null); }
export function createMeeting(input) {
  const title = cleanText(input?.title, 'название встречи', 120);
  const description = cleanText(input?.description, 'описание', 1000, false);
  const organizerName = cleanText(input?.organizerName, 'ваше имя', 60);
  const timeOptions = normalizeOptions(input?.timeOptions, normalizeTime, 'времени');
  const placeOptions = normalizeOptions(input?.placeOptions, normalizePlace, 'места');
  const person = participant(organizerName, id('person'), 'organizer');
  const meeting = {
    id: id('meeting'), title, description, organizer: { id: person.id, name: person.name }, participants: [person],
    timeOptions, placeOptions, status: 'planning', confirmedTime: null, confirmedPlace: null, planVersion: 0,
    photos: [], memoryNote: '', isDemo: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), completedAt: null,
  };
  persist(meeting);
  setActiveParticipantId(meeting.id, person.id);
  return copy(meeting);
}
export function updateMeeting(meetingId, patch) {
  const meeting = requireMeeting(meetingId);
  requireOrganizer(meeting);
  requireStatus(meeting, PLANNING, 'План уже подтверждён. Измените время или место через изменение плана.');
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Укажите изменения встречи.');
  if ('title' in patch) meeting.title = cleanText(patch.title, 'название встречи', 120);
  if ('description' in patch) meeting.description = cleanText(patch.description, 'описание', 1000, false);
  if ('timeOptions' in patch) meeting.timeOptions = normalizeOptions(patch.timeOptions, normalizeTime, 'времени');
  if ('placeOptions' in patch) meeting.placeOptions = normalizeOptions(patch.placeOptions, normalizePlace, 'места');
  if ('timeOptions' in patch || 'placeOptions' in patch) {
    const timeIds = new Set(meeting.timeOptions.map((option) => option.id));
    const placeIds = new Set(meeting.placeOptions.map((option) => option.id));
    meeting.participants.forEach((person) => {
      person.timeVotes = person.timeVotes.filter((optionId) => timeIds.has(optionId));
      person.placeVotes = person.placeVotes.filter((optionId) => placeIds.has(optionId));
      person.votesSaved = Boolean(person.votesSaved && person.timeVotes.length && person.placeVotes.length);
    });
  }
  updatePlanningStatus(meeting);
  return persist(meeting);
}
export function joinMeeting(meetingId, name) {
  const meeting = requireMeeting(meetingId);
  if (meeting.status === 'completed') throw new Error('Встреча завершена. Присоединиться уже нельзя.');
  const cleanName = cleanText(name, 'ваше имя', 60);
  if (meeting.participants.some((person) => person.name.toLocaleLowerCase() === cleanName.toLocaleLowerCase())) throw new Error('Участник с таким именем уже есть. Укажите другое имя.');
  if (meeting.participants.length >= 8) throw new Error('Во встрече уже 8 участников — группа заполнена.');
  const person = participant(cleanName);
  meeting.participants.push(person);
  if (PLANNING.has(meeting.status)) updatePlanningStatus(meeting);
  persist(meeting);
  write(ACTIVE_KEY, { ...read(ACTIVE_KEY, {}), [meeting.id]: person.id });
  return copy(meeting);
}
export function vote(meetingId, participantId, votes) {
  const meeting = requireMeeting(meetingId);
  requireStatus(meeting, PLANNING, 'Голосование закрыто: план встречи уже подтверждён.');
  const person = requireParticipant(meeting, participantId);
  const verify = (values, options) => {
    if (!Array.isArray(values) || !values.length || values.some((optionId) => !options.some((option) => option.id === optionId))) throw new Error('Выберите хотя бы один вариант времени и места из списка.');
    return [...new Set(values)];
  };
  person.timeVotes = verify(votes?.timeVotes, meeting.timeOptions);
  person.placeVotes = verify(votes?.placeVotes, meeting.placeOptions);
  person.votesSaved = true;
  updatePlanningStatus(meeting);
  return persist(meeting);
}
export function confirmPlan(meetingId, actorId, plan) {
  const meeting = requireMeeting(meetingId);
  requireOrganizer(meeting, actorId);
  requireStatus(meeting, new Set(['planning', 'awaiting', 'confirmed']), 'Встреча завершена. Изменить её план уже нельзя.');
  let chosenTime = meeting.timeOptions.find((option) => option.id === plan?.timeId);
  let chosenPlace = meeting.placeOptions.find((option) => option.id === plan?.placeId);
  if (plan?.date !== undefined || plan?.time !== undefined) {
    chosenTime = normalizeTime({ id: chosenTime?.id || meeting.confirmedTime?.id || id('time'), date: plan.date ?? chosenTime?.date ?? meeting.confirmedTime?.date, time: plan.time ?? chosenTime?.time ?? meeting.confirmedTime?.time });
  }
  if (plan?.placeName !== undefined || plan?.placeAddress !== undefined) {
    chosenPlace = normalizePlace({ id: chosenPlace?.id || meeting.confirmedPlace?.id || id('place'), name: plan.placeName ?? chosenPlace?.name ?? meeting.confirmedPlace?.name, address: plan.placeAddress ?? chosenPlace?.address ?? meeting.confirmedPlace?.address });
  }
  if (!chosenTime || !chosenPlace) throw new Error('Выберите время и место встречи.');
  const previousTime = meeting.confirmedTime;
  const previousPlace = meeting.confirmedPlace;
  const changed = !previousTime || !previousPlace || previousTime.date !== chosenTime.date || previousTime.time !== chosenTime.time || previousPlace.name !== chosenPlace.name || (previousPlace.address || '') !== (chosenPlace.address || '');
  meeting.confirmedTime = copy(chosenTime);
  meeting.confirmedPlace = copy(chosenPlace);
  meeting.status = 'confirmed';
  if (changed) {
    meeting.planVersion += 1;
    meeting.participants.forEach((person) => { person.attendance = 'pending'; person.arrivalStatus = 'home'; person.lateMinutes = 0; });
  }
  return persist(meeting);
}
export function updateAttendance(meetingId, participantId, attendance) {
  const meeting = requireMeeting(meetingId);
  requireStatus(meeting, new Set(['confirmed']), 'Ответ об участии доступен после подтверждения плана.');
  const person = requireParticipant(meeting, participantId);
  if (!ATTENDANCE.has(attendance) || attendance === 'pending') throw new Error('Выберите: «Буду», «Под вопросом» или «Не смогу».');
  person.attendance = attendance;
  if (attendance !== 'going') { person.arrivalStatus = 'home'; person.lateMinutes = 0; }
  return persist(meeting);
}
export function updateArrivalStatus(meetingId, participantId, status, lateMinutes = 0) {
  const meeting = requireMeeting(meetingId);
  requireStatus(meeting, new Set(['confirmed']), 'Статус прибытия доступен только для подтверждённой встречи.');
  const person = requireParticipant(meeting, participantId);
  if (person.attendance !== 'going') throw new Error('Сначала подтвердите участие: «Буду».');
  if (!ARRIVAL.has(status)) throw new Error('Выберите корректный статус прибытия.');
  if (status === 'late' && (!Number.isInteger(Number(lateMinutes)) || Number(lateMinutes) < 1 || Number(lateMinutes) > 180)) throw new Error('Укажите опоздание от 1 до 180 минут.');
  person.arrivalStatus = status;
  person.lateMinutes = status === 'late' ? Number(lateMinutes) : 0;
  return persist(meeting);
}
export function completeMeeting(meetingId, actorId) {
  const meeting = requireMeeting(meetingId);
  requireOrganizer(meeting, actorId);
  requireStatus(meeting, new Set(['confirmed']), 'Завершить можно только встречу с подтверждённым планом.');
  meeting.status = 'completed';
  meeting.completedAt = new Date().toISOString();
  return persist(meeting);
}
export function saveMemory(meetingId, actorId, memory) {
  const meeting = requireMeeting(meetingId);
  requireOrganizer(meeting, actorId);
  requireStatus(meeting, new Set(['completed']), 'Добавить воспоминания можно после завершения встречи.');
  const photos = memory?.photos ?? meeting.photos;
  if (!Array.isArray(photos) || photos.length > 6) throw new Error('Можно сохранить не более 6 фотографий.');
  meeting.photos = photos.map((photo) => {
    if (!photo || typeof photo.url !== 'string' || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(photo.url) || photo.url.length > 3 * 1024 * 1024) throw new Error('Фотография не прошла проверку. Загрузите JPG, PNG или WebP.');
    return { id: safeId(photo.id, 'photo'), name: cleanText(photo.name || 'Фото встречи', 'название фотографии', 250), url: photo.url };
  });
  meeting.memoryNote = cleanText(memory?.memoryNote ?? meeting.memoryNote, 'заметку', 2000, false);
  return persist(meeting);
}
export function getActiveParticipantId(meetingId) {
  const identities = read(ACTIVE_KEY, {});
  return typeof identities?.[meetingId] === 'string' ? identities[meetingId] : null;
}
export function setActiveParticipantId(meetingId, participantId) {
  const meeting = requireMeeting(meetingId);
  if (!meeting.participants.some((person) => person.id === participantId)) throw new Error('Участник не найден.');
  const current = getActiveParticipantId(meetingId);
  if (current && current !== participantId && !meeting.isDemo) throw new Error('Переключение участников доступно только в демонстрационной встрече.');
  write(ACTIVE_KEY, { ...read(ACTIVE_KEY, {}), [meetingId]: participantId });
  if (meetingId === DEMO_MEETING_ID) seededDemoSnapshot = null;
  return participantId;
}
export function resetDemo() {
  const demo = demoMeeting();
  // This explicit reset is confirmed by the UI and also recovers damaged data.
  write(STORAGE_KEY, { version: 1, meetings: [demo] });
  write(ACTIVE_KEY, { [demo.id]: demo.organizer.id });
  seededDemoSnapshot = null;
  return copy(demo);
}
function encodeSnapshot(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function decodeSnapshot(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(binary, (character) => character.charCodeAt(0))));
}
export function createInviteUrl(meetingId) {
  const meeting = requireMeeting(meetingId);
  // Compact schema keeps ordinary meeting invites small enough for a QR code.
  const snapshot = {
    v: 1, i: meeting.id, t: meeting.title, d: meeting.description, o: meeting.organizer.id,
    p: meeting.participants.map((person) => [person.id, person.name, person.timeVotes, person.placeVotes, person.votesSaved, person.attendance, person.arrivalStatus, person.lateMinutes]),
    a: meeting.timeOptions.map((option) => [option.id, option.date, option.time]),
    b: meeting.placeOptions.map((option) => [option.id, option.name, option.address || '']),
    s: meeting.status, r: meeting.planVersion,
    f: meeting.confirmedTime ? [meeting.confirmedTime.id, meeting.confirmedTime.date, meeting.confirmedTime.time] : null,
    g: meeting.confirmedPlace ? [meeting.confirmedPlace.id, meeting.confirmedPlace.name, meeting.confirmedPlace.address || ''] : null,
  };
  const origin = globalThis.location?.origin || 'http://localhost:5173';
  return `${origin}/join/${encodeURIComponent(meeting.id)}#invite=${encodeSnapshot(snapshot)}`;
}
function validateImported(raw, meetingId) {
  if (!raw || typeof raw !== 'object' || raw.id !== meetingId || !/^[\w-]{1,100}$/.test(meetingId)) throw new Error('Некорректная ссылка приглашения.');
  const timeOptions = normalizeOptions(raw.timeOptions, normalizeTime, 'времени');
  const placeOptions = normalizeOptions(raw.placeOptions, normalizePlace, 'места');
  if (!Array.isArray(raw.participants) || raw.participants.length < 1 || raw.participants.length > 8) throw new Error('Некорректный список участников.');
  const participants = raw.participants.map((value) => {
    if (!value || typeof value.id !== 'string' || !/^[\w-]{1,100}$/.test(value.id)) throw new Error('Некорректный участник приглашения.');
    const person = participant(cleanText(value.name, 'имя участника', 60), value.id);
    person.timeVotes = Array.isArray(value.timeVotes) ? [...new Set(value.timeVotes.filter((optionId) => timeOptions.some((option) => option.id === optionId)))] : [];
    person.placeVotes = Array.isArray(value.placeVotes) ? [...new Set(value.placeVotes.filter((optionId) => placeOptions.some((option) => option.id === optionId)))] : [];
    person.votesSaved = Boolean(value.votesSaved && person.timeVotes.length && person.placeVotes.length);
    person.attendance = ATTENDANCE.has(value.attendance) ? value.attendance : 'pending';
    person.arrivalStatus = ARRIVAL.has(value.arrivalStatus) && person.attendance === 'going' ? value.arrivalStatus : 'home';
    person.lateMinutes = person.arrivalStatus === 'late' && Number.isInteger(value.lateMinutes) && value.lateMinutes >= 1 && value.lateMinutes <= 180 ? value.lateMinutes : 0;
    return person;
  });
  if (new Set(participants.map((person) => person.id)).size !== participants.length || new Set(participants.map((person) => person.name.toLocaleLowerCase())).size !== participants.length) throw new Error('Участники приглашения не должны повторяться.');
  const organizer = participants.find((person) => person.id === raw.organizer?.id);
  if (!organizer) throw new Error('В приглашении не указан организатор.');
  organizer.role = 'organizer';
  if (!['planning', 'awaiting', 'confirmed', 'completed'].includes(raw.status)) throw new Error('Некорректный этап встречи.');
  const confirmedTime = raw.confirmedTime ? normalizeTime(raw.confirmedTime) : null;
  const confirmedPlace = raw.confirmedPlace ? normalizePlace(raw.confirmedPlace) : null;
  if (['confirmed', 'completed'].includes(raw.status) && (!confirmedTime || !confirmedPlace)) throw new Error('В приглашении отсутствует подтверждённый план.');
  const meeting = {
    id: meetingId, title: cleanText(raw.title, 'название встречи', 120), description: cleanText(raw.description, 'описание', 1000, false),
    organizer: { id: organizer.id, name: organizer.name }, participants, timeOptions, placeOptions,
    status: raw.status, confirmedTime, confirmedPlace,
    planVersion: Number.isInteger(raw.planVersion) && raw.planVersion >= 0 && raw.planVersion <= 100000 ? raw.planVersion : 0,
    photos: [], memoryNote: '', isDemo: false,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), completedAt: raw.status === 'completed' ? new Date().toISOString() : null,
  };
  if (PLANNING.has(meeting.status)) updatePlanningStatus(meeting);
  return meeting;
}
function expandSnapshot(snapshot) {
  if (!snapshot || snapshot.v !== 1 || !Array.isArray(snapshot.a) || !Array.isArray(snapshot.b) || !Array.isArray(snapshot.p)) throw new Error('Некорректная ссылка приглашения.');
  const time = (option) => Array.isArray(option) ? { id: option[0], date: option[1], time: option[2] } : null;
  const place = (option) => Array.isArray(option) ? { id: option[0], name: option[1], address: option[2] } : null;
  return {
    id: snapshot.i, title: snapshot.t, description: snapshot.d, organizer: { id: snapshot.o },
    timeOptions: snapshot.a.map(time), placeOptions: snapshot.b.map(place),
    participants: snapshot.p.map((person) => Array.isArray(person) ? { id: person[0], name: person[1], timeVotes: person[2], placeVotes: person[3], votesSaved: person[4], attendance: person[5], arrivalStatus: person[6], lateMinutes: person[7] } : null),
    status: snapshot.s, planVersion: snapshot.r, confirmedTime: snapshot.f ? time(snapshot.f) : null, confirmedPlace: snapshot.g ? place(snapshot.g) : null,
  };
}
export function importInvite(meetingId, hash) {
  // Inspect without initialising: a cold invite must import its snapshot first.
  const saved = read(STORAGE_KEY, null);
  const data = saved === null ? { version: 1, meetings: [] } : repository();
  const existing = data.meetings.find((meeting) => meeting.id === meetingId);
  const replaceFreshPlaceholder = existing && seededDemoSnapshot && JSON.stringify(existing) === seededDemoSnapshot;
  if (existing && !replaceFreshPlaceholder) return copy(existing);
  if (!hash) return existing ? copy(existing) : null;
  try {
    const encoded = new URLSearchParams(String(hash).replace(/^#/, '')).get('invite');
    if (!encoded || encoded.length > 100000 || !/^[\w-]+$/.test(encoded)) throw new Error('Некорректная ссылка приглашения.');
    const meeting = validateImported(expandSnapshot(decodeSnapshot(encoded)), meetingId);
    const next = { version: 1, meetings: [meeting, ...data.meetings.filter((item) => item.id !== meetingId)] };
    write(STORAGE_KEY, next);
    // Imported people are examples from another browser, never local identities.
    const identities = read(ACTIVE_KEY, {});
    delete identities[meetingId];
    write(ACTIVE_KEY, identities);
    seededDemoSnapshot = null;
    return copy(meeting);
  } catch (error) {
    if (error instanceof Error && /^(Укажите|Добавьте|Некоррект|В приглашении|Участники|Варианты)/.test(error.message)) throw error;
    throw new Error('Не удалось открыть приглашение. Попросите организатора прислать новую ссылку.');
  }
}
