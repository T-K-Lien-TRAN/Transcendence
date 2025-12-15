import { FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import { WebSocket } from "ws";
import type { Socket as IOSocket, Server as IOServer } from "socket.io";

let fastifyRef: FastifyInstance | null = null;

// --------------------
// Game matches only
// --------------------
interface GameQuery { matchId?: string; userId: string; token?: string; }

interface Match {
    matchId: number;
    mode: 2 | 4;
    players: number[];
    sockets: Map<number, WebSocket>;
    ioSockets: Map<number, IOSocket>;
    state: GameState;
    scores: Record<string, number>;
    names: Record<number, string>;
    ready: Set<number>;
    started: boolean;
    countdownTimer?: NodeJS.Timeout | null;
}

interface GameState2P {
    mode: 2;
    paddles: { p1: number; p2: number };
    ball: BallState;
}

interface GameState4P {
    mode: 4;
    paddles: { p1: number; p2: number; p3: number; p4: number };
    ball: BallState;
}

type GameState = GameState2P | GameState4P;

interface BallState { x: number; y: number; vx: number; vy: number; }

// --------------------
// State
// --------------------
const matches = new Map<number, Match>();
let duoQueue: number[] = [];
let quadQueue: number[] = [];
let duoStatus: Record<number, number> = {};
let quadStatus: Record<number, number> = {};

// --------------------
// Create Match
// --------------------
function createMatch(matchId: number, mode: 2 | 4, players: number[]) {
    const baseBall: BallState = { x: ARENA_W / 2, y: ARENA_H / 2, vx: 0, vy: 0 };
    const state: GameState = mode === 2
        ? { mode: 2, paddles: { p1: 300, p2: 300 }, ball: { ...baseBall } }
        : { mode: 4, paddles: { p1: 300, p2: 300, p3: 300, p4: 300 }, ball: { ...baseBall } };
    const scores: Record<string, number> = mode === 2
        ? { p1: 0, p2: 0 }
        : { p1: 0, p2: 0, p3: 0, p4: 0 };

    const match: Match = {
        matchId,
        mode,
        players,
        sockets: new Map(),
        ioSockets: new Map(),
        state,
        scores,
        names: {},
        ready: new Set(),
        started: false,
        countdownTimer: null,
    };
    matches.set(matchId, match);
    return match;
}
function launchBall(ball: BallState) {
    const fresh = createBall();
    ball.x = fresh.x;
    ball.y = fresh.y;
    ball.vx = fresh.vx;
    ball.vy = fresh.vy;
}

// --------------------
// Matchmaking
// --------------------
function joinDuoQueue(userId: number): number {
    if (duoQueue.length > 0) {
        const opponentId = duoQueue.shift()!;
        const matchId = Date.now();
        createMatch(matchId, 2, [opponentId, userId]);
        duoStatus[opponentId] = matchId;
        duoStatus[userId] = matchId;
        return matchId;
    } else {
        duoQueue.push(userId);
        return -1;
    }
}

function joinQuadQueue(userId: number): number {
    quadQueue.push(userId);
    if (quadQueue.length >= 4) {
        const players = quadQueue.splice(0, 4);
        const matchId = Date.now();
        createMatch(matchId, 4, players);
        players.forEach(id => { quadStatus[id] = matchId; });
        return matchId;
    }
    return -1;
}

// --------------------
// WebSocket Setup (game only)
// --------------------
export function setupGameWS(fastify: FastifyInstance) {
    fastifyRef = fastify;
    fastify.register(websocket);

    fastify.get<{ Querystring: GameQuery }>(
        "/game",
        { websocket: true },
        async (conn, req) => {
            const socket: WebSocket = (conn as any).socket;
            const userId = Number(req.query.userId);
            const matchId = req.query.matchId ? Number(req.query.matchId) : undefined;

            // Token must match the userId
            // For gameplay, we accept userId from query to avoid websocket auth failures in browsers.
            const queryIdNum = Number.isFinite(userId) ? userId : null;
            const tokenUserId: number | null = null;

            // Join match if matchId provided
            let match: Match | undefined;
            let playerId: number | null = null;
            if (matchId && matches.has(matchId)) {
                const found = matches.get(matchId);
                if (!found) {
                    socket.close(4404, "Match not found");
                    return;
                }
                match = found;

            // Choose the player id to attach the socket to: use the query userId
            const queryIdNum = Number.isFinite(userId) ? userId : null;
            playerId = match.players.find(p => queryIdNum !== null ? p === queryIdNum : false) ?? null;

            // Resolve player name (ws path doesn't have username, fallback to db)
            const lookupUsername = (fastify as any).lookupUsername as (id: number) => Promise<string>;
            if (playerId && lookupUsername) {
                lookupUsername(playerId).then((name) => {
                    match!.names[playerId!] = name;
                }).catch(() => {
                    match!.names[playerId!] = `P${playerId}`;
                });
            }

                if (!playerId || !match) {
                    socket.close(4403, "Forbidden");
                    return;
                }

                match.sockets.set(playerId, socket);
                socket.send(JSON.stringify({
                    type: "state",
                    state: match.state,
                    scores: match.scores,
                    names: buildNames(match),
                    config: {
                        width: ARENA_W,
                        height: ARENA_H,
                        paddleLength: PADDLE_LEN,
                        paddleThickness: PADDLE_THICK,
                        ballRadius: BALL_RADIUS
                    }
                }));
                console.log(`User ${userId} joined match ${matchId}`);
            } else {
                socket.close(4404, "Match not found");
                return;
            }

            const effectivePlayerId = playerId;

            socket.on("message", (raw: any) => {
                const data = JSON.parse(raw.toString());

                // Identify player in match
                if (data.type === "whoami" && match && effectivePlayerId != null) {
            const index = match.players.indexOf(effectivePlayerId) + 1;
            socket.send(JSON.stringify({ type: "identify", index, names: buildNames(match) }));
            return;
        }

                // Ready up
                if (data.type === "ready" && match && effectivePlayerId != null) {
                    match.ready.add(effectivePlayerId);
                    broadcastReady(match);
                    tryStartCountdown(match);
                    return;
                }

                // Paddle move for match
                if (data.type === "paddle" && match && match.players.includes(effectivePlayerId!)) {
                    const index = match.players.indexOf(effectivePlayerId!) + 1;
                    if (match.state.mode === 2) {
                        (match.state.paddles as any)[`p${index}`] = clamp(data.value, PADDLE_LEN / 2, ARENA_H - PADDLE_LEN / 2);
                    } else {
                        if (index <= 2 && data.axis === "y")
                            (match.state.paddles as any)[`p${index}`] = clamp(data.value, PADDLE_LEN / 2, ARENA_H - PADDLE_LEN / 2);
                        if (index >= 3 && data.axis === "x")
                            (match.state.paddles as any)[`p${index}`] = clamp(data.value, PADDLE_LEN / 2, ARENA_W - PADDLE_LEN / 2);
                    }
                }
            });

            socket.on("close", () => {
                if (match && effectivePlayerId != null) {
                    match.sockets.delete(effectivePlayerId);
                    match.ready.delete(effectivePlayerId);
                    stopCountdown(match);
                    broadcastReady(match);
                    // If everyone left, clean up match. Otherwise keep it alive to avoid early disconnect messages.
                    if (match.sockets.size === 0) {
                        matches.delete(match.matchId);
                    }
                }
            });
        }
    );

    // Physics loop for matches
    setInterval(() => {
        for (const match of matches.values()) {
            stepPhysics(match);
        }
    }, 16);

    // ---------------------------
    // Socket.io fallback for game (polling-friendly)
    // ---------------------------
    const io: IOServer | undefined = (fastify as any).io;
    if (io) {
        const gameNsp = io.of("/game");
        gameNsp.on("connection", (socket) => {
            const auth = socket.handshake.auth || {};
            const matchId = Number(auth.matchId);
            const userId = Number(auth.userId);
            const username = typeof auth.username === "string" && auth.username.trim()
                ? auth.username.trim()
                : `P${userId}`;
            if (!Number.isFinite(matchId) || !Number.isFinite(userId)) {
                socket.disconnect(true);
                return;
            }

            const match = matches.get(matchId);
            if (!match || !match.players.includes(userId)) {
                socket.emit("error", { message: "Forbidden" });
                socket.disconnect(true);
                return;
            }

            match.names[userId] = username;
            match.ioSockets.set(userId, socket);
            const index = match.players.indexOf(userId) + 1;
            socket.emit("identify", { index });
            socket.emit("state", {
                state: match.state,
                scores: match.scores,
                names: buildNames(match),
                config: {
                    width: ARENA_W,
                    height: ARENA_H,
                    paddleLength: PADDLE_LEN,
                    paddleThickness: PADDLE_THICK,
                    ballRadius: BALL_RADIUS
                }
            });

            socket.on("paddle", (data: any) => {
                // Only accept moves if this user is mapped in players list
                const idx = match.players.indexOf(userId);
                if (idx === -1) return;
                const paddleIndex = idx + 1; // 1-based
                if (match.state.mode === 2) {
                    (match.state.paddles as any)[`p${paddleIndex}`] = clamp(data.value, PADDLE_LEN / 2, ARENA_H - PADDLE_LEN / 2);
                } else {
                    if (paddleIndex <= 2 && data.axis === "y")
                        (match.state.paddles as any)[`p${paddleIndex}`] = clamp(data.value, PADDLE_LEN / 2, ARENA_H - PADDLE_LEN / 2);
                    if (paddleIndex >= 3 && data.axis === "x")
                        (match.state.paddles as any)[`p${paddleIndex}`] = clamp(data.value, PADDLE_LEN / 2, ARENA_W - PADDLE_LEN / 2);
                }
            });

            socket.on("ready", () => {
                match.ready.add(userId);
                broadcastReady(match);
                tryStartCountdown(match);
            });

            socket.on("disconnect", () => {
                match.ioSockets.delete(userId);
                match.ready.delete(userId);
                stopCountdown(match);
                broadcastReady(match);
                if (match.ioSockets.size === 0 && match.sockets.size === 0) {
                    matches.delete(match.matchId);
                }
            });
        });
    }

    // ---------------------------
    // API endpoints
    // ---------------------------
    fastify.post<{ Body: { userId: number } }>("/api/join-duo", async (req) => {
        const matchId = joinDuoQueue(req.body.userId);
        return matchId === -1
            ? { ok: true, status: "waiting" }
            : { ok: true, status: "matched", matchId };
    });

    fastify.get<{ Querystring: { userId: string } }>("/api/join-duo/status", async (req) => {
        const userId = Number(req.query.userId);
        if (duoStatus[userId]) {
            const matchId = duoStatus[userId];
            delete duoStatus[userId];
            return { ok: true, status: "matched", matchId };
        }
        return { ok: true, status: "waiting" };
    });

    fastify.post<{ Body: { userId: number } }>("/api/join-quad", async (req) => {
        const matchId = joinQuadQueue(req.body.userId);
        return matchId === -1
            ? { ok: true, status: "waiting" }
            : { ok: true, status: "matched", matchId };
    });

    fastify.get<{ Querystring: { userId: string } }>("/api/join-quad/status", async (req) => {
        const userId = Number(req.query.userId);
        if (quadStatus[userId]) {
            const matchId = quadStatus[userId];
            delete quadStatus[userId];
            return { ok: true, status: "matched", matchId };
        }
        return { ok: true, status: "waiting" };
    });

    // Allow clients to cancel matchmaking to avoid stale queue entries
    fastify.post<{ Body: { userId: number } }>("/api/join-duo/cancel", async (req) => {
        cancelFromQueue(req.body.userId, duoQueue, duoStatus);
        return { ok: true };
    });

    fastify.post<{ Body: { userId: number } }>("/api/join-quad/cancel", async (req) => {
        cancelFromQueue(req.body.userId, quadQueue, quadStatus);
        return { ok: true };
    });
}

// --------------------
// Physics helpers
// --------------------
const ARENA_W = 600;
const ARENA_H = 600;
const PADDLE_LEN = 100;
const PADDLE_THICK = 10;
const BALL_RADIUS = 10;
const WIN_SCORE = 10;

function clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
}

