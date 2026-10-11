import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { ArrowLeft, ArrowUpRight, CalendarDays, Check, CheckCircle2, ChevronRight, Clock3, Coffee, Copy, Crown, Download, Flag, Footprints, HelpCircle, Home, MapPin, Pencil, QrCode, Sparkles, Users, X } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import { completeMeeting, confirmPlan, createInviteUrl, getActiveParticipantId, setActiveParticipantId, updateArrivalStatus, updateAttendance, vote } from '../services/storage.js';
import { downloadCalendarEvent } from '../services/calendar.js';
import '../meeting.css';

const attendanceLabels = { pending: 'Ждём ответа', going: 'Будет', maybe: 'Не уверен', declined: 'Не сможет' };
const arrivalLabels = { home: 'Ещё дома', leaving: 'Выхожу', late: 'Задерживаюсь', arrived: 'Прибыл' };
const arrivalIcons = { home: Home, leaving: Footprints, late: Clock3, arrived: CheckCircle2 };
const statusLabels = { planning: 'Согласование', awaiting: 'Ожидает подтверждения', confirmed: 'Встреча подтверждена', completed: 'Встреча состоялась' };
const dayLabel = (date, long = false) => {
  if (!date) return 'Дата пока не выбрана';
  const parsed = new Date(`${date}T12:00:00`);
  return Number.isNaN(parsed.valueOf()) ? date : parsed.toLocaleDateString('ru-RU', { day: 'numeric', month: long ? 'long' : 'short', ...(long ? { weekday: 'long' } : {}) });
};
const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((word) => word[0]).join('').toUpperCase();
const plural = (count, forms) => forms[count % 100 >= 11 && count % 100 <= 14 ? 2 : count % 10 === 1 ? 0 : count % 10 >= 2 && count % 10 <= 4 ? 1 : 2];
const votesLabel = (count) => `${count} ${plural(count, ['голос', 'голоса', 'голосов'])}`;

function ParticipantAvatar({ participant, small = false }) {
  return <span className={`avatar mp-avatar ${small ? 'mp-avatar-small' : ''}`} style={{ '--avatar-hue': `${Array.from(participant.name).reduce((sum, char) => sum + char.charCodeAt(0), 0) % 360}` }}>{initials(participant.name)}</span>;
}

function MissingMeeting() {
  return <div className="meeting-page"><Link className="back-link" to="/"><ArrowLeft size={17} /> К встречам</Link><div className="empty-state card mp-missing"><CalendarDays size={38} /><h1>Встреча не найдена</h1><p>Возможно, её удалили или она сохранена в другом браузере. Откройте полную ссылку приглашения.</p><Link className="button primary" to="/">Мои встречи</Link></div></div>;
}

