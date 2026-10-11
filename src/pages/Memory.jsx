import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, CalendarDays, Check, ImagePlus, MapPin, ShieldCheck, Sparkles, Trash2, X } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { deletePhoto, getMeeting, listPhotos, releasePhotos, saveMemory, uploadPhotos } from '../services/api.js';
import '../meeting.css';
import { useDialogFocus } from '../utils/useDialogFocus.js';

export default function Memory() {
  const { id } = useParams();
  const { user } = useAuth();
  const { meetings, mutate, syncVersion } = useApp();
  const [meeting, setMeeting] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  useDialogFocus(!!deleteTarget);
  const [note, setNote] = useState('');
  const [noteDirty, setNoteDirty] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const fileInput = useRef(null);
  const photoValues = useRef([]);

  const replacePhotos = useCallback((values) => {
    releasePhotos(photoValues.current); photoValues.current = values; setPhotos(values);
  }, []);

  const refreshPhotos = useCallback(async () => {
    try { replacePhotos(await listPhotos(id)); setError(''); }
    catch (cause) { setError(cause.message || 'Не удалось загрузить фотографии.'); }
  }, [id, replacePhotos]);
  useEffect(() => {
    let live = true;
    const load = async () => { const value = await getMeeting(id); return [value, value ? await listPhotos(id) : []]; };
    load().then(([value, values]) => { if (live) { setMeeting(value); replacePhotos(values); setError(''); } else releasePhotos(values); }).catch((cause) => { if (live) { setMeeting(null); replacePhotos([]); setError(cause.message || 'Не удалось загрузить воспоминание.'); } }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [id, meetings, syncVersion, replacePhotos]);
  useEffect(() => { setLoading(true); setMeeting(null); replacePhotos([]); setDeleteTarget(null); setNote(''); setNoteDirty(false); }, [id, replacePhotos]);
  useEffect(() => { if (!noteDirty) setNote(meeting?.memoryNote || ''); }, [meeting?.memoryNote, noteDirty]);
  useEffect(() => () => { releasePhotos(photoValues.current); photoValues.current = []; }, []);
  useEffect(() => {
    if (!deleteTarget) return;
    const escape = (event) => { if (event.key === 'Escape' && !deleting) setDeleteTarget(null); };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [deleteTarget, deleting]);

  async function addPhotos(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length || uploading) return;
    setUploading(true);
    setError('');
    try {
      const result = await mutate(async () => {
        try { return await uploadPhotos(id, files); }
        catch (cause) { setError(cause.message || 'Не удалось сохранить фотографии. Попробуйте другой файл.'); throw cause; }
      }, 'Фотографии сохранены для вашей компании');
      if (Array.isArray(result)) replacePhotos(result);
      else if (result !== null) await refreshPhotos();
    } finally { setUploading(false); }
  }
  async function removePhoto() {
    if (!deleteTarget || deleting) return;
    setDeleting(deleteTarget.id);
    try {
      const result = await mutate(() => deletePhoto(deleteTarget), 'Фотография удалена');
      if (result !== null) { setDeleteTarget(null); await refreshPhotos(); }
    } finally { setDeleting(''); }
  }
  async function saveNote(event) {
    event.preventDefault();
    if (savingNote) return;
    setSavingNote(true);
    try {
      const result = await mutate(() => saveMemory(id, note.trim()), 'Заметка о встрече сохранена');
      if (result !== null) { const value = await getMeeting(id); setMeeting(value); setNoteDirty(false); }
    } finally { setSavingNote(false); }
  }

  if (!meeting) return <div className="memory-page"><Link className="back-link" to="/"><ArrowLeft size={17} />Мои встречи</Link><div className="card empty-state"><Sparkles size={36} /><h1>{loading ? 'Открываем фотографии…' : 'Воспоминание недоступно'}</h1><p>{loading ? 'Загружаем моменты вашей компании.' : error || 'Фотографии могут видеть только участники встречи.'}</p>{!loading && <Link to="/" className="button primary">Мои встречи</Link>}</div></div>;
  const active = meeting.participants?.find((participant) => (participant.userId || participant.id) === user?.id);
  const canUpload = meeting.status !== 'cancelled' && (meeting.organizerId === user?.id || active?.invitationStatus === 'accepted');
  const completed = meeting.status === 'completed';
  const organizer = meeting.organizerId === user?.id;
  const date = new Date(meeting.startsAt).toLocaleString('ru-RU', { timeZone: meeting.timeZone, day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

  return <div className="memory-page">
    <Link className="back-link" to={`/meetings/${id}`}><ArrowLeft size={17} />К встрече</Link>
    <div className="memory-heading"><span className="memory-sparkle"><Sparkles size={32} /></span><p className="eyebrow">ЕЩЁ ОДИН ХОРОШИЙ ДЕНЬ</p><h1>{completed ? <>Встреча состоялась <span>🎉</span></> : 'Наши моменты'}</h1><p>Сохраните маленькую историю большой компании.</p></div>
    <section className="card memory-card"><div className="memory-meeting-info"><div><h2>{meeting.title}</h2><div><span><CalendarDays size={15} />{date} · {meeting.timeZone}</span><span><MapPin size={15} />{meeting.placeName}</span></div></div><span className={`badge ${completed ? 'green' : 'blue'}`}><Check size={13} />{completed ? 'Завершена' : meeting.status === 'cancelled' ? 'Отменена' : 'Запланирована'}</span></div>
      <div className="memory-section-title"><h3>Фотографии компании</h3><span>{photos.length} фото</span></div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {photos.length > 0 && <div className="memory-upload-gallery">{photos.map((photo, index) => <div key={photo.id} className="memory-photo"><a href={photo.url} target="_blank" rel="noopener noreferrer" aria-label={`Открыть фотографию ${index + 1}`}><img src={photo.url} alt={`Фотография встречи ${index + 1}`} loading="lazy" /></a>{photo.authorId === user?.id && <button type="button" className="memory-remove-photo" aria-label={`Удалить свою фотографию ${index + 1}`} disabled={uploading || !!deleting} onClick={() => setDeleteTarget(photo)}><Trash2 size={16} /></button>}</div>)}</div>}
      {!photos.length && !canUpload && <div className="mp-memory-empty"><Sparkles size={32} /><p>Здесь пока нет фотографий.</p></div>}
      {canUpload && <><input ref={fileInput} className="mp-visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={addPhotos} disabled={uploading || !!deleting} aria-label="Добавить фотографии" /><button type="button" className={`memory-dropzone ${photos.length ? 'compact' : ''}`} onClick={() => fileInput.current?.click()} disabled={uploading || !!deleting}><span><ImagePlus size={25} /></span><strong>{uploading ? 'Сжимаем и сохраняем фотографии…' : photos.length ? 'Добавить ещё фото' : 'Добавить фотографии'}</strong><small>{uploading ? 'Это займёт несколько секунд' : 'JPEG, PNG или WebP · до 2 МБ · до 6 фото за загрузку'}</small></button></>}
      <p className="memory-optional">Любой участник может добавить фотографии и удалить свои. Просматривать их может только компания этой встречи.</p>{completed && organizer && <form onSubmit={saveNote}><label className="field memory-note-label" htmlFor="memory-note">Пара слов на память<textarea id="memory-note" rows={4} maxLength={1000} placeholder="Как всё прошло? Что хочется запомнить?" value={note} onChange={(event) => { setNote(event.target.value); setNoteDirty(true); }} disabled={savingNote} /></label><div className="memory-note-counter">{note.length} / 1000</div><div className="mp-edit-actions"><button type="submit" className="button secondary" disabled={savingNote || !noteDirty}><Sparkles size={17} />{savingNote ? 'Сохраняем…' : 'Сохранить заметку'}</button></div></form>}{completed && !organizer && meeting.memoryNote && <p className="mp-memory-note">{meeting.memoryNote}</p>}<div className="memory-save-footer"><span><ShieldCheck size={13} />Фотографии сохраняются сразу в приватной галерее.</span><Link className="button primary" to={`/meetings/${id}`}><Sparkles size={17} />К нашей встрече</Link></div>
    </section><Link className="memory-history-link" to="/history">Посмотреть историю встреч<ArrowRight size={16} /></Link>
    {deleteTarget && <div className="modal-backdrop" onClick={() => { if (!deleting) setDeleteTarget(null); }}><section className="modal card" role="dialog" aria-modal="true" aria-labelledby="delete-photo-title" onClick={(event) => event.stopPropagation()}><button type="button" className="icon-button modal-close" disabled={!!deleting} onClick={() => setDeleteTarget(null)} aria-label="Закрыть"><X size={20} /></button><h2 id="delete-photo-title">Удалить вашу фотографию?</h2><p className="muted">Она исчезнет из галереи встречи для всех участников.</p><div className="modal-actions"><button type="button" className="button secondary" autoFocus disabled={!!deleting} onClick={() => setDeleteTarget(null)}>Оставить</button><button type="button" className="button primary" disabled={!!deleting} onClick={removePhoto}>{deleting ? 'Удаляем…' : 'Удалить фотографию'}</button></div></section></div>}
  </div>;
}
