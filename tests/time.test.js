import test from 'node:test';
import assert from 'node:assert/strict';
import { zonedDateTime, meetingDateParts } from '../src/utils/time.js';
import { createCalendarEvent } from '../src/services/calendar.js';

test('meeting wall-clock is converted using chosen timezone, not device timezone', () => {
  assert.equal(zonedDateTime('2026-10-11', '18:30', 'Asia/Tashkent'), '2026-10-11T13:30:00.000Z');
  assert.equal(zonedDateTime('2026-01-01', '00:30', 'Asia/Tashkent'), '2025-12-31T19:30:00.000Z');
  assert.deepEqual(meetingDateParts('2026-10-11T13:30:00Z', 'Asia/Tashkent'), { date: '2026-10-11', time: '18:30' });
});
test('DST gaps and repeated ambiguous times cannot silently change meeting instant', () => {
  assert.throws(() => zonedDateTime('2026-03-08', '02:30', 'America/New_York'), /не существует/);
  assert.throws(() => zonedDateTime('2026-11-01', '01:30', 'America/New_York'), /повторяется/);
  assert.equal(zonedDateTime('2026-03-08', '03:30', 'America/New_York'), '2026-03-08T07:30:00.000Z');
});
test('invalid dates, clock values and timezone are rejected', () => {
  assert.throws(() => zonedDateTime('2026-02-30', '18:30', 'Asia/Tashkent'));
  assert.throws(() => zonedDateTime('2026-10-11', '24:00', 'Asia/Tashkent'));
  assert.throws(() => zonedDateTime('2026-10-11', '12:00', 'Mars/City'));
});
test('cloud calendar export preserves the actual instant across devices', () => {
  const ics = createCalendarEvent({ id: 'meeting', title: 'Кофе', startsAt: '2026-10-11T13:30:00Z', placeName: 'Кофейня', placeAddress: 'Улица', status: 'scheduled' });
  assert.match(ics, /DTSTART:20261011T133000Z/);
  assert.match(ics, /DTEND:20261011T150000Z/);
});
