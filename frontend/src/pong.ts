import { io, Socket } from "socket.io-client";

export type GameMode = "duo" | "quad" | "local-duo" | "local-quad";

type RemoteMode = "duo" | "quad";

type PaddleState = { p1: number; p2: number; p3?: number; p4?: number };

interface ClientState {
    paddles: PaddleState;
    ball: { x: number; y: number; vx: number; vy: number };
}

interface GameConfig {
    width: number;
    height: number;
    paddleLength: number;
    paddleThickness: number;
    ballRadius: number;
    paddleSpeed: number;
}

interface ServerStateMessage {
    type: "state";
    state: { paddles: PaddleState; ball: { x: number; y: number; vx: number; vy: number } };
    scores: Record<string, number>;
    config?: Partial<GameConfig>;
    names?: Record<string, string>;
}

interface ServerEndMessage {
    type: "end";
    winner?: string;
    reason?: string;
    leaver?: number;
}

const DEFAULT_CONFIG: GameConfig = {
    width: 600,
    height: 600,
    paddleLength: 100,
    paddleThickness: 10,
    ballRadius: 10,
    paddleSpeed: 5,
};

// --- Chat socket + état global match ---
let chatSocket: Socket | null = null;
let currentMatchId: number | null = null;

/**
 * Affiche et lance une partie (duo ou quad) + chat de match.
 */
