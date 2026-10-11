import { useCallback, useEffect, useState } from 'react';
import { Check, LoaderCircle, Search, UserMinus, UserPlus, Users, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useApp } from '../context/AppContext.jsx';
import { listFriends, listFriendRequests, removeFriend, requestFriend, respondFriendRequest, searchProfiles } from '../services/api.js';
import { AccountTabs, ProfileAvatar } from './Profile.jsx';

export default function Friends() {
  const { user } = useAuth();
  const { toast } = useApp();
  const [friends, setFriends] = useState([]);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [busy, setBusy] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    const loaded = await Promise.allSettled([listFriends(), listFriendRequests()]);
    if (loaded[0].status === 'fulfilled') setFriends(loaded[0].value);
    if (loaded[1].status === 'fulfilled') setRequests(loaded[1].value);
    const failure = loaded.find(result => result.status === 'rejected');
    if (failure) setError(failure.reason.message || 'Не удалось загрузить друзей.');
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const refresh = () => { if (!document.hidden) load(); };
    window.addEventListener('focus', refresh);
    window.addEventListener('yavka:sync', refresh);
    return () => { window.removeEventListener('focus', refresh); window.removeEventListener('yavka:sync', refresh); };
  }, [load]);
  const incoming = requests.filter(request => request.status === 'pending' && request.receiverId === user.id);
  const outgoing = requests.filter(request => request.status === 'pending' && request.senderId === user.id);

  async function search(event) {
    event.preventDefault();
    setSearchError('');
    if (query.trim().length < 2) { setSearchError('Введите не менее двух символов имени или публичного ID.'); return; }
    setSearching(true); setSearched(false);
    try { setResults((await searchProfiles(query.trim())).filter(person => person.id !== user.id)); setSearched(true); }
    catch (failure) { setSearchError(failure.message || 'Не удалось выполнить поиск.'); }
    finally { setSearching(false); }
  }
  async function act(key, action, message) {
    setBusy(key);
    try { await action(); toast(message); await load(); }
    catch (failure) { toast(failure.message || 'Не удалось сохранить изменения.', 'error'); }
    finally { setBusy(''); }
  }
  function personLine(person, actions) {
    return <li className="person-row" key={person.id}><ProfileAvatar profile={person} /><div className="person-details"><strong>{person.name}</strong>{person.publicId && <p className="public-id">ID: {person.publicId}</p>}</div><div className="person-actions">{actions}</div></li>;
  }
  return <><div className="page-header"><div><span className="eyebrow">ХОРОШАЯ КОМПАНИЯ</span><h1>Друзья</h1><p className="muted">Найдите своих и приглашайте их на встречи.</p></div></div><AccountTabs />{error && <div className="retry-panel" role="alert"><span>{error}</span><button className="button secondary compact-button" onClick={load}>Повторить</button></div>}<div className="account-layout"><div><section className="card account-card"><h2>Найти друга</h2><p className="muted">Введите имя или публичный ID. Поиск по почте недоступен.</p><form className="search-row" onSubmit={search}><label className="field">Имя или ID<input value={query} onChange={event => setQuery(event.target.value)} placeholder="Например, имя друга" maxLength={60} minLength={2} required /></label><button className="button primary" disabled={searching || !!busy}>{searching ? <LoaderCircle size={17} /> : <Search size={17} />}{searching ? 'Ищем…' : 'Найти'}</button></form>{searchError && <div className="form-error" role="alert">{searchError}</div>}{searched && (results.length ? <ul className="people-list section-gap">{results.map(person => {
    const friend = friends.some(item => item.id === person.id);
    const sent = outgoing.some(item => item.receiverId === person.id);
    const received = incoming.some(item => item.senderId === person.id);
    return personLine(person, friend ? <span className="badge green"><Check size={13} />Уже друзья</span> : sent ? <span className="badge amber">Запрос отправлен</span> : received ? <span className="badge blue">Входящий запрос</span> : <button className="button secondary compact-button" disabled={!!busy} onClick={() => act(`request-${person.id}`, () => requestFriend(person.id), 'Запрос в друзья отправлен.')}><UserPlus size={15} />{busy === `request-${person.id}` ? 'Отправляем…' : 'Добавить'}</button>);
  })}</ul> : <div className="empty-state"><p>Никого не нашли. Проверьте имя или попросите друга прислать свой публичный ID.</p></div>)}</section><section className="card account-card section-gap"><h2>Мои друзья <span className="count-pill">{friends.length}</span></h2>{loading ? <div className="loading-state" role="status"><LoaderCircle size={19} />Загружаем…</div> : friends.length ? <ul className="people-list">{friends.map(person => personLine(person, <button className="button secondary compact-button" disabled={!!busy} onClick={() => { if (window.confirm(`Удалить ${person.name} из друзей?`)) act(`remove-${person.id}`, () => removeFriend(person.id), 'Пользователь удалён из друзей.'); }}><UserMinus size={15} />{busy === `remove-${person.id}` ? 'Удаляем…' : 'Удалить'}</button>))}</ul> : <div className="empty-state"><Users size={29} /><h3>Начните со своих</h3><p>После принятия запроса ваши друзья появятся здесь.</p></div>}</section></div><aside><section className="card account-card"><h2>Входящие запросы <span className="count-pill">{incoming.length}</span></h2>{loading ? <div className="loading-state" role="status"><LoaderCircle size={19} />Загружаем…</div> : incoming.length ? <ul className="people-list">{incoming.map(request => personLine({ ...request.sender, id: request.senderId }, <><button className="button primary compact-button" disabled={!!busy} onClick={() => act(request.id, () => respondFriendRequest(request.id, true), 'Теперь вы друзья.')}><Check size={15} />Принять</button><button className="button secondary compact-button" disabled={!!busy} onClick={() => act(request.id, () => respondFriendRequest(request.id, false), 'Запрос отклонён.')}><X size={15} />Отклонить</button></>))}</ul> : <p className="muted">Новых запросов пока нет.</p>}</section><section className="card account-card section-gap"><h2>Отправленные запросы</h2>{outgoing.length ? <ul className="people-list">{outgoing.map(request => personLine({ ...request.receiver, id: request.receiverId }, <span className="badge amber">Ожидает ответа</span>))}</ul> : <p className="muted">Здесь появятся ваши запросы в друзья.</p>}</section></aside></div></>;
}
