import { useEffect, useState } from 'react';
import { NavLink, Link, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { CalendarDays, Plus, Images, RotateCcw, X, ArrowLeft } from 'lucide-react';
import { useApp } from './context/AppContext.jsx';
import { resetDemo } from './services/storage.js';
import Home from './pages/Home.jsx';
import Brand from './components/Brand.jsx';
import Create from './pages/Create.jsx';
import History from './pages/History.jsx';
import Meeting from './pages/Meeting.jsx';
import Join from './pages/Join.jsx';
import Memory from './pages/Memory.jsx';

const navigation = [{ to: '/', label: 'Встречи', icon: CalendarDays }, { to: '/create', label: 'Создать', icon: Plus }, { to: '/history', label: 'История', icon: Images }];

export default function App() {
  const [demoDialog, setDemoDialog] = useState(false); const { mutate } = useApp(); const navigate = useNavigate(); const location = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [location.pathname]);
  useEffect(() => {
    const onEscape = e => { if (e.key === 'Escape') setDemoDialog(false); };
    if (demoDialog) window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [demoDialog]);
  function reset() { if (mutate(() => resetDemo(), 'Демо восстановлено. Всё готово к новой встрече!')) { setDemoDialog(false); navigate('/'); } }
  return <><header className="site-header"><div className="header-inner"><Link to="/" className="brand" aria-label="ЯВКА — на главную"><Brand /></Link><nav className="desktop-nav" aria-label="Основная навигация">{navigation.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} end={to === '/'}><Icon size={17} />{label}</NavLink>)}</nav><div className="header-actions"><button className="demo-button" onClick={() => setDemoDialog(true)}><RotateCcw size={14} />Demo</button><span className="beta-pill">BETA 0.1</span></div></div></header><main className="main-container"><Routes><Route path="/" element={<Home />} /><Route path="/create" element={<Create />} /><Route path="/history" element={<History />} /><Route path="/meetings/:id" element={<Meeting />} /><Route path="/join/:id" element={<Join />} /><Route path="/meetings/:id/memory" element={<Memory />} /><Route path="*" element={<div className="card empty-state"><h1>Здесь пока нет встречи</h1><p className="muted">Проверьте ссылку или вернитесь к своим планам.</p><Link className="button primary" to="/"><ArrowLeft size={18} />Мои встречи</Link></div>} /></Routes></main><footer className="site-footer"><strong>ЯВКА.</strong><span>Для встреч, которые хочется повторить.</span><span className="footer-local">Данные хранятся в вашем браузере</span></footer><nav className="mobile-nav" aria-label="Мобильная навигация">{navigation.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} end={to === '/'}><Icon size={21} />{label}</NavLink>)}</nav>{demoDialog && <div className="modal-backdrop" onClick={() => setDemoDialog(false)}><section className="modal card" role="dialog" aria-modal="true" aria-labelledby="demo-title" onClick={e => e.stopPropagation()}><button className="icon-button modal-close" onClick={() => setDemoDialog(false)} aria-label="Закрыть"><X size={20} /></button><span className="guide-icon"><RotateCcw size={25} /></span><h2 id="demo-title">Вернуть начало истории?</h2><p className="muted">Demo удалит локальные встречи и фотографии и восстановит «Кофе после пар» с пятью друзьями. Это действие нельзя отменить.</p><div className="modal-actions"><button className="button secondary" onClick={() => setDemoDialog(false)} autoFocus>Отмена</button><button className="button primary" onClick={reset}>Восстановить Demo</button></div></section></div>}</>;
}
