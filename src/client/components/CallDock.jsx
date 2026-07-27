import { Camera, CameraOff, Mic, MicOff, MonitorUp, PhoneOff } from 'lucide-react';
import { useEffect, useRef } from 'react';

export function CallDock({ call, onToggleMic, onToggleCamera, onShareScreen, onHangup }) {
  const localRef = useRef(null);

  useEffect(() => {
    if (localRef.current) localRef.current.srcObject = call?.localStream || null;
  }, [call?.localStream]);

  if (!call) return null;

  return (
    <aside className="call-dock">
      <div className="call-grid">
        <div className="video-tile">
          <video ref={localRef} autoPlay muted playsInline />
          <span>Vous</span>
        </div>
        {Object.entries(call.remoteStreams || {}).map(([peerId, stream]) => (
          <RemoteVideo key={peerId} peerId={peerId} stream={stream} />
        ))}
      </div>
      <div className="call-controls">
        <button title="Micro" className={call.mic ? '' : 'disabled'} onClick={onToggleMic}>
          {call.mic ? <Mic size={18} /> : <MicOff size={18} />}
        </button>
        <button title="Caméra" className={call.camera ? '' : 'disabled'} onClick={onToggleCamera}>
          {call.camera ? <Camera size={18} /> : <CameraOff size={18} />}
        </button>
        <button title="Partager écran" onClick={onShareScreen}>
          <MonitorUp size={18} />
        </button>
        <button title="Raccrocher" className="danger" onClick={onHangup}>
          <PhoneOff size={18} />
        </button>
        <span>{call.iceState || 'connexion'}</span>
      </div>
    </aside>
  );
}

function RemoteVideo({ peerId, stream }) {
  const ref = useRef(null);

  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);

  return (
    <div className="video-tile">
      <video ref={ref} autoPlay playsInline />
      <span>{peerId.slice(0, 8)}</span>
    </div>
  );
}