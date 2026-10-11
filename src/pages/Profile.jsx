import { useCallback, useEffect, useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { ArrowRight, LoaderCircle, LogOut, Mail, Save, Trophy, UserRound, Users } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useApp } from '../context/AppContext.jsx';
import { getRating, updateProfile } from '../services/api.js';

export function AccountTabs() {
  return <nav className="account-tabs" aria-label="Мой аккаунт"><NavLink to="/friends"><Users size={16} />Друзья</NavLink><NavLink to="/invitations"><Mail size={16} />Приглашения</NavLink><NavLink to="/profile"><UserRound size={16} />Профиль</NavLink></nav>;
}

export function safeAvatarUrl(value) {
  if (!value?.trim()) return '';
  try { const url = new URL(value.trim()); return url.protocol === 'https:' && !url.username && !url.password ? url.href : ''; }
  catch { return ''; }
}

export function ProfileAvatar({ profile, large = false }) {
  const url = safeAvatarUrl(profile?.avatarUrl);
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [url]);
  return url && !failed ? <img className={`profile-avatar${large ? ' large' : ''}`} src={url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : <span className={`avatar profile-avatar${large ? ' large' : ''}`} aria-hidden="true">{(profile?.name || 'У').slice(0, 1).toUpperCase()}</span>;
}

const outcomeLabels = { on_time: 'Пришёл вовремя', late: 'Опоздал', no_show: 'Не пришёл' };
const formatTime = value => value ? new Date(value).toLocaleString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

