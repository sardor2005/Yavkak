import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { ArrowLeft, CalendarDays, Check, CheckCircle2, Coffee, Copy, Crown, Download, Flag, Footprints, Home, ImagePlus, Link2, MapPin, Pencil, QrCode, RotateCcw, ShieldCheck, Sparkles, UserMinus, Users, X } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { cancelMeeting, completeMeeting, createInvitation, getMeeting, listFriends, listMeetingInvitations, listPhotos, releasePhotos, removeParticipant, respondAttendance, reverseRating, revokeInvitation, setArrival, updateMeeting } from '../services/api.js';
import { meetingDateParts } from '../utils/time.js';
import { peopleLabel } from '../utils/format.js';
import { downloadCalendarEvent } from '../services/calendar.js';
import MeetingChat from '../components/MeetingChat.jsx';
import { MeetingFields, meetingFormInput } from './Create.jsx';
import '../meeting.css';
import { useDialogFocus } from '../utils/useDialogFocus.js';

const statuses = { scheduled: 'Встреча запланирована', completed: 'Встреча состоялась', cancelled: 'Встреча отменена' };
const arrivalLabels = { pending: 'Пока без отметки', ready: 'Готов', on_way: 'В пути', arrived: 'Пришёл', no_show: 'Не пришёл' };
const arrivalIcons = { ready: Home, on_way: Footprints, arrived: CheckCircle2 };
const initialLetters = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((word) => word[0]).join('').toUpperCase();
const dateText = (value, zone, options = {}) => new Date(value).toLocaleString('ru-RU', { timeZone: zone, ...options });
const invitationLabels = { pending: 'Ожидает ответа', accepted: 'Принято', declined: 'Отклонено', revoked: 'Отозвано', expired: 'Истекло' };

function ParticipantAvatar({ participant, small = false }) {
  const name = String(participant.name || 'Участник');
  return <span className={`avatar mp-avatar ${small ? 'mp-avatar-small' : ''}`} style={{ '--avatar-hue': `${Array.from(name).reduce((sum, char) => sum + char.charCodeAt(0), 0) % 360}` }}>{participant.avatarUrl ? <img src={participant.avatarUrl} alt="" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} /> : initialLetters(name)}</span>;
}

function MissingMeeting({ error, loading, onRetry }) {
  return <div className="meeting-page"><Link className="back-link" to="/"><ArrowLeft size={17} />К встречам</Link><div className="empty-state card mp-missing"><CalendarDays size={38} /><h1>{loading ? 'Открываем встречу…' : 'Встреча недоступна'}</h1><p>{loading ? 'Загружаем общий план вашей компании.' : error || 'Возможно, вас ещё не пригласили или доступ к встрече был закрыт.'}</p>{!loading && <><button type="button" className="button secondary" onClick={onRetry}>Попробовать ещё раз</button><Link className="button primary" to="/">Мои встречи</Link></>}</div></div>;
}

