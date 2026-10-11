import assert from 'node:assert/strict'
import { test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const apiUrl = process.env.SUPABASE_TEST_URL
const publicKey = process.env.SUPABASE_TEST_ANON_KEY
const serviceKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY
const mailUrl = process.env.SUPABASE_TEST_MAILPIT_URL || 'http://127.0.0.1:54324'
if (!apiUrl || !publicKey || !serviceKey) {
  throw new Error('Run node scripts/run-integration.mjs against a running local Supabase stack.')
}
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(apiUrl).hostname)) {
  throw new Error('Integration fixtures must run against a local Supabase stack.')
}
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(mailUrl).hostname)) {
  throw new Error('Delivered-email tests may read only the local Mailpit mailbox.')
}
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
const client = () => createClient(apiUrl, publicKey, options)
const admin = createClient(apiUrl, serviceKey, options)
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
const ok = result => {
  assert.equal(result.error, null, result.error?.message)
  return result.data
}
const rejected = result => assert.ok(result.error, 'The unauthorized or invalid operation must fail')
const rpc = async (connection, name, parameters) => ok(await connection.rpc(name, parameters))

async function deliveredMessages() {
  const response = await fetch(`${mailUrl}/api/v1/messages`)
  assert.ok(response.ok, 'Local Mailpit must be available')
  return (await response.json()).messages || []
}

async function deliveredToken(email, type, excludedIds = new Set()) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const messages = (await deliveredMessages())
      .filter(item => !excludedIds.has(item.ID) && item.To?.some(recipient => recipient.Address === email))
      .sort((a, b) => Date.parse(b.Created) - Date.parse(a.Created))
    for (const message of messages) {
      const detailResponse = await fetch(`${mailUrl}/api/v1/message/${message.ID}`)
      assert.ok(detailResponse.ok)
      const detail = await detailResponse.json()
      const body = `${detail.Text || ''}\n${detail.HTML || ''}`.replaceAll('&amp;', '&')
      const links = body.match(/https?:\/\/[^\s"<>]+\/auth\/v1\/verify\?[^\s"<>]+/g) || []
      for (const link of links) {
        const url = new URL(link)
        if (url.searchParams.get('type') !== type) continue
        assert.ok(url.searchParams.get('token'), 'The delivered verification link must contain its token hash')
        return url.searchParams.get('token')
      }
    }
    await pause(150)
  }
  throw new Error(`Local Auth did not deliver a ${type} email within 30 seconds`)
}

