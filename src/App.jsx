import { lazy, Suspense, useEffect } from 'react';
import { NavLink, Link, Routes, Route, useLocation, Navigate } from 'react-router-dom';
import { CalendarDays, Plus, Images, ArrowLeft, Users, UserRound, Mail, LoaderCircle } from 'lucide-react';
import { useAuth } from './context/AuthContext.jsx';
const Home = lazy(() => import('./pages/Home.jsx'));
import Brand from './components/Brand.jsx';
const Create = lazy(() => import('./pages/Create.jsx'));
const History = lazy(() => import('./pages/History.jsx'));
const Meeting = lazy(() => import('./pages/Meeting.jsx'));
const Join = lazy(() => import('./pages/Join.jsx'));
const Memory = lazy(() => import('./pages/Memory.jsx'));
import Auth from './pages/Auth.jsx';
const Friends = lazy(() => import('./pages/Friends.jsx'));
const Profile = lazy(() => import('./pages/Profile.jsx'));
const Invitations = lazy(() => import('./pages/Invitations.jsx'));
import './mvp.css';

const navigation = [{ to: '/', label: 'Встречи', icon: CalendarDays }, { to: '/create', label: 'Создать', icon: Plus }, { to: '/history', label: 'История', icon: Images }, { to: '/friends', label: 'Друзья', icon: Users }];
const mobileNavigation = [...navigation, { to: '/profile', label: 'Профиль', icon: UserRound }];

function PrivateRoute({ children }) {
  const { user, loading, configured } = useAuth();
  const location = useLocation();
  if (loading) return <div className="loading-state page-loading" role="status"><LoaderCircle size={21} />Проверяем вход…</div>;
  if (!configured || !user) return <Navigate to={`/auth?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return children;
}

export default function App() {
  const { user, profile, configured, loading } = useAuth();
  const location = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [location.pathname]);
  const protect = element => <PrivateRoute>{element}</PrivateRoute>;
  return <><header className="site-header"><div className="header-inner"><Link to="/" className="brand" aria-label="ЯВКА — на главную"><Brand /></Link><nav className="desktop-nav" aria-label="Основная навигация">{navigation.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} end={to === '/'}><Icon size={17} />{label}</NavLink>)}</nav><div className="header-actions">{user ? <><Link className="icon-button" to="/invitations" aria-label="Приглашения" title="Приглашения"><Mail size={20} /></Link><Link className="account-link" to="/profile" aria-label="Мой профиль"><UserRound size={19} /><span>{profile?.name || 'Профиль'}</span></Link></> : <Link className="button secondary" to="/auth">Войти</Link>}<span className="server-badge">{loading ? 'Подключение…' : configured ? 'MVP 1.0' : 'Нет подключения'}</span></div></div></header><main className="main-container"><Suspense fallback={<div className="loading-state page-loading" role="status"><LoaderCircle size={21} />Открываем страницу…</div>}><Routes><Route path="/auth" element={<Auth />} /><Route path="/auth/callback" element={<Auth />} /><Route path="/auth/reset" element={<Auth />} /><Route path="/" element={protect(<Home />)} /><Route path="/create" element={protect(<Create />)} /><Route path="/history" element={protect(<History />)} /><Route path="/friends" element={protect(<Friends />)} /><Route path="/profile" element={protect(<Profile />)} /><Route path="/invitations" element={protect(<Invitations />)} /><Route path="/meetings/:id" element={protect(<Meeting />)} /><Route path="/join/:token" element={protect(<Join />)} /><Route path="/meetings/:id/memory" element={protect(<Memory />)} /><Route path="*" element={<div className="card empty-state"><h1>Здесь пока нет встречи</h1><p className="muted">Проверьте ссылку или вернитесь к своим планам.</p><Link className="button primary" to="/"><ArrowLeft size={18} />Мои встречи</Link></div>} /></Routes></Suspense></main><footer className="site-footer"><strong>ЯВКА.</strong><span>Для встреч, которые хочется повторить.</span><span className="footer-local">Ваши встречи доступны после входа в аккаунт</span></footer><nav className="mobile-nav" aria-label="Мобильная навигация">{mobileNavigation.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} end={to === '/'}><Icon size={21} />{label}</NavLink>)}</nav></>;
}
