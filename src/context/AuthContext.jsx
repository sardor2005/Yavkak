import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { configured, supabase, requireClient } from '../services/supabase.js';

const AuthContext = createContext(null);
const nextQuery = () => {
  const next = new URLSearchParams(window.location.search).get('next');
  return next && next.startsWith('/') && !next.startsWith('//') ? `?next=${encodeURIComponent(next)}` : '';
};
const callback = () => `${window.location.origin}/auth/callback${nextQuery()}`;

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(configured);
  const [error, setError] = useState('');
  const [authEvent, setAuthEvent] = useState('');
  const user = session?.user || null;
  useEffect(() => {
    if (!supabase) return;
    let active = true;
    supabase.auth.getSession().then(({ data, error: cause }) => {
      if (!active) return;
      if (cause) setError('Не удалось восстановить сессию. Попробуйте войти снова.');
      setSession(data.session); setLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, next) => {
      if (!active) return;
      setAuthEvent(event); setSession(next); setLoading(false);
      if (!next) setProfile(null);
    });
    return () => { active = false; subscription.unsubscribe(); };
  }, []);
  const refreshProfile = useCallback(async () => {
    if (!user) return;
    const { data, error: cause } = await requireClient().from('profiles').select('id,name,public_id,avatar_url').eq('id', user.id).single();
    if (cause) { setError('Не удалось загрузить профиль. Проверьте сеть и миграции.'); throw cause; }
    const next = { id: data.id, name: data.name, publicId: data.public_id, avatarUrl: data.avatar_url };
    setProfile(next); setError(''); return next;
  }, [user?.id]);
  useEffect(() => {
    if (!user) { setProfile(null); return; }
    let active = true;
    requireClient().from('profiles').select('id,name,public_id,avatar_url').eq('id', user.id).single().then(({ data, error: cause }) => {
      if (!active) return;
      if (cause) setError('Не удалось загрузить профиль. Проверьте сеть и миграции.');
      else { setProfile({ id: data.id, name: data.name, publicId: data.public_id, avatarUrl: data.avatar_url }); setError(''); }
    });
    return () => { active = false; };
  }, [user?.id]);
  const checked = async result => { const value = await result; if (value.error) throw new Error(value.error.message); return value.data; };
  const value = {
    user, profile, session, loading, configured, error, authEvent, refreshProfile,
    signUp: async ({ email, password, name }) => {
      const data = await checked(requireClient().auth.signUp({ email, password, options: { emailRedirectTo: callback(), data: { name: name.trim() } } }));
      return { needsConfirmation: !data.session };
    },
    signIn: ({ email, password }) => checked(requireClient().auth.signInWithPassword({ email, password })),
    signOut: () => checked(requireClient().auth.signOut()),
    resetPassword: email => checked(requireClient().auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/auth/reset${nextQuery()}` })),
    updatePassword: password => checked(requireClient().auth.updateUser({ password })),
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export const useAuth = () => useContext(AuthContext);
