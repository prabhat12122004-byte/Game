export class GameRoom {

  constructor(state, env) {

    this.state = state;
    this.env = env;

    this.players = new Map();

    this.started = false;

    this.map = "jungle";

  }


  broadcast(message){

    const data =
      JSON.stringify(message);

    for(const ws of this.players.keys()){

      try{

        ws.send(data);

      }
      catch{}

    }

  }


  getPlayers(){

    return [
      ...this.players.values()
    ];

  }


  async fetch(request){

    if(
      request.headers.get("Upgrade")
      !==
      "websocket"
    ){

      return new Response(
        "Hill Warriors multiplayer server"
      );

    }


    const pair =
      new WebSocketPair();

    const client =
      pair[0];

    const server =
      pair[1];

    server.accept();


    const id =
      crypto.randomUUID();


    server.addEventListener(
      "message",
      event => {

        let msg;

        try{

          msg =
            JSON.parse(
              event.data
            );

        }
        catch{

          return;

        }


        /* JOIN */

        if(msg.type==="join"){

          /* Maximum 4 human players */

          if(this.players.size>=4){

            server.send(
              JSON.stringify({
                type:"full",
                message:
                  "Room is full. Maximum 4 players."
              })
            );

            server.close();

            return;

          }


          const player={

            id:id,

            name:
              String(
                msg.name ||
                "Player"
              ).slice(0,18),

            ready:false,

            color:
              this.players.size===0
              ? "#2477ff"
              : this.players.size===1
              ? "#e53935"
              : this.players.size===2
              ? "#20b45a"
              : "#ff8c00"

          };


          this.players.set(
            server,
            player
          );


          this.broadcast({

            type:"lobby",

            players:
              this.getPlayers(),

            maximum:4

          });


          return;

        }


        const player =
          this.players.get(server);


        if(!player)
          return;


        /* READY */

        if(msg.type==="ready"){

          player.ready=true;


          this.broadcast({

            type:"lobby",

            players:
              this.getPlayers(),

            maximum:4

          });


          const players =
            this.getPlayers();


          /* Start when everyone is ready */

          if(
            players.length>0 &&
            players.every(
              p=>p.ready
            )
          ){

            this.startGame();

          }

        }

      }
    );


    server.addEventListener(
      "close",
      ()=>{

        this.players.delete(
          server
        );

        this.broadcast({

          type:"lobby",

          players:
            this.getPlayers(),

          maximum:4

        });

      }
    );


    return new Response(
      null,
      {
        status:101,
        webSocket:client
      }
    );

  }


  startGame(){

    if(this.started)
      return;


    this.started=true;


    const humans =
      this.getPlayers();


    /*
      Always make exactly
      four racers.

      1 human = 3 bots
      2 humans = 2 bots
      3 humans = 1 bot
      4 humans = 0 bots
    */

    const botCount =
      4-humans.length;


    const bots=[];


    for(
      let i=0;
      i<botCount;
      i++
    ){

      bots.push({

        id:"bot-"+i,

        name:"BOT "+(i+1),

        color:"#777777",

        bot:true

      });

    }


    for(
      const ws of this.players.keys()
    ){

      ws.send(

        JSON.stringify({

          type:"start",

          map:this.map,

          players:
            humans,

          bots:bots

        })

      );

    }

  }

}


/* =========================
   MAIN WORKER
========================= */

export default {

  async fetch(request,env){

    const url =
      new URL(request.url);


    /*
      Multiplayer WebSocket
      endpoint:

      /ws/ROOMCODE
    */

    if(
      url.pathname.startsWith(
        "/ws/"
      )
    ){

      const code =
        url.pathname
          .split("/")[2]
          || "DEFAULT";


      const id =
        env.GameRoom.idFromName(
          code
        );


      const room =
        env.GameRoom.get(id);


      return room.fetch(
        request
      );

    }


    /*
      Serve game files
      from /public
    */

    return env.ASSETS.fetch(
      request
    );

  }

};
