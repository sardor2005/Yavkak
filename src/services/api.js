import { requireClient } from './supabase.js';
import { processPhotos } from './photos.js';

const meetingSelection = '*,organizer:profiles!organizer_id(id,name,public_id,avatar_url),meeting_participants(*,profile:profiles!user_id(id,name,public_id,avatar_url))';
const profileSelection = 'id,name,public_id,avatar_url';
const publicProfile = row => row && ({ id: row.id, name: row.name, publicId: row.public_id, avatarUrl: row.avatar_url });

async function result(query) {
  const { data, error } = await query;
  if (error) {
    if (/fetch|network|connection/i.test(error.message)) {
      const failure = new Error('Нет соединения с сервером. Проверьте сеть и повторите действие.');
      failure.code = 'NETWORK_ERROR';
      throw failure;
    }
    throw new Error(error.message || 'Не удалось выполнить запрос.');
  }
  return data;
}
const rpc = (name, args) => result(requireClient().rpc(name, args));
const userId = async () => { const { user } = await result(requireClient().auth.getUser()); if (!user) throw new Error('Войдите в аккаунт.'); return user.id; };
function scalarId(value) { return typeof value === 'string' ? value : value?.meeting_id || value?.id || value?.[0]?.meeting_id; }

export function normalizeMeeting(row) {
  return {
    id: row.id, title: row.title, description: row.description, placeName: row.place_name, placeAddress: row.place_address,
    startsAt: row.starts_at, timeZone: row.time_zone, status: row.status, organizerId: row.organizer_id,
    organizer: publicProfile(row.organizer), createdAt: row.created_at, updatedAt: row.updated_at, completedAt: row.completed_at, memoryNote: row.memory_note || '',
    participants: (row.meeting_participants || []).map(person => ({
      id: person.user_id, userId: person.user_id, name: person.profile?.name || 'Участник', avatarUrl: person.profile?.avatar_url,
      publicId: person.profile?.public_id, role: person.user_id === row.organizer_id ? 'organizer' : 'guest',
      invitationStatus: person.invitation_status, arrivalStatus: person.arrival_status, arrivedAt: person.arrived_at,
    })), photos: [],
  };
}
export async function listMeetings(cursor = null) {
  let query = requireClient().from('meetings').select(meetingSelection).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(21);
  if (cursor) query = query.or(`created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`);
  const rows = await result(query);
  const selected = rows.slice(0, 20);
  const last = selected.at(-1);
  return { meetings: selected.map(normalizeMeeting), hasMore: rows.length > 20, cursor: last ? { createdAt: last.created_at, id: last.id } : null };
}
export async function getMeeting(id) {
  const row = await result(requireClient().from('meetings').select(meetingSelection).eq('id', id).maybeSingle());
  return row ? normalizeMeeting(row) : null;
}
function meetingInput(input) {
  return { title: input.title, description: input.description || '', place_name: input.placeName, place_address: input.placeAddress || '', starts_at: input.startsAt, time_zone: input.timeZone };
}
export async function createMeeting(input) {
  const value = await rpc('create_meeting', { p_input: meetingInput(input) });
  const id = scalarId(value);
  return id ? getMeeting(id) : normalizeMeeting(value);
}
export async function updateMeeting(id, input) { await rpc('update_meeting', { p_meeting_id: id, p_input: meetingInput(input) }); return getMeeting(id); }
export const completeMeeting = id => rpc('complete_meeting', { p_meeting_id: id });
export const cancelMeeting = id => rpc('cancel_meeting', { p_meeting_id: id });
export const removeParticipant = (id, user) => rpc('remove_participant', { p_meeting_id: id, p_user_id: user });
export const respondAttendance = (id, response) => rpc('respond_attendance', { p_meeting_id: id, p_response: response });
export const setArrival = (id, status) => rpc('set_arrival', { p_meeting_id: id, p_status: status });
export const reverseRating = (id, user) => rpc('reverse_rating', { p_meeting_id: id, p_user_id: user });
export const saveMemory = (id, note) => rpc('save_memory', { p_meeting_id: id, p_note: note });

