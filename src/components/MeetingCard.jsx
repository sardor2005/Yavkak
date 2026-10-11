import { Link } from 'react-router-dom';
import { ArrowUpRight, CalendarDays, Clock3, MapPin, Coffee, Image } from 'lucide-react';
import { peopleLabel } from '../utils/format.js';
import { meetingDateParts } from '../utils/time.js';

export default function MeetingCard({ meeting }) {
  const participants = meeting.participants || [];
  const date = new Date(meeting.startsAt);
  const timeZone = meeting.timeZone || 'UTC';
  const validDate = Number.isFinite(date.getTime());
  const today = meetingDateParts(new Date().toISOString(), timeZone).date;
  const meetingDay = validDate ? meetingDateParts(meeting.startsAt, timeZone).date : '';
  const state = meeting.status === 'completed' ? { label: 'Завершена', color: 'gray' } : meeting.status === 'cancelled' ? { label: 'Отменена', color: 'gray' } : meetingDay === today ? { label: 'Сегодня', color: 'green' } : { label: 'Запланирована', color: 'blue' };
  const completed = meeting.status === 'completed';
  return <Link to={`/meetings/${meeting.id}`} className="meeting-card">
    <div className={`meeting-cover ${completed ? 'past-cover' : ''}`}>
      {meeting.photos?.[0]?.url ? <img src={meeting.photos[0].url} alt={`Воспоминание: ${meeting.title}`} loading="lazy" /> : <><div className="cover-ring ring-one" /><div className="cover-ring ring-two" /><div className="cover-center">{completed ? <Image size={40} strokeWidth={1.3} /> : <Coffee size={48} strokeWidth={1.3} />}</div><span className="cover-caption">{completed ? 'ХОРОШО БЫЛО' : meeting.status === 'cancelled' ? 'ДО СЛЕДУЮЩЕЙ ВСТРЕЧИ' : 'УВИДИМСЯ СКОРО'}</span></>}
      <span className={`badge ${state.color}`}>{state.label}</span>
      {validDate && <div className="date-stamp"><strong>{date.toLocaleString('ru-RU', { timeZone, day: 'numeric' })}</strong><span>{date.toLocaleString('ru-RU', { timeZone, month: 'short' }).replace('.', '')}</span></div>}
    </div>
    <div className="meeting-card-body"><div className="card-title-line"><h3>{meeting.title}</h3><span className="card-arrow"><ArrowUpRight size={20} /></span></div>
      <div className="meeting-meta"><span><CalendarDays size={16} />{validDate ? date.toLocaleDateString('ru-RU', { timeZone, day: 'numeric', month: 'long' }) : 'Дата не указана'}</span><span><Clock3 size={16} />{validDate ? date.toLocaleTimeString('ru-RU', { timeZone, hour: '2-digit', minute: '2-digit' }) : '—'}</span></div>
      <div className="meeting-place"><MapPin size={16} />{meeting.placeName}</div><p className="muted" style={{ fontSize: 11, margin: '0 0 14px' }}>{timeZone}</p>
      <div className="card-bottom"><div className="avatar-stack">{participants.slice(0, 5).map((participant, index) => <span key={participant.id} className={`avatar avatar-${index % 5}`} title={participant.name}>{String(participant.name || '?').slice(0, 1)}</span>)}</div><span>{peopleLabel(participants.length)}</span></div>
    </div>
  </Link>;
}
