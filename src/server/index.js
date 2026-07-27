import 'dotenv/config';
import bcrypt from 'bcryptjs';
import cors from 'cors';
import express from 'express';
import http from 'node:http';
import jwt from 'jsonwebtoken';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { customAlphabet, nanoid } from 'nanoid';
import { serverDb, publicUser } from './db.js';

const PORT = Number(process.env.PORT || 4141);
const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-change-me';

// En production, si CLIENT_ORIGIN n'est pas défini, on autorise toutes les origines (nécessaire pour le client Electron)
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || '*';

if (process.env.NODE_ENV === 'production' && JWT_SECRET === 'dev-only-change-me') {
  throw new Error(
    '[server] JWT_SECRET doit être défini via une variable d\'environnement en production (secret par défaut détecté).'
  );
}
const makeFriendCode = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 10);

const onlineUsers = new Map();
const userStatuses = new Map();

function signUser(user) {
  return jwt.sign({ sub: user.id, uniqueId: user.unique_id }, JWT_SECRET, { expiresIn: '14d' });
}

function authHttp(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Token manquant.' });

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    return next();
  } catch {
    return res.status(401).json({ error: 'Session invalide.' });
  }
}

function requireFields(body, fields) {
  return fields.filter((field) => !String(body[field] || '').trim());
}

