import { showHome } from "./home";
import { showGame } from "./pong";
import { showTournament } from "./tournament";
import { sendFriendRequest, acceptFriend, getFriends, getIncomingRequests, getSentRequests, blockFriend, getMatchHistory } from "./api";
import { io } from "socket.io-client";

window.addEventListener("DOMContentLoaded", () => {
    const app = document.getElementById("pongContent")!;
    const gameContainer = document.getElementById("gameContainer")!;

    // -------------------------
    // Router for hash navigation
    // -------------------------
    function router() {
        const hash = window.location.hash;
        app.innerHTML = "";

        if (!hash || hash === "#home") {
            showHome(app);
        } else if (hash === "#tournament") {
            showTournament(app);
        } else {
            app.innerHTML = `<p class="text-red-500">Page not found</p>`;
        }
    }

    // -------------------------
    // Quick play buttons
    // -------------------------
    const playDuoBtn = document.getElementById("playDuoBtn");
    const playQuadBtn = document.getElementById("playQuadBtn");

    playDuoBtn?.addEventListener("click", () => {
        showGame(gameContainer, "duo");
    });

    playQuadBtn?.addEventListener("click", () => {
        showGame(gameContainer, "quad");
    });

    // -------------------------
    // Top navbar buttons
    // -------------------------
    const homeBtn = document.getElementById("homeBtn");
    const viewTournamentBtn = document.getElementById("viewtournamentBtn");

    homeBtn?.addEventListener("click", () => window.location.hash = "#home");
    viewTournamentBtn?.addEventListener("click", () => window.location.hash = "#tournament");

    // -------------------------
    // Event listeners for routing
    // -------------------------
    window.addEventListener("hashchange", router);

    // Initial render
    router();
});

// -------------------------
// Hybrid storage for user/session
// -------------------------
let me = JSON.parse(sessionStorage.getItem("me") || localStorage.getItem("me") || "{}");
let token = sessionStorage.getItem("token") || localStorage.getItem("token");
const currentUserId = me.id;

// Store user in sessionStorage on login
window.saveUserSession = function (user: any) {
    sessionStorage.setItem("me", JSON.stringify(user));
    sessionStorage.setItem("token", user.token);

    // Optional: also persist in localStorage for regular sessions
    localStorage.setItem("me", JSON.stringify(user));
    localStorage.setItem("token", user.token);

    me = user;
    token = user.token;
};

// Show friends panel
window.showFriendsPanel = function () {
    document.getElementById("friends-panel")!.classList.remove("hidden");
    loadAllFriendsData();
};

// ----------------------------
// Friends (accepted)
// ----------------------------
let socket: ReturnType<typeof io> | null = null;

function initSocket(friendsIds: number[]) {
    if (!socket) {
        const token = localStorage.getItem("token");
        if (!token) return;

        socket = io("https://localhost:3000", { auth: { token } });

        // Friend online/offline updates
        socket.on("user:online", ({ userId }) => updateFriendStatus(userId, true));
        socket.on("user:offline", ({ userId }) => updateFriendStatus(userId, false));

        socket.on("connect", () => {
            socket!.emit("get:onlineFriends", friendsIds);
        });

        socket.on("onlineFriends", (onlineIds: number[]) => {
            onlineIds.forEach(id => updateFriendStatus(id, true));
        });
    }
}

// ----------------------------
// Load friend list
// ----------------------------
async function loadFriendList() {
    const container = document.getElementById("friends-list")!;
    container.innerHTML = "Loading...";

    const res = await getFriends(currentUserId);
    if (!res.success) {
        container.innerHTML = "Failed to load friends";
        return;
    }

    container.innerHTML = "";

    res.friends.forEach(friend => {
        const item = document.createElement("div");
        item.id = `friend-${friend.id}`;
        item.setAttribute("data-user-id", friend.id.toString());
        item.className = "p-2 border rounded mb-1 flex justify-between items-center";

        item.innerHTML = `
            <span class="text-gray-500">${friend.username}</span>
            <span class="status text-gray-500">○ offline</span>
        `;

        container.appendChild(item);
    });

    // Init socket now that we have friend IDs
    initSocket(res.friends.map(f => f.id));
}

// ----------------------------
// Update friend status dynamically
// ----------------------------
function updateFriendStatus(userId: number, online: boolean) {
    const el = document.querySelector(`[data-user-id="${userId}"] .status`);
    if (el) {
        el.textContent = online ? "● online" : "○ offline";
        el.className = online ? "status text-green-500" : "status text-gray-500";
    }
}

