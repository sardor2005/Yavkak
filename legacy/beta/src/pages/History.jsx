import { Link } from 'react-router-dom';
import { ArrowLeft, Images, Plus } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import MeetingCard from '../components/MeetingCard.jsx';

export default function History() {
  const { meetings } = useApp();
  const past = meetings.filter(m => m.status === 'completed').sort((a, b) => (b.completedAt || b.createdAt).localeCompare(a.completedAt || a.createdAt));
  return <><div className="page-header"><div><span className="eyebrow">ХОРОШО БЫЛО</span><h1>История встреч <span className="count-pill">{past.length}</span></h1><p className="muted">Места, люди и моменты, которые остаются с вами.</p></div><Link to="/" className="button secondary"><ArrowLeft size={18} />К встречам</Link></div>{past.length ? <div className="meeting-grid history-grid">{past.map(m => <MeetingCard key={m.id} meeting={m} />)}</div> : <div className="card empty-state large-empty"><div className="empty-icon"><Images size={40} /></div><h2>Лучшее ещё впереди</h2><p>После встречи добавьте фотографии или короткую заметку.<br />Ваши общие моменты появятся здесь.</p><Link to="/create" className="button primary"><Plus size={18} />Запланировать встречу</Link></div>}</>;
}