function createBall(): BallState {
    const dirX = Math.random() > 0.5 ? 1 : -1;
    const dirY = Math.random() > 0.5 ? 1 : -1;
    return { x: ARENA_W / 2, y: ARENA_H / 2, vx: 300 * dirX, vy: 200 * dirY };
}

function resetBall(ball: BallState) {
    const fresh = createBall();
    ball.x = fresh.x;
    ball.y = fresh.y;
    ball.vx = fresh.vx;
    ball.vy = fresh.vy;
}

function broadcast(match: Match, payload: any) {
    const msg = JSON.stringify(payload);
    for (const socket of match.sockets.values()) {
        if (socket.readyState === WebSocket.OPEN) {
            socket.send(msg);
        }
    }
    // Also emit via socket.io if present
    for (const socket of match.ioSockets.values()) {
        socket.emit(payload.type, payload);
    }
}

function buildNames(match: Match) {
    const res: Record<string, string> = {};
    if (match.players[0]) res.p1 = match.names[match.players[0]] || `User ${match.players[0]}`;
    if (match.players[1]) res.p2 = match.names[match.players[1]] || `User ${match.players[1]}`;
    if (match.mode === 4) {
        if (match.players[2]) res.p3 = match.names[match.players[2]] || `User ${match.players[2]}`;
        if (match.players[3]) res.p4 = match.names[match.players[3]] || `User ${match.players[3]}`;
    }
    return res;
}

