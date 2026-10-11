import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Coffee, ShieldCheck, X } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { acceptToken } from '../services/api.js';
import '../meeting.css';

export default function Join() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const { mutate } = useApp();
  const [pending, setPending] = useState('');
  const [error, setError] = useState('');
  const [declined, setDeclined] = useState(false);
  const next = `/join/${token}`;

  async function respond(accept) {
    if (pending || !user) return;
    setPending(accept ? 'accept' : 'decline');
    setError('');
    try {
      const result = await mutate(async () => {
        try { return await acceptToken(token, accept); }
        catch (cause) { setError(cause.message || 'Приглашение недоступно. Попросите организатора прислать новую ссылку.'); throw cause; }
      }, accept ? 'Вы в компании!' : 'Приглашение отклонено');
      if (result === null) return;
      if (!accept) { setDeclined(true); return; }
      const meetingId = typeof result === 'string' ? result : result?.meetingId || result?.meeting_id || result?.id;
      if (meetingId) navigate(`/meetings/${meetingId}`, { replace: true });
      else setError('Приглашение принято. Откройте встречу из списка ваших встреч.');
    } finally { setPending(''); }
  }

  return <div className="join-page">
    <Link className="back-link join-back" to="/"><ArrowLeft size={17} />Мои встречи</Link><div className="join-decoration one" /><div className="join-decoration two" />
    <section className="card join-card"><h1 className="join-invitation-tag"><span />{declined ? 'ВАШ ОТВЕТ СОХРАНЁН' : 'ВАС ПРИГЛАШАЮТ НА ВСТРЕЧУ'}</h1><div className="join-coffee"><Coffee size={36} strokeWidth={1.6} /></div><h2 className="join-title">{declined ? 'До следующей встречи' : 'Друзья собирают компанию'}</h2><p className="join-description">{declined ? 'Вы отклонили приглашение. Если планы изменятся, попросите организатора пригласить вас снова.' : 'Примите приглашение, чтобы увидеть название, время, место и участников встречи.'}</p>
      {loading ? <p className="muted" role="status">Проверяем вход…</p> : declined ? <Link className="button primary join-submit" to="/">Мои встречи<ArrowRight size={18} /></Link> : !user ? <><p className="join-organizer" style={{ marginTop: 20 }}>Войдите в свой аккаунт, чтобы ответить на приглашение.</p><Link className="button primary join-submit" to={`/auth?next=${encodeURIComponent(next)}`}>Войти и продолжить<ArrowRight size={18} /></Link></> : <><div className="join-event-details"><span><ShieldCheck size={19} /><strong>План, чат и фотографии доступны участникам после принятия приглашения.</strong></span></div>{error && <p className="form-error" role="alert">{error}</p>}<button type="button" className="button primary join-submit" disabled={!!pending} onClick={() => respond(true)}>{pending === 'accept' ? 'Принимаем приглашение…' : 'Принять приглашение'}<ArrowRight size={18} /></button><button type="button" className="button secondary join-submit" disabled={!!pending} onClick={() => respond(false)}>{pending === 'decline' ? 'Сохраняем ответ…' : 'Отклонить приглашение'}<X size={17} /></button></>}
      <div className="join-no-account"><ShieldCheck size={15} />Приватная встреча вашей компании</div>
    </section><p className="join-slogan">Договорились. Встретились. Сохранили.</p>
  </div>;
}
