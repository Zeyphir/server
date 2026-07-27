import { useMemo, useState } from 'react';
import { Hash, MessageCirclePlus, PhoneCall, Plus, Users } from 'lucide-react';

export function Sidebar({
  localUser,
  friends,
  conversations,
  activeConversationId,
  onOpenConversation,
  onAddFriend,
  onCreatePrivateConversation,
  onCreateGroup,
  onStatusChange
}) {
  const [friendCode, setFriendCode] = useState('');
  const [groupOpen, setGroupOpen] = useState(false);
  const [groupTitle, setGroupTitle] = useState('');
  const [selected, setSelected] = useState([]);

  const sortedFriends = useMemo(
    () => Object.values(friends).sort((a, b) => (a.pseudo || a.uniqueId).localeCompare(b.pseudo || b.uniqueId)),
    [friends]
  );

  return (
    <aside className="sidebar">
      <div className="self-card">
        <Avatar profile={localUser} />
        <div className="self-meta">
          <strong>{localUser.pseudo}</strong>
          <span>@{localUser.uniqueId}</span>
        </div>
      </div>

      <label className="field-label">Statut</label>
      <select className="compact-select" value={localUser.presence || 'online'} onChange={(event) => onStatusChange(event.target.value)}>
        <option value="online">En ligne</option>
        <option value="away">Absent</option>
        <option value="in-call">En appel</option>
        <option value="offline">Invisible</option>
      </select>

      <div className="friend-code">
        <Hash size={15} />
        <span>{localUser.friendCode}</span>
      </div>

      <form
        className="add-friend"
        onSubmit={(event) => {
          event.preventDefault();
          onAddFriend(friendCode);
          setFriendCode('');
        }}
      >
        <input value={friendCode} onChange={(event) => setFriendCode(event.target.value)} placeholder="Code ami" />
        <button title="Ajouter ami">
          <Plus size={17} />
        </button>
      </form>

      <div className="section-title">
        <span>Conversations</span>
        <button title="Créer un groupe" onClick={() => setGroupOpen(true)}>
          <Users size={16} />
        </button>
      </div>

      <nav className="conversation-list">
        {conversations.map((conversation) => (
          <button
            key={conversation.id}
            className={conversation.id === activeConversationId ? 'active' : ''}
            onClick={() => onOpenConversation(conversation.id)}
          >
            {conversation.type === 'group' ? <Users size={17} /> : <MessageCirclePlus size={17} />}
            <span>{conversation.title || conversationName(conversation, friends, localUser.id)}</span>
          </button>
        ))}
      </nav>

      <div className="section-title">
        <span>Amis</span>
      </div>
      <div className="friend-list">
        {sortedFriends.map((friend) => (
          <button key={friend.userId || friend.id} onClick={() => onCreatePrivateConversation(friend)}>
            <Avatar profile={friend} small />
            <span>{friend.pseudo || friend.uniqueId}</span>
            <i className={`presence ${friend.status || (friend.online ? 'online' : 'offline')}`} />
          </button>
        ))}
      </div>

      {groupOpen && (
        <div className="modal-backdrop">
          <section className="modal">
            <h2>Nouveau groupe</h2>
            <input value={groupTitle} onChange={(event) => setGroupTitle(event.target.value)} placeholder="Nom du groupe" />
            <div className="check-list">
              {sortedFriends.map((friend) => {
                const id = friend.userId || friend.id;
                return (
                  <label key={id}>
                    <input
                      type="checkbox"
                      checked={selected.includes(id)}
                      onChange={(event) =>
                        setSelected((current) =>
                          event.target.checked ? [...current, id] : current.filter((selectedId) => selectedId !== id)
                        )
                      }
                    />
                    {friend.pseudo || friend.uniqueId}
                  </label>
                );
              })}
            </div>
            <div className="modal-actions">
              <button onClick={() => setGroupOpen(false)}>Annuler</button>
              <button
                className="primary"
                onClick={() => {
                  onCreateGroup(groupTitle, selected);
                  setGroupOpen(false);
                  setGroupTitle('');
                  setSelected([]);
                }}
              >
                Créer
              </button>
            </div>
          </section>
        </div>
      )}
    </aside>
  );
}

export function Avatar({ profile, small = false }) {
  return (
    <div className={`avatar ${small ? 'small' : ''}`}>
      {profile?.avatar ? <img src={profile.avatar} alt="" /> : <span>{(profile?.pseudo || profile?.uniqueId || '?')[0]}</span>}
    </div>
  );
}

function conversationName(conversation, friends, localUserId) {
  return conversation.participantIds
    .filter((id) => id !== localUserId)
    .map((id) => friends[id]?.pseudo || friends[id]?.uniqueId || id.slice(0, 6))
    .join(', ');
}