export default function Meeting() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { meetings, mutate, toast } = useApp();
  const meeting = meetings.find((item) => item.id === id);
  const activeId = getActiveParticipantId(id);
  const active = meeting?.participants.find((participant) => participant.id === activeId);
  const organizer = !!active && (active.id === meeting?.organizer.id || active.role === 'organizer');
  const [timeVotes, setTimeVotes] = useState([]);
  const [placeVotes, setPlaceVotes] = useState([]);
  const [finalTime, setFinalTime] = useState('');
  const [finalPlace, setFinalPlace] = useState('');
  const [qrOpen, setQrOpen] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editPlan, setEditPlan] = useState({ date: '', time: '', placeName: '', placeAddress: '' });
  const [lateMinutes, setLateMinutes] = useState(10);
  const [lateOpen, setLateOpen] = useState(false);
  const [copying, setCopying] = useState(false);

  useEffect(() => {
    setTimeVotes(active?.timeVotes || []); setPlaceVotes(active?.placeVotes || []);
    setLateMinutes(active?.lateMinutes || 10); setLateOpen(false);
  }, [id, activeId, active?.timeVotes?.join('|'), active?.placeVotes?.join('|')]);
  useEffect(() => {
    if (meeting) {
      const count = (optionId, key) => meeting.participants.filter((participant) => participant[key]?.includes(optionId)).length;
      setFinalTime(meeting.confirmedTime?.id || [...meeting.timeOptions].sort((a, b) => count(b.id, 'timeVotes') - count(a.id, 'timeVotes'))[0]?.id || '');
      setFinalPlace(meeting.confirmedPlace?.id || [...meeting.placeOptions].sort((a, b) => count(b.id, 'placeVotes') - count(a.id, 'placeVotes'))[0]?.id || '');
    }
    setEditing(false);
  }, [id, meeting?.id, meeting?.status]);
  const inviteUrl = useMemo(() => {
    if (!meeting || meeting.status === 'completed') return '';
    try { return createInviteUrl(id); } catch { return ''; }
  }, [id, meeting]);

  if (!meeting) return <MissingMeeting />;
  const planning = ['planning', 'awaiting'].includes(meeting.status);
  const completed = meeting.status === 'completed';
  const confirmed = !!meeting.confirmedTime && !!meeting.confirmedPlace;
  const going = meeting.participants.filter((participant) => participant.attendance === 'going');
  const voteCount = (optionId, key) => meeting.participants.filter((participant) => participant[key]?.includes(optionId)).length;
  const toggleVote = (optionId, current, setter) => setter(current.includes(optionId) ? current.filter((value) => value !== optionId) : [...current, optionId]);
  const answersChanged = JSON.stringify([...timeVotes].sort()) !== JSON.stringify([...(active?.timeVotes || [])].sort()) || JSON.stringify([...placeVotes].sort()) !== JSON.stringify([...(active?.placeVotes || [])].sort());

  async function copyInvite() {
    setCopying(true);
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(inviteUrl);
      else {
        const input = document.createElement('textarea'); input.value = inviteUrl; input.setAttribute('readonly', ''); input.style.position = 'fixed'; input.style.opacity = '0'; document.body.appendChild(input); input.select(); const copied = document.execCommand('copy'); input.remove(); if (!copied) throw new Error('copy');
      }
      toast('Ссылка скопирована. Отправьте её друзьям.');
    } catch { toast('Не удалось скопировать. Выделите ссылку и скопируйте вручную.', 'error'); }
    finally { setCopying(false); }
  }

  function saveVotes() {
    if (!timeVotes.length || !placeVotes.length) { toast('Выберите хотя бы один вариант времени и места.', 'error'); return; }
    mutate(() => vote(id, active.id, { timeVotes, placeVotes }), 'Ваши ответы сохранены');
  }

  function finishPlan(event) {
    event.preventDefault();
    mutate(() => confirmPlan(id, active.id, { timeId: finalTime, placeId: finalPlace }), 'План подтверждён. Теперь друзья могут подтвердить участие.');
  }

  function startEdit() {
    setEditPlan({ date: meeting.confirmedTime.date, time: meeting.confirmedTime.time, placeName: meeting.confirmedPlace.name, placeAddress: meeting.confirmedPlace.address || '' });
    setEditing(true);
  }

  function saveEditedPlan(event) {
    event.preventDefault();
    if (!editPlan.placeName.trim()) { toast('Укажите название места.', 'error'); return; }
    const changed = editPlan.date !== meeting.confirmedTime.date || editPlan.time !== meeting.confirmedTime.time || editPlan.placeName.trim() !== meeting.confirmedPlace.name || editPlan.placeAddress.trim() !== (meeting.confirmedPlace.address || '');
    if (!changed) { setEditing(false); toast('План остался прежним'); return; }
    const result = mutate(() => confirmPlan(id, active.id, { timeId: meeting.confirmedTime.id, placeId: meeting.confirmedPlace.id, ...editPlan }), 'План изменён. Участникам необходимо подтвердить участие заново.');
    if (result) { setEditing(false); setLateOpen(false); }
  }

  function setAttendance(value) {
    mutate(() => updateAttendance(id, active.id, value), { going: 'Отлично, ждём вас на встрече!', maybe: 'Ответ сохранён: пока не уверены', declined: 'Ответ сохранён: не сможете прийти' }[value]);
    setLateOpen(false);
  }

  function setArrival(value, minutes) {
    mutate(() => updateArrivalStatus(id, active.id, value, minutes), value === 'late' ? `Друзья увидят: задерживаетесь на ${minutes} минут` : `Статус обновлён: ${arrivalLabels[value].toLowerCase()}`);
    setLateOpen(false);
  }

  return <div className="meeting-page">
    <Link className="back-link" to={completed ? '/history' : '/'}><ArrowLeft size={17} /> {completed ? 'К истории встреч' : 'К встречам'}</Link>
    <div className="mp-title-row">
      <div className="mp-title-main"><span className="mp-event-icon"><Coffee size={28} strokeWidth={1.7} /></span><div><div className="mp-title-badges"><span className={`badge ${completed ? 'gray' : confirmed ? 'green' : 'blue'}`}><span className="mp-status-dot" />{statusLabels[meeting.status] || 'Согласование'}</span>{meeting.isDemo && <span className="mp-demo-tag">DEMO</span>}</div><h1>{meeting.title}</h1></div></div>
      {meeting.isDemo && <label className="mp-demo-switch"><span>Демо: вы смотрите как</span><select aria-label="Демо: вы смотрите как" value={activeId || ''} onChange={(event) => mutate(() => setActiveParticipantId(id, event.target.value))}>{meeting.participants.map((participant) => <option key={participant.id} value={participant.id}>{participant.name}{participant.role === 'organizer' ? ' · организатор' : ''}</option>)}</select></label>}
    </div>
    {meeting.description && <p className="mp-description">{meeting.description}</p>}
    <div className="mp-meta"><span><Users size={15} /> {meeting.participants.length} {plural(meeting.participants.length, ['участник', 'участника', 'участников'])}</span><span><Crown size={15} /> Организатор — {meeting.organizer.name}</span>{active && <span className="mp-you">Вы: {active.name}</span>}</div>

    <div className="mp-layout">
      <div className="mp-main">
        {planning && <>
          <section className="card mp-voting-card">
            <div className="mp-section-heading"><span className="mp-section-icon"><CalendarDays size={21} /></span><div><h2>Давайте договоримся</h2><p>Отметьте все варианты, которые вам подходят.</p></div>{active?.votesSaved && <span className="badge green mp-saved-label"><Check size={13} /> Ответ сохранён</span>}</div>
            {!active && <div className="mp-notice"><Users size={18} /><div>Чтобы голосовать, присоединитесь к встрече.<Link to={`/join/${id}`} className="mp-inline-link">Присоединиться <ChevronRight size={14} /></Link></div></div>}
            <div className="mp-vote-section"><h3><CalendarDays size={17} /> Когда встречаемся</h3><div className="mp-option-list">{meeting.timeOptions.map((option) => {
              const count = voteCount(option.id, 'timeVotes'); const selected = timeVotes.includes(option.id);
              return <button key={option.id} type="button" className={`mp-vote-option ${selected ? 'selected' : ''}`} role="checkbox" aria-checked={selected} disabled={!active} onClick={() => toggleVote(option.id, timeVotes, setTimeVotes)}><span className="mp-checkbox">{selected && <Check size={13} strokeWidth={3} />}</span><span className="mp-option-text"><strong>{dayLabel(option.date, true)}</strong><span>{option.time}</span></span><span className={`mp-vote-count ${count ? 'has-votes' : ''}`}><Users size={14} />{votesLabel(count)}</span></button>;
            })}</div></div>
            <div className="mp-vote-section"><h3><MapPin size={17} /> Где встречаемся</h3><div className="mp-option-list">{meeting.placeOptions.map((option) => {
              const count = voteCount(option.id, 'placeVotes'); const selected = placeVotes.includes(option.id);
              return <button key={option.id} type="button" className={`mp-vote-option ${selected ? 'selected' : ''}`} role="checkbox" aria-checked={selected} disabled={!active} onClick={() => toggleVote(option.id, placeVotes, setPlaceVotes)}><span className="mp-checkbox">{selected && <Check size={13} strokeWidth={3} />}</span><span className="mp-option-text"><strong>{option.name}</strong>{option.address && <span>{option.address}</span>}</span><span className={`mp-vote-count ${count ? 'has-votes' : ''}`}><Users size={14} />{votesLabel(count)}</span></button>;
            })}</div></div>
            {active && <div className="mp-vote-footer"><span className="muted">Можно выбрать несколько вариантов</span><button className="button primary" onClick={saveVotes} disabled={active.votesSaved && !answersChanged}><Check size={17} />{active.votesSaved && !answersChanged ? 'Ответы сохранены' : 'Сохранить ответы'}</button></div>}
          </section>
          {organizer && <form className="card mp-organizer-card" onSubmit={finishPlan}><div className="mp-section-heading"><span className="mp-section-icon blue"><Crown size={20} /></span><div><h2>Выберите итоговый план</h2><p>Как организатор, вы принимаете финальное решение.</p></div></div><div className="mp-form-grid"><label className="field">Итоговое время<select aria-label="Итоговое время" value={finalTime} required onChange={(event) => setFinalTime(event.target.value)}>{meeting.timeOptions.map((option) => <option key={option.id} value={option.id}>{dayLabel(option.date)} · {option.time} · {votesLabel(voteCount(option.id, 'timeVotes'))}</option>)}</select></label><label className="field">Итоговое место<select aria-label="Итоговое место" value={finalPlace} required onChange={(event) => setFinalPlace(event.target.value)}>{meeting.placeOptions.map((option) => <option key={option.id} value={option.id}>{option.name} · {votesLabel(voteCount(option.id, 'placeVotes'))}</option>)}</select></label></div><button className="button primary mp-full-button" type="submit"><CheckCircle2 size={18} /> Подтвердить план</button></form>}
        </>}

        {confirmed && <section className="mp-confirmed-card">
          <div className="mp-confirmed-heading"><span className="mp-confirmed-icon"><CheckCircle2 size={21} /></span><div><p className="eyebrow">{completed ? 'ЭТО БЫЛО ЗДОРОВО' : 'ВСЁ РЕШЕНО'}</p><h2>{completed ? 'Встреча состоялась' : 'Один план. Все в курсе.'}</h2></div>{organizer && !completed && <button className="icon-button" title="Изменить план" aria-label="Изменить план" onClick={startEdit}><Pencil size={17} /></button>}</div>
          <div className="mp-final-details"><div><span className="mp-detail-label"><CalendarDays size={14} /> КОГДА</span><strong>{dayLabel(meeting.confirmedTime.date)}</strong><span className="mp-final-time">{meeting.confirmedTime.time}</span></div><div><span className="mp-detail-label"><MapPin size={14} /> ГДЕ</span><strong>{meeting.confirmedPlace.name}</strong><span className="mp-final-address">{meeting.confirmedPlace.address || 'Место встречи выбрано'}</span></div></div>
          <div className="mp-final-bottom"><div><span className="mp-detail-label">КТО {completed ? 'БЫЛ С НАМИ' : 'ИДЁТ'}</span><div className="mp-going-avatars">{going.slice(0, 5).map((participant) => <ParticipantAvatar key={participant.id} participant={participant} small />)}<span>{going.length ? `${going.length} ${plural(going.length, ['участник', 'участника', 'участников'])}` : 'Ждём подтверждений'}</span></div></div>{!completed && <button className="button secondary mp-calendar-button" onClick={() => { try { downloadCalendarEvent(meeting); toast('Файл календаря скачан'); } catch { toast('Не удалось создать файл календаря.', 'error'); } }}><Download size={16} /> Добавить в календарь</button>}</div>
        </section>}

        {editing && !completed && <form className="card mp-edit-card" onSubmit={saveEditedPlan}><div className="mp-section-heading"><span className="mp-section-icon"><Pencil size={19} /></span><div><h2>Изменить план</h2><p>После изменения все участники подтвердят участие заново.</p></div></div><div className="mp-form-grid"><label className="field">Дата<input type="date" required value={editPlan.date} onChange={(event) => setEditPlan({ ...editPlan, date: event.target.value })} /></label><label className="field">Время<input type="time" required value={editPlan.time} onChange={(event) => setEditPlan({ ...editPlan, time: event.target.value })} /></label><label className="field mp-span-two">Место<input required maxLength={100} value={editPlan.placeName} onChange={(event) => setEditPlan({ ...editPlan, placeName: event.target.value })} /></label><label className="field mp-span-two">Адрес <span className="muted">· необязательно</span><input maxLength={180} value={editPlan.placeAddress} onChange={(event) => setEditPlan({ ...editPlan, placeAddress: event.target.value })} /></label></div><div className="mp-edit-actions"><button type="button" className="button secondary" onClick={() => setEditing(false)}>Отмена</button><button className="button primary" type="submit">Сохранить новый план</button></div></form>}

        {confirmed && !completed && active && <section className="card mp-attendance-card"><div className="mp-section-heading"><span className="mp-section-icon"><Users size={20} /></span><div><h2>Вы с нами?</h2><p>{meeting.planVersion > 1 && active.attendance === 'pending' ? 'План изменён. Подтвердите участие заново.' : 'Дайте друзьям знать, получится ли прийти.'}</p></div></div>{meeting.planVersion > 1 && active.attendance === 'pending' && <div className="mp-plan-changed"><Pencil size={16} /> План изменён. Участникам необходимо подтвердить участие заново.</div>}<div className="mp-attendance-buttons"><button className={`mp-attendance-choice ${active.attendance === 'going' ? 'active going' : ''}`} aria-pressed={active.attendance === 'going'} onClick={() => setAttendance('going')}><CheckCircle2 size={19} /> Буду</button><button className={`mp-attendance-choice ${active.attendance === 'maybe' ? 'active maybe' : ''}`} aria-pressed={active.attendance === 'maybe'} onClick={() => setAttendance('maybe')}><HelpCircle size={19} /> Не уверен</button><button className={`mp-attendance-choice ${active.attendance === 'declined' ? 'active declined' : ''}`} aria-pressed={active.attendance === 'declined'} onClick={() => setAttendance('declined')}><X size={19} /> Не смогу</button></div>
          {active.attendance === 'going' && <div className="mp-arrival-controls"><h3>Как вы добираетесь?</h3><p className="muted">Обновляйте статус по пути — друзья будут в курсе.</p><div className="mp-arrival-buttons">{['home', 'leaving', 'late', 'arrived'].map((value) => { const Icon = arrivalIcons[value]; return <button key={value} className={`mp-arrival-choice ${active.arrivalStatus === value ? `active ${value}` : ''}`} aria-pressed={active.arrivalStatus === value} onClick={() => value === 'late' ? setLateOpen(!lateOpen) : setArrival(value)}><Icon size={18} />{arrivalLabels[value]}</button>; })}</div>{lateOpen && <div className="mp-late-picker"><span>На сколько задерживаетесь?</span><div>{[5, 10, 15, 30].map((minutes) => <button key={minutes} className={`mp-minutes ${lateMinutes === minutes ? 'active' : ''}`} onClick={() => setLateMinutes(minutes)}>{minutes} мин</button>)}</div><button className="button primary" onClick={() => setArrival('late', lateMinutes)}>Сообщить</button></div>}</div>}
        </section>}

        {confirmed && !completed && <section className="card mp-gathering-card"><div className="mp-section-heading"><span className="mp-section-icon green"><Footprints size={21} /></span><div><h2>Все собираются</h2><p>{going.length ? `${going.length} ${plural(going.length, ['участник подтвердил', 'участника подтвердили', 'участников подтвердили'])} участие` : 'Здесь появятся статусы тех, кто будет на встрече'}</p></div><span className="mp-live-indicator"><span /> На связи</span></div>{going.length > 0 && <div className="mp-gathering-summary">{[{ value: 'leaving', label: 'выходят', Icon: Footprints }, { value: 'late', label: 'задерживаются', Icon: Clock3 }, { value: 'arrived', label: 'прибыли', Icon: CheckCircle2 }].map(({ value, label, Icon }) => <div key={value} className={`mp-summary-item ${value}`}><Icon size={17} /><strong>{going.filter((participant) => participant.arrivalStatus === value).length}</strong><span>{label}</span></div>)}</div>}<div className="mp-participant-list">{meeting.participants.map((participant) => {
          const arrives = participant.attendance === 'going'; const Icon = arrives ? arrivalIcons[participant.arrivalStatus || 'home'] : participant.attendance === 'declined' ? X : HelpCircle;
          return <div className="mp-person-row" key={participant.id}><ParticipantAvatar participant={participant} /><div className="mp-person-name"><strong>{participant.name}{participant.id === activeId && <span className="mp-self-label">вы</span>}</strong><span>{participant.role === 'organizer' ? 'Организатор' : 'Участник'}</span></div><span className={`mp-person-status ${arrives ? participant.arrivalStatus : participant.attendance}`}><Icon size={14} />{arrives ? participant.arrivalStatus === 'late' ? `Задерживается на ${participant.lateMinutes || 10} мин` : arrivalLabels[participant.arrivalStatus || 'home'] : attendanceLabels[participant.attendance || 'pending']}</span></div>;
        })}</div></section>}

        {completed && <section className="card mp-memory-summary"><div className="mp-section-heading"><span className="mp-section-icon"><Sparkles size={21} /></span><div><h2>Моменты этой встречи</h2><p>Хорошие встречи хочется помнить.</p></div>{organizer && <Link to={`/meetings/${id}/memory`} className="button ghost"><Pencil size={16} />{meeting.photos?.length || meeting.memoryNote ? 'Изменить' : 'Добавить'}</Link>}</div>{meeting.photos?.length > 0 && <div className="mp-memory-gallery">{meeting.photos.map((photo) => <a key={photo.id} href={photo.url} download={photo.name || 'yavka-photo.jpg'} title="Скачать фотографию"><img src={photo.url} alt={photo.name || 'Воспоминание о встрече'} /></a>)}</div>}{meeting.memoryNote && <p className="mp-memory-note">{meeting.memoryNote}</p>}{!meeting.photos?.length && !meeting.memoryNote && <div className="mp-memory-empty"><Coffee size={30} /><p>Воспоминание — это уже сама встреча.</p>{organizer && <Link to={`/meetings/${id}/memory`} className="mp-inline-link">Добавить фотографии или заметку <ArrowUpRight size={15} /></Link>}</div>}</section>}

        {organizer && confirmed && !completed && <div className="mp-organizer-bottom"><div><Flag size={18} /><span>Уже встретились? Сохраните этот момент.</span></div><button className="button secondary" onClick={() => { const result = mutate(() => completeMeeting(id, active.id), 'Встреча завершена. Сохраним воспоминание?'); if (result) navigate(`/meetings/${id}/memory`); }}><CheckCircle2 size={17} /> Завершить встречу</button></div>}
      </div>

      <aside className="mp-sidebar">
        {!completed && <section className="card mp-invite-card"><span className="mp-invite-icon"><Users size={23} /></span><h2>Пригласить друзей</h2><p>Одна ссылка — и все в деле.<br />Регистрация не понадобится.</p><div className="mp-invite-link"><input aria-label="Ссылка приглашения" value={inviteUrl} readOnly onClick={(event) => event.target.select()} /><span><ArrowUpRight size={15} /></span></div><button className="button primary mp-full-button" onClick={copyInvite} disabled={copying || !inviteUrl}><Copy size={16} />{copying ? 'Копируем…' : 'Скопировать ссылку'}</button><button className="mp-qr-toggle" onClick={() => setQrOpen(!qrOpen)} aria-expanded={qrOpen}><QrCode size={16} />{qrOpen ? 'Скрыть QR-код' : 'Показать QR-код'}</button>{qrOpen && (inviteUrl.length <= 2800 ? <div className="mp-qr"><QRCodeSVG value={inviteUrl || `${window.location.origin}/join/${id}`} size={224} level="L" marginSize={2} fgColor="#111725" /><p>Наведите камеру телефона</p></div> : <p className="mp-qr-note">Для этого приглашения используйте ссылку выше.</p>)}<div className="mp-beta-note"><span>beta</span> Встреча хранится в вашем браузере. Ссылка передаёт друзьям текущий план; ответы с разных устройств пока не синхронизируются.</div></section>}
        {(planning || completed) && <section className="card mp-people-card"><div className="mp-people-title"><h2>Наша компания</h2><span className="mp-count-bubble">{meeting.participants.length}</span></div><div className="mp-participant-list">{meeting.participants.map((participant) => <div className="mp-person-row" key={participant.id}><ParticipantAvatar participant={participant} /><div className="mp-person-name"><strong>{participant.name}{participant.id === activeId && <span className="mp-self-label">вы</span>}</strong><span>{participant.role === 'organizer' ? 'Организатор' : planning ? participant.votesSaved ? 'Ответы сохранены' : 'Выбирает варианты' : attendanceLabels[participant.attendance || 'pending']}</span></div>{participant.role === 'organizer' ? <Crown className="mp-person-crown" size={15} /> : planning && participant.votesSaved ? <CheckCircle2 className="mp-person-check" size={16} /> : null}</div>)}</div></section>}
        <div className="mp-sidebar-message"><span className="mp-small-logo">Я</span><p>Меньше переписки.<br /><strong>Больше встреч.</strong></p></div>
      </aside>
    </div>
  </div>;
}