test('real Auth, PostgREST, Storage and Realtime across three separate users', { timeout: 240_000 }, async t => {
  const actors = []
  const uploadedPaths = []
  t.after(async () => {
    if (uploadedPaths.length) ok(await admin.storage.from('meeting-photos').remove(uploadedPaths))
    for (const actor of actors) ok(await admin.auth.admin.deleteUser(actor.id))
    await Promise.all(actors.map(actor => actor.connection.removeAllChannels()))
  })
  const runId = randomUUID().slice(0, 8)
  await t.test('registration requires and delivers confirmation; independent sessions create persistent profiles', async () => {
    for (const label of ['Alice', 'Bob', 'Eve']) {
      const connection = client()
      const email = `yavka-${label.toLowerCase()}-${runId}@example.com`
      const password = `Integration-${randomUUID()}-1a!`
      const registration = ok(await connection.auth.signUp({ email, password, options: { data: { name: label } } }))
      assert.equal(registration.session, null, 'Unconfirmed registration must not grant a session')
      assert.ok(registration.user?.id)
      actors.push({ connection, id: registration.user.id, email, password })
      const tokenHash = await deliveredToken(email, 'signup')
      const verification = ok(await connection.auth.verifyOtp({ token_hash: tokenHash, type: 'signup' }))
      assert.equal(verification.user.id, registration.user.id)
      assert.ok(verification.session?.access_token)
      const profile = ok(await connection.from('profiles').select('id,name,public_id').eq('id', registration.user.id).single())
      assert.equal(profile.name, label)
      assert.match(profile.public_id, /^yavka-[a-f0-9]{16}$/)
      actors.at(-1).publicId = profile.public_id
      const resumed = client()
      const login = ok(await resumed.auth.signInWithPassword({ email, password }))
      assert.equal(login.user.id, registration.user.id, 'A new client must restore the same server identity')
      ok(await resumed.auth.signOut({ scope: 'local' }))
    }
    assert.equal(new Set(actors.map(actor => actor.id)).size, 3)
    assert.equal(new Set(actors.map(actor => actor.publicId)).size, 3)
  })
  const [alice, bob, eve] = actors
  let meeting
  let linkMeeting
  let photo

  await t.test('password recovery delivers a new email and restores access with the changed password', async () => {
    const previousMessages = new Set((await deliveredMessages()).map(message => message.ID))
    const recoveryConnection = client()
    ok(await recoveryConnection.auth.resetPasswordForEmail(bob.email, {
      redirectTo: 'http://127.0.0.1:5173/auth/reset',
    }))
    const recoveryToken = await deliveredToken(bob.email, 'recovery', previousMessages)
    const recovered = ok(await recoveryConnection.auth.verifyOtp({ token_hash: recoveryToken, type: 'recovery' }))
    assert.equal(recovered.user.id, bob.id)
    assert.ok(recovered.session?.access_token, 'A delivered recovery token must create an authenticated recovery session')
    const oldPassword = bob.password
    const nextPassword = `Recovered-${randomUUID()}-1a!`
    const changed = ok(await recoveryConnection.auth.updateUser({ password: nextPassword }))
    assert.equal(changed.user.id, bob.id)
    ok(await recoveryConnection.auth.signOut({ scope: 'local' }))
    rejected(await client().auth.signInWithPassword({ email: bob.email, password: oldPassword }))
    const nextConnection = client()
    const signedIn = ok(await nextConnection.auth.signInWithPassword({ email: bob.email, password: nextPassword }))
    assert.equal(signedIn.user.id, bob.id)
    const profile = ok(await nextConnection.from('profiles').select('id,public_id').eq('id', bob.id).single())
    assert.equal(profile.public_id, bob.publicId, 'Recovery must preserve the original account and server profile')
    bob.connection = nextConnection
    bob.password = nextPassword
  })

  await t.test('friend requests require recipient acceptance and prevent duplicates and impersonation', async () => {
    rejected(await alice.connection.rpc('request_friend', { p_user_id: alice.id }))
    const request = await rpc(alice.connection, 'request_friend', { p_user_id: bob.id })
    const duplicate = await rpc(alice.connection, 'request_friend', { p_user_id: bob.id })
    assert.equal(duplicate.id, request.id)
    assert.equal(ok(await alice.connection.from('friend_requests').select('*')).length, 1)
    rejected(await eve.connection.rpc('respond_friend_request', { p_request_id: request.id, p_accept: true }))
    await rpc(bob.connection, 'respond_friend_request', { p_request_id: request.id, p_accept: true })
    const friendships = ok(await bob.connection.from('friendships').select('*'))
    assert.equal(friendships.length, 1)
    assert.equal(ok(await eve.connection.from('friendships').select('*')).length, 0)
    const search = await rpc(bob.connection, 'search_profiles', { p_query: alice.publicId })
    assert.equal(search[0].id, alice.id)
    assert.equal(search[0].email, undefined, 'Profile directory must not expose email')
  })

  await t.test('UTC meeting creation is private until invitation acceptance; nonowners cannot edit it', async () => {
    const p_input = {
      title: `Integration ${runId}`,
      description: 'Private cross-user meeting',
      place_name: 'Тестовое кафе',
      place_address: 'Ташкент',
      starts_at: new Date(Date.now() + 3_600_000).toISOString(),
      time_zone: 'Asia/Tashkent',
    }
    rejected(await alice.connection.rpc('create_meeting', { p_input: { ...p_input, starts_at: '2030-01-01T10:00:00' } }))
    rejected(await alice.connection.rpc('create_meeting', { p_input: { ...p_input, time_zone: 'Invalid/Zone' } }))
    meeting = await rpc(alice.connection, 'create_meeting', { p_input })
    assert.equal(meeting.status, 'scheduled')
    assert.equal(meeting.organizer_id, alice.id)
    assert.equal(ok(await eve.connection.from('meetings').select('*').eq('id', meeting.id)).length, 0)
    rejected(await client().from('meetings').select('*').eq('id', meeting.id))
    const invitation = await rpc(alice.connection, 'create_invite', { p_meeting_id: meeting.id, p_invitee_id: bob.id })
    rejected(await eve.connection.rpc('respond_invitation', { p_invitation_id: invitation.id, p_accept: true }))
    await rpc(bob.connection, 'respond_invitation', { p_invitation_id: invitation.id, p_accept: true })
    assert.equal(ok(await bob.connection.from('meetings').select('*').eq('id', meeting.id)).length, 1)
    rejected(await bob.connection.rpc('update_meeting', { p_meeting_id: meeting.id, p_input: { title: 'Impersonated' } }))
    rejected(await eve.connection.rpc('set_arrival', { p_meeting_id: meeting.id, p_status: 'arrived' }))
    rejected(await bob.connection.from('meetings').update({ organizer_id: bob.id }).eq('id', meeting.id))
  })

  await t.test('link invitations hide verifiers, reject revoked and expired tokens and allow a real join', async () => {
    linkMeeting = await rpc(alice.connection, 'create_meeting', { p_input: {
      title: 'Token validation', place_name: 'Кафе', place_address: '', description: '',
      starts_at: new Date(Date.now() + 7_200_000).toISOString(), time_zone: 'Asia/Tashkent',
    } })
    const revoked = await rpc(alice.connection, 'create_invite', { p_meeting_id: linkMeeting.id })
    assert.ok(revoked.token?.length >= 32)
    await rpc(alice.connection, 'revoke_invite', { p_invitation_id: revoked.id })
    rejected(await eve.connection.rpc('join_invite', { p_token: revoked.token, p_accept: true }))
    const expired = await rpc(alice.connection, 'create_invite', { p_meeting_id: linkMeeting.id })
    ok(await admin.from('meeting_invitations').update({
      created_at: new Date(Date.now() - 600_000).toISOString(),
      expires_at: new Date(Date.now() - 60_000).toISOString(),
    }).eq('id', expired.id))
    rejected(await eve.connection.rpc('join_invite', { p_token: expired.token, p_accept: true }))
    rejected(await eve.connection.rpc('join_invite', { p_token: 'x'.repeat(64), p_accept: true }))
    const active = await rpc(alice.connection, 'create_invite', { p_meeting_id: linkMeeting.id })
    const publicRows = ok(await alice.connection.from('meeting_invitations').select('*').eq('meeting_id', linkMeeting.id))
    assert.ok(publicRows.every(row => !('token_hash' in row) && !('token' in row)))
    await rpc(eve.connection, 'join_invite', { p_token: active.token, p_accept: true })
    assert.equal(ok(await eve.connection.from('meetings').select('*').eq('id', linkMeeting.id)).length, 1)
    assert.equal(ok(await eve.connection.from('meetings').select('*').eq('id', meeting.id)).length, 0)
  })

  await t.test('arrival statuses are restricted to the actor and direct attendance writes are denied', async () => {
    await rpc(bob.connection, 'set_arrival', { p_meeting_id: meeting.id, p_status: 'on_way' })
    const participant = ok(await alice.connection.from('meeting_participants').select('*').eq('meeting_id', meeting.id).eq('user_id', bob.id).single())
    assert.equal(participant.arrival_status, 'on_way')
    assert.equal(participant.arrived_at, null)
    rejected(await bob.connection.from('meeting_participants').update({ user_id: alice.id, arrival_status: 'arrived' }).eq('meeting_id', meeting.id))
    rejected(await bob.connection.rpc('set_arrival', { p_meeting_id: meeting.id, p_status: 'no_show' }))
    await rpc(alice.connection, 'set_arrival', { p_meeting_id: meeting.id, p_status: 'arrived' })
    const arrived = ok(await bob.connection.from('meeting_participants').select('*').eq('meeting_id', meeting.id).eq('user_id', alice.id).single())
    assert.ok(arrived.arrived_at)
    assert.ok(Date.parse(arrived.arrived_at) <= Date.now())
    rejected(await bob.connection.rpc('complete_meeting', { p_meeting_id: meeting.id }))
    rejected(await alice.connection.rpc('complete_meeting', { p_meeting_id: meeting.id }))
  })

  await t.test('chat validation and Realtime deliver a member message without outsider access', async () => {
    rejected(await alice.connection.rpc('send_message', { p_meeting_id: meeting.id, p_body: '   ' }))
    rejected(await eve.connection.rpc('send_message', { p_meeting_id: meeting.id, p_body: 'Unauthorized' }))
    const body = `<img src=x onerror=alert(1)> ${runId}`
    let resolveEvent
    let rejectEvent
    const eventPromise = new Promise((resolve, reject) => { resolveEvent = resolve; rejectEvent = reject })
    eventPromise.catch(() => {})
    let resolveReady
    let rejectReady
    const readyPromise = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject })
    readyPromise.catch(() => {})
    let readinessError = false
    const readyTimeout = setTimeout(() => rejectReady(new Error(readinessError
      ? 'Realtime Postgres Changes reported a subscription error and did not become ready'
      : 'Realtime Postgres Changes did not confirm its subscription')), 20_000)
    let deliveryTimeout
    const channel = bob.connection.channel(`integration-${runId}`, {
      config: { postgres_changes_options: { wait: true, timeout: 15_000 } },
    })
      // Realtime v2.73.2 joins the channel before registering PostgreSQL changes.
      // It ignores the newer wait option, but emits this supported system event.
      // A message sent before it can legitimately be absent from the WAL stream.
      .on('system', {}, payload => {
        if (payload.extension !== 'postgres_changes') return
        if (payload.status === 'ok') { clearTimeout(readyTimeout); resolveReady() }
        if (payload.status === 'error') readinessError = true
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `meeting_id=eq.${meeting.id}` }, payload => {
        if (payload.new.body === body) resolveEvent(payload.new)
      })
    try {
      await new Promise((resolve, reject) => channel.subscribe(status => {
        if (status === 'SUBSCRIBED') resolve()
        if (['TIMED_OUT', 'CHANNEL_ERROR', 'CLOSED'].includes(status)) {
          const failure = new Error(`Realtime subscription: ${status}`)
          reject(failure); rejectReady(failure)
        }
      }))
      await readyPromise
      deliveryTimeout = setTimeout(() => rejectEvent(new Error('Realtime did not deliver the member message')), 20_000)
      const message = await rpc(alice.connection, 'send_message', { p_meeting_id: meeting.id, p_body: body })
      const event = await eventPromise
      assert.equal(event.id, message.id)
      assert.equal(event.author_id, alice.id)
      assert.equal(ok(await eve.connection.from('chat_messages').select('*').eq('meeting_id', meeting.id)).length, 0)
      rejected(await alice.connection.from('chat_messages').insert({ meeting_id: meeting.id, author_id: bob.id, body: 'Impersonated' }))
    } finally {
      clearTimeout(readyTimeout)
      clearTimeout(deliveryTimeout)
      await bob.connection.removeChannel(channel)
    }
  })

  await t.test('private Storage allows a member upload and signed URL while denying outsiders and foreign paths', async () => {
    const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ2kAAAAASUVORK5CYII=', 'base64')
    rejected(await eve.connection.rpc('reserve_photo', { p_meeting_id: meeting.id, p_name: 'x.png', p_mime: 'image/png', p_size: bytes.length }))
    rejected(await alice.connection.rpc('reserve_photo', { p_meeting_id: meeting.id, p_name: 'x.svg', p_mime: 'image/svg+xml', p_size: bytes.length }))
    rejected(await alice.connection.rpc('reserve_photo', { p_meeting_id: meeting.id, p_name: 'too-big.png', p_mime: 'image/png', p_size: 2_097_153 }))
    photo = await rpc(alice.connection, 'reserve_photo', { p_meeting_id: meeting.id, p_name: 'pixel.png', p_mime: 'image/png', p_size: bytes.length })
    rejected(await bob.connection.storage.from('meeting-photos').upload(photo.path, bytes, { contentType: 'image/png' }))
    ok(await alice.connection.storage.from('meeting-photos').upload(photo.path, bytes, { contentType: 'image/png' }))
    uploadedPaths.push(photo.path)
    await rpc(alice.connection, 'finish_photo', { p_photo_id: photo.id })
    const foreignMetadataDeletion = ok(await bob.connection.from('meeting_photos').delete().eq('id', photo.id).select('id'))
    assert.deepEqual(foreignMetadataDeletion, [], 'A participant cannot delete another author photo metadata')
    const foreignObjectDeletion = ok(await bob.connection.storage.from('meeting-photos').remove([photo.path]))
    assert.deepEqual(foreignObjectDeletion, [], 'Storage deletion filters out another author object')
    assert.equal(ok(await alice.connection.from('meeting_photos').select('id').eq('id', photo.id).single()).id, photo.id)
    const signed = ok(await bob.connection.storage.from('meeting-photos').createSignedUrl(photo.path, 60))
    const response = await fetch(signed.signedUrl)
    assert.ok(response.ok)
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes)
    rejected(await eve.connection.storage.from('meeting-photos').createSignedUrl(photo.path, 60))
    rejected(await client().storage.from('meeting-photos').download(photo.path))
    for (let index = 0; index < 5; index++) {
      const reserved = await rpc(alice.connection, 'reserve_photo', { p_meeting_id: meeting.id, p_name: `reserved-${index}.png`, p_mime: 'image/png', p_size: bytes.length })
      rejected(await alice.connection.rpc('finish_photo', { p_photo_id: reserved.id }))
    }
    rejected(await alice.connection.rpc('reserve_photo', { p_meeting_id: meeting.id, p_name: 'seventh.png', p_mime: 'image/png', p_size: bytes.length }))
  })

  await t.test('completion creates server rating facts once; direct and nonowner rating changes fail', async () => {
    // Only the local fixture administrator advances meeting time; user RPCs cannot backdate attendance.
    ok(await admin.from('meetings').update({ starts_at: new Date(Date.now() - 60_000).toISOString() }).eq('id', meeting.id))
    await rpc(alice.connection, 'complete_meeting', { p_meeting_id: meeting.id })
    const ratings = ok(await alice.connection.from('rating_events').select('*').eq('meeting_id', meeting.id))
    assert.equal(ratings.length, 2)
    const bobRating = ratings.find(row => row.user_id === bob.id)
    assert.equal(bobRating.outcome, 'no_show')
    assert.equal(bobRating.points, -5)
    const aliceRating = ratings.find(row => row.user_id === alice.id)
    const aliceOnTime = Date.parse(aliceRating.arrived_at) <= Date.parse(aliceRating.starts_at)
    assert.equal(aliceRating.outcome, aliceOnTime ? 'on_time' : 'late')
    assert.equal(aliceRating.points, aliceOnTime ? 10 : 0, 'Points must derive from server timestamps, not client input')
    const beforeReversal = await rpc(bob.connection, 'rating_summary')
    assert.deepEqual(beforeReversal, { total_score: -5, meeting_count: 1, on_time: 0, late: 0, no_show: 1 })
    assert.ok(ratings.every(row => row.confirmation === 'manual_unverified'))
    rejected(await bob.connection.from('rating_events').update({ points: 10 }).eq('meeting_id', meeting.id))
    rejected(await bob.connection.rpc('reverse_rating', { p_meeting_id: meeting.id, p_user_id: bob.id }))
    await rpc(alice.connection, 'complete_meeting', { p_meeting_id: meeting.id })
    assert.equal(ok(await alice.connection.from('rating_events').select('*').eq('meeting_id', meeting.id)).length, 2)
    await rpc(alice.connection, 'reverse_rating', { p_meeting_id: meeting.id, p_user_id: bob.id })
    const reversed = ok(await bob.connection.from('rating_events').select('*').eq('meeting_id', meeting.id).eq('user_id', bob.id).single())
    assert.ok(reversed.revoked_at)
    const afterReversal = await rpc(bob.connection, 'rating_summary')
    assert.deepEqual(afterReversal, { total_score: 0, meeting_count: 0, on_time: 0, late: 0, no_show: 0 })
    rejected(await bob.connection.rpc('set_arrival', { p_meeting_id: meeting.id, p_status: 'arrived' }))
    rejected(await bob.connection.rpc('save_memory', { p_meeting_id: meeting.id, p_note: 'Impersonated memory' }))
    const memory = await rpc(alice.connection, 'save_memory', { p_meeting_id: meeting.id, p_note: 'Confirmed integration memory' })
    assert.equal(memory.memory_note, 'Confirmed integration memory')
    assert.equal(ok(await bob.connection.from('meetings').select('memory_note').eq('id', meeting.id).single()).memory_note, memory.memory_note)
  })

  await t.test('removal revokes prior participant reads and only owners can cancel meetings', async () => {
    rejected(await eve.connection.rpc('cancel_meeting', { p_meeting_id: linkMeeting.id }))
    await rpc(alice.connection, 'remove_participant', { p_meeting_id: linkMeeting.id, p_user_id: eve.id })
    assert.equal(ok(await eve.connection.from('meetings').select('*').eq('id', linkMeeting.id)).length, 0)
    await rpc(alice.connection, 'cancel_meeting', { p_meeting_id: linkMeeting.id })
    const cancelled = ok(await alice.connection.from('meetings').select('*').eq('id', linkMeeting.id).single())
    assert.equal(cancelled.status, 'cancelled')
    assert.equal(cancelled.completed_at, null)
    await rpc(bob.connection, 'remove_friend', { p_user_id: alice.id })
    assert.equal(ok(await alice.connection.from('friendships').select('*')).length, 0)
  })
})
