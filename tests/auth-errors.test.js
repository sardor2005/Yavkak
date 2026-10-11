import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toAuthError } from '../src/services/authErrors.js';

test('Auth email quota reports a temporary delivery limit and preserves provider diagnostics', () => {
  const cause = { code: 'over_email_send_rate_limit', status: 429, message: 'email rate limit exceeded' };
  const error = toAuthError(cause);
  assert.match(error.message, /лимит отправки писем/);
  assert.match(error.message, /уже подтверждена/);
  assert.equal(error.code, cause.code);
  assert.equal(error.status, 429);
  assert.equal(error.cause, cause);
});

test('an unauthorized SMTP recipient is distinct from a full account quota', () => {
  const error = toAuthError({ code: 'email_address_not_authorized', status: 400, message: 'Email address not authorized' });
  assert.match(error.message, /не может доставить письмо на этот адрес/);
  assert.match(error.message, /владельцу сайта/);
  assert.equal(error.code, 'email_address_not_authorized');
  assert.equal(error.status, 400);
});

test('a general request rate limit does not claim that email delivery is exhausted', () => {
  const error = toAuthError({ code: 'over_request_rate_limit', status: 429, message: 'Request rate limit reached' });
  assert.match(error.message, /Слишком много попыток/);
  assert.doesNotMatch(error.message, /писем/);
  assert.equal(error.code, 'over_request_rate_limit');
  assert.equal(error.status, 429);
});

test('older Auth responses retain email-quota guidance without inventing a provider code', () => {
  const error = toAuthError({ status: 429, message: 'Email rate limit exceeded' });
  assert.match(error.message, /лимит отправки писем/);
  assert.equal(error.code, undefined);
  assert.equal(error.status, 429);
});

test('unrelated Auth failures retain their original message and diagnostic fields', () => {
  const cause = { code: 'invalid_credentials', status: 400, message: 'Invalid login credentials' };
  const error = toAuthError(cause);
  assert.equal(error.message, cause.message);
  assert.equal(error.code, cause.code);
  assert.equal(error.status, cause.status);
  assert.equal(error.cause, cause);
});
