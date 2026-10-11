import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, KeyRound, LoaderCircle, Mail, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';

function safeNext(value) {
  return value && value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/auth') && !value.includes('\\') ? value : '/';
}

export default function Auth() {
  const { user, loading, configured, error: authError, authEvent, signUp, signIn, resetPassword, updatePassword } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const parameters = new URLSearchParams(location.search);
  const next = safeNext(parameters.get('next'));
  const mode = location.pathname === '/auth/reset' ? (user ? 'update' : 'reset') : parameters.get('mode') === 'register' ? 'register' : parameters.get('mode') === 'reset' ? 'reset' : 'login';
  const callback = location.pathname === '/auth/callback';
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [finishedPassword, setFinishedPassword] = useState(false);
  useEffect(() => { setError(''); setMessage(''); setPassword(''); setConfirmation(''); }, [mode]);
  useEffect(() => {
    if (!user || loading || pending) return;
    if (authEvent === 'PASSWORD_RECOVERY' && location.pathname !== '/auth/reset') navigate(`/auth/reset?next=${encodeURIComponent(next)}`, { replace: true });
    else if (mode !== 'update') navigate(next, { replace: true });
  }, [user, loading, mode, pending, navigate, next, authEvent, location.pathname]);
  const linkFor = target => `/auth?mode=${target}&next=${encodeURIComponent(next)}`;

  async function submit(event) {
    event.preventDefault();
    setError(''); setMessage('');
    if (mode === 'update' && password !== confirmation) { setError('Пароли не совпадают.'); return; }
    if ((mode === 'register' || mode === 'update') && password.length < 8) { setError('Используйте пароль длиной не менее 8 символов.'); return; }
    setPending(true);
    try {
      if (mode === 'register') {
        const result = await signUp({ email: email.trim(), password, name: name.trim() });
        if (result.needsConfirmation) setMessage('Проверьте почту: мы отправили ссылку для подтверждения адреса. Откройте её, затем войдите в ЯВКУ. Если письма нет, проверьте папку «Спам».');
        else navigate(next, { replace: true });
      } else if (mode === 'reset') {
        await resetPassword(email.trim());
        setMessage('Если для этого адреса есть аккаунт, на почту придёт ссылка для смены пароля. Проверьте входящие и папку «Спам».');
      } else if (mode === 'update') {
        await updatePassword(password);
        setFinishedPassword(true); setMessage('Пароль изменён. Теперь можно вернуться к встречам.');
        setPassword(''); setConfirmation('');
      } else {
        await signIn({ email: email.trim(), password });
        navigate(next, { replace: true });
      }
    } catch (failure) { setError(failure.message || 'Не удалось выполнить запрос. Попробуйте ещё раз.'); }
    finally { setPending(false); }
  }

  if (!configured) return <section className="card auth-card"><span className="guide-icon"><ShieldCheck size={24} /></span><h1>Подключение пока не настроено</h1><p className="muted">Владельцу приложения нужно подключить сервер, чтобы стали доступны регистрация и сохранение встреч.</p><div className="info-panel" role="status">Встречи и аккаунты появятся здесь после завершения настройки. Проверьте страницу позже.</div></section>;
  if (loading || (callback && user)) return <div className="loading-state page-loading" role="status"><LoaderCircle size={22} />Проверяем вход…</div>;
  if (callback) return <section className="card auth-card"><span className="guide-icon"><Mail size={23} /></span><h1>Проверим вход</h1><p className="muted">Ссылка могла истечь или уже использоваться. Попробуйте войти с подтверждённым адресом. Если вы меняли пароль, запросите новую ссылку.</p>{authError && <p className="form-error" role="alert">{authError}</p>}<div className="button-row"><Link to={linkFor('login')} className="button primary">Войти<ArrowRight size={18} /></Link><Link to={linkFor('reset')} className="button secondary">Сменить пароль</Link></div></section>;
  return <section className="card auth-card"><span className="guide-icon">{mode === 'reset' || mode === 'update' ? <KeyRound size={24} /> : <ShieldCheck size={24} />}</span>{(mode === 'login' || mode === 'register') && <nav className="auth-switch" aria-label="Способ входа"><Link className={mode === 'login' ? 'active' : ''} to={linkFor('login')}>Войти</Link><Link className={mode === 'register' ? 'active' : ''} to={linkFor('register')}>Создать аккаунт</Link></nav>}<h1>{mode === 'register' ? 'Рады знакомству' : mode === 'reset' ? 'Восстановить доступ' : mode === 'update' ? 'Новый пароль' : 'Снова увидимся'}</h1><p className="muted">{mode === 'register' ? 'Создайте аккаунт, чтобы приглашать друзей и хранить общие планы.' : mode === 'reset' ? 'Введите почту вашего аккаунта. Мы отправим ссылку для смены пароля.' : mode === 'update' ? 'Придумайте пароль, который вы ещё не использовали.' : 'Войдите, чтобы вернуться к своим встречам.'}</p>{message && <div className="success-panel" role="status">{message}</div>}{(error || authError) && <div className="form-error" role="alert">{error || authError}</div>}{!finishedPassword && <form onSubmit={submit}>{mode === 'register' && <label className="field">Ваше имя<input value={name} onChange={event => setName(event.target.value)} autoComplete="name" placeholder="Как вас зовут" required minLength={2} maxLength={60} disabled={pending} /></label>}{mode !== 'update' && <label className="field">Электронная почта<input type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" placeholder="you@example.com" required maxLength={254} disabled={pending} /></label>}{mode !== 'reset' && <div><label className="field">{mode === 'update' ? 'Новый пароль' : 'Пароль'}<input type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required minLength={mode === 'login' ? 1 : 8} maxLength={128} disabled={pending} aria-describedby={mode !== 'login' ? 'password-requirement' : undefined} /></label>{mode !== 'login' && <p id="password-requirement" className="password-requirement">Не менее 8 символов.</p>}</div>}{mode === 'update' && <label className="field">Повторите пароль<input type="password" value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete="new-password" required minLength={8} maxLength={128} disabled={pending} /></label>}<button className="button primary" type="submit" disabled={pending}>{pending ? <LoaderCircle size={18} /> : mode === 'reset' ? <Mail size={18} /> : <ArrowRight size={18} />}{pending ? 'Подождите…' : mode === 'register' ? 'Создать аккаунт' : mode === 'reset' ? 'Получить ссылку' : mode === 'update' ? 'Сохранить пароль' : 'Войти'}</button></form>}{finishedPassword ? <Link className="button primary" to={next}>К встречам<ArrowRight size={18} /></Link> : <div className="auth-links">{mode === 'login' ? <Link to={linkFor('reset')}>Забыли пароль?</Link> : <Link to={linkFor('login')}>Вернуться ко входу</Link>}{mode === 'register' && <span className="muted">Подтвердите адрес по ссылке из письма.</span>}</div>}</section>;
}
