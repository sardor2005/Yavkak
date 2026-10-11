import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, CalendarDays, MapPin, Users } from 'lucide-react';
import { createMeeting } from '../services/api.js';
import { useApp } from '../context/AppContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { localDate } from '../utils/format.js';
import { zonedDateTime } from '../utils/time.js';
import '../meeting.css';

export const browserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Tashkent';
const timeZones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : ['Asia/Tashkent', 'Europe/Moscow', 'Europe/London', 'UTC'];

export function MeetingFields({ value, onChange, disabled = false }) {
  const update = (key) => (event) => onChange({ ...value, [key]: event.target.value });
  return <>
    <label className="field">Название встречи <span className="required">*</span><input value={value.title} onChange={update('title')} placeholder="Например, кофе после пар" required minLength={2} maxLength={100} autoComplete="off" disabled={disabled} /></label>
    <label className="field">Описание <span className="optional">необязательно</span><textarea value={value.description} onChange={update('description')} placeholder="За чашкой кофе обсудим всё, что накопилось ☕" maxLength={1000} rows={3} disabled={disabled} /></label>
    <div className="mp-form-grid">
      <label className="field">Дата <span className="required">*</span><input type="date" required value={value.date} onChange={update('date')} disabled={disabled} /></label>
      <label className="field">Время <span className="required">*</span><input type="time" required value={value.time} onChange={update('time')} disabled={disabled} /></label>
      <label className="field mp-span-two">Часовой пояс <span className="required">*</span><input list="meeting-time-zones" required maxLength={100} value={value.timeZone} onChange={update('timeZone')} placeholder="Asia/Tashkent" disabled={disabled} /><datalist id="meeting-time-zones">{timeZones.map((zone) => <option key={zone} value={zone} />)}</datalist></label>
      <label className="field mp-span-two">Название места <span className="required">*</span><input required maxLength={120} placeholder="Например, любимая кофейня" value={value.placeName} onChange={update('placeName')} disabled={disabled} /></label>
      <label className="field mp-span-two">Адрес <span className="optional">необязательно</span><input maxLength={250} placeholder="Улица Амира Темура, 12" value={value.placeAddress} onChange={update('placeAddress')} disabled={disabled} /></label>
    </div>
  </>;
}

export function meetingFormInput(form) {
  return { title: form.title.trim(), description: form.description.trim(), placeName: form.placeName.trim(), placeAddress: form.placeAddress.trim(), startsAt: zonedDateTime(form.date, form.time, form.timeZone.trim()), timeZone: form.timeZone.trim() };
}

export default function Create() {
  const [form, setForm] = useState({ title: '', description: '', placeName: '', placeAddress: '', date: localDate(1), time: '18:30', timeZone: browserTimeZone() });
  const [saving, setSaving] = useState(false);
  const { mutate } = useApp();
  const { profile } = useAuth();
  const navigate = useNavigate();

  async function submit(event) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const meeting = await mutate(() => createMeeting(meetingFormInput(form)), 'Встреча создана. Теперь позовите друзей!');
      if (meeting?.id) navigate(`/meetings/${meeting.id}`);
    } finally { setSaving(false); }
  }

  return <>
    <Link to="/" className="back-link"><ArrowLeft size={17} />Мои встречи</Link>
    <div className="page-header"><div><span className="eyebrow">НАЧНИТЕ С ИДЕИ</span><h1>Создадим встречу</h1><p className="muted">Назначьте время и место. Друзьям останется подтвердить участие.</p></div><span className="badge blue">Общий план для друзей</span></div>
    <div className="create-layout"><form className="create-form" onSubmit={submit}>
      <section className="card form-section"><div className="form-section-heading"><span className="section-number">01</span><h2><CalendarDays size={20} />Что планируем?</h2></div><MeetingFields value={form} onChange={setForm} disabled={saving} /><p className="muted form-hint"><MapPin size={14} /> Время указано в выбранном часовом поясе.</p></section>
      <div className="create-submit"><span className="muted">После создания можно пригласить друзей или отправить ссылку.</span><button className="button primary" type="submit" disabled={saving}>{saving ? 'Создаём встречу…' : 'Создать встречу'}<ArrowRight size={18} /></button></div>
    </form><aside className="create-aside"><div className="guide-card"><div className="guide-icon"><Users size={24} /></div><h3>Вы — организатор{profile?.name ? `, ${profile.name}` : ''}</h3><p className="muted">Участники увидят единый план, смогут сообщить, что готовы, уже в пути или пришли.</p><div className="create-tip"><strong>Планы поменялись?</strong><p>Отредактируйте встречу. Новый план появится у всей компании.</p></div><span className="badge blue">Меньше переписки. Больше встреч.</span></div></aside></div>
  </>;
}
