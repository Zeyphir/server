# Secure Messenger Desktop

Application desktop Windows de messagerie sécurisée avec Electron, React, Express, Socket.IO, WebRTC et SQLite local.

## Démarrage

```bash
npm.cmd install
npm.cmd run dev
```

PowerShell bloque parfois `npm.ps1`; utilisez `npm.cmd` sur Windows.

Le mode dev lance :

- API auth, présence et signalisation sur `http://127.0.0.1:4141`
- Vite React sur `http://127.0.0.1:5173`
- Electron sur le renderer Vite

## Architecture

- `src/server` : authentification, confirmation email simulée, codes amis, clés publiques, relations d'amis, présence Socket.IO et signalisation WebRTC.
- `src/main` : processus Electron, IPC sécurisé et SQLite local par utilisateur.
- `src/client` : interface React type Discord, état applicatif, E2EE, messagerie temps réel, médias, réactions, replies, édition/suppression, appels.
- `src/shared/sqlite.js` : adaptateur SQLite pur JS basé sur `sql.js`, sans compilation native Windows.

## Sécurité et stockage

Le serveur ne stocke pas les profils locaux, les bios, avatars, statuts personnalisés ni les messages en clair. Les profils et conversations sont conservés localement dans SQLite et échangés via relais chiffré.

Les messages sont chiffrés avant émission avec `tweetnacl` (`x25519-xsalsa20-poly1305`) pour chaque destinataire. Les clés privées restent dans la base SQLite locale Electron.

La confirmation email est simulée en développement : le code est affiché dans la réponse API et dans les logs serveur. En production, remplacez cette partie par un fournisseur SMTP ou transactionnel.

## Fonctionnalités incluses

- Inscription avec pseudo, identifiant unique, email, mot de passe et confirmation email.
- Génération de code ami permanent après vérification.
- Génération de clés E2EE locales après vérification email.
- Profil local : avatar, bio, statut.
- Ajout d'amis uniquement par code.
- Présence amis : en ligne, hors ligne, en appel.
- Maximum 10 conversations locales, privées et groupes inclus.
- Messages texte temps réel, emojis, images, vidéos, réactions, replies, typing indicator, édition et suppression.
- Messages temporaires : 24h, 3j, 7j, 2 semaines, jamais. Valeur par défaut : 7 jours après lecture.
- Appels WebRTC audio, vidéo, partage écran, audio système quand Chromium le permet, qualité 360p/480p/720p/1080p/natif et FPS 15/30/60.
- ICE configuré via `.env` avec STUN/TURN.

## Configuration

Copiez `.env.example` vers `.env` puis ajustez si besoin :

```bash
PORT=4141
JWT_SECRET=replace-this-dev-secret
CLIENT_ORIGIN=http://127.0.0.1:5173
VITE_API_URL=http://127.0.0.1:4141
VITE_SIGNALING_URL=http://127.0.0.1:4141
VITE_STUN_URL=stun:stun.l.google.com:19302
VITE_TURN_URL=
VITE_TURN_USERNAME=
VITE_TURN_CREDENTIAL=
```

## Vérification

```bash
npm.cmd run build
node -e "import('./src/server/index.js').then(() => console.log('server module loaded'))"
```

## Points à durcir avant production

- Brancher une vraie livraison email.
- Ajouter une stratégie de sauvegarde/restauration de clés locales.
- Ajouter une rotation de clés et une vérification d'empreintes entre amis.
- Ajouter un TURN authentifié pour les réseaux stricts.
- Ajouter tests automatisés et packaging Windows signé.
