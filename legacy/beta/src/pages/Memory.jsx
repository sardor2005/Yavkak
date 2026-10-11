import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, CalendarDays, Check, ImagePlus, MapPin, Sparkles, Trash2 } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import { getActiveParticipantId, saveMemory } from '../services/storage.js';
import { processPhotos } from '../services/photos.js';
import '../meeting.css';

export default function Memory() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { meetings, mutate, toast } = useApp();
  const meeting = meetings.find((item) => item.id === id);
  const activeId = getActiveParticipantId(id);
  const active = meeting?.participants.find((participant) => participant.id === activeId);
  const organizer = !!active && (active.id === meeting?.organizer.id || active.role === 'organizer');
  const [photos, setPhotos] = useState(meeting?.photos || []);
  const [note, setNote] = useState(meeting?.memoryNote || '');
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef(null);
  useEffect(() => { setPhotos(meeting?.photos || []); setNote(meeting?.memoryNote || ''); }, [id, meeting?.id]);

  if (!meeting) return <div className="memory-page"><div className="card empty-state"><Sparkles size={36} /><h1>Встреча не найдена</h1><p>Откройте встречу из списка или по полной ссылке приглашения.</p><Link to="/" className="button primary">Мои встречи</Link></div></div>;
  if (meeting.status !== 'completed' || !organizer) return <div className="memory-page"><div className="card empty-state"><Sparkles size={36} /><h1>{meeting.status !== 'completed' ? 'Встреча ещё впереди' : 'Воспоминание о встрече'}</h1><p>{meeting.status !== 'completed' ? 'Завершите встречу, чтобы сохранить фотографии и заметку.' : 'Фотографии и заметку добавляет организатор встречи.'}</p><Link to={`/meetings/${id}`} className="button primary">К встрече <ArrowRight size={17} /></Link></div></div>;

  async function addPhotos(event) {
    const files = Array.from(event.target.files || []); event.target.value = '';
    if (!files.length) return;
    const remaining = 6 - photos.length;
    if (remaining <= 0) { toast('Можно сохранить до 6 фотографий.', 'error'); return; }
    setUploading(true);
    try {
      const processed = await processPhotos(files.slice(0, remaining));
      setPhotos((current) => [...current, ...processed].slice(0, 6));
      toast(files.length > remaining ? `Добавлено ${processed.length} фото. Максимум — 6 фотографий.` : 'Фотографии готовы к сохранению');
    } catch (error) { toast(error.message || 'Не удалось обработать фотографии. Попробуйте другой файл.', 'error'); }
    finally { setUploading(false); }
  }

  function save(event) {
    event.preventDefault();
    const result = mutate(() => saveMemory(id, active.id, { photos, memoryNote: note.trim() }), 'Воспоминание сохранено. До следующей встречи!');
    if (result) navigate(`/meetings/${id}`);
  }

  const date = meeting.confirmedTime?.date ? new Date(`${meeting.confirmedTime.date}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) : '';
  return <div className="memory-page"><Link className="back-link" to={`/meetings/${id}`}><ArrowLeft size={17} /> К встрече</Link><div className="memory-heading"><span className="memory-sparkle"><Sparkles size={32} /></span><p className="eyebrow">ЕЩЁ ОДИН ХОРОШИЙ ДЕНЬ</p><h1>Встреча состоялась <span>🎉</span></h1><p>Сохраните маленькую историю большой компании.</p></div><form onSubmit={save} className="card memory-card"><div className="memory-meeting-info"><div><h2>{meeting.title}</h2><div><span><CalendarDays size={15} />{date}{meeting.confirmedTime?.time && ` · ${meeting.confirmedTime.time}`}</span><span><MapPin size={15} />{meeting.confirmedPlace?.name}</span></div></div><span className="badge green"><Check size={13} /> Завершена</span></div><div className="memory-section-title"><h3>Ваши фотографии</h3><span>{photos.length} / 6</span></div><input ref={fileInput} className="mp-visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={addPhotos} disabled={uploading} aria-label="Добавить фотографии" />{photos.length > 0 && <div className="memory-upload-gallery">{photos.map((photo, index) => <div key={photo.id} className="memory-photo"><img src={photo.url} alt={`Фотография встречи ${index + 1}`} /><button type="button" className="memory-remove-photo" aria-label={`Удалить фотографию ${index + 1}`} onClick={() => setPhotos((current) => current.filter((item) => item.id !== photo.id))}><Trash2 size={16} /></button></div>)}</div>}{photos.length < 6 && <button type="button" className={`memory-dropzone ${photos.length ? 'compact' : ''}`} onClick={() => fileInput.current?.click()} disabled={uploading}><span><ImagePlus size={25} /></span><strong>{uploading ? 'Подготавливаем фотографии…' : photos.length ? 'Добавить ещё фото' : 'Добавить фотографии'}</strong><small>{uploading ? 'Это займёт всего несколько секунд' : 'JPEG, PNG или WebP · до 2 МБ · до 6 фото'}</small></button>}<p className="memory-optional">Фотографии необязательны — можно сохранить только заметку.</p><label className="field memory-note-label" htmlFor="memory-note">Пара слов на память<textarea id="memory-note" rows={4} maxLength={1000} placeholder="Как всё прошло? Что хочется запомнить?" value={note} onChange={(event) => setNote(event.target.value)} /></label><div className="memory-note-counter">{note.length} / 1000</div><div className="memory-save-footer"><span>Воспоминание останется в этом браузере.</span><button type="submit" className="button primary" disabled={uploading}><Sparkles size={17} /> Сохранить воспоминание</button></div></form><Link className="memory-history-link" to="/history">Посмотреть историю встреч <ArrowRight size={16} /></Link></div>;
}
