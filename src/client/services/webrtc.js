const QUALITY = {
  '360p': { width: 640, height: 360 },
  '480p': { width: 854, height: 480 },
  '720p': { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 },
  native: {}
};

export function getRtcConfiguration() {
  const iceServers = [];
  if (import.meta.env.VITE_STUN_URL) {
    iceServers.push({ urls: import.meta.env.VITE_STUN_URL });
  }
  if (import.meta.env.VITE_TURN_URL) {
    iceServers.push({
      urls: import.meta.env.VITE_TURN_URL,
      username: import.meta.env.VITE_TURN_USERNAME,
      credential: import.meta.env.VITE_TURN_CREDENTIAL
    });
  }
  return { iceServers };
}

export async function getCallStream({ audio = true, video = false, screen = false, quality = '720p', fps = 30 }) {
  const size = QUALITY[quality] || QUALITY['720p'];
  const videoConstraints =
    video || screen
      ? {
          ...size,
          frameRate: { ideal: Number(fps), max: Number(fps) }
        }
      : false;

  if (screen) {
    return navigator.mediaDevices.getDisplayMedia({
      video: videoConstraints,
      audio
    });
  }

  return navigator.mediaDevices.getUserMedia({
    audio,
    video: videoConstraints
  });
}

export function createPeer({ socket, peerId, localStream, onRemoteStream, onIceState }) {
  const connection = new RTCPeerConnection(getRtcConfiguration());

  localStream?.getTracks().forEach((track) => connection.addTrack(track, localStream));

  connection.ontrack = (event) => {
    onRemoteStream?.(event.streams[0]);
  };

  connection.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('webrtc:ice', { to: peerId, candidate: event.candidate });
    }
  };

  connection.oniceconnectionstatechange = () => {
    onIceState?.(connection.iceConnectionState);
  };

  return connection;
}

export function setTrackEnabled(stream, kind, enabled) {
  stream?.getTracks().filter((track) => track.kind === kind).forEach((track) => {
    track.enabled = enabled;
  });
}

export function stopStream(stream) {
  stream?.getTracks().forEach((track) => track.stop());
}