import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { CheckCircle2, CircleAlert, X } from 'lucide-react';
import { useAuth } from './AuthContext.jsx';
import { listMeetings } from '../services/api.js';
import { supabase } from '../services/supabase.js';

const AppContext = createContext(null);
export function AppProvider({ children }) {
  const { user } = useAuth();
  const [meetings, setMeetings] = useState([]);
  const [notice, setNotice] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [connected, setConnected] = useState(false);
  const [syncVersion, setSyncVersion] = useState(0);
  const timeout = useRef(); const debounce = useRef(); const pageCount = useRef(1); const generation = useRef(0);
  const toast = useCallback((message, type = 'success') => {
    clearTimeout(timeout.current); setNotice({ message, type });
    timeout.current = setTimeout(() => setNotice(null), type === 'error' ? 6500 : 4500);
  }, []);
  const refresh = useCallback(async () => {
    const run = ++generation.current;
    if (!user) { setMeetings([]); setHasMore(false); return; }
    setLoading(true);
    try {
      let nextCursor = null, all = [], more = false;
      for (let i = 0; i < pageCount.current; i++) {
        const page = await listMeetings(nextCursor); all.push(...page.meetings); nextCursor = page.cursor; more = page.hasMore;
        if (!more) break;
      }
      if (run !== generation.current) return;
      setMeetings(all); setHasMore(more); setError(''); setSyncVersion(v => v + 1);
    } catch (cause) { if (run === generation.current) setError(cause.message || 'Не удалось загрузить встречи.'); }
    finally { if (run === generation.current) setLoading(false); }
  }, [user?.id]);
  const loadMore = useCallback(async () => {
    if (loading || !hasMore) return;
    pageCount.current += 1; await refresh();
  }, [loading, hasMore, refresh]);
  const mutate = useCallback(async (action, success) => {
    try { const value = await action(); await refresh(); if (success) toast(success); return value === undefined ? true : value; }
    catch (cause) { toast(cause.message || 'Не удалось сохранить изменения.', 'error'); return null; }
  }, [refresh, toast]);
  useEffect(() => {
    generation.current++; pageCount.current = 1; setMeetings([]); setError(''); setHasMore(false); refresh();
    return () => { generation.current++; clearTimeout(timeout.current); clearTimeout(debounce.current); };
  }, [refresh]);
  const meetingIds = meetings.map(m => m.id).sort().join(',');
  useEffect(() => {
    if (!supabase || !user) return;
    let alive = true; setConnected(false);
    const sync = () => {
      clearTimeout(debounce.current);
      debounce.current = setTimeout(() => { if (alive) { refresh(); window.dispatchEvent(new Event('yavka:sync')); } }, 180);
    };
    const channel = supabase.channel(`account-${user.id}-${meetingIds}`);
    const watch = (table, filter) => channel.on('postgres_changes', { event: '*', schema: 'public', table, filter }, sync);
    watch('meetings', `organizer_id=eq.${user.id}`); watch('meeting_participants', `user_id=eq.${user.id}`);
    watch('meeting_invitations', `invitee_id=eq.${user.id}`);
    watch('friend_requests', `sender_id=eq.${user.id}`); watch('friend_requests', `receiver_id=eq.${user.id}`);
    watch('friendships', `user_a=eq.${user.id}`); watch('friendships', `user_b=eq.${user.id}`);
    for (const id of meetingIds.split(',').filter(Boolean)) {
      watch('meetings', `id=eq.${id}`); watch('meeting_participants', `meeting_id=eq.${id}`); watch('meeting_photos', `meeting_id=eq.${id}`);
    }
    channel.on('system', {}, payload => {
      if (!alive || payload.extension !== 'postgres_changes') return;
      setConnected(payload.status === 'ok');
      if (payload.status === 'ok') sync();
    }).subscribe(status => {
      if (!alive) return;
      if (status !== 'SUBSCRIBED') setConnected(false);
      if (status === 'SUBSCRIBED') sync();
    });
    window.addEventListener('online', sync); window.addEventListener('focus', sync);
    const visibility = () => { if (document.visibilityState === 'visible') sync(); };
    document.addEventListener('visibilitychange', visibility);
    const poll = setInterval(() => { if (document.visibilityState === 'visible') sync(); }, 30000);
    return () => { alive = false; clearInterval(poll); clearTimeout(debounce.current); window.removeEventListener('online', sync); window.removeEventListener('focus', sync); document.removeEventListener('visibilitychange', visibility); supabase.removeChannel(channel); };
  }, [user?.id, meetingIds, refresh]);
  return <AppContext.Provider value={{ meetings, loading, error, refresh, mutate, toast, loadMore, hasMore, connected, syncVersion }}>
    {error && user && <div className="storage-error" role="alert">{error} <button className="button secondary" onClick={refresh}>Повторить</button></div>}
    {children}
    {notice && <div className={`toast ${notice.type}`} role={notice.type === 'error' ? 'alert' : 'status'}><span>{notice.type === 'error' ? <CircleAlert size={20} /> : <CheckCircle2 size={20} />}</span><span>{notice.message}</span><button className="icon-button" onClick={() => setNotice(null)} aria-label="Закрыть уведомление"><X size={18} /></button></div>}
  </AppContext.Provider>;
}
export function useApp() { return useContext(AppContext); }