function getUserById(id) {
  return serverDb.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function getOnlineState(userId) {
  const sockets = onlineUsers.get(userId);
  return Boolean(sockets && sockets.size);
}

function isFriend(userId, otherId) {
  if (userId === otherId) return false;
  return Boolean(
    serverDb.prepare('SELECT 1 FROM friends WHERE user_id = ? AND friend_id = ?').get(userId, otherId)
  );
}

function filterFriendRecipients(senderId, recipientIds) {
  return (recipientIds || []).filter((recipientId) => isFriend(senderId, recipientId));
}

function emitPresence(io, userId) {
  const friends = serverDb.prepare('SELECT friend_id FROM friends WHERE user_id = ?').all(userId);
  const payload = {
    userId,
    online: getOnlineState(userId),
    status: userStatuses.get(userId) || 'online'
  };

  for (const friend of friends) {
    io.to(`user:${friend.friend_id}`).emit('presence:update', payload);
  }
}

function createVerificationCode(userId) {
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = new Date(Date.now() + 1000 * 60 * 20).toISOString();

  serverDb
    .prepare('INSERT INTO verification_codes (user_id, code, expires_at) VALUES (?, ?, ?)')
    .run(userId, code, expiresAt);

  return { code, expiresAt };
}

function createApp() {
  const app = express();
  const server = http.createServer(app);

  // Configuration CORS souple pour accepter le client Electron
  const corsOptions = {
    origin: CLIENT_ORIGIN === '*' ? true : CLIENT_ORIGIN,
    credentials: true
  };

  const io = new Server(server, {
    cors: corsOptions,
    maxHttpBufferSize: 25 * 1024 * 1024
  });

  app.use(cors(corsOptions));
  app.use(express.json({ limit: '30mb' }));

  app.get('/health', (_req, res) => {
    res.json({ ok: true, timestamp: new Date().toISOString() });
  });

  app.post('/auth/register', async (req, res) => {
    const missing = requireFields(req.body, ['pseudo', 'uniqueId', 'email', 'password']);
    if (missing.length) return res.status(400).json({ error: `Champs manquants: ${missing.join(', ')}` });

    const uniqueId = String(req.body.uniqueId).trim().toLowerCase();
    const email = String(req.body.email).trim().toLowerCase();
    const existing = serverDb
      .prepare('SELECT id, email_verified FROM users WHERE unique_id = ? OR email = ?')
      .get(uniqueId, email);

    if (existing?.email_verified) {
      return res.status(409).json({ error: 'Identifiant ou email déjà utilisé.' });
    }

    const userId = existing?.id || nanoid(16);
    const passwordHash = await bcrypt.hash(String(req.body.password), 12);

    if (existing) {
      serverDb
        .prepare('UPDATE users SET password_hash = ? WHERE id = ?')
        .run(passwordHash, userId);
    } else {
      serverDb
        .prepare(
          `INSERT INTO users (id, unique_id, email, password_hash, created_at)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(userId, uniqueId, email, passwordHash, new Date().toISOString());
    }

    const verification = createVerificationCode(userId);
    console.log(`[auth] Code de verification email pour ${email}: ${verification.code}`);

    res.status(201).json({
      pendingVerification: true,
      email,
      expiresAt: verification.expiresAt,
      devVerificationCode: process.env.NODE_ENV === 'production' ? undefined : verification.code
    });
  });

  app.post('/auth/verify-email', (req, res) => {
    const missing = requireFields(req.body, ['email', 'code', 'publicKey']);
    if (missing.length) return res.status(400).json({ error: `Champs manquants: ${missing.join(', ')}` });

    const email = String(req.body.email).trim().toLowerCase();
    const user = serverDb.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user) return res.status(404).json({ error: 'Compte introuvable.' });

    const code = serverDb
      .prepare(
        `SELECT * FROM verification_codes
         WHERE user_id = ? AND code = ? AND used_at IS NULL
         ORDER BY id DESC LIMIT 1`
      )
      .get(user.id, String(req.body.code).trim());

    if (!code || new Date(code.expires_at).getTime() < Date.now()) {
      return res.status(400).json({ error: 'Code invalide ou expiré.' });
    }

    let friendCode = user.friend_code;
    while (!friendCode) {
      const candidate = makeFriendCode();
      const exists = serverDb.prepare('SELECT id FROM users WHERE friend_code = ?').get(candidate);
      if (!exists) friendCode = candidate;
    }

    const verifiedAt = new Date().toISOString();
    const tx = serverDb.transaction(() => {
      serverDb.prepare('UPDATE verification_codes SET used_at = ? WHERE id = ?').run(verifiedAt, code.id);
      serverDb
        .prepare('UPDATE users SET email_verified = 1, friend_code = ?, public_key = ? WHERE id = ?')
        .run(friendCode, String(req.body.publicKey), user.id);
    });
    tx();

    const updated = getUserById(user.id);
    res.json({ token: signUser(updated), user: publicUser(updated) });
  });

  app.post('/auth/login', async (req, res) => {
    const missing = requireFields(req.body, ['email', 'password']);
    if (missing.length) return res.status(400).json({ error: `Champs manquants: ${missing.join(', ')}` });

    const email = String(req.body.email).trim().toLowerCase();
    const user = serverDb.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user || !(await bcrypt.compare(String(req.body.password), user.password_hash))) {
      return res.status(401).json({ error: 'Identifiants invalides.' });
    }
    if (!user.email_verified) return res.status(403).json({ error: 'Email non vérifié.' });

    res.json({ token: signUser(user), user: publicUser(user, getOnlineState(user.id)) });
  });

  app.get('/me', authHttp, (req, res) => {
    const user = getUserById(req.user.sub);
    res.json({ user: publicUser(user, getOnlineState(user.id)) });
  });

  app.get('/friends', authHttp, (req, res) => {
    const rows = serverDb
      .prepare(
        `SELECT u.* FROM friends f
         JOIN users u ON u.id = f.friend_id
         WHERE f.user_id = ?
         ORDER BY u.unique_id`
      )
      .all(req.user.sub);

    res.json({
      friends: rows.map((row) => ({
        ...publicUser(row, getOnlineState(row.id)),
        status: userStatuses.get(row.id) || (getOnlineState(row.id) ? 'online' : 'offline')
      }))
    });
  });

  app.post('/friends/add', authHttp, (req, res) => {
    const friendCode = String(req.body.friendCode || '').trim().toUpperCase();
    if (!friendCode) return res.status(400).json({ error: 'Code ami requis.' });

    const friend = serverDb.prepare('SELECT * FROM users WHERE friend_code = ?').get(friendCode);
    if (!friend) return res.status(404).json({ error: 'Code ami introuvable.' });
    if (friend.id === req.user.sub) return res.status(400).json({ error: 'Impossible de vous ajouter vous-même.' });

    const now = new Date().toISOString();
    const tx = serverDb.transaction(() => {
      serverDb
        .prepare('INSERT OR IGNORE INTO friends (user_id, friend_id, created_at) VALUES (?, ?, ?)')
        .run(req.user.sub, friend.id, now);
      serverDb
        .prepare('INSERT OR IGNORE INTO friends (user_id, friend_id, created_at) VALUES (?, ?, ?)')
        .run(friend.id, req.user.sub, now);
    });
    tx();

    res.json({
      friend: {
        ...publicUser(friend, getOnlineState(friend.id)),
        status: userStatuses.get(friend.id) || (getOnlineState(friend.id) ? 'online' : 'offline')
      }
    });
  });

  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) throw new Error('Token manquant');
      socket.user = jwt.verify(token, JWT_SECRET);
      next();
    } catch (error) {
      next(error);
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.user.sub;
    socket.join(`user:${userId}`);

    if (!onlineUsers.has(userId)) onlineUsers.set(userId, new Set());
    onlineUsers.get(userId).add(socket.id);
    userStatuses.set(userId, 'online');
    emitPresence(io, userId);

    socket.on('presence:set', ({ status }) => {
      userStatuses.set(userId, status || 'online');
      emitPresence(io, userId);
    });

    socket.on('message:send', (payload = {}, ack) => {
      const recipientIds = filterFriendRecipients(userId, payload.recipientIds);
      const event = { ...payload, recipientIds, senderId: userId, sentAt: new Date().toISOString() };
      for (const recipientId of recipientIds) {
        io.to(`user:${recipientId}`).emit('message:new', event);
      }
      ack?.({ ok: true, sentAt: event.sentAt });
    });

    socket.on('message:edit', (payload = {}) => {
      const recipientIds = filterFriendRecipients(userId, payload.recipientIds);
      for (const recipientId of recipientIds) {
        io.to(`user:${recipientId}`).emit('message:edited', { ...payload, senderId: userId });
      }
    });

    socket.on('message:delete', (payload = {}) => {
      const recipientIds = filterFriendRecipients(userId, payload.recipientIds);
      for (const recipientId of recipientIds) {
        io.to(`user:${recipientId}`).emit('message:deleted', { ...payload, senderId: userId });
      }
    });

    socket.on('message:reaction', (payload = {}) => {
      const recipientIds = filterFriendRecipients(userId, payload.recipientIds);
      for (const recipientId of recipientIds) {
        io.to(`user:${recipientId}`).emit('message:reaction', { ...payload, senderId: userId });
      }
    });

    socket.on('typing:set', (payload = {}) => {
      const recipientIds = filterFriendRecipients(userId, payload.recipientIds);
      for (const recipientId of recipientIds) {
        io.to(`user:${recipientId}`).emit('typing:update', { ...payload, userId });
      }
    });

    socket.on('profile:exchange', (payload = {}) => {
      const recipientIds = filterFriendRecipients(userId, payload.recipientIds);
      for (const recipientId of recipientIds) {
        io.to(`user:${recipientId}`).emit('profile:exchange', { ...payload, senderId: userId });
      }
    });

    const relay = (eventName) => (payload = {}) => {
      if (!payload.to || !isFriend(userId, payload.to)) return;
      io.to(`user:${payload.to}`).emit(eventName, { ...payload, from: userId });
    };

    socket.on('webrtc:offer', relay('webrtc:offer'));
    socket.on('webrtc:answer', relay('webrtc:answer'));
    socket.on('webrtc:ice', relay('webrtc:ice'));
    socket.on('call:state', relay('call:state'));

    socket.on('disconnect', () => {
      onlineUsers.get(userId)?.delete(socket.id);
      if (!onlineUsers.get(userId)?.size) {
        onlineUsers.delete(userId);
        userStatuses.set(userId, 'offline');
      }
      emitPresence(io, userId);
    });
  });

  return { app, server, io };
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const { server } = createApp();
  // Modification essentielle : écouter sur '0.0.0.0' pour être accessible depuis l'extérieur
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[server] API, auth et signalisation disponibles sur le port ${PORT}`);
  });
}

export { createApp };