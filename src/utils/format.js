export function dateLabel(date, { year = false } = {}) {
  if (!date) return 'Выбираем дату';
  const parsed = new Date(`${date}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return 'Выбираем дату';
  return parsed.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', ...(year ? { year: 'numeric' } : {}) });
}
export function localDate(offset = 0) {
  const date = new Date(); date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function meetingState(meeting) {
  if (meeting.status === 'completed') return { label: 'Завершена', color: 'gray' };
  if (meeting.status === 'confirmed' && meeting.confirmedTime?.date === localDate()) return { label: 'Сегодня', color: 'green' };
  if (meeting.status === 'confirmed') return { label: 'Подтверждена', color: 'green' };
  if (meeting.status === 'awaiting') return { label: 'Ожидает подтверждения', color: 'amber' };
  return { label: 'Согласование', color: 'blue' };
}
export function peopleLabel(count) {
  return `${count} ${count % 10 === 1 && count % 100 !== 11 ? 'участник' : count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 12 || count % 100 > 14) ? 'участника' : 'участников'}`;
}
