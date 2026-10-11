import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { getMeetings } from '../services/storage.js';
import { CheckCircle2, CircleAlert, X } from 'lucide-react';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [meetings, setMeetings] = useState([]);
  const [notice, setNotice] = useState(null);
  const [storageError, setStorageError] = useState('');
  const timeout = useRef();
  const toast = useCallback((message, type = 'success') => {
    clearTimeout(timeout.current);
    setNotice({ message, type, id: Date.now() });
    timeout.current = setTimeout(() => setNotice(null), type === 'error' ? 6500 : 4500);
  }, []);
  const refresh = useCallback(() => {
    try { setMeetings(getMeetings()); setStorageError(''); }
    catch (error) { setStorageError(error.message); toast(error.message, 'error'); }
  }, [toast]);
  useEffect(() => {
    refresh();
    window.addEventListener('storage', refresh);
    return () => { window.removeEventListener('storage', refresh); clearTimeout(timeout.current); };
  }, [refresh]);
  const mutate = useCallback((action, successMessage) => {
    try {
      const result = action(); refresh();
      if (successMessage) toast(successMessage);
      return result;
    } catch (error) { toast(error.message || 'Не удалось сохранить изменения.', 'error'); return null; }
  }, [refresh, toast]);
  return <AppContext.Provider value={{ meetings, refresh, mutate, toast }}>
    {storageError && <div className="storage-error" role="alert">{storageError} Проверьте разрешение браузера на сохранение данных.</div>}
    {children}
    {notice && <div className={`toast ${notice.type}`} role={notice.type === 'error' ? 'alert' : 'status'}>
      {notice.type === 'error' ? <CircleAlert size={20} /> : <CheckCircle2 size={20} />}
      <span>{notice.message}</span><button className="icon-button" onClick={() => setNotice(null)} aria-label="Закрыть уведомление"><X size={18} /></button>
    </div>}
  </AppContext.Provider>;
}
export function useApp() { return useContext(AppContext); }