function broadcastReady(match: Match) {
    broadcast(match, {
        type: "ready",
        readyCount: match.ready.size,
        total: match.players.length,
        readyIds: Array.from(match.ready),
    });
}

function stopCountdown(match: Match) {
    if (match.countdownTimer) {
        clearInterval(match.countdownTimer);
        match.countdownTimer = null;
    }
}

function tryStartCountdown(match: Match) {
    if (match.started || match.countdownTimer) return;
    if (match.ready.size < match.players.length) return;

    let remaining = 5;
    broadcast(match, { type: "countdown", seconds: remaining });
    match.countdownTimer = setInterval(() => {
        remaining -= 1;
        if (remaining > 0) {
            broadcast(match, { type: "countdown", seconds: remaining });
            return;
        }

        stopCountdown(match);
        match.started = true;
        launchBall(match.state.ball);
        broadcast(match, {
            type: "start",
            state: match.state,
            scores: match.scores,
            names: buildNames(match),
        });
    }, 1000);
}

async function recordMatch(match: Match, winnerKey: string) {
    if (!fastifyRef) return;
    const db = (fastifyRef as any).db;
    if (!db) return;
    if (match.mode !== 2) return; // handle duo for now
    const p1 = match.players[0];
    const p2 = match.players[1];
    const s1 = match.scores.p1 ?? 0;
    const s2 = match.scores.p2 ?? 0;
    const winnerId = winnerKey === "p1" ? p1 : p2;

    try {
        // Ensure stats rows exist
        await db.run(`INSERT OR IGNORE INTO "UserStats" (user_id) VALUES (?)`, [p1]);
        await db.run(`INSERT OR IGNORE INTO "UserStats" (user_id) VALUES (?)`, [p2]);

        // Fetch current ELOs
        const stats1 = await db.get(`SELECT elo FROM "UserStats" WHERE user_id = ?`, [p1]);
        const stats2 = await db.get(`SELECT elo FROM "UserStats" WHERE user_id = ?`, [p2]);
        const elo1 = stats1?.elo ?? 1000;
        const elo2 = stats2?.elo ?? 1000;

        // Compute new ELO (K-factor 32)
        const expected1 = 1 / (1 + Math.pow(10, (elo2 - elo1) / 400));
        const expected2 = 1 - expected1;
        const result1 = s1 === s2 ? 0.5 : s1 > s2 ? 1 : 0;
        const result2 = 1 - result1;
        const K = 32;
        const newElo1 = Math.round(elo1 + K * (result1 - expected1));
        const newElo2 = Math.round(elo2 + K * (result2 - expected2));

        await db.run(
            `INSERT INTO "MatchHistory" (user_id, opponent_id, user_score, opponent_score, user_elo, result) VALUES (?, ?, ?, ?, ?, ?)`,
            [p1, p2, s1, s2, newElo1, s1 > s2 ? "win" : s1 < s2 ? "loss" : "draw"]
        );
        await db.run(
            `INSERT INTO "MatchHistory" (user_id, opponent_id, user_score, opponent_score, user_elo, result) VALUES (?, ?, ?, ?, ?, ?)`,
            [p2, p1, s2, s1, newElo2, s2 > s1 ? "win" : s2 < s1 ? "loss" : "draw"]
        );

        // Update simple stats (matches_played, winrate) if table exists
        for (const uid of [p1, p2]) {
            const statsRow = await db.get(`SELECT COUNT(*) as total FROM "MatchHistory" WHERE user_id = ?`, [uid]);
            const winsRow = await db.get(`SELECT COUNT(*) as wins FROM "MatchHistory" WHERE user_id = ? AND result = 'win'`, [uid]);
            const total = statsRow?.total || 0;
            const wins = winsRow?.wins || 0;
            const winrate = total > 0 ? (wins / total) * 100 : 0;
            const elo = uid === p1 ? newElo1 : newElo2;
            await db.run(
                `INSERT INTO "UserStats" (user_id, matches_played, winrate, elo) VALUES (?, ?, ?, ?)
                 ON CONFLICT(user_id) DO UPDATE SET matches_played=excluded.matches_played, winrate=excluded.winrate, elo=excluded.elo`,
                [uid, total, winrate, elo]
            );
        }
    } catch (err) {
        fastifyRef.log.error({ err }, "Failed to record match");
    }
}

