import { useEffect, useRef, useState, useCallback } from 'react';
import { Send, Trash2, MessageCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useApp } from '../context/AppContext.jsx';
import { deleteMessage, getMeeting, listMessages, sendMessage } from '../services/api.js';
import { supabase } from '../services/supabase.js';
import '../chat.css';

export default function MeetingChat({ meetingId }) {
  const { user } = useAuth(); const { toast } = useApp();
  const [messages, setMessages] = useState([]); const [text, setText] = useState('');
  const [error, setError] = useState(''); const [loading, setLoading] = useState(true); const [sending, setSending] = useState(false);
  const [more, setMore] = useState(false); const [connected, setConnected] = useState(false); const [allowed, setAllowed] = useState(false);
  const cursor = useRef(null); const scroll = useRef(null); const atBottom = useRef(true); const alive = useRef(true); const request = useRef(0); const queued = useRef(false);
  const reload = useCallback(async (reset = false) => {
    const run = ++request.current;
    try {
      const meeting = await getMeeting(meetingId);
      const member = meeting?.participants.find(p => p.userId === user?.id && p.invitationStatus === 'accepted');
      if (!member) { if (alive.current && run === request.current) { setAllowed(false); setMessages([]); setError('Доступ к чату прекращён.'); } return; }
      const page = await listMessages(meetingId);
      if (!alive.current || run !== request.current) return;
      setAllowed(meeting.status !== 'cancelled'); setError('');
      setMessages(previous => {
        if (reset) return page.messages;
        const oldest = page.messages[0]?.createdAt;
        const retained = oldest ? previous.filter(m => m.createdAt < oldest) : [];
        return [...retained, ...page.messages];
      });
      if (reset || !cursor.current) { cursor.current = page.cursor; setMore(page.hasMore); }
    } catch (cause) { if (alive.current && run === request.current) setError(cause.message); }
    finally { if (alive.current && run === request.current) setLoading(false); }
  }, [meetingId, user?.id]);
  useEffect(() => {
    alive.current = true; setConnected(false); setMessages([]); setLoading(true); cursor.current = null; atBottom.current = true;
    reload(true);
    const sync = () => reload();
    const channel = supabase?.channel(`chat-${meetingId}-${user?.id}`).on('postgres_changes', { event: '*', schema: 'public', table: 'chat_messages', filter: `meeting_id=eq.${meetingId}` }, payload => {
      if (payload.eventType === 'DELETE') setMessages(rows => rows.filter(row => row.id !== payload.old.id));
      reload();
    }).on('system', {}, payload => {
      if (!alive.current || payload.extension !== 'postgres_changes') return;
      setConnected(payload.status === 'ok');
      if (payload.status === 'ok') reload();
    }).subscribe(status => {
      if (!alive.current) return;
      if (status !== 'SUBSCRIBED') setConnected(false);
      if (status === 'SUBSCRIBED') reload();
    });
    window.addEventListener('online', sync); window.addEventListener('yavka:sync', sync);
    const poll = setInterval(sync, 30000);
    return () => { alive.current = false; request.current++; clearInterval(poll); window.removeEventListener('online', sync); window.removeEventListener('yavka:sync', sync); if (channel) supabase.removeChannel(channel); };
  }, [reload, meetingId, user?.id]);
  useEffect(() => { if (atBottom.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight; }, [messages]);
  async function older() {
    if (queued.current || !cursor.current) return;
    queued.current = true;
    try {
      const oldHeight = scroll.current?.scrollHeight || 0;
      const page = await listMessages(meetingId, cursor.current);
      if (!alive.current) return;
      cursor.current = page.cursor; setMore(page.hasMore); atBottom.current = false;
      setMessages(rows => [...page.messages, ...rows].filter((m, i, all) => all.findIndex(x => x.id === m.id) === i));
      requestAnimationFrame(() => { if (scroll.current) scroll.current.scrollTop += scroll.current.scrollHeight - oldHeight; });
    } catch (cause) { toast(cause.message, 'error'); } finally { queued.current = false; }
  }
  async function submit(event) {
    event.preventDefault(); if (!text.trim() || sending) return;
    setSending(true);
    try { await sendMessage(meetingId, text); setText(''); atBottom.current = true; await reload(); }
    catch (cause) { toast(cause.message, 'error'); }
    finally { setSending(false); }
  }
  async function remove(id) {
    if (!window.confirm('Удалить своё сообщение?')) return;
    try { await deleteMessage(id); setMessages(rows => rows.filter(m => m.id !== id)); await reload(); }
    catch (cause) { toast(cause.message, 'error'); }
  }
  return <section className="card meeting-chat" aria-label="Чат встречи"><div className="mp-section-heading"><span className="mp-section-icon"><MessageCircle size={20} /></span><div><h2>Чат встречи</h2><p>{connected ? 'Обновления в реальном времени' : 'Можно обновить историю вручную'}</p></div></div>
    {error && <p role="alert" className="form-error">{error}</p>}
    <button className="button ghost" onClick={() => reload(true)} disabled={loading}>Обновить историю</button>
    <div className="chat-history" role="log" aria-label="Сообщения" ref={scroll} onScroll={() => { const box = scroll.current; atBottom.current = box.scrollHeight - box.scrollTop - box.clientHeight < 60; }}>
      {more && <button className="button secondary" onClick={older}>Более ранние сообщения</button>}
      {loading ? <p className="muted">Загружаем сообщения…</p> : !messages.length && <p className="muted">Начните разговор — сообщения доступны участникам встречи.</p>}
      {messages.map(message => <article className={`chat-message ${message.authorId === user?.id ? 'own' : ''}`} key={message.id}><div className="chat-meta"><strong>{message.author?.name || 'Участник'}</strong><time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })}</time>{message.authorId === user?.id && <button className="icon-button" aria-label="Удалить своё сообщение" onClick={() => remove(message.id)}><Trash2 size={15} /></button>}</div><p>{message.body}</p></article>)}
    </div><form className="chat-compose" onSubmit={submit}><label className="field">Сообщение<textarea value={text} onChange={e => setText(e.target.value)} maxLength={2000} rows={2} required disabled={!allowed} placeholder="Напишите участникам встречи" /></label><button className="button primary" type="submit" disabled={sending || !allowed || !text.trim()}><Send size={16} />{sending ? 'Отправляем…' : 'Отправить'}</button></form>
  </section>;
}
