export class GameRoom {
  constructor(state, env) {
    this.state = state;
    this.sessions = new Set();
  }
  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("Holi Warriors room");
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    this.sessions.add(server);
    server.addEventListener("close", () => this.sessions.delete(server));
    server.addEventListener("message", e => {
      for (const s of this.sessions) {
        try { s.send(e.data); } catch {}
      }
    });
    return new Response(null, {status:101, webSocket:client});
  }
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/ws/")) {
      const code = url.pathname.split("/")[2] || "default";
      const id = env.ROOMS.idFromName(code);
      return env.ROOMS.get(id).fetch(request);
    }
    return env.ASSETS.fetch(request);
  }
};