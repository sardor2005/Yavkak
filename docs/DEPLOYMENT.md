# Настройка Supabase и Vercel: действия владельца

Здесь описаны действия для существующего приложения из `sardor2005/Yavka`. Облачный Supabase-проект ещё не предоставлен; применение миграций в cloud, доставка email и production deployment не объявляются выполненными. Результаты текущих локальных проверок: [TESTING.md](TESTING.md).

## 1. GitHub: получите изменения без замены проекта

1. Откройте существующий репозиторий `sardor2005/Yavka`.
2. Проверьте ветку `feature/yavka-mvp-backend`, изменения и итоговые проверки PR. Исходный frontend и логотип сохраняются; прежняя браузерная beta архивирована в `legacy/beta/`.
3. Не используйте пустой `Yavka-2.0` как замену существующего приложения.
4. Убедитесь, что в Git не попали реальные `.env`, пароли, административные ключи, фото пользователей и резервные копии.
5. Merge выполняет владелец после проверки. Этот документ не означает, что PR уже опубликован или объединён.

## 2. Создайте Supabase Free

1. В Supabase нажмите **New project**, выберите организацию и тариф **Free**. Не включайте платные дополнения.
2. Придумайте сильный пароль базы; сохраните его в менеджере паролей. Не вставляйте пароль в чат, Git или frontend.
3. Дождитесь готовности проекта. Найдите **Project URL** и публичный **publishable key** в настройках API/ключей.
4. Для разработки и разрушительных проверок используйте отдельный тестовый проект либо локальный Supabase. Реальные пользовательские данные не нужны для тестов.

Клиенту нужны только URL и publishable key. `service_role`, secret key, пароль базы и административные токены используются только в защищённых административных инструментах.

## 3. Примените миграции по порядку

В **SQL Editor** тестового проекта выполните файлы последовательно:

1. `supabase/migrations/202610110001_schema.sql` — сущности, constraints, индексы, базовые RLS/grants и создание профиля.
2. `supabase/migrations/202610110002_functions.sql` — доверенные операции и серверные проверки.
3. `supabase/migrations/202610110003_storage_realtime.sql` — приватный Storage и необходимые публикации Realtime.

Дождитесь успешного результата каждого файла. При ошибке прочитайте её и исправьте причину; не отключайте RLS и не удаляйте пользовательские таблицы ради повторного запуска. Это начальные миграции нового backend, а не средство автоматического переноса данных уже существующей Supabase-базы.

Альтернатива для установленного Supabase CLI, из корня репозитория:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

`YOUR_PROJECT_REF` — ID вашего проекта. Авторизация CLI происходит на вашем устройстве; реальные токены вводите в предусмотренном CLI/панели процессе, а не в документы. Локальная тестовая среда запускается через `supabase start`; `supabase db reset` переустанавливает **локальную** тестовую базу и уничтожает её локальные данные. Не используйте удалённый reset с реальными данными.

После миграций проверьте положительные и отрицательные сценарии RLS под обычными пользовательскими сессиями. Успех SQL Editor, который имеет административные права, сам по себе не доказывает безопасность клиентского доступа.

## 4. Проверьте приватный Storage

Миграция создаёт bucket **`meeting-photos`**. В **Storage** убедитесь, что:

- bucket приватный, переключатель **Public** выключен;
- разрешены JPEG, PNG и WebP; лимит одного файла — **2 МиБ**;
- на одну встречу допускается не более **6 фотографий**;
- политики проверяют участие во встрече и авторство при удалении;
- клиент использует разрешённые object paths и авторизованную загрузку с временными Blob URL, а не постоянные публичные ссылки.

Лимит количества обеспечивает серверная операция резервирования фотографии, а не только кнопка интерфейса. Загрузка в Storage и завершение записи metadata должны пройти согласованную проверку. Не создавайте второй публичный bucket вместо применения политик. Аватар профиля в текущей реализации задаётся HTTPS URL; отдельный avatar bucket не требуется.

