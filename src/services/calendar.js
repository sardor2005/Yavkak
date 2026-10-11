/** RFC 5545 event export using the user's local wall-clock time. */
function escapeText(value = '') {
  return String(value).replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
}
function wallClock(date) {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}${String(date.getMinutes()).padStart(2, '0')}00`;
}
function foldLine(value) {
  // Count UTF-8 bytes so Cyrillic content still follows the 75-octet limit.
  const lines = [];
  let current = '';
  let size = 0;
  for (const character of value) {
    const length = new TextEncoder().encode(character).length;
    if (size + length > 75) { lines.push(current); current = ' '; size = 1; }
    current += character;
    size += length;
  }
  lines.push(current);
  return lines.join('\r\n');
}
export function createCalendarEvent(meeting) {
  const cloud = !!meeting?.startsAt;
  if (!cloud && (!meeting?.confirmedTime || !meeting?.confirmedPlace || !['confirmed', 'completed'].includes(meeting.status))) throw new Error('Сначала подтвердите время и место встречи.');
  const start = cloud ? new Date(meeting.startsAt) : new Date(`${meeting.confirmedTime.date}T${meeting.confirmedTime.time}:00`);
  if (!Number.isFinite(start.getTime())) throw new Error('Не удалось определить время встречи.');
  const end = new Date(start.getTime() + 90 * 60 * 1000);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const location = cloud ? [meeting.placeName, meeting.placeAddress].filter(Boolean).join(', ') : [meeting.confirmedPlace.name, meeting.confirmedPlace.address].filter(Boolean).join(', ');
  const eventTime = date => cloud ? date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z') : wallClock(date);
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Yavka//Meetings//RU', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
    `UID:${escapeText(meeting.id)}@yavka.local`, `DTSTAMP:${stamp}`, `DTSTART:${eventTime(start)}`, `DTEND:${eventTime(end)}`,
    `SUMMARY:${escapeText(meeting.title)}`, `DESCRIPTION:${escapeText(meeting.description)}`, `LOCATION:${escapeText(location)}`,
    `SEQUENCE:${Number.isInteger(meeting.planVersion) ? meeting.planVersion : 0}`, `STATUS:${meeting.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED'}`, 'END:VEVENT', 'END:VCALENDAR',
  ];
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}
export function downloadCalendarEvent(meeting) {
  const content = createCalendarEvent(meeting);
  const url = URL.createObjectURL(new Blob([content], { type: 'text/calendar;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `yavka-${meeting.id}.ics`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return content;
}
