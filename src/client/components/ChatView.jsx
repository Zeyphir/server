import { useRef, useState } from 'react';
import {
  Camera,
  Edit3,
  ImagePlus,
  Mic,
  MonitorUp,
  Phone,
  SendHorizontal,
  SmilePlus,
  Trash2
} from 'lucide-react';
import { Avatar } from './Sidebar.jsx';

const EMOJIS = ['👍', '❤️', '😂', '🔥', '👀', '✅'];

export function ChatView({
  conversation,
  localUser,
  profiles,
  typingUsers,
  onSendMessage,
  onEditMessage,
  onDeleteMessage,
  onReact,
  onTyping,
  onStartCall,
  onPolicyChange,
  callSettings,
  onCallSettingsChange
}) {
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [media, setMedia] = useState(null);
  const fileInputRef = useRef(null);

  if (!conversation) {
    return (
      <section className="empty-chat">
        <h2>Sélectionnez une conversation</h2>
        <p>Ajoutez un ami par code unique ou créez un groupe privé.</p>
      </section>
    );
  }

  const title =
    conversation.title ||
    conversation.participantIds
      .filter((id) => id !== localUser.id)
      .map((id) => profiles[id]?.pseudo || profiles[id]?.uniqueId || id.slice(0, 6))
      .join(', ');

  const send = () => {
    if (!text.trim() && !media) return;
    onSendMessage({ text: text.trim(), media, replyTo });
    setText('');
    setMedia(null);
    setReplyTo(null);
  };

  return (
    <section className="chat">
      <header className="chat-header">
        <div>
          <h2>{title}</h2>
          <span>{conversation.type === 'group' ? 'Groupe privé' : 'Conversation privée'}</span>
        </div>
        <div className="header-controls">
          <select value={conversation.ephemeralPolicy} onChange={(event) => onPolicyChange(event.target.value)}>
            <option value="24h">24h après lecture</option>
            <option value="3d">3 jours</option>
            <option value="7d">7 jours</option>
            <option value="14d">2 semaines</option>
            <option value="never">Jamais</option>
          </select>
          <select value={callSettings.quality} onChange={(event) => onCallSettingsChange({ quality: event.target.value })}>
            <option value="360p">360p</option>
            <option value="480p">480p</option>
            <option value="720p">720p</option>
            <option value="1080p">1080p</option>
            <option value="native">Natif</option>
          </select>
          <select value={callSettings.fps} onChange={(event) => onCallSettingsChange({ fps: Number(event.target.value) })}>
            <option value="15">15 FPS</option>
            <option value="30">30 FPS</option>
            <option value="60">60 FPS</option>
          </select>
          <button title="Appel audio" onClick={() => onStartCall('audio')}>
            <Phone size={18} />
          </button>
          <button title="Appel vidéo" onClick={() => onStartCall('video')}>
            <Camera size={18} />
          </button>
          <button title="Partage écran" onClick={() => onStartCall('screen')}>
            <MonitorUp size={18} />
          </button>
        </div>
      </header>

      <div className="message-list">
        {conversation.messages.map((message) => (
          <article key={message.id} className={`message ${message.senderId === localUser.id ? 'mine' : ''}`}>
            <Avatar profile={profiles[message.senderId] || localUser} small />
            <div className="message-body">
              <div className="message-meta">
                <strong>{message.senderId === localUser.id ? localUser.pseudo : profiles[message.senderId]?.pseudo || 'Ami'}</strong>
                <span>{new Date(message.createdAt).toLocaleString()}</span>
                {message.expiresAt && <span>expire {new Date(message.expiresAt).toLocaleDateString()}</span>}
              </div>
              {message.deletedAt ? (
                <p className="deleted-message">Message supprimé</p>
              ) : (
                <>
                  {message.replyTo && <div className="reply-pill">Réponse à {message.replyTo.slice(0, 8)}</div>}
                  {message.content?.text && <p>{message.content.text}</p>}
                  {message.content?.media && <MediaPreview media={message.content.media} />}
                  <div className="reaction-row">
                    {Object.entries(message.reactions || {}).map(([emoji, users]) => (
                      <button key={emoji} onClick={() => onReact(message.id, emoji)}>
                        {emoji} {users.length}
                      </button>
                    ))}
                    {EMOJIS.map((emoji) => (
                      <button key={emoji} onClick={() => onReact(message.id, emoji)}>
                        {emoji}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
            {!message.deletedAt && message.senderId === localUser.id && (
              <div className="message-actions">
                <button title="Répondre" onClick={() => setReplyTo(message.id)}>
                  <SendHorizontal size={14} />
                </button>
                <button
                  title="Modifier"
                  onClick={() => {
                    const nextText = window.prompt('Modifier le message', message.content?.text || '');
                    if (nextText !== null) onEditMessage(message, nextText);
                  }}
                >
                  <Edit3 size={14} />
                </button>
                <button title="Supprimer" onClick={() => onDeleteMessage(message.id)}>
                  <Trash2 size={14} />
                </button>
              </div>
            )}
          </article>
        ))}
      </div>

      {!!typingUsers.length && <div className="typing-line">{typingUsers.join(', ')} est en train d'écrire...</div>}

      {replyTo && (
        <div className="composer-reply">
          Réponse à {replyTo.slice(0, 8)}
          <button onClick={() => setReplyTo(null)}>×</button>
        </div>
      )}
      {media && (
        <div className="composer-media">
          <span>{media.name}</span>
          <button onClick={() => setMedia(null)}>Retirer</button>
        </div>
      )}

      <footer className="composer">
        <button title="Emojis" onClick={() => setText((current) => `${current} 👍`)}>
          <SmilePlus size={19} />
        </button>
        <button title="Image ou vidéo" onClick={() => fileInputRef.current?.click()}>
          <ImagePlus size={19} />
        </button>
        <button title="Micro" onClick={() => onStartCall('audio')}>
          <Mic size={19} />
        </button>
        <input
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            onTyping(Boolean(event.target.value));
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
          placeholder="Message chiffré..."
        />
        <button className="primary" title="Envoyer" onClick={send}>
          <SendHorizontal size={20} />
        </button>
        <input
          ref={fileInputRef}
          hidden
          type="file"
          accept="image/*,video/*"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            const dataUrl = await fileToDataUrl(file);
            setMedia({ name: file.name, type: file.type, dataUrl });
            event.target.value = '';
          }}
        />
      </footer>
    </section>
  );
}

function MediaPreview({ media }) {
  if (media.type?.startsWith('video/')) {
    return <video src={media.dataUrl} controls />;
  }
  return <img src={media.dataUrl} alt={media.name || ''} />;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}