На `storage.objects` установлен trigger проверки окончательной записи: Storage может выполнять её внутренним администратором, поэтому одна RLS-проверка предварительного запроса недостаточна. Trigger учитывает протокол локального Storage v1.35.3; после обновления управляемого Storage повторите тесты обычной загрузки, MIME/размера, отмены и восстановления. Резервные копии восстанавливаются после соответствующих записей `meeting_photos` и по исходным paths/MIME/размерам.

## 5. Настройте Auth и письма

1. В **Authentication → Providers** включите **Email / Password**.
2. Включите подтверждение email. Для production не включайте anonymous sign-ins вместо настоящих аккаунтов.
3. В **Authentication → URL Configuration** укажите **Site URL**:

   ```text
   https://yavka-rosy.vercel.app
   ```

4. Добавьте точные redirect URL:

   ```text
   https://yavka-rosy.vercel.app/auth/callback
   https://yavka-rosy.vercel.app/auth/reset
   ```

5. Для разработки добавьте только используемые локальные адреса, например:

   ```text
   http://localhost:5173/auth/callback**
   http://localhost:5173/auth/reset**
   http://127.0.0.1:5173/auth/callback**
   http://127.0.0.1:5173/auth/reset**
   ```

6. Для проверки Vercel Preview отдельно добавьте следующие шаблоны на **конкретном URL preview deployment**, заменив `YOUR-PREVIEW.vercel.app` его точным hostname:

   ```text
   https://YOUR-PREVIEW.vercel.app/auth/callback**
   https://YOUR-PREVIEW.vercel.app/auth/reset**
   ```

   Приложение добавляет параметр возврата `?next=...`; Supabase сопоставляет redirect URL вместе с параметрами запроса, поэтому для Preview нужен суффикс `**`. Hostname должен оставаться точным: не разрешайте все домены `vercel.app`.
7. Зарегистрируйте два независимых пользователя и проверьте получение/переход по письмам подтверждения и восстановления пароля.

Встроенная отправка Supabase имеет ограничения адресатов и скорости. Проверьте актуальные ограничения и Auth Logs до публичного запуска. Если штатный отправитель не доставляет письма обычным пользователям, настройте собственный SMTP, доступный бесплатно для вашего использования, либо зафиксируйте блокер доставки. Не отключайте подтверждение email и не объявляйте создание локального аккаунта проверкой реальной доставки.

`supabase/config.toml` относится к локальной разработке: подтверждение email включено, anonymous sign-ins выключены. Локальные письма можно проверять в Mailpit на `http://127.0.0.1:54324`; это не доказывает доставку на реальные почтовые адреса. Настройки cloud-проекта задаются отдельно.

## 6. Локальный frontend

Требуется Node.js 22.12+; текущая работа выполнялась на Node.js 24. Установите зависимости по lockfile:

```bash
npm ci
cp .env.example .env.local
```

В `.env.local` укажите значения своего **тестового** проекта:

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLIC_PUBLISHABLE_KEY
```

Имена выбраны для фактического Vite-сборщика. `.env.local` не добавляется в Git. Publishable key является публичным; доступ защищается RLS, а не секретностью этого ключа. Не подставляйте вместо него `service_role`/secret key.

```bash
npm run dev
npm run check
```

Откройте `http://localhost:5173`. После изменения `.env.local` перезапустите Vite. Без конфигурации приложение должно сообщать о необходимости настроить backend; это не режим с демонстрационными пользователями.

## 7. Существующий Vercel Hobby

