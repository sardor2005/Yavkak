function formatter(timeZone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
}

export function meetingDateParts(instant, timeZone) {
  const values = Object.fromEntries(formatter(timeZone).formatToParts(new Date(instant)).map(({ type, value }) => [type, value]));
  return { date: `${values.year}-${values.month}-${values.day}`, time: `${values.hour}:${values.minute}` };
}

/** Reject nonexistent/ambiguous DST times rather than silently shifting a meeting. */
export function zonedDateTime(date, time, timeZone) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Укажите корректную дату и время.');
  const wall = new Date(`${date}T${time}:00Z`).getTime();
  if (!Number.isFinite(wall) || new Date(wall).toISOString().slice(0, 10) !== date) throw new Error('Дата не существует.');
  const f = formatter(timeZone);
  const offsets = new Set();
  for (const delta of [-36, -12, 0, 12, 36]) {
    const probe = wall + delta * 3600000;
    const p = Object.fromEntries(f.formatToParts(new Date(probe)).map(({ type, value }) => [type, value]));
    offsets.add(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second)) - probe);
  }
  const matches = [...offsets].map(offset => wall - offset).filter(candidate => {
    const p = meetingDateParts(candidate, timeZone);
    return p.date === date && p.time === time;
  });
  if (matches.length !== 1) throw new Error(matches.length ? 'Это время повторяется при переводе часов. Выберите другое время.' : 'Это время не существует из-за перевода часов. Выберите другое время.');
  return new Date(matches[0]).toISOString();
}
