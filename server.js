const crypto = require('crypto');
const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const clients = new Map();
const rooms = new Map();
const shares = new Map();
const names = new Map();

app.use(express.static(path.join(__dirname, 'public')));

function sanitizeDisplayName(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().slice(0, 24);
}

function safeSend(ws, payload) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function broadcast(roomId, payload, excludeId) {
  const room = rooms.get(roomId);
  if (!room) {
    return;
  }
  for (const clientId of room) {
    if (clientId === excludeId) {
      continue;
    }
    const peer = clients.get(clientId);
    if (peer) {
      safeSend(peer, payload);
    }
  }
}

function leaveRoom(ws) {
  if (!ws.room) {
    return;
  }
  const room = rooms.get(ws.room);
  if (room) {
    room.delete(ws.id);
    if (room.size === 0) {
      rooms.delete(ws.room);
    }
  }
  broadcast(ws.room, { type: 'peer-left', id: ws.id }, ws.id);
  shares.delete(ws.id);
  names.delete(ws.id);
  ws.room = null;
}

wss.on('connection', (ws) => {
  ws.id = crypto.randomUUID();
  ws.room = null;
  clients.set(ws.id, ws);

  safeSend(ws, { type: 'welcome', id: ws.id });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (err) {
      return;
    }

    if (msg.type === 'join') {
      const roomId = typeof msg.room === 'string' && msg.room.trim() ? msg.room.trim() : 'lobby';
      const name = sanitizeDisplayName(msg.name);
      const room = rooms.get(roomId) || new Set();
      const peers = Array.from(room);
      const shareInfo = peers
        .map((peerId) => {
          const share = shares.get(peerId);
          if (!share) {
            return null;
          }
          return { id: peerId, trackId: share.trackId, position: share.position };
        })
        .filter(Boolean);
      const peerNames = peers.reduce((acc, peerId) => {
        const peerName = names.get(peerId);
        if (peerName) {
          acc[peerId] = peerName;
        }
        return acc;
      }, {});
      room.add(ws.id);
      rooms.set(roomId, room);
      ws.room = roomId;
      if (name) {
        names.set(ws.id, name);
      } else {
        names.delete(ws.id);
      }

      safeSend(ws, { type: 'peers', peers, shares: shareInfo, names: peerNames });
      broadcast(roomId, { type: 'peer-joined', id: ws.id, name }, ws.id);
      return;
    }

    if (msg.type === 'name-update') {
      if (!ws.room) {
        return;
      }
      const name = sanitizeDisplayName(msg.name);
      if (name) {
        names.set(ws.id, name);
      } else {
        names.delete(ws.id);
      }
      broadcast(ws.room, { type: 'name-update', id: ws.id, name }, ws.id);
      return;
    }

    if (msg.type === 'share-start') {
      if (!ws.room || !msg.trackId) {
        return;
      }
      const shareState = {
        trackId: msg.trackId,
        position: msg.position
      };
      shares.set(ws.id, shareState);
      broadcast(
        ws.room,
        {
          type: 'share-start',
          id: ws.id,
          trackId: msg.trackId,
          position: msg.position
        },
        ws.id
      );
      return;
    }

    if (msg.type === 'share-stop') {
      if (!ws.room) {
        return;
      }
      shares.delete(ws.id);
      broadcast(ws.room, { type: 'share-stop', id: ws.id }, ws.id);
      return;
    }

    if (msg.type === 'offer' || msg.type === 'answer' || msg.type === 'ice') {
      const target = clients.get(msg.to);
      if (!target) {
        return;
      }
      safeSend(target, {
        type: msg.type,
        from: ws.id,
        sdp: msg.sdp,
        candidate: msg.candidate
      });
    }
  });

  ws.on('close', () => {
    leaveRoom(ws);
    clients.delete(ws.id);
  });
});

const PORT = 3847;
server.listen(PORT, () => {
  console.log(`webrtsee server running on http://localhost:${PORT}`);
});
