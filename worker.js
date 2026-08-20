export class GameRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sessions = new Map();

    // Restore hibernatable WebSocket sessions after the Durable Object wakes up.
    for (const ws of this.state.getWebSockets()) {
      const attachment = ws.deserializeAttachment();
      if (attachment?.id) {
        this.sessions.set(ws, {
          id: attachment.id,
          team: attachment.team,
          player: attachment.player || this.defaultPlayer(attachment.id, attachment.team),
          lastHitAt: 0
        });
      }
    }
  }

  defaultPlayer(id, team) {
    return {
      id,
      team,
      x: team === "blue" ? 18 : 78,
      y: 78,
      angle: team === "blue" ? 0 : Math.PI,
      hits: 0,
      score: 0,
      out: false
    };
  }

  send(ws, message) {
    try {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
    } catch {}
  }

  broadcast(message, except = null) {
    for (const ws of this.sessions.keys()) {
      if (ws === except) continue;
      this.send(ws, message);
    }
  }

  snapshot(except = null) {
    const players = [];
    for (const [ws, session] of this.sessions) {
      if (ws === except) continue;
      players.push({ ...session.player });
    }
    return players;
  }

  async fetch(request) {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Holi Warriors multiplayer room", { status: 426 });
    }

    if (this.sessions.size >= 2) {
      return new Response("Room is full", { status: 409 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const id = crypto.randomUUID().slice(0, 8);
    const team = this.sessions.size === 0 ? "blue" : "red";
    const player = this.defaultPlayer(id, team);

    // Hibernatable WebSocket API: keeps connected clients alive while the DO can sleep when idle.
    this.state.acceptWebSocket(server);
    server.serializeAttachment({ id, team, player });
    this.sessions.set(server, { id, team, player, lastHitAt: 0 });

    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws, message) {
    const session = this.sessions.get(ws);
    if (!session) return;

    let msg;
    try {
      msg = JSON.parse(typeof message === "string" ? message : new TextDecoder().decode(message));
    } catch {
      return;
    }

    if (msg.type === "join") {
      session.player = this.defaultPlayer(session.id, session.team);
      ws.serializeAttachment({ id: session.id, team: session.team, player: session.player });

      this.send(ws, {
        type: "welcome",
        id: session.id,
        team: session.team,
        players: this.snapshot(ws)
      });

      this.broadcast({ type: "player_joined", player: { ...session.player } }, ws);
      if (this.sessions.size === 2) this.broadcast({ type: "room_ready", players: this.snapshot() });
      return;
    }

    if (msg.type === "state" && msg.player) {
      const p = msg.player;
      session.player.x = Number.isFinite(p.x) ? Math.max(2, Math.min(94, p.x)) : session.player.x;
      session.player.y = Number.isFinite(p.y) ? Math.max(2, Math.min(94, p.y)) : session.player.y;
      session.player.angle = Number.isFinite(p.angle) ? p.angle : session.player.angle;

      // Server owns score/hit/out values; clients only send movement and aim.
      this.broadcast({
        type: "state",
        player: {
          id: session.id,
          team: session.team,
          x: session.player.x,
          y: session.player.y,
          angle: session.player.angle,
          hits: session.player.hits,
          score: session.player.score,
          out: session.player.out
        }
      }, ws);
      return;
    }

    if (msg.type === "hit" && typeof msg.targetId === "string") {
      const now = Date.now();
      if (now - session.lastHitAt < 120) return;
      session.lastHitAt = now;

      let targetEntry = null;
      for (const [otherWs, other] of this.sessions) {
        if (other.id === msg.targetId && other.team !== session.team) {
          targetEntry = [otherWs, other];
          break;
        }
      }
      if (!targetEntry) return;

      const [, target] = targetEntry;
      if (target.player.out) return;

      session.player.score += 10;
      target.player.hits += 1;
      let knockedOut = false;
      if (target.player.hits >= 10) {
        target.player.hits = 0;
        target.player.out = true;
        knockedOut = true;
      }

      for (const connected of this.sessions.keys()) {
        this.send(connected, {
          type: "hit_result",
          shooterId: session.id,
          targetId: target.id,
          shooterScore: session.player.score,
          targetHits: target.player.hits,
          targetOut: target.player.out,
          knockedOut
        });
      }

      if (knockedOut) {
        setTimeout(() => {
          const current = [...this.sessions.values()].find(s => s.id === target.id);
          if (!current) return;
          current.player.out = false;
          current.player.hits = 0;
          current.player.x = current.team === "blue" ? 18 : 78;
          current.player.y = 78;
          this.broadcast({ type: "respawn", player: { ...current.player } });
        }, 3000);
      }
      return;
    }
  }

  webSocketClose(ws) {
    const session = this.sessions.get(ws);
    this.sessions.delete(ws);
    if (session) this.broadcast({ type: "player_left", id: session.id });
  }

  webSocketError(ws) {
    this.webSocketClose(ws);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/ws/")) {
      const code = url.pathname.split("/")[2]?.toUpperCase() || "DEFAULT";
      if (!/^[A-Z0-9]{6}$/.test(code)) return new Response("Invalid room code", { status: 400 });
      const id = env.ROOMS.idFromName(code);
      return env.ROOMS.get(id).fetch(request);
    }
    return env.ASSETS.fetch(request);
  }
};