// ----------------------------
// Incoming friend requests
// ----------------------------
    async function loadIncomingRequests() {
        const container = document.getElementById("friends-incoming")!;
        container.innerHTML = "Loading...";

        const res = await getIncomingRequests(currentUserId);
        if (!res.success) {
            container.innerHTML = "Failed to load requests";
            return;
        }

        container.innerHTML = "";

        res.requests.forEach(req => {
            const div = document.createElement("div");
            div.className = "p-2 border rounded mb-1 flex justify-between items-center";

            div.innerHTML = `
                <span>${req.username}</span>
                <div class="flex gap-2">
                    <button class="accept-btn px-2 py-1 bg-green-600 text-white text-xs rounded" data-id="${req.id}">Accept</button>
                    <button class="block-btn px-2 py-1 bg-red-600 text-white text-xs rounded" data-id="${req.id}">Block</button>
                </div>
            `;

            container.appendChild(div);
        });
        
      // Attach event listeners
    container.querySelectorAll(".accept-btn").forEach(btn => {
        btn.addEventListener("click", async () => {
            const friendId = btn.getAttribute("data-id");
            if (!friendId) return;

            const result = await acceptFriend(Number(friendId));
            if (result.success) loadAllFriendsData();
        });
    });
}
  // ----------------------------
    // Event listener for accept/block
    // ----------------------------
    document.addEventListener("click", async (e) => {
        const target = e.target as HTMLElement;

        if (target.classList.contains("accept-btn")) {
            const requesterId = Number(target.dataset.id);
            await acceptFriend(requesterId);
            loadIncomingRequests();
            loadSentRequests();
        }

        if (target.classList.contains("block-btn")) {
            const userIdToBlock = Number(target.dataset.id);
            await blockFriend(userIdToBlock);
            loadIncomingRequests();
            loadSentRequests();
        }
    });

    // ----------------------------
// Load all friend data
// ----------------------------
async function loadAllFriendsData() {
    await loadFriendList();
    await loadIncomingRequests();
    await loadSentRequests();
}

// ----------------------------
// Sent friend requests
// ----------------------------
async function loadSentRequests() {
    const container = document.getElementById("friends-sent")!;
    container.innerHTML = "Loading...";

    const res = await getSentRequests(currentUserId);
    if (!res.success) {
        container.innerHTML = "Failed to load sent requests";
        return;
    }

    container.innerHTML = "";
    res.sent.forEach(req => {
        const div = document.createElement("div");
        div.className = "p-2 border rounded mb-1 flex justify-between items-center";

          // Status text depending on friend.status
        let statusText = "";
        if (req.status === "pending") {
            statusText = `<span class="text-yellow-500 text-xs">Pending</span>`;
        } else if (req.status === "blocked") {
            statusText = `<span class="text-red-600 text-xs">Blocked</span>`;
        } else {
            statusText = `<span class="text-gray-400 text-xs">${req.status}</span>`;
        }

        div.innerHTML = `
            <span>${req.username}</span>
            ${statusText}
        `;

        container.appendChild(div);
    });
}

// ----------------------------
// Send friend request form
// ----------------------------
const friendForm = document.getElementById("friend-send-form") as HTMLFormElement;
friendForm.addEventListener("submit", async e => {
    e.preventDefault();

    const input = document.getElementById("friend-username-input") as HTMLInputElement;
    const username = input.value.trim();
    const messageEl = document.getElementById("friend-send-message")!;
    if (!username) return;

    try {
        await sendFriendRequest(username);
        messageEl.textContent = `Friend request sent to ${username}`;
        input.value = "";
        loadAllFriendsData();
    } catch (err: any) {
        messageEl.textContent = err.message;
    }
});

// ----------------------------
// Load friends on page load
// ----------------------------
document.addEventListener("DOMContentLoaded", () => {
    if (currentUserId) loadAllFriendsData();
});

// ----------------------------
// Show Matchs Panel
// ----------------------------
function openMatchesPanel(userId) {
    document.getElementById("matches-panel").classList.remove("hidden");
    showSection("matches-panel");
    loadMatchHistory(userId);
}

// ----------------------------
// Load Matchs History
// ----------------------------
async function loadMatchHistory(userId) {
    try {
        // Fetch the raw response
        const response = await getMatchHistory(userId);
        console.log("Raw match history response:", response);

        // Determine where the matches array actually is
        let matches: any[] = [];

        if (Array.isArray(response)) {
            // Case: API returns array directly
            matches = response;
        } else if (response.matches) {
            // Case: API returns { success: true, matches: [...] }
            matches = response.matches;
        } else if (response.data?.matches) {
            // Case: API returns { data: { matches: [...] } } 
            matches = response.data.matches;
        }

        const container = document.getElementById("matches-list");

        if (!matches.length) {
            container.innerHTML = "<p class='text-gray-400'>No matches played yet.</p>";
            return;
        }

        container.innerHTML = matches.map(m => `
            <div class="p-3 border-b border-gray-600">
                <div class="flex justify-between">
                    <span>Vs <strong>${m.opponent_name}</strong></span>
                    <span>${new Date(m.date).toLocaleString()}</span>
                </div>
                <div>
                    Score: <span class="text-orange-400">${m.user_score}</span>
                    -
                    <span class="text-blue-400">${m.opponent_score}</span>
                </div>
                <div class="text-sm text-gray-400">
                    Result: <strong class="${m.result === 'win' ? 'text-green-400' : m.result === 'loss' ? 'text-red-400' : 'text-yellow-400'}">
                        ${m.result}
                    </strong>
                </div>
            </div>
        `).join("");
    } catch (err: any) {
        console.error("Failed to load match history:", err);
        const container = document.getElementById("matches-list");
        container.innerHTML = "<p class='text-red-400'>Failed to load matches. Please try again later.</p>";
    }
}

