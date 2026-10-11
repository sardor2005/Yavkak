const emailLimitMessage = 'Временно исчерпан лимит отправки писем. Повторите попытку позже. Если почта уже подтверждена, войдите в свой аккаунт.';

const messages = {
  over_email_send_rate_limit: emailLimitMessage,
  email_address_not_authorized: 'Сервис отправки пока не может доставить письмо на этот адрес. Обратитесь к владельцу сайта для настройки отправки подтверждений.',
  over_request_rate_limit: 'Слишком много попыток. Подождите и повторите действие.',
};

export function toAuthError(cause) {
  const message = (Object.hasOwn(messages, cause?.code) ? messages[cause.code] : '')
    || (/email rate limit exceeded/i.test(cause?.message || '') ? emailLimitMessage : '')
    || (cause?.status === 429 ? messages.over_request_rate_limit : '')
    || cause?.message
    || 'Не удалось выполнить запрос. Попробуйте ещё раз.';
  const error = new Error(message, { cause });
  if (cause?.code) error.code = cause.code;
  if (typeof cause?.status === 'number') error.status = cause.status;
  return error;
}