export async function showGame(container: HTMLElement, mode: GameMode = "duo") {
    const isLocal = mode.startsWith("local");
    const isQuad = mode === "quad" || mode === "local-quad";
    const remoteMode: RemoteMode = mode === "duo" || mode === "quad" ? mode : "duo";

    currentMatchId = null;
    container.innerHTML = isLocal
        ? ""
        : `<div class="flex items-center justify-center h-[60vh] text-xl font-semibold text-gray-700">Looking for a match...</div>`;

    const storedMe = sessionStorage.getItem("me") || localStorage.getItem("me") || "{}";
    const me = JSON.parse(storedMe);
    const currentUserId = me.id;

    // Modes locaux n'ont pas besoin d'être connectés
    if (!isLocal && !currentUserId) {
        alert("User not logged in!");
        return;
    }

    const token = localStorage.getItem("jwt") || sessionStorage.getItem("token");
    if (!isLocal && !token) {
        alert("No token found, please log in again.");
        return;
    }

    // Elements créés après matchmaking (pour éviter l'affichage prématuré)
    let overlay: HTMLDivElement | null = null;
    let wrapper!: HTMLDivElement;
    let canvas!: HTMLCanvasElement;
    let ctx!: CanvasRenderingContext2D;
    let scoreBox!: HTMLDivElement;
    let statusBox!: HTMLDivElement;
    let readyButton: HTMLButtonElement | null = null;
    let messagesList: HTMLUListElement | null = null;
    let chatForm: HTMLFormElement | null = null;
    let chatInput: HTMLInputElement | null = null;

    // ---------------------------
    // State / config init
    // ---------------------------
    let config: GameConfig = { ...DEFAULT_CONFIG };
    let scores: Record<string, number> = isQuad ? { p1: 0, p2: 0, p3: 0, p4: 0 } : { p1: 0, p2: 0 };
    let state: ClientState = {
        paddles: isQuad
            ? { p1: config.height / 2, p2: config.height / 2, p3: config.width / 2, p4: config.width / 2 }
            : { p1: config.height / 2, p2: config.height / 2 },
        ball: {
            x: config.width / 2,
            y: config.height / 2,
            vx: 0,
            vy: 0,
        },
    };
    if (isLocal) {
        resetLocalBall(state, config);
    }

    const keys = new Set<string>();
    const keydownHandler = (e: KeyboardEvent) => {
        if (!isLocal && !matchStarted && !isReady && (e.key === " " || e.key === "Enter")) {
            e.preventDefault();
            sendReady();
            return;
        }
        keys.add(e.key);
    };
    const keyupHandler = (e: KeyboardEvent) => keys.delete(e.key);
    window.addEventListener("keydown", keydownHandler);
    window.addEventListener("keyup", keyupHandler);

    let gameSocket: Socket | null = null;
    let paddleInterval: number | null = null;
    let running = true;
    let matchStarted = isLocal;
    let isReady = isLocal;
    let myPaddleIndex: number | null = null;
    const setStatus = (text: string) => {
        if (statusBox) statusBox.textContent = text;
    };
    const sendReady = () => {
        if (isLocal || isReady) return;
        isReady = true;
        if (readyButton) {
            readyButton.disabled = true;
            readyButton.textContent = "Prêt";
        }
        setStatus("Prêt - en attente des autres joueurs");
        if (gameSocket) {
            gameSocket.emit("ready");
        }
    };

    // ---------------------------
    // Remote matchmaking + WS
    // ---------------------------
    if (!isLocal) {
        const joinUrl = remoteMode === "duo" ? "/api/join-duo" : "/api/join-quad";
        const statusUrl = remoteMode === "duo" ? "/api/join-duo/status" : "/api/join-quad/status";
        const cancelUrl = remoteMode === "duo" ? "/api/join-duo/cancel" : "/api/join-quad/cancel";

        await fetch(joinUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId: currentUserId }),
        });

        // Poll for match with timeout
        let matchId: number | null = null;
        const start = Date.now();
        while (!matchId && Date.now() - start < 20000) {
            const res = await fetch(`${statusUrl}?userId=${currentUserId}`);
            const data = await res.json();
            if (data.status === "matched") {
                matchId = data.matchId;
            } else {
                await wait(1000);
            }
        }

        if (!matchId) {
            await fetch(cancelUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ userId: currentUserId }),
            });
            container.innerHTML = "<p class='text-red-500 text-center mt-8'>Matchmaking cancelled (timeout)</p>";
            window.removeEventListener("keydown", keydownHandler);
            window.removeEventListener("keyup", keyupHandler);
            return;
        }

        // Match trouvé, on construit maintenant l'UI fullscreen
        ({
            overlay,
            wrapper,
            canvas,
            ctx,
            scoreBox,
            statusBox,
            messagesList,
            chatForm,
            chatInput,
        } = buildUI(container, !isLocal));

        currentMatchId = matchId;
        if (!isLocal) {
            readyButton = document.createElement("button");
            readyButton.textContent = "Je suis prêt";
            readyButton.style.position = "absolute";
            readyButton.style.left = "50%";
            readyButton.style.bottom = "24px";
            readyButton.style.transform = "translateX(-50%)";
            readyButton.style.padding = "10px 18px";
            readyButton.style.borderRadius = "10px";
            readyButton.style.border = "none";
            readyButton.style.background = "#2563eb";
            readyButton.style.color = "#fff";
            readyButton.style.fontWeight = "700";
            readyButton.style.boxShadow = "0 6px 12px rgba(0,0,0,0.15)";
            readyButton.addEventListener("click", (e) => {
                e.preventDefault();
                sendReady();
            });
            wrapper.appendChild(readyButton);
            setStatus('Match trouvé ! Appuie sur "Espace" ou clique sur "Je suis prêt" pour lancer le match.');
        }

        gameSocket = io(`${window.location.origin}/game`, {
            transports: ["polling"],
            auth: { userId: currentUserId, matchId, token, username: me.username },
            withCredentials: true,
        });

        gameSocket.on("connect_error", (err) => {
            console.error("Game socket connect_error:", err);
        });

        gameSocket.on("identify", ({ index }) => {
            myPaddleIndex = index;
        });

        gameSocket.on("state", (msg: any) => {
            if (msg.config) {
                config = { ...config, ...msg.config };
                canvas.width = config.width;
                canvas.height = config.height;
            }

            state.ball.x = msg.state.ball.x;
            state.ball.y = msg.state.ball.y;
            state.ball.vx = msg.state.ball.vx;
            state.ball.vy = msg.state.ball.vy;
            state.paddles = msg.state.paddles;
            scores = msg.scores;
            renderScores(scoreBox, scores, isQuad, undefined, msg.names);
        });

        gameSocket.on("ready", (msg: any) => {
            if (msg?.readyIds?.includes(currentUserId)) {
                isReady = true;
                if (readyButton) {
                    readyButton.disabled = true;
                    readyButton.textContent = "Prêt";
                }
            }
            if (msg?.total) {
                setStatus(`Prêts: ${msg.readyCount ?? 0}/${msg.total}`);
            }
        });

        gameSocket.on("countdown", (msg: any) => {
            matchStarted = false;
            setStatus(`Départ dans ${msg.seconds}s`);
            if (readyButton) readyButton.disabled = true;
        });

        gameSocket.on("start", (msg: any) => {
            matchStarted = true;
            isReady = true;
            if (msg?.state) {
                state.ball = msg.state.ball;
                state.paddles = msg.state.paddles;
                scores = msg.scores || scores;
                renderScores(scoreBox, scores, isQuad, undefined, msg.names);
            }
            setStatus("GO !");
            if (readyButton) readyButton.style.display = "none";
            setTimeout(() => setStatus(""), 1200);
        });

        gameSocket.on("end", (msg: any) => {
            running = false;
            matchStarted = false;
            renderScores(scoreBox, scores, isQuad, msg?.winner || "END", msg?.names);
        });

        // Envoi des mouvements
        paddleInterval = window.setInterval(() => {
            if (!gameSocket || !myPaddleIndex) return;
            if (!matchStarted) return;
            const payload: any = { type: "paddle" };
            const speed = config.paddleSpeed;

            if (myPaddleIndex === 1) {
                if (keys.has("w")) payload.value = state.paddles.p1 - speed;
                if (keys.has("s")) payload.value = state.paddles.p1 + speed;
                payload.axis = "y";
            }
            if (myPaddleIndex === 2) {
                if (keys.has("ArrowUp")) payload.value = state.paddles.p2 - speed;
                if (keys.has("ArrowDown")) payload.value = state.paddles.p2 + speed;
                payload.axis = "y";
            }
            if (myPaddleIndex === 3 && isQuad) {
                if (keys.has("a")) payload.value = (state.paddles.p3 ?? 0) - speed;
                if (keys.has("d")) payload.value = (state.paddles.p3 ?? 0) + speed;
                payload.axis = "x";
            }
            if (myPaddleIndex === 4 && isQuad) {
                if (keys.has("j")) payload.value = (state.paddles.p4 ?? 0) - speed;
                if (keys.has("l")) payload.value = (state.paddles.p4 ?? 0) + speed;
                payload.axis = "x";
            }

            if (payload.value !== undefined) gameSocket.emit("paddle", payload);
        }, 1000 / 60);

        // Init chat
        if (messagesList && chatForm && chatInput) {
            initMatchChat(matchId, messagesList);
            setupChatForm(chatForm, chatInput);
        }
    }
    // Modes locaux : on construit l'UI immédiatement
    else {
        ({
            overlay,
            wrapper,
            canvas,
            ctx,
            scoreBox,
            statusBox,
            messagesList,
            chatForm,
            chatInput,
        } = buildUI(container, false));
    }

    // ---------------------------
    // Local game loop
    // ---------------------------
    let lastTime = performance.now();
    renderScores(scoreBox, scores, isQuad);

    function loop(ts: number) {
        const dt = (ts - lastTime) / 1000;
        lastTime = ts;

        if (isLocal) {
            stepLocal(state, scores, keys, config, isQuad, dt, () => {
                running = false;
                renderScores(scoreBox, scores, isQuad, findLocalWinner(scores));
                teardown();
            });
            renderScores(scoreBox, scores, isQuad);
        }

        draw(ctx, canvas, state, config, isQuad);

        if (running) requestAnimationFrame(loop);
    }

    requestAnimationFrame(loop);

    function teardown() {
        if (paddleInterval) {
            clearInterval(paddleInterval);
            paddleInterval = null;
        }
        if (gameSocket) {
            gameSocket.off();
            gameSocket.disconnect();
            gameSocket = null;
        }
        if (chatSocket) {
            chatSocket.off();
            chatSocket.disconnect();
            chatSocket = null;
        }
        if (overlay && overlay.parentElement) {
            overlay.parentElement.removeChild(overlay);
            overlay = null;
        }
        window.removeEventListener("keydown", keydownHandler);
        window.removeEventListener("keyup", keyupHandler);
        (window as any).stopCurrentGame = undefined;
    }

    // expose teardown for external navigation (e.g., Home button)
    (window as any).stopCurrentGame = teardown;
}

