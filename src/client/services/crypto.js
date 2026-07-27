import nacl from 'tweetnacl';

export async function generateIdentityKeys() {
  const pair = nacl.box.keyPair();
  return {
    publicKey: toBase64(pair.publicKey),
    privateKey: toBase64(pair.secretKey)
  };
}

export async function encryptForRecipients(payload, recipients, sender) {
  if (!sender?.privateKey) throw new Error('Clé privée locale indisponible pour chiffrer.');
  const encoded = new TextEncoder().encode(JSON.stringify(payload));
  const senderSecretKey = fromBase64(sender.privateKey);
  const encryptedByRecipient = {};

  for (const recipient of recipients) {
    if (!recipient.publicKey) continue;
    const nonce = nacl.randomBytes(nacl.box.nonceLength);
    const publicKey = fromBase64(recipient.publicKey);
    // On chiffre avec la vraie clé privée de l'expéditeur (et non une clé
    // éphémère) : nacl.box authentifie alors intrinsèquement l'expéditeur,
    // seule la personne possédant sa clé privée a pu produire ce box.
    const box = nacl.box(encoded, nonce, publicKey, senderSecretKey);
    encryptedByRecipient[recipient.userId || recipient.id] = JSON.stringify({
      alg: 'x25519-xsalsa20-poly1305',
      nonce: toBase64(nonce),
      box: toBase64(box)
    });
  }

  return encryptedByRecipient;
}

export async function decryptFromSender(ciphertext, identity, senderPublicKey) {
  if (!senderPublicKey) throw new Error('Clé publique de l\'expéditeur inconnue, impossible de vérifier l\'authenticité.');
  const envelope = JSON.parse(ciphertext);
  const decrypted = nacl.box.open(
    fromBase64(envelope.box),
    fromBase64(envelope.nonce),
    fromBase64(senderPublicKey),
    fromBase64(identity.privateKey)
  );
  if (!decrypted) throw new Error('Déchiffrement impossible ou expéditeur non authentifié.');
  return JSON.parse(new TextDecoder().decode(decrypted));
}

export async function fingerprint(publicKey) {
  const hash = await crypto.subtle.digest('SHA-256', fromBase64(publicKey));
  return [...new Uint8Array(hash)]
    .slice(0, 12)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .match(/.{1,4}/g)
    .join(' ');
}

function toBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function fromBase64(value) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}