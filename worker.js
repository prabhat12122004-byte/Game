export class GameRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sessions = new Map();
    this.room = "";
    this.started = false;
    this.map = "jungle";
    this.time = 180;
  }

  broadcast(obj) {
    const data = JSON.stringify(obj);
    for (const ws of this.sessions.keys()) {
      try { ws.send(data); } catch {}
    }
  }

  roster() {
    return [...this.sessions.values()].map((p) => ({
      id:p.id,name:p.name,team:p.team,ready:p.ready
    }));
  }

  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket")
      return new Response("Holi Warriors GameRoom");

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();

    let pid = crypto.randomUUID();
    const firstFreeTeam = this.sessions.size % 2 === 0 ? "blue" : "red";

    server.addEventListener("message", (event) => {
      let m;
      try { m = JSON.parse(event.data); } catch { return; }

      if (m.type === "join") {
        if (this.sessions.size >= 6) {
          try { server.send(JSON.stringify({type:"error",message:"Room is full."})); } catch {}
          try { server.close(); } catch {}
          return;
        }
        const p = {
          id:pid,
          name:String(m.name || "Player").slice(0,18),
          team:firstFreeTeam,
          ready:false
        };
        this.sessions.set(server,p);
        this.room = new URL(request.url).pathname.split("/").pop().toUpperCase();
        server.send(JSON.stringify({type:"room",room:this.room,message:"Room created/joined. Choose Ready when you are prepared."}));
        this.broadcast({type:"lobby",players:this.roster(),max:6,map:this.map,time:this.time});
        return;
      }

      const p = this.sessions.get(server);
      if (!p) return;

      if (m.type === "ready") {
        p.ready = !!m.ready;
        if (m.map) this.map = ["jungle","sand","space"].includes(m.map) ? m.map : "jungle";
        if ([60,120,180,300].includes(Number(m.time))) this.time = Number(m.time);

        this.broadcast({type:"lobby",players:this.roster(),max:6,map:this.map,time:this.time});

        // The battle starts when at least one player is connected and all
        // currently connected humans are ready. Empty slots are bots.
        const people = [...this.sessions.values()];
        if (people.length && people.every(x => x.ready)) this.startBattle();
        return;
      }

      if (m.type === "state") {
        this.broadcast({type:"state",player:m.player});
        return;
      }

      if (m.type === "balloon") {
        // Relay the projectile to every other client so opponent balloons
        // are visible on all devices.
        this.broadcast({type:"balloon",balloon:m.balloon});
        return;
      }

      if (m.type === "hit") {
        this.broadcast({type:"hit",target:m.target,owner:m.owner});
        return;
      }
    });

    server.addEventListener("close", () => {
      this.sessions.delete(server);
      if (!this.started) this.broadcast({type:"lobby",players:this.roster(),max:6,map:this.map,time:this.time});
    });

    return new Response(null,{status:101,webSocket:client});
  }

  startBattle() {
    if (this.started) return;
    this.started = true;

    const humans = [...this.sessions.values()];
    const bots = [];
    let blueCount = humans.filter(p=>p.team==="blue").length;
    let redCount = humans.filter(p=>p.team==="red").length;
    let botIndex = 0;

    while (blueCount < 3) {
      const owner = humans[botIndex % humans.length].id;
      bots.push({id:`bot${botIndex++}`,name:`BOT ${botIndex}`,team:"blue",x:18+Math.random()*20,y:15+Math.random()*70,hp:100,angle:0,bot:true,owner});
      blueCount++;
    }
    while (redCount < 3) {
      const owner = humans[botIndex % humans.length].id;
      bots.push({id:`bot${botIndex++}`,name:`BOT ${botIndex}`,team:"red",x:62+Math.random()*20,y:15+Math.random()*70,hp:100,angle:3.14,bot:true,owner});
      redCount++;
    }

    for (const ws of this.sessions.keys()) {
      const me = this.sessions.get(ws);
      const humansForClient = humans.map(p=>({
        id:p.id,name:p.name,team:p.team,x:p.team==="blue"?12:82,y:50,hp:100,outUntil:0,angle:p.team==="blue"?0:3.14,score:0
      }));
      const mine = humansForClient.find(x=>x.id===me.id);
      ws.send(JSON.stringify({
        type:"start",
        map:this.map,
        time:this.time,
        me:mine,
        players:humansForClient,
        bots
      }));
    }
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
