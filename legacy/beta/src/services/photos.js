const MAX_PHOTOS = 6;
const MAX_INPUT_BYTES = 2 * 1024 * 1024;
const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
function decodeImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`Не удалось прочитать фото «${file.name}».`)); };
    image.src = url;
  });
}
/** Validates and resizes browser uploads; returns locally storable image URLs. */
export async function processPhotos(files) {
  const selected = Array.from(files || []);
  if (selected.length > MAX_PHOTOS) throw new Error('Можно добавить не более 6 фотографий.');
  for (const file of selected) {
    if (!ACCEPTED_TYPES.has(file.type)) throw new Error('Поддерживаются фотографии JPG, PNG и WebP.');
    if (!file.size || file.size > MAX_INPUT_BYTES) throw new Error(`Фото «${file.name}» должно быть не больше 2 МБ.`);
  }
  const processed = [];
  // Sequential decoding limits peak memory on mobile devices.
  for (const file of selected) {
    const image = await decodeImage(file);
    if (!image.naturalWidth || !image.naturalHeight) throw new Error(`Не удалось прочитать фото «${file.name}».`);
    const scale = Math.min(1, 1000 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Этот браузер не поддерживает обработку фотографий.');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    let url = canvas.toDataURL('image/jpeg', 0.72);
    if (url.length > 600000) url = canvas.toDataURL('image/jpeg', 0.48);
    if (url.length > 900000) throw new Error(`Фото «${file.name}» слишком сложное для локального сохранения. Выберите другое.`);
    processed.push({ id: `photo-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`, name: file.name, url });
  }
  return processed;
}