1. Откройте **существующий** Vercel-проект сайта `yavka-rosy.vercel.app`; проверьте в **Settings → Git**, что подключён `sardor2005/Yavka` и правильная production branch. Новый проект и новый домен не требуются.
2. Проверьте root directory: каталог приложения с `package.json`. Framework — Vite, build command — `npm run build`, output directory — `dist`, Node.js — 22.x или 24.x (минимум 22.12).
3. Добавьте `VITE_SUPABASE_URL` и `VITE_SUPABASE_PUBLISHABLE_KEY` в **Settings → Environment Variables** для нужного окружения. Для preview удобно использовать тестовый Supabase, для production — отдельный production проект.
4. Подготовьте preview ветки и проверьте `/auth/callback`, `/auth/reset`, `/meetings/<id>` и `/join/<token>` при прямом открытии/обновлении. SPA fallback должен возвращать `index.html` для страниц приложения.
5. Запустите весь сценарий из [TESTING.md](TESTING.md) на двух устройствах и проверьте запреты для третьего аккаунта.
6. После проверки владелец может выполнить merge и production deployment. Автоматический merge и публикация production в рамках этой работы не выполняются.

После изменения переменных требуется новое развёртывание: Vite получает их во время сборки. Проверка имён переменных в панели не подтверждает подключение к Supabase. Не переводите проект на платный тариф и не включайте автоматические расходы ради этой настройки.

## 8. Бесплатные лимиты и доступность

Supabase Free может приостанавливать неактивный проект. В панели проверяйте актуальные лимиты базы, Storage, Realtime, трафика и Auth-писем. История загружается страницами, фото сжимаются, подписки ограничиваются разрешёнными встречами и удаляются при выходе. Если Realtime недоступен, должны работать обычные запросы загрузки данных.

## 9. Ручная резервная копия базы и фото

Объекты Storage не входят в SQL dump. Храните backup вне публичного репозитория; он может содержать личные данные и данные Auth. Сделайте отдельную копию базы и объектов, затем проверьте восстановление в отдельной тестовой среде.

Для установленного совместимого PostgreSQL-клиента укажите connection string из панели **Connect** в защищённой переменной `SUPABASE_DB_URL` на своём устройстве. Не выводите её значение. Пример полного архивного дампа:

```bash
umask 077
mkdir -p backup
pg_dump --dbname "$SUPABASE_DB_URL" --format=custom --no-owner --no-acl --file backup/database.dump
pg_restore --list backup/database.dump > backup/database-contents.txt
```

Убедитесь, что дамп включает необходимые `public`, `private`, `auth` и metadata `storage`. Доступность управляемых схем зависит от прав соединения; ошибка или исключённая схема означает неполную копию. Экспорт только прикладных таблиц не переносит аккаунты. При переносе между Supabase-проектами используйте поддерживаемый провайдером порядок восстановления Auth/Storage и согласуйте UUID аккаунтов с профилями.

Чтобы скачать файлы bucket, можно использовать установленный SDK в **административном терминале**, вне браузера. Защищённые переменные `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` не должны иметь префикс `VITE_`. Пример из корня проекта:

```bash
node --input-type=module <<'NODE'
import { createClient } from '@supabase/supabase-js';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const bucket = client.storage.from('meeting-photos');
let count = 0;
async function exportPrefix(prefix = '') {
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await bucket.list(prefix, { limit: 100, offset, sortBy: { column: 'name', order: 'asc' } });
    if (error) throw error;
    for (const item of data) {
      const objectPath = prefix ? `${prefix}/${item.name}` : item.name;
      if (!item.id) { await exportPrefix(objectPath); continue; }
      const { data: blob, error: downloadError } = await bucket.download(objectPath);
      if (downloadError) throw downloadError;
      const target = path.join('backup', 'meeting-photos', objectPath);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, Buffer.from(await blob.arrayBuffer()));
      count += 1;
    }
    if (data.length < 100) break;
  }
}
await exportPrefix();
console.log(`Экспортировано фотографий: ${count}`);
NODE
```

Во время экспорта исключите конкурирующие изменения фотографий либо повторно сверяйте список metadata и файлов. При восстановлении сначала подготовьте тестовый проект и политику bucket, затем восстановите согласованные записи/аккаунты и загрузите объекты **по тем же object paths**. Проверьте число объектов, доступ участника, запрет постороннему и авторское удаление. Это примеры административного backup; они не запускались на пользовательском cloud-проекте и не объявляются проверенным восстановлением.
