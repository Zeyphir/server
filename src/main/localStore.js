import path from 'node:path';
import { openSqliteDatabase } from '../shared/sqlite.js';

let db;

const DEFAULT_EPHEMERAL_POLICY = '7d';
const POLICY_MS = {
  '24h': 24 * 60 * 60 * 1000,
  '3d': 3 * 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '14d': 14 * 24 * 60 * 60 * 1000,
  never: null
};

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function serialize(value) {
  return JSON.stringify(value ?? null);
}

export async function openLocalStore(userDataPath) {
  db = await openSqliteDatabase(path.join(userDataPath, 'secure-messenger.sqlite'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS local_users (
      id TEXT PRIMARY KEY,
      unique_id TEXT NOT NULL,
      email TEXT NOT NULL,
      friend_code TEXT NOT NULL,
      public_key TEXT NOT NULL,
      private_key TEXT NOT NULL,
      pseudo TEXT NOT NULL,
      avatar TEXT,
      bio TEXT,
      status TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS profiles (
      user_id TEXT PRIMARY KEY,
      unique_id TEXT,
      friend_code TEXT,
      public_key TEXT,
      pseudo TEXT,
      avatar TEXT,
      bio TEXT,
      status TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK(type IN ('private', 'group')),
      title TEXT,
      participant_ids TEXT NOT NULL,
      ephemeral_policy TEXT NOT NULL DEFAULT '${DEFAULT_EPHEMERAL_POLICY}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      sender_id TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'text',
      encrypted_payload TEXT,
      content_json TEXT,
      reply_to TEXT,
      read_at TEXT,
      expires_at TEXT,
      edited_at TEXT,
      deleted_at TEXT,
      reactions_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL
    );
  `);

  setSetting('defaultEphemeralPolicy', getSetting('defaultEphemeralPolicy') || DEFAULT_EPHEMERAL_POLICY);
  return true;
}

function requireDb() {
  if (!db) throw new Error('SQLite local non initialisé.');
  return db;
}

export function getSetting(key) {
  const row = requireDb().prepare('SELECT value_json FROM settings WHERE key = ?').get(key);
  return parseJson(row?.value_json, null);
}

export function setSetting(key, value) {
  requireDb()
    .prepare('INSERT INTO settings (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json')
    .run(key, serialize(value));
  return { key, value };
}

export function getBootstrap() {
  cleanupExpiredMessages();
  const user = requireDb().prepare('SELECT * FROM local_users ORDER BY created_at DESC LIMIT 1').get();
  return {
    user: mapLocalUser(user),
    profiles: listProfiles(),
    conversations: listConversations(),
    settings: Object.fromEntries(
      requireDb()
        .prepare('SELECT key, value_json FROM settings')
        .all()
        .map((row) => [row.key, parseJson(row.value_json, null)])
    )
  };
}

export function saveLocalUser(profile) {
  const now = new Date().toISOString();
  requireDb()
    .prepare(
      `INSERT INTO local_users
       (id, unique_id, email, friend_code, public_key, private_key, pseudo, avatar, bio, status, created_at, updated_at)
       VALUES (@id, @uniqueId, @email, @friendCode, @publicKey, @privateKey, @pseudo, @avatar, @bio, @status, @createdAt, @updatedAt)
       ON CONFLICT(id) DO UPDATE SET
         unique_id = excluded.unique_id,
         email = excluded.email,
         friend_code = excluded.friend_code,
         public_key = excluded.public_key,
         private_key = excluded.private_key,
         pseudo = excluded.pseudo,
         avatar = excluded.avatar,
         bio = excluded.bio,
         status = excluded.status,
         updated_at = excluded.updated_at`
    )
    .run({
      ...profile,
      avatar: profile.avatar || null,
      bio: profile.bio || '',
      status: profile.status || 'Disponible',
      createdAt: profile.createdAt || now,
      updatedAt: now
    });

  upsertProfile({
    userId: profile.id,
    uniqueId: profile.uniqueId,
    friendCode: profile.friendCode,
    publicKey: profile.publicKey,
    pseudo: profile.pseudo,
    avatar: profile.avatar,
    bio: profile.bio,
    status: profile.status
  });

  return mapLocalUser(requireDb().prepare('SELECT * FROM local_users WHERE id = ?').get(profile.id));
}

export function upsertProfile(profile) {
  const now = new Date().toISOString();
  requireDb()
    .prepare(
      `INSERT INTO profiles
       (user_id, unique_id, friend_code, public_key, pseudo, avatar, bio, status, updated_at)
       VALUES (@userId, @uniqueId, @friendCode, @publicKey, @pseudo, @avatar, @bio, @status, @updatedAt)
       ON CONFLICT(user_id) DO UPDATE SET
         unique_id = excluded.unique_id,
         friend_code = excluded.friend_code,
         public_key = excluded.public_key,
         pseudo = COALESCE(excluded.pseudo, profiles.pseudo),
         avatar = COALESCE(excluded.avatar, profiles.avatar),
         bio = COALESCE(excluded.bio, profiles.bio),
         status = COALESCE(excluded.status, profiles.status),
         updated_at = excluded.updated_at`
    )
    .run({
      userId: profile.userId,
      uniqueId: profile.uniqueId || null,
      friendCode: profile.friendCode || null,
      publicKey: profile.publicKey || null,
      pseudo: profile.pseudo || null,
      avatar: profile.avatar || null,
      bio: profile.bio || null,
      status: profile.status || null,
      updatedAt: now
    });
  return profile;
}

export function listProfiles() {
  return requireDb()
    .prepare('SELECT * FROM profiles ORDER BY COALESCE(pseudo, unique_id, user_id)')
    .all()
    .map(mapProfile);
}

export function saveConversation(conversation) {
  const database = requireDb();
  const existing = database.prepare('SELECT id FROM conversations WHERE id = ?').get(conversation.id);
  if (!existing) {
    const count = database.prepare('SELECT COUNT(*) AS total FROM conversations').get().total;
    if (count >= 10) {
      throw new Error('Limite atteinte: maximum 10 conversations privées et groupes.');
    }
  }

  const now = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO conversations
       (id, type, title, participant_ids, ephemeral_policy, created_at, updated_at)
       VALUES (@id, @type, @title, @participantIds, @ephemeralPolicy, @createdAt, @updatedAt)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title,
         participant_ids = excluded.participant_ids,
         ephemeral_policy = excluded.ephemeral_policy,
         updated_at = excluded.updated_at`
    )
    .run({
      id: conversation.id,
      type: conversation.type,
      title: conversation.title || null,
      participantIds: serialize(conversation.participantIds || []),
      ephemeralPolicy: conversation.ephemeralPolicy || getSetting('defaultEphemeralPolicy') || DEFAULT_EPHEMERAL_POLICY,
      createdAt: conversation.createdAt || now,
      updatedAt: now
    });

  return getConversation(conversation.id);
}

export function listConversations() {
  return requireDb()
    .prepare('SELECT * FROM conversations ORDER BY updated_at DESC')
    .all()
    .map(mapConversation);
}

export function getConversation(id) {
  return mapConversation(requireDb().prepare('SELECT * FROM conversations WHERE id = ?').get(id));
}

export function saveMessage(message) {
  const conversation = getConversation(message.conversationId);
  const now = new Date().toISOString();
  const readAt = message.readAt || (message.senderId === message.localUserId ? now : null);
  const expiresAt = message.expiresAt || getExpiresAt(readAt, conversation?.ephemeralPolicy);

  requireDb()
    .prepare(
      `INSERT INTO messages
       (id, conversation_id, sender_id, kind, encrypted_payload, content_json, reply_to, read_at, expires_at, edited_at, deleted_at, reactions_json, created_at)
       VALUES (@id, @conversationId, @senderId, @kind, @encryptedPayload, @contentJson, @replyTo, @readAt, @expiresAt, @editedAt, @deletedAt, @reactionsJson, @createdAt)
       ON CONFLICT(id) DO UPDATE SET
         encrypted_payload = excluded.encrypted_payload,
         content_json = excluded.content_json,
         read_at = COALESCE(messages.read_at, excluded.read_at),
         expires_at = COALESCE(messages.expires_at, excluded.expires_at),
         edited_at = excluded.edited_at,
         deleted_at = excluded.deleted_at,
         reactions_json = excluded.reactions_json`
    )
    .run({
      id: message.id,
      conversationId: message.conversationId,
      senderId: message.senderId,
      kind: message.kind || 'text',
      encryptedPayload: message.encryptedPayload || null,
      contentJson: serialize(message.content || {}),
      replyTo: message.replyTo || null,
      readAt,
      expiresAt,
      editedAt: message.editedAt || null,
      deletedAt: message.deletedAt || null,
      reactionsJson: serialize(message.reactions || {}),
      createdAt: message.createdAt || now
    });

  requireDb().prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(now, message.conversationId);
  return getMessages(message.conversationId);
}

export function getMessages(conversationId) {
  cleanupExpiredMessages();
  return requireDb()
    .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC')
    .all(conversationId)
    .map(mapMessage);
}

export function updateMessage(messageId, patch) {
  const current = requireDb().prepare('SELECT * FROM messages WHERE id = ?').get(messageId);
  if (!current) return null;

  requireDb()
    .prepare('UPDATE messages SET content_json = ?, encrypted_payload = ?, edited_at = ? WHERE id = ?')
    .run(
      serialize(patch.content || parseJson(current.content_json, {})),
      patch.encryptedPayload || current.encrypted_payload,
      new Date().toISOString(),
      messageId
    );
  return mapMessage(requireDb().prepare('SELECT * FROM messages WHERE id = ?').get(messageId));
}

export function deleteMessage(messageId) {
  requireDb().prepare('UPDATE messages SET deleted_at = ? WHERE id = ?').run(new Date().toISOString(), messageId);
  return { id: messageId, deleted: true };
}

export function reactToMessage(messageId, userId, emoji) {
  const row = requireDb().prepare('SELECT reactions_json FROM messages WHERE id = ?').get(messageId);
  const reactions = parseJson(row?.reactions_json, {});
  reactions[emoji] = Array.from(new Set([...(reactions[emoji] || []), userId]));
  requireDb().prepare('UPDATE messages SET reactions_json = ? WHERE id = ?').run(serialize(reactions), messageId);
  return reactions;
}

export function markConversationRead(conversationId) {
  const readAt = new Date().toISOString();
  const conversation = getConversation(conversationId);
  const expiresAt = getExpiresAt(readAt, conversation?.ephemeralPolicy);
  requireDb()
    .prepare('UPDATE messages SET read_at = COALESCE(read_at, ?), expires_at = COALESCE(expires_at, ?) WHERE conversation_id = ?')
    .run(readAt, expiresAt, conversationId);
  return getMessages(conversationId);
}

export function cleanupExpiredMessages() {
  const now = new Date().toISOString();
  requireDb().prepare('DELETE FROM messages WHERE expires_at IS NOT NULL AND expires_at <= ?').run(now);
  return true;
}

function getExpiresAt(readAt, policy = DEFAULT_EPHEMERAL_POLICY) {
  if (!readAt) return null;
  const duration = POLICY_MS[policy || DEFAULT_EPHEMERAL_POLICY];
  if (!duration) return null;
  return new Date(new Date(readAt).getTime() + duration).toISOString();
}

function mapLocalUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    uniqueId: row.unique_id,
    email: row.email,
    friendCode: row.friend_code,
    publicKey: row.public_key,
    privateKey: row.private_key,
    pseudo: row.pseudo,
    avatar: row.avatar,
    bio: row.bio,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapProfile(row) {
  if (!row) return null;
  return {
    userId: row.user_id,
    uniqueId: row.unique_id,
    friendCode: row.friend_code,
    publicKey: row.public_key,
    pseudo: row.pseudo,
    avatar: row.avatar,
    bio: row.bio,
    status: row.status,
    updatedAt: row.updated_at
  };
}

function mapConversation(row) {
  if (!row) return null;
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    participantIds: parseJson(row.participant_ids, []),
    ephemeralPolicy: row.ephemeral_policy,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messages: getMessagesUnsafe(row.id)
  };
}

function getMessagesUnsafe(conversationId) {
  return requireDb()
    .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC')
    .all(conversationId)
    .map(mapMessage);
}

function mapMessage(row) {
  if (!row) return null;
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    kind: row.kind,
    encryptedPayload: row.encrypted_payload,
    content: parseJson(row.content_json, {}),
    replyTo: row.reply_to,
    readAt: row.read_at,
    expiresAt: row.expires_at,
    editedAt: row.edited_at,
    deletedAt: row.deleted_at,
    reactions: parseJson(row.reactions_json, {}),
    createdAt: row.created_at
  };
}