export default function Profile() {
  const { user, profile, error: profileError, refreshProfile, signOut } = useAuth();
  const { toast } = useApp();
  const navigate = useNavigate();
  const [name, setName] = useState(profile?.name || '');
  const [avatarUrl, setAvatarUrl] = useState(profile?.avatarUrl || '');
  const [saving, setSaving] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState('');
  const [rating, setRating] = useState(null);
  const [ratingError, setRatingError] = useState('');
  const [ratingLoading, setRatingLoading] = useState(true);
  const [ratingMore, setRatingMore] = useState(false);
  const [pageError, setPageError] = useState('');
  useEffect(() => { setName(profile?.name || ''); setAvatarUrl(profile?.avatarUrl || ''); }, [profile?.name, profile?.avatarUrl]);
  const loadRating = useCallback(async () => {
    setRatingLoading(true); setRatingError('');
    try { setRating(await getRating()); }
    catch (failure) { setRatingError(failure.message || 'Не удалось загрузить рейтинг.'); }
    finally { setRatingLoading(false); }
  }, []);
  useEffect(() => {
    loadRating();
    window.addEventListener('yavka:sync', loadRating);
    return () => window.removeEventListener('yavka:sync', loadRating);
  }, [loadRating]);
  async function loadMoreRating() {
    if (ratingMore || !rating?.hasMore) return;
    setRatingMore(true); setPageError('');
    try {
      const page = await getRating(rating.cursor);
      setRating(current => ({ ...page, events: [...current.events, ...page.events.filter(event => !current.events.some(previous => previous.id === event.id))] }));
    } catch (failure) { setPageError(failure.message || 'Не удалось загрузить предыдущие начисления.'); }
    finally { setRatingMore(false); }
  }
  async function save(event) {
    event.preventDefault(); setError('');
    if (name.trim().length < 2) { setError('Имя должно содержать не менее двух символов.'); return; }
    if (avatarUrl.trim() && !safeAvatarUrl(avatarUrl)) { setError('Укажите обычную HTTPS-ссылку на изображение, без логина и пароля.'); return; }
    setSaving(true);
    try { await updateProfile({ name: name.trim(), avatarUrl: safeAvatarUrl(avatarUrl) || null }); await refreshProfile(); toast('Профиль сохранён.'); }
    catch (failure) { setError(failure.message || 'Не удалось сохранить профиль.'); }
    finally { setSaving(false); }
  }
  async function leave() {
    setLeaving(true);
    try { await signOut(); navigate('/auth', { replace: true }); }
    catch (failure) { toast(failure.message || 'Не удалось выйти из аккаунта.', 'error'); }
    finally { setLeaving(false); }
  }
  return <><div className="page-header"><div><span className="eyebrow">ВАША ЯВКА</span><h1>Мой профиль</h1><p className="muted">Ваше имя, друзья и история участия.</p></div><button className="button secondary" disabled={leaving} onClick={leave}><LogOut size={17} />{leaving ? 'Выходим…' : 'Выйти'}</button></div><AccountTabs /><div className="account-layout"><section className="card account-card">{profileError && <div className="form-error" role="alert">{profileError}<div className="inline-actions"><button className="button secondary compact-button" onClick={() => refreshProfile().catch(() => {})}>Повторить загрузку профиля</button></div></div>}<div className="profile-heading"><ProfileAvatar profile={profile} large /><div><h2>{profile?.name || 'Ваш профиль'}</h2><p className="public-id">Публичный ID: {profile?.publicId || 'Загружается…'}</p></div></div><form onSubmit={save}><label className="field">Имя<input value={name} onChange={event => setName(event.target.value)} required minLength={2} maxLength={60} autoComplete="name" disabled={saving || !profile} /></label><label className="field">Ссылка на аватар <span className="optional">Необязательно</span><input type="url" value={avatarUrl} onChange={event => setAvatarUrl(event.target.value)} placeholder="https://…" maxLength={2000} disabled={saving || !profile} /><p className="password-requirement">Публичное изображение по HTTPS. Оставьте поле пустым, чтобы убрать аватар.</p></label>{error && <div className="form-error" role="alert">{error}</div>}<div className="inline-actions"><button className="button primary" type="submit" disabled={saving || !profile}>{saving ? <LoaderCircle size={17} /> : <Save size={17} />}{saving ? 'Сохраняем…' : 'Сохранить'}</button></div></form><p className="session-note">Почта аккаунта: {user.email}. Ваш адрес виден только вам.</p><Link className="text-link section-gap" to="/auth/reset">Сменить пароль<ArrowRight size={15} /></Link></section><section className="card account-card"><span className="guide-icon"><Trophy size={24} /></span><h2>Рейтинг явки</h2><span className="badge blue">Экспериментальная формула</span><p className="muted section-gap">Вовремя: +10. Опоздание: 0. Неявка: −5. Прибытие участник отмечает сам; сервер сохраняет время. Результат не подтверждён геолокацией.</p><p className="muted">Ошибочную отметку организатор может отменить на странице встречи. Отменённые начисления остаются в истории и не влияют на итог.</p>{ratingLoading ? <div className="loading-state" role="status"><LoaderCircle size={19} />Загружаем статистику…</div> : ratingError ? <div className="form-error" role="alert">{ratingError}<div className="inline-actions"><button className="button secondary compact-button" onClick={loadRating}>Повторить</button></div></div> : rating && <><div className="stats-grid"><div className="stat-card"><strong>{rating.totalScore}</strong><span>Баллов</span></div><div className="stat-card"><strong>{rating.meetingCount}</strong><span>Встреч с отметкой</span></div><div className="stat-card"><strong>{rating.onTime}</strong><span>Вовремя</span></div><div className="stat-card"><strong>{rating.late}</strong><span>С опозданием</span></div><div className="stat-card"><strong>{rating.noShow}</strong><span>Неявок</span></div></div><h3>История начислений</h3>{rating.events.length ? <ul className="score-events">{rating.events.map(event => <li className="score-event" key={event.id}><div><strong><Link to={`/meetings/${event.meetingId}`}>{event.meetingTitle || 'Встреча'}</Link></strong><p>{outcomeLabels[event.outcome] || 'Ручная отметка'} · {formatTime(event.createdAt)}</p>{event.revokedAt && <span className="badge gray">Отменено {formatTime(event.revokedAt)}</span>}</div><span className={`score-delta${event.points < 0 ? ' negative' : ''}`}>{event.revokedAt ? '0' : event.points > 0 ? `+${event.points}` : event.points}</span></li>)}</ul> : <p className="muted">Пока нет начислений. Они появятся после завершения встреч с ручными отметками участников.</p>}{pageError && <div className="form-error" role="alert">{pageError}</div>}{rating.hasMore && <div className="pagination-action"><button className="button secondary compact-button" onClick={loadMoreRating} disabled={ratingMore}>{ratingMore ? 'Загружаем…' : 'Предыдущие начисления'}</button></div>}</>}</section></div></>;
}
