import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, CalendarDays, Coffee, MapPin, ShieldCheck, Users } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import { importInvite, joinMeeting } from '../services/storage.js';
import '../meeting.css';

export default function Join() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { meetings, mutate, refresh } = useApp();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const meeting = meetings.find((item) => item.id === id);

  useEffect(() => {
    setError(''); setReady(false);
    try { const imported = importInvite(id, window.location.hash); if (imported) refresh(); }
    catch (cause) { setError(cause.message || 'Не удалось открыть приглашение. Попросите организатора отправить новую ссылку.'); }
    setReady(true);
  }, [id]);

  function submit(event) {
    event.preventDefault(); setError('');
    const cleaned = name.trim();
    if (cleaned.length < 2) { setError('Введите имя — хотя бы два символа.'); return; }
    const result = mutate(() => joinMeeting(id, cleaned), 'Вы в компании! Теперь выберите удобные варианты.');
    if (result) navigate(`/meetings/${id}`);
  }

  if (!ready) return <div className="join-page"><div className="card join-card"><p className="muted">Открываем приглашение…</p></div></div>;
  if (!meeting) return <div className="join-page"><div className="card join-card join-missing"><div className="join-coffee"><CalendarDays size={30} /></div><h1>Приглашение не найдено</h1><p>{error || 'Откройте полную ссылку, которую прислал организатор. В beta приглашение содержит данные встречи.'}</p><Link to="/" className="button primary">Мои встречи <ArrowRight size={17} /></Link></div></div>;
  const time = meeting.confirmedTime || meeting.timeOptions[0];
  const place = meeting.confirmedPlace || meeting.placeOptions[0];
  const date = time?.date ? new Date(`${time.date}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) : 'Выберем вместе';

  return <div className="join-page"><Link className="back-link join-back" to="/"><ArrowLeft size={17} /> Мои встречи</Link><div className="join-decoration one" /><div className="join-decoration two" /><section className="card join-card"><h1 className="join-invitation-tag"><span /> Вас приглашают на встречу</h1><div className="join-coffee"><Coffee size={36} strokeWidth={1.6} /></div><h2 className="join-title">{meeting.title}</h2><p className="join-organizer">{meeting.organizer.name} собирает компанию</p>{meeting.description && <p className="join-description">{meeting.description}</p>}<div className="join-event-details"><span><CalendarDays size={17} /><strong>{date}{time?.time && ` · ${time.time}`}</strong></span><span><MapPin size={17} /><strong>{place?.name || 'Место выберем вместе'}</strong></span><span><Users size={17} /><strong>{meeting.participants.length} в компании</strong></span>{!meeting.confirmedTime && <p>Время и место ещё можно выбрать вместе.</p>}</div>
    {meeting.status === 'completed' ? <div className="join-completed"><p>Эта встреча уже состоялась.</p><Link className="button primary" to={`/meetings/${id}`}>Посмотреть воспоминание <ArrowRight size={17} /></Link></div> : <form onSubmit={submit}><label className="field" htmlFor="guest-name">Ваше имя<input id="guest-name" placeholder="Ваше имя" autoComplete="given-name" required maxLength={40} value={name} onChange={(event) => setName(event.target.value)} aria-describedby={error ? 'join-error' : undefined} /></label>{error && <p className="form-error" id="join-error" role="alert">{error}</p>}<button type="submit" className="button primary join-submit">Присоединиться <ArrowRight size={18} /></button><div className="join-no-account"><ShieldCheck size={15} /> Без регистрации и паролей</div></form>}
    <p className="join-beta-caption">Beta: общий план передаётся в ссылке. Ответы сохраняются в вашем браузере.</p>
  </section><p className="join-slogan">Договорились. Встретились. Сохранили.</p></div>;
}
