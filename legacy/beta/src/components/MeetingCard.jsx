import { Link } from 'react-router-dom';
import { ArrowUpRight, CalendarDays, Clock3, MapPin, Coffee, Image } from 'lucide-react';
import { dateLabel, meetingState, peopleLabel } from '../utils/format.js';

export default function MeetingCard({ meeting }) {
  const state = meetingState(meeting);
  const time = meeting.confirmedTime || meeting.timeOptions[0];
  const place = meeting.confirmedPlace || meeting.placeOptions[0];
  return <Link to={`/meetings/${meeting.id}`} className="meeting-card">
    <div className={`meeting-cover ${meeting.status === 'completed' ? 'past-cover' : ''}`}>
      {meeting.photos?.[0] ? <img src={meeting.photos[0].url} alt={`Воспоминание: ${meeting.title}`} /> : <><div className="cover-ring ring-one" /><div className="cover-ring ring-two" /><div className="cover-center">{meeting.status === 'completed' ? <Image size={40} strokeWidth={1.3} /> : <Coffee size={48} strokeWidth={1.3} />}</div><span className="cover-caption">{meeting.status === 'completed' ? 'ХОРОШО БЫЛО' : 'УВИДИМСЯ СКОРО'}</span></>}
      <span className={`badge ${state.color}`}>{state.label}</span>
      {time && <div className="date-stamp"><strong>{new Date(`${time.date}T12:00:00`).getDate()}</strong><span>{new Date(`${time.date}T12:00:00`).toLocaleDateString('ru-RU', { month: 'short' }).replace('.', '')}</span></div>}
    </div>
    <div className="meeting-card-body"><div className="card-title-line"><h3>{meeting.title}</h3><span className="card-arrow"><ArrowUpRight size={20} /></span></div>
      <div className="meeting-meta"><span><CalendarDays size={16} />{dateLabel(time?.date)}</span><span><Clock3 size={16} />{time?.time || 'Выбираем время'}</span></div>
      <div className="meeting-place"><MapPin size={16} />{place?.name || 'Выбираем место'}{!meeting.confirmedPlace && <span className="proposal-hint">· вариант</span>}</div>
      <div className="card-bottom"><div className="avatar-stack">{meeting.participants.slice(0, 5).map((p, i) => <span key={p.id} className={`avatar avatar-${i % 5}`} title={p.name}>{p.name.slice(0, 1)}</span>)}</div><span>{peopleLabel(meeting.participants.length)}</span></div>
    </div>
  </Link>;
}
