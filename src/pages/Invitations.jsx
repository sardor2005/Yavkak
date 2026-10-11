import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Check, LoaderCircle, Mail, X } from 'lucide-react';
import { listInvitations, respondInvitation } from '../services/api.js';
import { useApp } from '../context/AppContext.jsx';
import { AccountTabs } from './Profile.jsx';

const labels = { pending: 'Ожидает ответа', accepted: 'Принято', declined: 'Отклонено', revoked: 'Отозвано', expired: 'Истекло' };

export default function Invitations() {
  const { toast, refresh } = useApp();
  const navigate = useNavigate();
  const [invitations, setInvitations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setInvitations(await listInvitations()); }
    catch (failure) { setError(failure.message || 'Не удалось загрузить приглашения.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const onFocus = () => { if (!document.hidden) load(); };
    window.addEventListener('focus', onFocus);
    window.addEventListener('yavka:sync', onFocus);
    return () => { window.removeEventListener('focus', onFocus); window.removeEventListener('yavka:sync', onFocus); };
  }, [load]);
  async function respond(invitation, accept) {
    setBusy(invitation.id);
    try {
      const meetingId = await respondInvitation(invitation.id, accept);
      toast(accept ? 'Приглашение принято. Увидимся!' : 'Приглашение отклонено.');
      await refresh();
      if (accept && meetingId) navigate(`/meetings/${meetingId}`);
      else await load();
    } catch (failure) { toast(failure.message || 'Не удалось ответить на приглашение.', 'error'); }
    finally { setBusy(''); }
  }
  return <><div className="page-header"><div><span className="eyebrow">ВАС ЗОВУТ</span><h1>Приглашения</h1><p className="muted">Ответьте друзьям и добавьте встречу в свои планы.</p></div><button className="button secondary" onClick={load} disabled={loading}>Обновить</button></div><AccountTabs />{error && <div className="retry-panel" role="alert"><span>{error}</span><button className="button secondary compact-button" onClick={load}>Повторить</button></div>}{loading ? <div className="loading-state page-loading" role="status"><LoaderCircle size={21} />Загружаем приглашения…</div> : invitations.length ? invitations.map(invitation => {
    const expired = invitation.expiresAt && new Date(invitation.expiresAt).getTime() <= Date.now();
    const status = invitation.status === 'pending' && expired ? 'expired' : invitation.status;
    return <article className="card invite-card" key={invitation.id}><div className="invite-main"><span className={`badge ${status === 'pending' ? 'amber' : status === 'accepted' ? 'green' : 'gray'}`}>{labels[status] || 'Приглашение'}</span><h3>{invitation.meetingTitle || invitation.meeting?.title || 'Вас пригласили на встречу'}</h3><p>{invitation.inviter?.name || 'Организатор'} приглашает вас присоединиться.</p>{invitation.expiresAt && <p>Срок действия: {new Date(invitation.expiresAt).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}</p>}</div><div className="inline-actions">{status === 'pending' ? <><button className="button primary compact-button" disabled={!!busy} onClick={() => respond(invitation, true)}>{busy === invitation.id ? <LoaderCircle size={16} /> : <Check size={16} />}Принять</button><button className="button secondary compact-button" disabled={!!busy} onClick={() => respond(invitation, false)}><X size={16} />Отклонить</button></> : status === 'accepted' ? <Link className="button secondary compact-button" to={`/meetings/${invitation.meetingId}`}>К встрече<ArrowRight size={16} /></Link> : null}</div></article>;
  }) : <div className="card empty-state large-empty"><div className="empty-icon"><Mail size={37} /></div><h2>Пока тихо</h2><p>Когда друг пригласит вас на встречу, приглашение появится здесь.<br />Приглашение по ссылке можно принять, открыв саму ссылку.</p><Link className="button primary" to="/friends">Найти друзей<ArrowRight size={17} /></Link></div>}</>;
}
