import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { nanoid } from 'nanoid';
import { AuthPanel } from './components/AuthPanel.jsx';
import { CallDock } from './components/CallDock.jsx';
import { ChatView } from './components/ChatView.jsx';
import { Sidebar } from './components/Sidebar.jsx';
import { authApi, friendsApi } from './services/api.js';
import { decryptFromSender, encryptForRecipients, generateIdentityKeys } from './services/crypto.js';
import { getLocalDb, isLocalDbReady } from './services/localDb.js';
import { createRealtimeSocket } from './services/socket.js';
import { createPeer, getCallStream, setTrackEnabled, stopStream } from './services/webrtc.js';

export default function App() {
  const [localDb] = useState(() => getLocalDb());
  const [initializing, setInitializing] = useState(true);
  const [storageReady] = useState(() => isLocalDbReady());
  const [localUser, setLocalUser] = useState(null);
  const [profiles, setProfiles] = useState({});
  const [friends, setFriends] = useState({});
  const [conversations, setConversations] = useState([]);
  const [activeConversationId, setActiveConversationId] = useState(null);
  const [pendingVerification, setPendingVerification] = useState(null);
  const [authDraft, setAuthDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [typing, setTyping] = useState({});
  const [callSettings, setCallSettings] = useState({ quality: '720p', fps: 30 });
  const [call, setCall] = useState(null);
  const socketRef = useRef(null);
  const peerConnectionsRef = useRef(new Map());
  const profilesRef = useRef({});
  const callRef = useRef(null);
  const callSettingsRef = useRef(callSettings);
  const activeConversation = conversations.find((conversation) => conversation.id === activeConversationId);

  const patchMessage = useCallback((messagePatch) => {
    setConversations((current) =>
      current.map((conversation) => ({
        ...conversation,
        messages: conversation.messages.map((message) =>
          message.id === messagePatch.id ? { ...message, ...messagePatch } : message
        )
      }))
    );
  }, []);

  useEffect(() => {
    let alive = true;

    if (!localDb?.getBootstrap) {
      console.error('[localDb] Service local invalide: getBootstrap est introuvable.', localDb);
      setError('Stockage local indisponible. Interface lancée en mode dégradé.');
      setInitializing(false);
      return () => {
        alive = false;
      };
    }

    localDb
      .getBootstrap()
      .then((bootstrap) => {
        if (!alive) return;
        setLocalUser(bootstrap.user);
        setProfiles(indexProfiles([...(bootstrap.profiles || []), bootstrap.user && localUserProfile(bootstrap.user)].filter(Boolean)));
        setConversations(bootstrap.conversations || []);
        setActiveConversationId(bootstrap.conversations?.[0]?.id || null);
      })
      .catch((err) => {
        console.error('[localDb] Initialisation impossible.', err);
        if (alive) setError(`Stockage local indisponible: ${err.message}`);
      })
      .finally(() => {
        if (alive) setInitializing(false);
      });

    return () => {
      alive = false;
    };
  }, [localDb]);

  useEffect(() => {
    profilesRef.current = profiles;
  }, [profiles]);

  useEffect(() => {
    if (!error) return;
    const timeout = setTimeout(() => setError(''), 6000);
    return () => clearTimeout(timeout);
  }, [error]);

  useEffect(() => {
    callRef.current = call;
  }, [call]);

  useEffect(() => {
    callSettingsRef.current = callSettings;
  }, [callSettings]);

  const mergeProfile = useCallback(async (profile) => {
    const normalized = normalizeProfile(profile);
    await localDb?.upsertProfile?.(normalized);
    setProfiles((current) => ({ ...current, [normalized.userId]: { ...current[normalized.userId], ...normalized } }));
    return normalized;
  }, [localDb]);

  const mergeConversation = useCallback((conversation) => {
    setConversations((current) => {
      const next = current.filter((item) => item.id !== conversation.id);
      return [conversation, ...next].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    });
  }, []);

  const refreshFriends = useCallback(async () => {
    const { friends: remoteFriends } = await friendsApi.list();
    const normalizedFriends = {};

    for (const friend of remoteFriends) {
      const profile = await mergeProfile(friend);
      normalizedFriends[profile.userId] = profile;
    }

    setFriends((current) => ({ ...current, ...normalizedFriends }));
  }, [mergeProfile]);

  const sendProfileExchange = useCallback(
    async (recipientProfiles) => {
      if (!socketRef.current || !localUser) return;
      const content = localUserProfile(localUser);
      const encryptedByRecipient = await encryptForRecipients(content, recipientProfiles, localUser);
      socketRef.current.emit('profile:exchange', {
        recipientIds: recipientProfiles.map((profile) => profile.userId),
        encryptedByRecipient
      });
    },
    [localUser]
  );

  useEffect(() => {
    const token = authApi.getToken();
    if (!token || !localUser || socketRef.current) return;

    const socket = createRealtimeSocket(token);
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('presence:set', { status: localUser.presence || 'online' });
      refreshFriends().catch((err) => setError(err.message));
    });

    socket.on('presence:update', ({ userId, online, status }) => {
      setFriends((current) => ({
        ...current,
        [userId]: { ...current[userId], userId, online, status: status || (online ? 'online' : 'offline') }
      }));
    });

    socket.on('profile:exchange', async (payload) => {
      try {
        const encrypted = payload.encryptedByRecipient?.[localUser.id];
        if (!encrypted) return;
        // La clé publique de l'expéditeur doit venir d'une source de confiance
        // (le serveur authentifié via REST), jamais du payload chiffré lui-même.
        let senderPublicKey = profilesRef.current[payload.senderId]?.publicKey;
        if (!senderPublicKey) {
          await refreshFriends().catch(() => {});
          senderPublicKey = profilesRef.current[payload.senderId]?.publicKey;
        }
        const profile = await decryptFromSender(encrypted, localUser, senderPublicKey);
        await mergeProfile(profile);
      } catch (err) {
        console.warn('Profil P2P non déchiffrable ou expéditeur non authentifié', err);
      }
    });

    socket.on('message:new', async (payload) => {
      try {
        const encrypted = payload.encryptedByRecipient?.[localUser.id];
        if (!encrypted) return;
        const senderPublicKey = profilesRef.current[payload.senderId]?.publicKey;
        const content = await decryptFromSender(encrypted, localUser, senderPublicKey);
        const conversation = await localDb?.saveConversation?.(payload.conversation);
        const messages = await localDb?.saveMessage?.({
          id: payload.id,
          conversationId: payload.conversationId,
          senderId: payload.senderId,
          encryptedPayload: encrypted,
          content,
          kind: payload.kind,
          replyTo: payload.replyTo,
          createdAt: payload.sentAt
        });
        if (!conversation || !messages) return;
        mergeConversation({ ...conversation, messages });
      } catch (err) {
        console.warn('Message non déchiffrable', err);
      }
    });

    socket.on('message:edited', async (payload) => {
      try {
        const encrypted = payload.encryptedByRecipient?.[localUser.id];
        const senderPublicKey = profilesRef.current[payload.senderId]?.publicKey;
        const content = encrypted ? await decryptFromSender(encrypted, localUser, senderPublicKey) : payload.content;
        const updated = await localDb?.updateMessage?.(payload.messageId, { content, encryptedPayload: encrypted });
        if (updated) patchMessage(updated);
      } catch (err) {
        console.warn('Modification non déchiffrable', err);
      }
    });

    socket.on('message:deleted', async ({ messageId }) => {
      await localDb?.deleteMessage?.(messageId);
      patchMessage({ id: messageId, deletedAt: new Date().toISOString() });
    });

    socket.on('message:reaction', async ({ messageId, senderId, emoji }) => {
      const reactions = await localDb?.reactToMessage?.(messageId, senderId, emoji);
      patchMessage({ id: messageId, reactions });
    });

    socket.on('typing:update', ({ conversationId, userId, isTyping }) => {
      const name = profilesRef.current[userId]?.pseudo || profilesRef.current[userId]?.uniqueId || 'Un ami';
      setTyping((current) => ({
        ...current,
        [conversationId]: isTyping
          ? Array.from(new Set([...(current[conversationId] || []), name]))
          : (current[conversationId] || []).filter((item) => item !== name)
      }));
    });

    socket.on('webrtc:offer', handleWebRtcOffer);
    socket.on('webrtc:answer', handleWebRtcAnswer);
    socket.on('webrtc:ice', handleWebRtcIce);
    socket.on('call:state', ({ from, state }) => {
      setFriends((current) => ({
        ...current,
        [from]: { ...current[from], status: state === 'ended' ? 'online' : 'in-call' }
      }));

      if (state === 'ended') {
        const peer = peerConnectionsRef.current.get(from);
        if (peer) {
          peer.close();
          peerConnectionsRef.current.delete(from);
        }
        setCall((current) => {
          if (!current) return current;
          const { [from]: _removed, ...remainingStreams } = current.remoteStreams || {};
          return { ...current, remoteStreams: remainingStreams };
        });
      }
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [localDb, localUser, mergeConversation, mergeProfile, patchMessage, refreshFriends]);

  async function handleRegister(form) {
    setBusy(true);
    setError('');
    try {
      const pending = await authApi.register(form);
      setAuthDraft(form);
      setPendingVerification(pending);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleVerify(form) {
    setBusy(true);
    setError('');
    try {
      const keys = await generateIdentityKeys();
      const result = await authApi.verifyEmail({
        email: form.email,
        code: form.code,
        publicKey: keys.publicKey
      });
      authApi.setToken(result.token);
      const saved = await localDb?.saveLocalUser?.({
        id: result.user.id,
        uniqueId: result.user.uniqueId,
        email: form.email,
        friendCode: result.user.friendCode,
        publicKey: keys.publicKey,
        privateKey: keys.privateKey,
        pseudo: authDraft?.pseudo || form.pseudo || result.user.uniqueId,
        avatar: '',
        bio: '',
        status: 'Disponible'
      });
      if (!saved) throw new Error('Impossible de sauvegarder le profil local.');
      setLocalUser(saved);
      setProfiles({ [saved.id]: localUserProfile(saved) });
      setPendingVerification(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleLogin(form) {
    setBusy(true);
    setError('');
    try {
      const result = await authApi.login(form);
      if (!localUser || localUser.id !== result.user.id || !localUser.privateKey) {
        throw new Error('Les clés E2EE de ce compte ne sont pas présentes sur cet appareil.');
      }
      authApi.setToken(result.token);
      await refreshFriends();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleAddFriend(friendCode) {
    if (!friendCode.trim()) return;
    setError('');
    try {
      const { friend } = await friendsApi.add(friendCode);
      const profile = await mergeProfile(friend);
      setFriends((current) => ({ ...current, [profile.userId]: profile }));
      await sendProfileExchange([profile]);
      await createPrivateConversation(profile);
    } catch (err) {
      setError(err.message);
    }
  }

  async function createPrivateConversation(friend) {
    const friendId = friend.userId || friend.id;
    const id = `private:${[localUser.id, friendId].sort().join(':')}`;
    const conversation = await localDb?.saveConversation?.({
      id,
      type: 'private',
      title: null,
      participantIds: [localUser.id, friendId],
      ephemeralPolicy: '7d'
    });
    if (!conversation) throw new Error('Impossible de créer la conversation locale.');
    mergeConversation(conversation);
    setActiveConversationId(id);
  }

  async function createGroup(title, selectedIds) {
    if (!selectedIds.length) return;
    try {
      const participantIds = Array.from(new Set([localUser.id, ...selectedIds]));
      const conversation = await localDb?.saveConversation?.({
        id: `group:${nanoid(12)}`,
        type: 'group',
        title: title || 'Groupe privé',
        participantIds,
        ephemeralPolicy: '7d'
      });
      if (!conversation) throw new Error('Impossible de créer le groupe local.');
      mergeConversation(conversation);
      setActiveConversationId(conversation.id);
      await sendProfileExchange(participantIds.filter((id) => id !== localUser.id).map((id) => profiles[id]).filter(Boolean));
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleSendMessage(content) {
    if (!activeConversation) return;
    const recipientIds = activeConversation.participantIds.filter((id) => id !== localUser.id);
    const recipients = recipientIds.map((id) => profiles[id]).filter(Boolean);
    const encryptedByRecipient = await encryptForRecipients(content, recipients, localUser);
    const messageId = nanoid(16);
    const now = new Date().toISOString();
    const conversationPayload = stripMessages(activeConversation);

    const messages = await localDb?.saveMessage?.({
      id: messageId,
      localUserId: localUser.id,
      conversationId: activeConversation.id,
      senderId: localUser.id,
      content,
      kind: content.media ? (content.media.type?.startsWith('video/') ? 'video' : 'image') : 'text',
      replyTo: content.replyTo,
      createdAt: now
    });
    if (!messages) throw new Error('Impossible de sauvegarder le message local.');

    mergeConversation({ ...activeConversation, messages, updatedAt: now });
    socketRef.current?.emit('message:send', {
      id: messageId,
      conversationId: activeConversation.id,
      conversation: conversationPayload,
      recipientIds,
      encryptedByRecipient,
      kind: content.media ? 'media' : 'text',
      replyTo: content.replyTo
    });
    socketRef.current?.emit('typing:set', { conversationId: activeConversation.id, recipientIds, isTyping: false });
  }

  async function handleEditMessage(message, nextText) {
    const content = { ...message.content, text: nextText };
    const recipientIds = activeConversation.participantIds.filter((id) => id !== localUser.id);
    const recipients = recipientIds.map((id) => profiles[id]).filter(Boolean);
    const encryptedByRecipient = await encryptForRecipients(content, recipients, localUser);
    const updated = await localDb?.updateMessage?.(message.id, { content });
    if (updated) patchMessage(updated);
    socketRef.current?.emit('message:edit', { messageId: message.id, conversationId: activeConversation.id, recipientIds, encryptedByRecipient });
  }

  async function handleDeleteMessage(messageId) {
    await localDb?.deleteMessage?.(messageId);
    patchMessage({ id: messageId, deletedAt: new Date().toISOString() });
    socketRef.current?.emit('message:delete', {
      messageId,
      conversationId: activeConversation.id,
      recipientIds: activeConversation.participantIds.filter((id) => id !== localUser.id)
    });
  }

  async function handleReact(messageId, emoji) {
    const reactions = await localDb?.reactToMessage?.(messageId, localUser.id, emoji);
    patchMessage({ id: messageId, reactions });
    socketRef.current?.emit('message:reaction', {
      messageId,
      emoji,
      conversationId: activeConversation.id,
      recipientIds: activeConversation.participantIds.filter((id) => id !== localUser.id)
    });
  }

  async function handlePolicyChange(ephemeralPolicy) {
    const conversation = await localDb?.saveConversation?.({ ...activeConversation, ephemeralPolicy });
    if (!conversation) return;
    mergeConversation(conversation);
  }

  function handleTyping(isTyping) {
    if (!activeConversation) return;
    socketRef.current?.emit('typing:set', {
      conversationId: activeConversation.id,
      recipientIds: activeConversation.participantIds.filter((id) => id !== localUser.id),
      isTyping
    });
  }

  async function handleStatusChange(status) {
    const updated = { ...localUser, presence: status };
    setLocalUser(updated);
    socketRef.current?.emit('presence:set', { status });
  }

  async function startCall(kind) {
    if (!activeConversation || !socketRef.current) return;
    const recipientIds = activeConversation.participantIds.filter((id) => id !== localUser.id);
    const localStream = await getCallStream({
      audio: true,
      video: kind === 'video' || kind === 'screen',
      screen: kind === 'screen',
      quality: callSettings.quality,
      fps: callSettings.fps
    });

    setCall({ kind, localStream, remoteStreams: {}, mic: true, camera: kind !== 'audio', iceState: 'new' });

    for (const peerId of recipientIds) {
      const peer = createPeer({
        socket: socketRef.current,
        peerId,
        localStream,
        onRemoteStream: (stream) => setCall((current) => addRemoteStream(current, peerId, stream)),
        onIceState: (state) => setCall((current) => (current ? { ...current, iceState: state } : current))
      });
      peerConnectionsRef.current.set(peerId, peer);
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      socketRef.current.emit('webrtc:offer', {
        to: peerId,
        description: peer.localDescription,
        conversationId: activeConversation.id,
        kind,
        settings: callSettings
      });
      socketRef.current.emit('call:state', { to: peerId, state: 'ringing', conversationId: activeConversation.id });
    }
  }

  async function handleWebRtcOffer({ from, description, kind, settings }) {
    const accept = callRef.current || window.confirm(`Accepter l'appel ${kind || 'audio'} ?`);
    if (!accept) return;

    let localStream = callRef.current?.localStream;
    if (!localStream) {
      localStream = await getCallStream({
        audio: true,
        video: kind === 'video',
        screen: false,
        quality: settings?.quality || callSettingsRef.current.quality,
        fps: settings?.fps || callSettingsRef.current.fps
      });
      setCall({ kind, localStream, remoteStreams: {}, mic: true, camera: kind === 'video', iceState: 'new' });
    }

    const peer = createPeer({
      socket: socketRef.current,
      peerId: from,
      localStream,
      onRemoteStream: (stream) => setCall((current) => addRemoteStream(current, from, stream)),
      onIceState: (state) => setCall((current) => (current ? { ...current, iceState: state } : current))
    });
    peerConnectionsRef.current.set(from, peer);
    await peer.setRemoteDescription(description);
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    socketRef.current.emit('webrtc:answer', { to: from, description: peer.localDescription });
    socketRef.current.emit('call:state', { to: from, state: 'in-call' });
  }

  async function handleWebRtcAnswer({ from, description }) {
    const peer = peerConnectionsRef.current.get(from);
    if (peer) await peer.setRemoteDescription(description);
  }

  async function handleWebRtcIce({ from, candidate }) {
    const peer = peerConnectionsRef.current.get(from);
    if (peer && candidate) await peer.addIceCandidate(candidate);
  }

  function toggleMic() {
    setCall((current) => {
      if (!current) return current;
      setTrackEnabled(current.localStream, 'audio', !current.mic);
      return { ...current, mic: !current.mic };
    });
  }

  function toggleCamera() {
    setCall((current) => {
      if (!current) return current;
      setTrackEnabled(current.localStream, 'video', !current.camera);
      return { ...current, camera: !current.camera };
    });
  }

  async function shareScreenInCall() {
    if (!call) return;
    const screenStream = await getCallStream({ audio: true, video: true, screen: true, quality: callSettings.quality, fps: callSettings.fps });
    const [screenTrack] = screenStream.getVideoTracks();
    for (const peer of peerConnectionsRef.current.values()) {
      const sender = peer.getSenders().find((item) => item.track?.kind === 'video');
      if (sender && screenTrack) await sender.replaceTrack(screenTrack);
    }
    stopStream(call.localStream);
    setCall((current) => ({ ...current, localStream: screenStream, camera: true }));
  }

  function hangup() {
    for (const [peerId, peer] of peerConnectionsRef.current.entries()) {
      socketRef.current?.emit('call:state', { to: peerId, state: 'ended' });
      peer.close();
    }
    peerConnectionsRef.current.clear();
    stopStream(call?.localStream);
    setCall(null);
  }

  const typingUsers = useMemo(() => typing[activeConversationId] || [], [typing, activeConversationId]);

  if (initializing) {
    return (
      <main className="auth-shell">
        <section className="auth-panel">
          <div className="loading-state">
            <strong>Chargement...</strong>
            <span>Initialisation du stockage local et de l'interface.</span>
          </div>
        </section>
      </main>
    );
  }

  if (!localUser || !authApi.getToken()) {
    return (
      <AuthPanel
        onRegister={handleRegister}
        onVerify={handleVerify}
        onLogin={handleLogin}
        pendingVerification={pendingVerification}
        busy={busy}
        error={error}
        storageReady={storageReady}
      />
    );
  }

  return (
    <div className="app-shell">
      <Sidebar
        localUser={localUser}
        friends={friends}
        conversations={conversations}
        activeConversationId={activeConversationId}
        onOpenConversation={setActiveConversationId}
        onAddFriend={handleAddFriend}
        onCreatePrivateConversation={createPrivateConversation}
        onCreateGroup={createGroup}
        onStatusChange={handleStatusChange}
      />
      <ChatView
        conversation={activeConversation}
        localUser={localUser}
        profiles={{ ...profiles, [localUser.id]: localUserProfile(localUser) }}
        typingUsers={typingUsers}
        onSendMessage={handleSendMessage}
        onEditMessage={handleEditMessage}
        onDeleteMessage={handleDeleteMessage}
        onReact={handleReact}
        onTyping={handleTyping}
        onStartCall={startCall}
        onPolicyChange={handlePolicyChange}
        callSettings={callSettings}
        onCallSettingsChange={(patch) => setCallSettings((current) => ({ ...current, ...patch }))}
      />
      <CallDock call={call} onToggleMic={toggleMic} onToggleCamera={toggleCamera} onShareScreen={shareScreenInCall} onHangup={hangup} />
      {!storageReady && (
        <div className="storage-banner">
          Mode navigateur temporaire : les données ne sont pas persistées sur cet appareil.
        </div>
      )}
      {error && (
        <div className="toast">
          {error}
          <button onClick={() => setError('')} aria-label="Fermer">×</button>
        </div>
      )}
    </div>
  );
}

function normalizeProfile(profile) {
  return {
    userId: profile.userId || profile.id,
    uniqueId: profile.uniqueId,
    friendCode: profile.friendCode,
    publicKey: profile.publicKey,
    pseudo: profile.pseudo || profile.uniqueId,
    avatar: profile.avatar || '',
    bio: profile.bio || '',
    status: profile.status || (profile.online ? 'online' : 'offline'),
    online: profile.online
  };
}

function localUserProfile(user) {
  return {
    userId: user.id,
    uniqueId: user.uniqueId,
    friendCode: user.friendCode,
    publicKey: user.publicKey,
    pseudo: user.pseudo,
    avatar: user.avatar,
    bio: user.bio,
    status: user.status
  };
}

function indexProfiles(profileList) {
  return Object.fromEntries(profileList.map((profile) => [profile.userId, profile]));
}

function stripMessages(conversation) {
  const { messages: _messages, ...rest } = conversation;
  return rest;
}

function addRemoteStream(current, peerId, stream) {
  if (!current) return current;
  return {
    ...current,
    remoteStreams: {
      ...current.remoteStreams,
      [peerId]: stream
    }
  };
}