// ---------------------------
// Local physics
// ---------------------------
function stepLocal(
    state: ClientState,
    scores: Record<string, number>,
    keys: Set<string>,
    config: GameConfig,
    isQuad: boolean,
    dt: number,
    onEnd: () => void
) {
    const speed = config.paddleSpeed;
    // Input mapping local (tous joueurs au clavier)
    if (keys.has("w")) state.paddles.p1 -= speed;
    if (keys.has("s")) state.paddles.p1 += speed;
    if (keys.has("ArrowUp")) state.paddles.p2 -= speed;
    if (keys.has("ArrowDown")) state.paddles.p2 += speed;
    if (isQuad) {
        if (keys.has("a")) state.paddles.p3! -= speed;
        if (keys.has("d")) state.paddles.p3! += speed;
        if (keys.has("j")) state.paddles.p4! -= speed;
        if (keys.has("l")) state.paddles.p4! += speed;
    }

    // Clamp paddles
    state.paddles.p1 = clamp(state.paddles.p1, config.paddleLength / 2, config.height - config.paddleLength / 2);
    state.paddles.p2 = clamp(state.paddles.p2, config.paddleLength / 2, config.height - config.paddleLength / 2);
    if (isQuad) {
        state.paddles.p3 = clamp(state.paddles.p3!, config.paddleLength / 2, config.width - config.paddleLength / 2);
        state.paddles.p4 = clamp(state.paddles.p4!, config.paddleLength / 2, config.width - config.paddleLength / 2);
    }

    // Move ball
    const b = state.ball;
    if (b.vx === 0 && b.vy === 0) {
        resetLocalBall(state, config);
    }
    b.x += b.vx * dt;
    b.y += b.vy * dt;

    // Walls (top/bottom) only duo
    if (!isQuad) {
        if (b.y - config.ballRadius < 0) {
            b.y = config.ballRadius;
            b.vy *= -1;
        }
        if (b.y + config.ballRadius > config.height) {
            b.y = config.height - config.ballRadius;
            b.vy *= -1;
        }
    }

    // Paddles collisions
    // Left paddle (p1)
    if (b.x - config.ballRadius < config.paddleThickness + 20) {
        const minY = state.paddles.p1 - config.paddleLength / 2;
        const maxY = state.paddles.p1 + config.paddleLength / 2;
        if (b.y >= minY && b.y <= maxY) {
            b.x = config.paddleThickness + 20 + config.ballRadius;
            b.vx = Math.abs(b.vx);
        }
    }
    // Right paddle (p2)
    if (b.x + config.ballRadius > config.width - (config.paddleThickness + 20)) {
        const minY = state.paddles.p2 - config.paddleLength / 2;
        const maxY = state.paddles.p2 + config.paddleLength / 2;
        if (b.y >= minY && b.y <= maxY) {
            b.x = config.width - (config.paddleThickness + 20) - config.ballRadius;
            b.vx = -Math.abs(b.vx);
        }
    }

    if (isQuad) {
        if (b.y - config.ballRadius < config.paddleThickness + 20) {
            const minX = (state.paddles.p3 ?? 0) - config.paddleLength / 2;
            const maxX = (state.paddles.p3 ?? 0) + config.paddleLength / 2;
            if (b.x >= minX && b.x <= maxX) {
                b.y = config.paddleThickness + 20 + config.ballRadius;
                b.vy = Math.abs(b.vy);
            }
        }
        if (b.y + config.ballRadius > config.height - (config.paddleThickness + 20)) {
            const minX = (state.paddles.p4 ?? 0) - config.paddleLength / 2;
            const maxX = (state.paddles.p4 ?? 0) + config.paddleLength / 2;
            if (b.x >= minX && b.x <= maxX) {
                b.y = config.height - (config.paddleThickness + 20) - config.ballRadius;
                b.vy = -Math.abs(b.vy);
            }
        }
    }

    // Goals
    if (b.x < 0) {
        scores.p2 += 1;
        resetLocalBall(state, config);
    } else if (b.x > config.width) {
        scores.p1 += 1;
        resetLocalBall(state, config);
    } else if (isQuad && b.y < 0) {
        scores.p4! += 1;
        resetLocalBall(state, config);
    } else if (isQuad && b.y > config.height) {
        scores.p3! += 1;
        resetLocalBall(state, config);
    }

    if (checkWin(scores)) {
        onEnd();
    }
}