function handleScore(match: Match, scorerKey: string) {
    match.scores[scorerKey] = (match.scores[scorerKey] || 0) + 1;
    resetBall(match.state.ball);

    broadcast(match, {
        type: "state",
        state: match.state,
        scores: match.scores,
        names: buildNames(match),
    });

    const reached = match.scores[scorerKey] >= WIN_SCORE;
    if (reached) {
        const names = buildNames(match);
        broadcast(match, { type: "end", winner: scorerKey, names });
        stopCountdown(match);
        recordMatch(match, scorerKey);
        matches.delete(match.matchId);
    }
}

function stepPhysics(match: Match) {
    if (!match.started) {
        broadcast(match, {
            type: "state",
            state: match.state,
            scores: match.scores,
            names: buildNames(match),
        });
        return;
    }
    const b = match.state.ball;
    b.x += b.vx * 0.016;
    b.y += b.vy * 0.016;

    // Wall collisions (top/bottom) only for classic 2-player
    if (match.mode === 2) {
        if (b.y - BALL_RADIUS < 0) {
            b.y = BALL_RADIUS;
            b.vy *= -1;
        }
        if (b.y + BALL_RADIUS > ARENA_H) {
            b.y = ARENA_H - BALL_RADIUS;
            b.vy *= -1;
        }
    }

    // Paddles
    const p = match.state.paddles as any;

    // Left paddle (player1)
    if (b.x - BALL_RADIUS < PADDLE_THICK + 20) {
        const minY = p.p1 - PADDLE_LEN / 2;
        const maxY = p.p1 + PADDLE_LEN / 2;
        if (b.y >= minY && b.y <= maxY) {
            b.x = PADDLE_THICK + 20 + BALL_RADIUS;
            b.vx = Math.abs(b.vx);
        }
    }

    // Right paddle (player2)
    if (b.x + BALL_RADIUS > ARENA_W - (PADDLE_THICK + 20)) {
        const minY = p.p2 - PADDLE_LEN / 2;
        const maxY = p.p2 + PADDLE_LEN / 2;
        if (b.y >= minY && b.y <= maxY) {
            b.x = ARENA_W - (PADDLE_THICK + 20) - BALL_RADIUS;
            b.vx = -Math.abs(b.vx);
        }
    }

    if (match.mode === 4) {
        // Top paddle (player3)
        if (b.y - BALL_RADIUS < PADDLE_THICK + 20) {
            const minX = p.p3 - PADDLE_LEN / 2;
            const maxX = p.p3 + PADDLE_LEN / 2;
            if (b.x >= minX && b.x <= maxX) {
                b.y = PADDLE_THICK + 20 + BALL_RADIUS;
                b.vy = Math.abs(b.vy);
            }
        }

        // Bottom paddle (player4)
        if (b.y + BALL_RADIUS > ARENA_H - (PADDLE_THICK + 20)) {
            const minX = p.p4 - PADDLE_LEN / 2;
            const maxX = p.p4 + PADDLE_LEN / 2;
            if (b.x >= minX && b.x <= maxX) {
                b.y = ARENA_H - (PADDLE_THICK + 20) - BALL_RADIUS;
                b.vy = -Math.abs(b.vy);
            }
        }
    }

    // Goals
    if (b.x < 0) {
        handleScore(match, "p2");
        return;
    }
    if (b.x > ARENA_W) {
        handleScore(match, "p1");
        return;
    }
    if (match.mode === 4) {
        if (b.y < 0) {
            handleScore(match, "p4");
            return;
        }
        if (b.y > ARENA_H) {
            handleScore(match, "p3");
            return;
        }
    }

    broadcast(match, {
        type: "state",
        state: match.state,
        scores: match.scores,
        names: buildNames(match),
    });
}

// --------------------
// Queue helpers
// --------------------
function cancelFromQueue(userId: number, queue: number[], status: Record<number, number>) {
    const idx = queue.indexOf(userId);
    if (idx >= 0) queue.splice(idx, 1);
    delete status[userId];
}
