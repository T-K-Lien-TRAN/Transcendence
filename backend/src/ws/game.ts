import { FastifyInstance, FastifyRequest } from "fastify";
import websocket from "@fastify/websocket";
import { WebSocket, WebSocketServer } from "ws";
import http from "http";

// --------------------
// Game state via raw ws
// --------------------
interface GameState {
  player1Y: number;
  player2Y: number;
  ballX: number;
  ballY: number;
}

export function setupWebSocket(server: http.Server) {
  const wss = new WebSocketServer({ server });
  let state: GameState = { player1Y: 100, player2Y: 100, ballX: 250, ballY: 150 };

  wss.on("connection", (ws) => {
    ws.send(JSON.stringify(state));

    ws.on("message", (msg) => {
      const data = JSON.parse(msg.toString()) as Partial<GameState>;
      state = { ...state, ...data };
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify(state));
        }
      });
    });
  });
}

// --------------------
// Online users via Fastify WS
// --------------------
const onlineUsers = new Map<number, WebSocket>();

interface WSQuery {
    userId: string;
}
export function setupGameWS(fastify: FastifyInstance) {
    fastify.register(websocket);

    fastify.get<{ Querystring: WSQuery }>(
        "/ws",
        { websocket: true },
        (connection, request: FastifyRequest<{ Querystring: WSQuery }>) => {
            const socket: WebSocket = (connection as any).socket;
            const userId = Number(request.query.userId);
            onlineUsers.set(userId, socket);

            console.log(`User ${userId} connected`);
            broadcastOnlineUsers();

            socket.on("close", () => {
                onlineUsers.delete(userId);
                broadcastOnlineUsers();
            });
        }
    );
}

function broadcastOnlineUsers() {
    const ids = Array.from(onlineUsers.keys());
    for (const [, socket] of onlineUsers) {
        if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: "onlineUsers", users: ids }));
        }
    }
}
