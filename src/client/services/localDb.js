const emptyBootstrap = {
  user: null,
  profiles: [],
  conversations: [],
  settings: {
    defaultEphemeralPolicy: '7d'
  }
};

const memoryState = {
  bootstrap: structuredClone(emptyBootstrap)
};

export function getLocalDb() {
  if (window.secureLocal) return window.secureLocal;

  console.warn(
    '[localDb] window.secureLocal est indisponible. Le frontend tourne probablement hors Electron; fallback mémoire activé.'
  );
  return memoryLocalDb;
}

export function isLocalDbReady() {
  return Boolean(window.secureLocal);
}

const memoryLocalDb = {
  async getBootstrap() {
    return structuredClone(memoryState.bootstrap);
  },

  async saveLocalUser(profile) {
    const now = new Date().toISOString();
    const user = {
      ...profile,
      createdAt: profile.createdAt || now,
      updatedAt: now
    };

    memoryState.bootstrap.user = user;
    await this.upsertProfile({
      userId: user.id,
      uniqueId: user.uniqueId,
      friendCode: user.friendCode,
      publicKey: user.publicKey,
      pseudo: user.pseudo,
      avatar: user.avatar,
      bio: user.bio,
      status: user.status
    });

    return structuredClone(user);
  },

  async upsertProfile(profile) {
    const normalized = {
      ...profile,
      userId: profile.userId || profile.id,
      updatedAt: new Date().toISOString()
    };

    memoryState.bootstrap.profiles = [
      normalized,
      ...memoryState.bootstrap.profiles.filter((item) => item.userId !== normalized.userId)
    ];

    return structuredClone(normalized);
  },

  async saveConversation(conversation) {
    const existing = memoryState.bootstrap.conversations.find((item) => item.id === conversation.id);
    if (!existing && memoryState.bootstrap.conversations.length >= 10) {
      throw new Error('Limite atteinte: maximum 10 conversations privées et groupes.');
    }

    const now = new Date().toISOString();
    const saved = {
      ...existing,
      ...conversation,
      participantIds: conversation.participantIds || existing?.participantIds || [],
      ephemeralPolicy: conversation.ephemeralPolicy || existing?.ephemeralPolicy || '7d',
      messages: existing?.messages || conversation.messages || [],
      createdAt: existing?.createdAt || conversation.createdAt || now,
      updatedAt: now
    };

    memoryState.bootstrap.conversations = [
      saved,
      ...memoryState.bootstrap.conversations.filter((item) => item.id !== saved.id)
    ];

    return structuredClone(saved);
  },

  async saveMessage(message) {
    const conversation = memoryState.bootstrap.conversations.find((item) => item.id === message.conversationId);
    if (!conversation) return [];

    const saved = {
      ...message,
      reactions: message.reactions || {},
      createdAt: message.createdAt || new Date().toISOString()
    };

    conversation.messages = [saved, ...(conversation.messages || []).filter((item) => item.id !== saved.id)].sort(
      (a, b) => new Date(a.createdAt) - new Date(b.createdAt)
    );
    conversation.updatedAt = new Date().toISOString();

    return structuredClone(conversation.messages);
  },

  async updateMessage(messageId, patch) {
    const message = findMemoryMessage(messageId);
    if (!message) return null;
    Object.assign(message, patch, { editedAt: new Date().toISOString() });
    return structuredClone(message);
  },

  async deleteMessage(messageId) {
    const message = findMemoryMessage(messageId);
    if (message) message.deletedAt = new Date().toISOString();
    return { id: messageId, deleted: true };
  },

  async reactToMessage(messageId, userId, emoji) {
    const message = findMemoryMessage(messageId);
    if (!message) return {};
    message.reactions = message.reactions || {};
    message.reactions[emoji] = Array.from(new Set([...(message.reactions[emoji] || []), userId]));
    return structuredClone(message.reactions);
  },

  async markConversationRead(conversationId) {
    const conversation = memoryState.bootstrap.conversations.find((item) => item.id === conversationId);
    return structuredClone(conversation?.messages || []);
  },

  async setSetting(key, value) {
    memoryState.bootstrap.settings[key] = value;
    return { key, value };
  }
};

function findMemoryMessage(messageId) {
  for (const conversation of memoryState.bootstrap.conversations) {
    const message = conversation.messages?.find((item) => item.id === messageId);
    if (message) return message;
  }
  return null;
}