import { Link } from 'react-router-dom';
import { ArrowRight, Plus, Sparkles, Users, Check, Coffee, MapPin, CalendarCheck2 } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import MeetingCard from '../components/MeetingCard.jsx';

export default function Home() {
  const { meetings } = useApp();
  const upcoming = meetings.filter(m => m.status !== 'completed');
  const past = meetings.filter(m => m.status === 'completed');
  return <>
    <section className="hero">
      <div className="hero-copy"><span className="eyebrow"><span className="tiny-dot" /> БОЛЬШЕ ВСТРЕЧ. МЕНЬШЕ ПЕРЕПИСКИ.</span><h1>Хорошая компания.<br /><span>Один общий план.</span></h1><p>Выберите время и место, соберите друзей.<br className="desktop-break" /> Всё остальное уже в ЯВКЕ.</p><Link to="/create" className="button primary"><Plus size={19} />Создать встречу<ArrowRight size={18} /></Link><span className="hero-footnote">Договорились. Встретились. Сохранили.</span></div>
      <div className="hero-art" aria-hidden="true"><span className="art-orbit orbit-one" /><span className="art-orbit orbit-two" /><div className="floating-label label-top"><span className="green-dot" />Все на одной волне</div><div className="art-card"><div className="art-coffee"><Coffee size={52} strokeWidth={1.6} /><span>+</span></div><div className="art-card-title">Планы на хорошее время</div><div className="art-card-detail"><MapPin size={14} />Наше любимое место</div><div className="art-people">{['С', 'Н', 'Н', 'Д', 'К'].map((letter, i) => <span className={`avatar avatar-${i}`} key={i}>{letter}</span>)}<span className="art-check"><Check size={16} /></span></div></div><div className="floating-label label-bottom"><CalendarCheck2 size={18} />Встреча? Договорились.</div><span className="art-sparkle"><Sparkles size={26} /></span></div>
    </section>
    <div className="home-columns"><div className="home-main"><div className="section-heading"><div><span className="eyebrow">ВАШИ ПЛАНЫ</span><h2>Предстоящие <span className="count-pill">{upcoming.length}</span></h2></div><Link to="/create" className="text-link"><Plus size={17} />Новая встреча</Link></div>
      {upcoming.length ? <div className="meeting-grid">{upcoming.map(m => <MeetingCard key={m.id} meeting={m} />)}</div> : <div className="card empty-state"><CalendarCheck2 size={36} /><h3>Пора увидеться</h3><p>Ваш следующий хороший вечер начинается с одной идеи.</p><Link to="/create" className="button primary"><Plus size={18} />Создать встречу</Link></div>}
      <div className="section-heading history-heading"><div><h2>История встреч</h2><p className="muted">То, что хочется повторить</p></div><Link to="/history" className="text-link">Вся история<ArrowRight size={17} /></Link></div>
      {past.length ? <div className="meeting-grid">{past.slice(0, 2).map(m => <MeetingCard key={m.id} meeting={m} />)}</div> : <Link to="/history" className="history-empty"><div className="history-icon"><Coffee size={23} /></div><div><strong>Здесь будут ваши воспоминания</strong><p>Завершите встречу и сохраните её лучшие моменты.</p></div><ArrowRight size={20} /></Link>}
    </div><aside className="home-aside"><div className="guide-card"><span className="guide-icon"><Users size={22} /></span><h3>Собраться проще,<br />чем кажется</h3><p className="muted">От «давайте встретимся»<br />до «как же хорошо посидели».</p><ol className="steps"><li><span>01</span><div><strong>Предложите встречу</strong><p>Пара вариантов времени и места</p></div></li><li><span>02</span><div><strong>Позовите своих</strong><p>По ссылке. Без регистрации</p></div></li><li><span>03</span><div><strong>Договоритесь</strong><p>Голосование и один итоговый план</p></div></li><li><span>04</span><div><strong>Сохраните момент</strong><p>Фото и немного тёплых слов</p></div></li></ol><div className="guide-note"><span className="tiny-dot" />Для компаний от 3 до 8 друзей</div></div><div className="local-note"><span className="badge blue">BETA</span><p>Ваши встречи сохраняются в этом браузере. Никаких аккаунтов — только ваши планы.</p></div></aside></div>
  </>;
}