export default function Meeting() {
  const { id } = useParams();
  const { meetings, mutate, toast, syncVersion } = useApp();
  const { user } = useAuth();
  const [meeting, setMeeting] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState(null);
  const [confirmation, setConfirmation] = useState(null);
  useDialogFocus(!!confirmation);
  const [friends, setFriends] = useState([]);
  const [friendId, setFriendId] = useState('');
  const [invitations, setInvitations] = useState([]);
  const [inviteError, setInviteError] = useState('');
  const [generatedInvite, setGeneratedInvite] = useState(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [photos, setPhotos] = useState([]);
  const photoValues = useRef([]);

  const reloadMeeting = useCallback(async () => {
    try { const value = await getMeeting(id); setMeeting(value); setError(''); return value; }
    catch (cause) { setMeeting(null); setError(cause.message || 'Не удалось загрузить встречу.'); return null; }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => {
    let live = true;
    getMeeting(id).then((value) => { if (live) { setMeeting(value); setError(''); } }).catch((cause) => { if (live) { setMeeting(null); setError(cause.message || 'Не удалось загрузить встречу.'); } }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [id, meetings]);
  useEffect(() => { setLoading(true); setMeeting(null); setEditing(false); setEditForm(null); setConfirmation(null); setGeneratedInvite(null); setQrOpen(false); setInvitations([]); setFriendId(''); }, [id]);
  useEffect(() => {
    if (!meeting?.id) { releasePhotos(photoValues.current); photoValues.current = []; setPhotos([]); return; }
    let live = true;
    listPhotos(id).then((values) => {
      if (!live) { releasePhotos(values); return; }
      releasePhotos(photoValues.current); photoValues.current = values; setPhotos(values);
    }).catch((cause) => { if (live) toast(cause.message || 'Не удалось загрузить фотографии.', 'error'); });
    return () => { live = false; };
  }, [id, meeting?.id, syncVersion, toast]);
  useEffect(() => () => { releasePhotos(photoValues.current); photoValues.current = []; }, []);

  const organizer = !!user && meeting?.organizerId === user.id;
  const active = meeting?.participants?.find((participant) => (participant.userId || participant.id) === user?.id);
  const reloadInvitations = useCallback(async () => {
    try { const values = await listMeetingInvitations(id); setInvitations(values); setInviteError(''); }
    catch (cause) { setInviteError(cause.message || 'Не удалось загрузить приглашения.'); }
  }, [id]);
  useEffect(() => {
    if (!organizer) return;
    let live = true;
    Promise.all([listFriends(), listMeetingInvitations(id)]).then(([friendValues, inviteValues]) => { if (live) { setFriends(friendValues); setInvitations(inviteValues); setInviteError(''); } }).catch((cause) => { if (live) setInviteError(cause.message || 'Не удалось загрузить приглашения.'); });
    return () => { live = false; };
  }, [organizer, id]);
  useEffect(() => {
    if (!confirmation) return;
    const escape = (event) => { if (event.key === 'Escape' && !busy) setConfirmation(null); };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [confirmation, busy]);

  async function perform(key, action, message) {
    if (busy) return null;
    setBusy(key);
    try {
      const result = await mutate(action, message);
      if (result !== null) { await reloadMeeting(); await reloadInvitationsIfOrganizer(); }
      return result;
    } finally { setBusy(''); }
  }
  async function reloadInvitationsIfOrganizer() { if (organizer) await reloadInvitations(); }

  function startEdit() {
    setEditForm({ title: meeting.title, description: meeting.description || '', placeName: meeting.placeName || '', placeAddress: meeting.placeAddress || '', ...meetingDateParts(meeting.startsAt, meeting.timeZone), timeZone: meeting.timeZone });
    setEditing(true);
  }
  async function saveEditedPlan(event) {
    event.preventDefault();
    const result = await perform('edit', () => updateMeeting(id, meetingFormInput(editForm)), 'План встречи обновлён');
    if (result !== null) setEditing(false);
  }
  async function inviteFriend(event) {
    event.preventDefault();
    if (!friendId) return;
    const result = await perform('friend', () => createInvitation(id, { inviteeId: friendId, hours: 72 }), 'Приглашение отправлено другу');
    if (result !== null) setFriendId('');
  }
  async function generateLink() {
    const result = await perform('link', () => createInvitation(id, { inviteeId: null, hours: 72 }), 'Ссылка-приглашение создана');
    if (result?.token || result?.url) { setGeneratedInvite(result); setQrOpen(false); }
  }
  async function revoke(invitation) {
    const result = await perform(`revoke-${invitation.id}`, () => revokeInvitation(invitation.id), 'Приглашение отозвано');
    if (result !== null && generatedInvite?.id === invitation.id) setGeneratedInvite(null);
  }
  async function copyInvite() {
    const url = generatedInvite?.url || `${window.location.origin}/join/${generatedInvite?.token}`;
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(url);
      else {
        const input = document.createElement('textarea'); input.value = url; input.setAttribute('readonly', ''); input.style.position = 'fixed'; input.style.opacity = '0'; document.body.appendChild(input); input.select(); const copied = document.execCommand('copy'); input.remove(); if (!copied) throw new Error('copy');
      }
      toast('Ссылка скопирована. Отправьте её друзьям.');
    } catch { toast('Не удалось скопировать. Выделите ссылку и скопируйте вручную.', 'error'); }
  }
  function addToCalendar() {
    try { downloadCalendarEvent(meeting); }
    catch (cause) { toast(cause.message || 'Не удалось добавить встречу в календарь.', 'error'); }
  }
  async function confirmAction() {
    const request = confirmation;
    if (!request) return;
    const actions = {
      cancel: [() => cancelMeeting(id), 'Встреча отменена'],
      complete: [() => completeMeeting(id), 'Встреча завершена. Сохраните фотографии на память!'],
      remove: [() => removeParticipant(id, request.participant?.userId || request.participant?.id), 'Участник удалён из встречи'],
      reverse: [() => reverseRating(id, request.participant?.userId || request.participant?.id), 'Изменение оценки отменено'],
    };
    const [action, message] = actions[request.kind];
    const result = await perform(request.kind, action, message);
    if (result !== null) setConfirmation(null);
  }

  if (!meeting) return <MissingMeeting loading={loading} error={error} onRetry={reloadMeeting} />;
  const completed = meeting.status === 'completed';
  const cancelled = meeting.status === 'cancelled';
  const scheduled = meeting.status === 'scheduled';
  const participants = meeting.participants || [];
  const accepted = participants.filter((participant) => participant.invitationStatus === 'accepted');
  const inviteUrl = generatedInvite && (generatedInvite.url || `${window.location.origin}/join/${generatedInvite.token}`);
  const confirmationCopy = confirmation && {
    cancel: { title: 'Отменить встречу?', body: 'Компания увидит, что встреча отменена. Оценка за отменённую встречу не начисляется.', button: 'Отменить встречу' },
    complete: { title: 'Встреча состоялась?', body: 'Проверьте ручные отметки прибытия. После завершения участники смогут сохранить фотографии. Экспериментальная оценка по серверному времени ручной отметки: +10 за прибытие к началу встречи, 0 за опоздание и −5 за неявку. Отказ от участия не оценивается. Организатор сможет отменить ошибочное начисление.', button: 'Завершить встречу' },
    remove: { title: `Удалить ${confirmation.participant?.name || 'участника'}?`, body: 'Участник потеряет доступ к общему плану, чату и фотографиям этой встречи.', button: 'Удалить участника' },
    reverse: { title: 'Отменить изменение оценки?', body: 'Используйте это, если экспериментальная оценка участника была начислена ошибочно. История отмены сохранится.', button: 'Отменить изменение' },
  }[confirmation.kind];

  return <div className="meeting-page">
    <Link className="back-link" to={completed ? '/history' : '/'}><ArrowLeft size={17} />{completed ? 'К истории встреч' : 'К встречам'}</Link>
    <div className="mp-title-row"><div className="mp-title-main"><span className="mp-event-icon"><Coffee size={28} strokeWidth={1.7} /></span><div><div className="mp-title-badges"><span className={`badge ${completed || cancelled ? 'gray' : 'green'}`}><span className="mp-status-dot" />{statuses[meeting.status] || 'Встреча'}</span></div><h1>{meeting.title}</h1></div></div></div>
    {meeting.description && <p className="mp-description">{meeting.description}</p>}
    <div className="mp-meta"><span><Users size={15} />{peopleLabel(participants.length)}</span><span><Crown size={15} />Организатор — {meeting.organizer?.name || 'организатор встречи'}</span>{active && <span className="mp-you">Вы: {active.name}</span>}</div>
    <div className="mp-layout"><div className="mp-main">
      {editing && organizer && scheduled ? <form className="card mp-edit-card" onSubmit={saveEditedPlan}><div className="mp-section-heading"><span className="mp-section-icon blue"><Pencil size={20} /></span><div><h2>Изменить общий план</h2><p>При переносе даты или смене места отметки прибытия сбросятся.</p></div></div><MeetingFields value={editForm} onChange={setEditForm} disabled={!!busy} /><div className="mp-edit-actions"><button className="button secondary" type="button" onClick={() => setEditing(false)} disabled={!!busy}>Отмена</button><button className="button primary" type="submit" disabled={!!busy}>{busy === 'edit' ? 'Сохраняем…' : 'Сохранить план'}</button></div></form> : <section className="mp-confirmed-card"><div className="mp-confirmed-heading"><span className="mp-confirmed-icon"><Check size={23} /></span><div><p className="eyebrow">ОДИН ПЛАН ДЛЯ ВСЕЙ КОМПАНИИ</p><h2>{cancelled ? 'До следующей встречи' : completed ? 'Хорошо было!' : 'Договорились. Встречаемся.'}</h2></div>{organizer && scheduled && <button type="button" className="icon-button" onClick={startEdit} aria-label="Редактировать встречу" disabled={!!busy}><Pencil size={18} /></button>}</div><div className="mp-final-details"><div><span className="mp-detail-label"><CalendarDays size={13} />КОГДА</span><strong>{dateText(meeting.startsAt, meeting.timeZone, { day: 'numeric', month: 'long', year: 'numeric' })}</strong><span className="mp-final-time">{dateText(meeting.startsAt, meeting.timeZone, { hour: '2-digit', minute: '2-digit' })}</span><span className="mp-final-address">{meeting.timeZone}</span></div><div><span className="mp-detail-label"><MapPin size={13} />ГДЕ</span><strong>{meeting.placeName}</strong>{meeting.placeAddress && <span className="mp-final-address">{meeting.placeAddress}</span>}</div></div><div className="mp-final-bottom"><div><span className="mp-detail-label">ПОДТВЕРДИЛИ УЧАСТИЕ</span><div className="mp-going-avatars">{accepted.slice(0, 5).map((participant) => <ParticipantAvatar key={participant.id} participant={participant} small />)}<span>{peopleLabel(accepted.length)}</span></div></div>{!cancelled && <button type="button" className="button mp-calendar-button" onClick={addToCalendar}><Download size={16} />Добавить в календарь</button>}</div></section>}

      {active && scheduled && <section className="card mp-attendance-card"><div className="mp-section-heading"><span className="mp-section-icon green"><CheckCircle2 size={21} /></span><div><h2>Вы будете?</h2><p>Подтвердите участие или предупредите компанию, если планы изменились.</p></div></div><div className="mp-attendance-buttons" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}><button type="button" className={`mp-attendance-choice going ${active.invitationStatus === 'accepted' ? 'active' : ''}`} disabled={!!busy} onClick={() => perform('attendance', () => respondAttendance(id, 'accepted'), 'Участие подтверждено')}><CheckCircle2 size={18} />Буду</button><button type="button" className={`mp-attendance-choice declined ${active.invitationStatus === 'declined' ? 'active' : ''}`} disabled={!!busy} onClick={() => perform('attendance', () => respondAttendance(id, 'declined'), 'Ответ сохранён: не сможете прийти')}><X size={18} />Не смогу</button></div>{active.invitationStatus === 'accepted' && <div className="mp-arrival-controls"><h3>Как у вас дела?</h3><p className="muted">Отметки ставятся вручную и сохраняются с серверным временем.</p><div className="mp-arrival-buttons" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>{['ready', 'on_way', 'arrived'].map((value) => { const Icon = arrivalIcons[value]; return <button key={value} type="button" className={`mp-arrival-choice ${value} ${active.arrivalStatus === value ? 'active' : ''}`} aria-pressed={active.arrivalStatus === value} disabled={!!busy} onClick={() => perform('arrival', () => setArrival(id, value), `Статус обновлён: ${arrivalLabels[value].toLowerCase()}`)}><Icon size={20} />{arrivalLabels[value]}</button>; })}</div>{active.arrivalStatus === 'arrived' && active.arrivedAt && <p className="muted">Прибытие: {dateText(active.arrivedAt, meeting.timeZone, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · вручную</p>}</div>}</section>}

      <section className="card mp-gathering-card"><div className="mp-section-heading"><span className="mp-section-icon blue"><Users size={21} /></span><div><h2>{completed ? 'Наша компания' : 'Компания собирается'}</h2><p>Отметка «Пришёл» означает ручное подтверждение участника.</p></div></div><div className="mp-gathering-summary">{['ready', 'on_way', 'arrived'].map((value) => { const Icon = arrivalIcons[value]; return <div key={value} className={`mp-summary-item ${value === 'arrived' ? 'arrived' : ''}`}><Icon size={17} /><strong>{accepted.filter((participant) => participant.arrivalStatus === value).length}</strong><span>{arrivalLabels[value]}</span></div>; })}</div><div className="mp-participant-list">{participants.map((participant) => <div className="mp-person-row" key={participant.id}><ParticipantAvatar participant={participant} /><div className="mp-person-name"><strong>{participant.name}{(participant.userId || participant.id) === user?.id && <span className="mp-self-label">вы</span>}{participant.role === 'organizer' && <Crown className="mp-person-crown" size={14} />}</strong><span>{participant.invitationStatus === 'declined' ? 'Не сможет' : 'Участие подтверждено'}{participant.arrivedAt && participant.arrivalStatus === 'arrived' ? ` · ${dateText(participant.arrivedAt, meeting.timeZone, { hour: '2-digit', minute: '2-digit' })} · вручную` : ''}</span></div><span className={`mp-person-status ${participant.invitationStatus === 'declined' ? 'declined' : participant.arrivalStatus === 'on_way' ? 'leaving' : participant.arrivalStatus}`}>{participant.invitationStatus === 'declined' ? 'Не сможет' : `${arrivalLabels[participant.arrivalStatus] || 'Без отметки'}${participant.arrivalStatus === 'arrived' ? ' · вручную' : ''}`}</span>{organizer && participant.role !== 'organizer' && scheduled && <button type="button" className="icon-button" aria-label={`Удалить участника ${participant.name}`} disabled={!!busy} onClick={() => setConfirmation({ kind: 'remove', participant })}><UserMinus size={16} /></button>}{organizer && completed && <button type="button" className="icon-button" aria-label={`Отменить изменение оценки ${participant.name}`} title="Отменить экспериментальную оценку" disabled={!!busy} onClick={() => setConfirmation({ kind: 'reverse', participant })}><RotateCcw size={16} /></button>}</div>)}</div></section>

      {!cancelled && <section className="card mp-memory-summary"><div className="mp-section-heading"><span className="mp-section-icon"><Sparkles size={21} /></span><div><h2>{completed ? 'На память о встрече' : 'Фотографии компании'}</h2><p>Фотографии видны только участникам этой встречи.</p></div></div>{photos.length ? <div className="mp-memory-gallery">{photos.map((photo, index) => <a key={photo.id} href={photo.url} target="_blank" rel="noopener noreferrer" aria-label={`Открыть фотографию встречи ${index + 1}`}><img src={photo.url} alt={`Фотография встречи ${index + 1}`} loading="lazy" /></a>)}</div> : <div className="mp-memory-empty"><Sparkles size={30} /><p>Хорошие моменты можно сохранить здесь.</p></div>}{completed && meeting.memoryNote && <p className="mp-memory-note">{meeting.memoryNote}</p>}<Link className="button secondary mp-full-button" to={`/meetings/${id}/memory`}><ImagePlus size={17} />{photos.length ? 'Открыть фотографии' : 'Добавить фотографии'}</Link></section>}
      <MeetingChat meetingId={id} />
      {organizer && scheduled && <section className="card mp-organizer-card"><div className="mp-section-heading"><span className="mp-section-icon"><Crown size={21} /></span><div><h2>Вы — организатор</h2><p>Завершите встречу, когда компания уже встретилась.</p></div></div><div className="mp-organizer-bottom"><button type="button" className="button secondary" disabled={!!busy} onClick={() => setConfirmation({ kind: 'cancel' })}><X size={16} />Отменить встречу</button><button type="button" className="button primary" disabled={!!busy} onClick={() => setConfirmation({ kind: 'complete' })}><Flag size={16} />Завершить встречу</button></div><p className="muted form-hint">Экспериментальная оценка после завершения: +10 за прибытие к началу встречи, 0 за опоздание, −5 за неявку. Отказ не оценивается. Организатор может отменить ошибочное начисление.</p></section>}
      {completed && <p className="muted form-hint">Экспериментальная оценка основана на ручных отметках. Ошибочное изменение может отменить организатор.</p>}
    </div><aside className="mp-sidebar">
      {organizer && scheduled && <section className="card mp-invite-card"><div className="mp-invite-icon"><Users size={24} /></div><h2>Позовите друзей</h2><p>Пригласите друга или отправьте ссылку. Ссылка действует 72 часа.</p>{inviteError && <p className="form-error" role="alert">{inviteError}</p>}{friends.length ? <form onSubmit={inviteFriend}><div className="field"><label htmlFor="invite-friend">Друг</label><select id="invite-friend" value={friendId} onChange={(event) => setFriendId(event.target.value)} required disabled={!!busy}><option value="">Выберите друга</option>{friends.filter((friend) => !participants.some((participant) => (participant.userId || participant.id) === friend.id)).map((friend) => <option key={friend.id} value={friend.id}>{friend.name}{friend.publicId ? ` · ${friend.publicId}` : ''}</option>)}</select></div><button type="submit" className="button secondary mp-full-button" disabled={!friendId || !!busy}>{busy === 'friend' ? 'Приглашаем…' : 'Пригласить друга'}</button></form> : <p className="muted">Добавьте друзей в <Link className="mp-inline-link" to="/friends">списке друзей</Link>.</p>}<button type="button" className="button primary mp-full-button" disabled={!!busy} onClick={generateLink}><Link2 size={16} />{busy === 'link' ? 'Создаём ссылку…' : generatedInvite ? 'Создать ещё одну ссылку' : 'Создать ссылку'}</button>{generatedInvite && <><div className="mp-invite-link"><input aria-label="Ссылка-приглашение" readOnly value={inviteUrl} onFocus={(event) => event.target.select()} /><span><Link2 size={14} /></span></div><button type="button" className="button secondary mp-full-button" onClick={copyInvite}><Copy size={16} />Скопировать ссылку</button><button type="button" className="mp-qr-toggle" onClick={() => setQrOpen((value) => !value)} aria-expanded={qrOpen}><QrCode size={15} />{qrOpen ? 'Скрыть QR-код' : 'Показать QR-код'}</button>{qrOpen && <div className="mp-qr"><QRCodeSVG value={inviteUrl} size={220} marginSize={2} /><p>Откройте камерой телефона</p></div>}<p className="mp-qr-note">Сохраните ссылку сейчас. Детали встречи откроются после принятия приглашения.</p></>}<div className="mp-beta-note"><ShieldCheck size={13} />Приглашение содержит только случайный токен. Общий план хранится в приватной встрече.</div></section>}
      {organizer && invitations.length > 0 && <section className="card mp-people-card"><div className="mp-people-title"><h2>Приглашения</h2><span className="mp-count-bubble">{invitations.length}</span></div><div className="mp-participant-list">{invitations.map((invitation) => { const expired = new Date(invitation.expiresAt).getTime() < Date.now(); const actionable = !expired && !['revoked', 'declined', 'expired'].includes(invitation.status); return <div key={invitation.id} className="mp-person-row"><span className="mp-section-icon"><Link2 size={16} /></span><div className="mp-person-name"><strong>{invitation.invitee?.name || (invitation.inviteeId ? friends.find((friend) => friend.id === invitation.inviteeId)?.name || 'Друг' : 'Ссылка для друзей')}</strong><span>{expired ? 'Истекло' : invitationLabels[invitation.status] || 'Активно'}</span><span>До {new Date(invitation.expiresAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span></div>{actionable && <button type="button" className="icon-button" disabled={!!busy} aria-label={`Отозвать приглашение ${invitation.invitee?.name || 'по ссылке'}`} onClick={() => revoke(invitation)}><X size={16} /></button>}</div>; })}</div></section>}
      <section className="card mp-people-card"><div className="mp-people-title"><h2>В компании</h2><span className="mp-count-bubble">{participants.length}</span></div><div className="mp-participant-list">{participants.map((participant) => <div key={participant.id} className="mp-person-row"><ParticipantAvatar participant={participant} /><div className="mp-person-name"><strong>{participant.name}</strong><span>{participant.role === 'organizer' ? 'Организатор' : participant.invitationStatus === 'declined' ? 'Не сможет' : 'Будет'}</span></div>{participant.role === 'organizer' && <Crown className="mp-person-crown" size={15} />}</div>)}</div></section>
      <div className="mp-sidebar-message"><span className="mp-small-logo">Я</span><p>Меньше переписки.<br /><strong>Больше встреч.</strong></p></div>
    </aside></div>
    {confirmation && <div className="modal-backdrop" onClick={() => { if (!busy) setConfirmation(null); }}><section className="modal card" role="dialog" aria-modal="true" aria-labelledby="meeting-confirm-title" onClick={(event) => event.stopPropagation()}><button type="button" className="icon-button modal-close" disabled={!!busy} onClick={() => setConfirmation(null)} aria-label="Закрыть"><X size={20} /></button><span className="guide-icon"><Flag size={25} /></span><h2 id="meeting-confirm-title">{confirmationCopy.title}</h2><p className="muted">{confirmationCopy.body}</p><div className="modal-actions"><button type="button" className="button secondary" autoFocus disabled={!!busy} onClick={() => setConfirmation(null)}>Вернуться</button><button type="button" className="button primary" disabled={!!busy} onClick={confirmAction}>{busy ? 'Сохраняем…' : confirmationCopy.button}</button></div></section></div>}
  </div>;
}