function resetLocalBall(state: ClientState, config: GameConfig) {
    const dirX = Math.random() > 0.5 ? 1 : -1;
    const dirY = Math.random() > 0.5 ? 1 : -1;
    state.ball.x = config.width / 2;
    state.ball.y = config.height / 2;
    state.ball.vx = 300 * dirX;
    state.ball.vy = 200 * dirY;
}

function checkWin(scores: Record<string, number>) {
    return Object.values(scores).some((v) => v >= 10);
}

function findLocalWinner(scores: Record<string, number>) {
    let bestKey = "";
    let bestScore = -1;
    for (const [k, v] of Object.entries(scores)) {
        if (v > bestScore) {
            bestScore = v;
            bestKey = k;
        }
    }
    return bestKey || undefined;
}

// ---------------------------
// Drawing
// ---------------------------
function draw(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, state: ClientState, config: GameConfig, isQuad: boolean) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Ball
    ctx.beginPath();
    ctx.arc(state.ball.x, state.ball.y, config.ballRadius, 0, Math.PI * 2);
    ctx.fillStyle = "black";
    ctx.fill();

    // Player 1 paddle
    ctx.fillRect(20, state.paddles.p1 - config.paddleLength / 2, config.paddleThickness, config.paddleLength);

    // Player 2 paddle
    ctx.fillRect(canvas.width - 20 - config.paddleThickness, state.paddles.p2 - config.paddleLength / 2, config.paddleThickness, config.paddleLength);

    if (isQuad) {
        // Player 3 top horizontal
        ctx.fillRect((state.paddles.p3 ?? 0) - config.paddleLength / 2, 20, config.paddleLength, config.paddleThickness);

        // Player 4 bottom horizontal
        ctx.fillRect((state.paddles.p4 ?? 0) - config.paddleLength / 2, canvas.height - 20 - config.paddleThickness, config.paddleLength, config.paddleThickness);
    }
}

