export default {
  async fetch(request, env) {
    const upgrade = request.headers.get('Upgrade');
    if (upgrade && upgrade.toLowerCase() === 'websocket') {
      const url = new URL(request.url);
      const room = sanitizeRoomName(url.searchParams.get('room') || 'lobby');
      const roomId = env.ROOMS.idFromName(room);
      const stub = env.ROOMS.get(roomId);
      return stub.fetch(request);
    }

    return env.ASSETS.fetch(request);
  }
};

function sanitizeRoomName(value) {
  const cleaned = value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  return cleaned || 'lobby';
}

export class Room {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.clients = new Map();
    this.joined = new Set();
    this.shares = new Map();
  }

  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected websocket', { status: 426 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const clientId = crypto.randomUUID();

    this.clients.set(clientId, server);
    server.accept();

    server.addEventListener('message', (event) => {
      this.handleMessage(clientId, event);
    });
    server.addEventListener('close', () => {
      this.handleClose(clientId);
    });
    server.addEventListener('error', () => {
      this.handleClose(clientId);
    });

    this.safeSend(server, { type: 'welcome', id: clientId });

    return new Response(null, { status: 101, webSocket: client });
  }

  safeSend(ws, payload) {
    if (ws.readyState !== WebSocket.OPEN) {
      return;
    }
    try {
      ws.send(JSON.stringify(payload));
    } catch (err) {
      // Ignore send errors for closed sockets.
    }
  }

  broadcast(payload, excludeId) {
    for (const peerId of this.joined) {
      if (peerId === excludeId) {
        continue;
      }
      const peer = this.clients.get(peerId);
      if (peer) {
        this.safeSend(peer, payload);
      }
    }
  }

  handleClose(clientId) {
    this.clients.delete(clientId);
    if (this.joined.has(clientId)) {
      this.joined.delete(clientId);
      this.shares.delete(clientId);
      this.broadcast({ type: 'peer-left', id: clientId }, clientId);
    } else {
      this.shares.delete(clientId);
    }
  }

  handleMessage(clientId, event) {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch (err) {
      return;
    }

    if (msg.type === 'join') {
      if (this.joined.has(clientId)) {
        return;
      }
      const peers = Array.from(this.joined);
      const shares = peers
        .map((peerId) => {
          const share = this.shares.get(peerId);
          if (!share) {
            return null;
          }
          return { id: peerId, trackId: share.trackId, position: share.position };
        })
        .filter(Boolean);

      this.joined.add(clientId);
      const ws = this.clients.get(clientId);
      if (ws) {
        this.safeSend(ws, { type: 'peers', peers, shares });
      }
      this.broadcast({ type: 'peer-joined', id: clientId }, clientId);
      return;
    }

    if (!this.joined.has(clientId)) {
      return;
    }

    if (msg.type === 'pose') {
      this.broadcast(
        {
          type: 'pose',
          id: clientId,
          position: msg.position,
          rotation: msg.rotation
        },
        clientId
      );
      return;
    }

    if (msg.type === 'share-start') {
      if (!msg.trackId) {
        return;
      }
      const shareState = {
        trackId: msg.trackId,
        position: msg.position
      };
      this.shares.set(clientId, shareState);
      this.broadcast(
        {
          type: 'share-start',
          id: clientId,
          trackId: msg.trackId,
          position: msg.position
        },
        clientId
      );
      return;
    }

    if (msg.type === 'share-stop') {
      this.shares.delete(clientId);
      this.broadcast({ type: 'share-stop', id: clientId }, clientId);
      return;
    }

    if (msg.type === 'screenpose') {
      const share = this.shares.get(clientId);
      if (share && msg.position) {
        share.position = msg.position;
      }
      this.broadcast(
        {
          type: 'screenpose',
          id: clientId,
          position: msg.position
        },
        clientId
      );
      return;
    }

    if (msg.type === 'offer' || msg.type === 'answer' || msg.type === 'ice') {
      const target = this.clients.get(msg.to);
      if (!target) {
        return;
      }
      this.safeSend(target, {
        type: msg.type,
        from: clientId,
        sdp: msg.sdp,
        candidate: msg.candidate
      });
    }
  }
}