export async function searchProfiles(query) { return (await rpc('search_profiles', { p_query: query.trim() })).map(publicProfile); }
export async function listFriends() {
  const id = await userId();
  const rows = await result(requireClient().from('friendships').select(`*,a:profiles!user_a(${profileSelection}),b:profiles!user_b(${profileSelection})`).or(`user_a.eq.${id},user_b.eq.${id}`));
  return rows.map(row => publicProfile(row.user_a === id ? row.b : row.a));
}
export const requestFriend = id => rpc('request_friend', { p_user_id: id });
export const respondFriendRequest = (id, accept) => rpc('respond_friend_request', { p_request_id: id, p_accept: accept });
export const removeFriend = id => rpc('remove_friend', { p_user_id: id });
export async function listFriendRequests() {
  const rows = await result(requireClient().from('friend_requests').select(`*,sender:profiles!sender_id(${profileSelection}),receiver:profiles!receiver_id(${profileSelection})`).eq('status', 'pending').order('created_at', { ascending: false }).limit(100));
  return rows.map(row => ({ id: row.id, senderId: row.sender_id, receiverId: row.receiver_id, status: row.status, sender: publicProfile(row.sender), receiver: publicProfile(row.receiver) }));
}
export async function updateProfile(input) {
  const id = await userId();
  return publicProfile(await result(requireClient().from('profiles').update({ name: input.name.trim(), avatar_url: input.avatarUrl || null }).eq('id', id).select(profileSelection).single()));
}
const invitation = row => ({ id: row.id, meetingId: row.meeting_id, inviterId: row.inviter_id, inviter: publicProfile(row.inviter), inviteeId: row.invitee_id, invitee: publicProfile(row.invitee), status: row.status, expiresAt: row.expires_at });
const invitationSelect = `*,inviter:profiles!inviter_id(${profileSelection}),invitee:profiles!invitee_id(${profileSelection})`;
export async function listInvitations() {
  const id = await userId();
  return (await result(requireClient().from('meeting_invitations').select(invitationSelect).eq('invitee_id', id).eq('status', 'pending').order('created_at', { ascending: false }).limit(100))).map(invitation);
}
export async function listMeetingInvitations(id) { return (await result(requireClient().from('meeting_invitations').select(invitationSelect).eq('meeting_id', id).order('created_at', { ascending: false }).limit(100))).map(invitation); }
export async function createInvitation(id, { inviteeId = null, hours = 72 } = {}) {
  const raw = await rpc('create_invite', { p_meeting_id: id, p_invitee_id: inviteeId, p_hours: hours });
  const row = Array.isArray(raw) ? raw[0] : raw;
  return { id: row.id, token: row.token, expiresAt: row.expires_at, url: row.token ? `${window.location.origin}/join/${row.token}` : null };
}
export async function respondInvitation(id, accept) { return scalarId(await rpc('respond_invitation', { p_invitation_id: id, p_accept: accept })); }
export async function acceptToken(token, accept = true) { return scalarId(await rpc('join_invite', { p_token: token, p_accept: accept })); }
export const revokeInvitation = id => rpc('revoke_invite', { p_invitation_id: id });

export async function getRating(cursor = null) {
  const id = await userId();
  let query = requireClient().from('rating_events').select('*,meeting:meetings!meeting_id(title)').eq('user_id', id).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(51);
  if (cursor) query = query.or(`created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`);
  const [summary, rows] = await Promise.all([rpc('rating_summary'), result(query)]);
  const selected = rows.slice(0, 50); const last = selected.at(-1);
  return {
    totalScore: summary.total_score, meetingCount: summary.meeting_count, onTime: summary.on_time, late: summary.late, noShow: summary.no_show,
    events: selected.map(row => ({ id: row.id, meetingId: row.meeting_id, meetingTitle: row.meeting?.title || 'Встреча', outcome: row.outcome, points: row.points, createdAt: row.created_at, revokedAt: row.revoked_at, manual: true })),
    hasMore: rows.length > 50, cursor: last ? { createdAt: last.created_at, id: last.id } : null,
  };
}
export async function listPhotos(id) {
  const rows = await result(requireClient().from('meeting_photos').select('*').eq('meeting_id', id).eq('ready', true).order('created_at'));
  const downloads = await Promise.allSettled(rows.map(async row => {
    const data = await result(requireClient().storage.from('meeting-photos').download(row.path));
    return { id: row.id, authorId: row.author_id, path: row.path, name: row.name, url: URL.createObjectURL(data), createdAt: row.created_at };
  }));
  const values = downloads.filter(item => item.status === 'fulfilled').map(item => item.value);
  const failed = downloads.find(item => item.status === 'rejected');
  if (failed) { releasePhotos(values); throw failed.reason; }
  return values;
}
export function releasePhotos(photos = []) { photos.forEach(photo => { if (photo.url?.startsWith('blob:')) URL.revokeObjectURL(photo.url); }); }
export async function uploadPhotos(id, files) {
  const processed = await processPhotos(files);
  for (const photo of processed) {
    const blob = await (await fetch(photo.url)).blob();
    const reservation = await rpc('reserve_photo', { p_meeting_id: id, p_name: photo.name, p_mime: 'image/jpeg', p_size: blob.size });
    const row = Array.isArray(reservation) ? reservation[0] : reservation;
    try {
      await result(requireClient().storage.from('meeting-photos').upload(row.path, blob, { contentType: 'image/jpeg', upsert: false }));
      await rpc('finish_photo', { p_photo_id: row.id });
    } catch (error) {
      const cleanup = await requireClient().storage.from('meeting-photos').remove([row.path]);
      if (!cleanup.error) await requireClient().from('meeting_photos').delete().eq('id', row.id);
      throw error;
    }
  }
  return listPhotos(id);
}
export async function deletePhoto(photo) {
  await result(requireClient().storage.from('meeting-photos').remove([photo.path]));
  await result(requireClient().from('meeting_photos').delete().eq('id', photo.id));
  return true;
}
export async function listMessages(id, before = null) {
  let query = requireClient().from('chat_messages').select(`*,author:profiles!author_id(${profileSelection})`).eq('meeting_id', id).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(51);
  if (before) query = query.or(`created_at.lt.${before.createdAt},and(created_at.eq.${before.createdAt},id.lt.${before.id})`);
  const rows = await result(query); const selected = rows.slice(0, 50); const last = selected.at(-1);
  return { messages: selected.reverse().map(row => ({ id: row.id, authorId: row.author_id, body: row.body, createdAt: row.created_at, author: publicProfile(row.author) })), hasMore: rows.length > 50, cursor: last ? { createdAt: last.created_at, id: last.id } : null };
}
export const sendMessage = (id, body) => rpc('send_message', { p_meeting_id: id, p_body: body.trim() });
export const deleteMessage = id => result(requireClient().from('chat_messages').delete().eq('id', id));