function renderScores(el: HTMLElement, scores: Record<string, number>, isQuad: boolean, winner?: string, names?: Record<string, string>) {
    const labels = {
        p1: names?.p1 || "P1",
        p2: names?.p2 || "P2",
        p3: names?.p3 || "P3",
        p4: names?.p4 || "P4",
    };
    const winnerLabel = winner ? (labels[winner as keyof typeof labels] || winner) : undefined;
    if (winnerLabel) {
        el.textContent = `Winner: ${winnerLabel} | ${formatScores(scores, isQuad, labels)}`;
    } else {
        el.textContent = formatScores(scores, isQuad, labels);
    }
}

function formatScores(scores: Record<string, number>, isQuad: boolean, labels: Record<string, string>) {
    if (isQuad) {
        return `${labels.p1}: ${scores.p1 ?? 0} | ${labels.p2}: ${scores.p2 ?? 0} | ${labels.p3}: ${scores.p3 ?? 0} | ${labels.p4}: ${scores.p4 ?? 0}`;
    }
    return `${labels.p1}: ${scores.p1 ?? 0} | ${labels.p2}: ${scores.p2 ?? 0}`;
}

// ---------------------------
// UI helper (fullscreen)
// ---------------------------
function buildUI(
    container: HTMLElement,
    withChat: boolean
): {
    overlay: HTMLDivElement;
    wrapper: HTMLDivElement;
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    scoreBox: HTMLDivElement;
    statusBox: HTMLDivElement;
    messagesList: HTMLUListElement | null;
    chatForm: HTMLFormElement | null;
    chatInput: HTMLInputElement | null;
} {
    container.innerHTML = "";
    const header = document.getElementById("header1-section");
    let headerH = header ? header.getBoundingClientRect().height : 80;
    if (!headerH || headerH < 40) headerH = 80;

    const overlay = document.createElement("div");
    overlay.style.position = "fixed";
    overlay.style.top = `${headerH}px`;
    overlay.style.left = "0";
    overlay.style.width = "100vw";
    overlay.style.height = `calc(100vh - ${headerH}px)`;
    overlay.style.zIndex = "40"; // keep header (z=50) visible, but above page content
    overlay.style.display = "flex";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";
    overlay.style.background = "linear-gradient(135deg, #f4f4f5, #e5e7eb)";
    document.body.appendChild(overlay);

    const wrapper = document.createElement("div");
    wrapper.style.position = "relative";
    wrapper.style.width = "100%";
    wrapper.style.height = "100%";
    wrapper.style.display = "flex";
    wrapper.style.alignItems = "center";
    wrapper.style.justifyContent = "center";
    wrapper.style.borderRadius = "12px";
    wrapper.style.boxShadow = "0 10px 30px rgba(0,0,0,0.08)";
    overlay.appendChild(wrapper);

    const canvas = document.createElement("canvas");
    canvas.width = DEFAULT_CONFIG.width;
    canvas.height = DEFAULT_CONFIG.height;
    canvas.style.border = "1px solid #ccc";
    canvas.style.background = "#fff";
    canvas.style.width = "min(95vw, 95vh)";
    canvas.style.height = "min(95vw, 95vh)";
    canvas.style.maxWidth = "1200px";
    canvas.style.maxHeight = "1200px";
    wrapper.appendChild(canvas);
    const ctx = canvas.getContext("2d")!;

    const scoreBox = document.createElement("div");
    scoreBox.style.position = "absolute";
    scoreBox.style.top = "16px";
    scoreBox.style.left = "50%";
    scoreBox.style.transform = "translateX(-50%)";
    scoreBox.style.background = "rgba(0,0,0,0.7)";
    scoreBox.style.color = "#fff";
    scoreBox.style.padding = "8px 12px";
    scoreBox.style.borderRadius = "8px";
    scoreBox.style.fontWeight = "bold";
    scoreBox.style.fontSize = "14px";
    wrapper.appendChild(scoreBox);

    const statusBox = document.createElement("div");
    statusBox.style.position = "absolute";
    statusBox.style.top = "52px";
    statusBox.style.left = "50%";
    statusBox.style.transform = "translateX(-50%)";
    statusBox.style.background = "rgba(17,24,39,0.85)";
    statusBox.style.color = "#fff";
    statusBox.style.padding = "6px 10px";
    statusBox.style.borderRadius = "8px";
    statusBox.style.fontSize = "13px";
    statusBox.style.fontWeight = "600";
    statusBox.style.pointerEvents = "none";
    wrapper.appendChild(statusBox);

    let messagesList: HTMLUListElement | null = null;
    let chatForm: HTMLFormElement | null = null;
    let chatInput: HTMLInputElement | null = null;

    if (withChat) {
        const chatWrapper = document.createElement("div");
        chatWrapper.style.position = "absolute";
        chatWrapper.style.right = "20px";
        chatWrapper.style.bottom = "20px";
        chatWrapper.style.width = "300px";
        chatWrapper.style.maxHeight = "320px";
        chatWrapper.style.background = "rgba(0,0,0,0.6)";
        chatWrapper.style.color = "#fff";
        chatWrapper.style.borderRadius = "10px";
        chatWrapper.style.padding = "10px";
        chatWrapper.style.display = "flex";
        chatWrapper.style.flexDirection = "column";
        chatWrapper.style.fontSize = "12px";
        chatWrapper.style.backdropFilter = "blur(6px)";

        messagesList = document.createElement("ul");
        messagesList.id = "pong-chat-messages";
        messagesList.style.listStyle = "none";
        messagesList.style.margin = "0 0 8px 0";
        messagesList.style.padding = "0";
        messagesList.style.overflowY = "auto";
        messagesList.style.maxHeight = "220px";

        chatForm = document.createElement("form");
        chatForm.id = "pong-chat-form";
        chatForm.style.display = "flex";
        chatForm.style.gap = "6px";

        chatInput = document.createElement("input");
        chatInput.id = "pong-chat-input";
        chatInput.type = "text";
        chatInput.placeholder = "Tape ton message...";
        chatInput.autocomplete = "off";
        chatInput.style.flex = "1";
        chatInput.style.color = "#111";

        const btn = document.createElement("button");
        btn.type = "submit";
        btn.textContent = "Envoyer";
        btn.style.background = "#22c55e";
        btn.style.color = "#fff";
        btn.style.padding = "6px 10px";
        btn.style.borderRadius = "6px";

        chatForm.appendChild(chatInput);
        chatForm.appendChild(btn);
        chatWrapper.appendChild(messagesList);
        chatWrapper.appendChild(chatForm);
        wrapper.appendChild(chatWrapper);
    }

    return { overlay, wrapper, canvas, ctx, scoreBox, statusBox, messagesList, chatForm, chatInput };
}

// ---------------------------
// Chat helpers
// ---------------------------
function initMatchChat(matchId: number, messagesList: HTMLUListElement) {
    // On évite les doublons
    if (chatSocket) {
        chatSocket.disconnect();
        chatSocket = null;
    }

    const token = localStorage.getItem("jwt") || sessionStorage.getItem("token");
    if (!token) {
        const li = document.createElement("li");
        li.textContent = "Chat indisponible (pas de token)";
        messagesList.appendChild(li);
        return;
    }

    chatSocket = io(window.location.origin, {
        transports: ["polling"],
        auth: { token },
        withCredentials: true,
    });

    let errorShown = false;
    chatSocket.on("connect_error", (err) => {
        if (errorShown) return;
        errorShown = true;
        const li = document.createElement("li");
        li.textContent = `Chat error: ${err.message}`;
        messagesList.appendChild(li);
    });

    chatSocket.emit("joinMatchChat", matchId);

    chatSocket.on("chat:message", (msg: { from: number; fromUsername?: string; text: string; at: string }) => {
        const li = document.createElement("li");
        const time = new Date(msg.at).toLocaleTimeString();
        const label = msg.fromUsername || `#${msg.from}`;
        li.textContent = `[${time}] ${label}: ${msg.text}`;
        messagesList.appendChild(li);
        messagesList.scrollTop = messagesList.scrollHeight;
    });

}

function setupChatForm(form: HTMLFormElement, input: HTMLInputElement) {
    form.addEventListener("submit", (e) => {
        e.preventDefault();
        const text = input.value.trim();
        if (!text) return;
        if (!chatSocket || currentMatchId == null) {
            console.warn("Chat socket not connected");
            return;
        }
        const safeText = text.slice(0, 500);

        chatSocket.emit("chat:message", {
            matchId: currentMatchId,
            text: safeText,
        });

        // Feedback local "you"
        const messages = form.parentElement?.querySelector("ul");
        input.value = "";
    });
}

// ---------------------------
// Utils
// ---------------------------
function clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
}

function wait(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
