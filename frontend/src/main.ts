
import { showHome } from "./home";
import { showGame } from "./pong";
import { showTournament } from "./tournament";
import { sendFriendRequest, acceptFriend, getFriends, getIncomingRequests, getSentRequests, blockFriend, getMatchHistory, fetchUserMe } from "./api";
import { io } from "socket.io-client";

window.addEventListener("DOMContentLoaded", async () => {
    const app = document.getElementById("pongContent")!;
    async function ensureCurrentUser() {
        if (!me?.id) {
            try {
                const res = await fetchUserMe();
                if (res.success) {
                    me = res.user;
                    window.currentUserId = me.id;
                    sessionStorage.setItem("me", JSON.stringify(me));
                    localStorage.setItem("me", JSON.stringify(me)); 
                    console.log("[ensureCurrentUser] Updated me object:", me);
                } else {
                    console.warn("Failed to fetch /me:", res.error);
                }
            } catch (err) {
                console.error("Error fetching current user:", err);
            }
        }
    }
    await ensureCurrentUser(); 
    // Now run router AFTER user is loaded
    //await router();

    // ---- Rebind des boutons de la Home après chaque render ----
    function bindHomeButtons() {
        const gameContainer = document.getElementById("gameContainer")!;
        const playDuoBtn = document.getElementById("playDuoBtn");
        const playQuadBtn = document.getElementById("playQuadBtn");
        const viewTournamentBtn = document.getElementById("viewtournamentBtn");

        playDuoBtn?.addEventListener("click", () => {
            showGame(gameContainer, "duo");
        });

        playQuadBtn?.addEventListener("click", () => {
            showGame(gameContainer, "quad");
        });

        // bouton "View Tournaments" dans les quick actions
        viewTournamentBtn?.addEventListener("click", () => {
            window.location.hash = "#tournament";
        });
    }
    /*
    // -------------------------
    // Router pour la partie Pong
    // -------------------------
    function router() {
        const hash = window.location.hash;
        app.innerHTML = "";

        if (!hash || hash === "#home") {
            showHome(app);
            // très important : rebrancher les boutons après showHome
            bindHomeButtons();
        } else if (hash === "#tournament") {
            showTournament(app);
        } else {
            app.innerHTML = `<p class="text-red-500">Page not found</p>`;
        }
    }

    // -------------------------
    // Boutons de la navbar du header Pong
    // -------------------------
    const homeBtn = document.getElementById("homeBtn");
    const tournamentNavBtn = document.getElementById("tournamentBtn");

    homeBtn?.addEventListener("click", () => {
        window.location.hash = "#home";
    });

    tournamentNavBtn?.addEventListener("click", () => {
        window.location.hash = "#tournament";
    });

    // -------------------------
    // Routing
    // -------------------------
    window.addEventListener("hashchange", router);

    // Premier render
    router();
});
*/

    // -------------------------
    // Updated Router (supports friends + matches)
    // -------------------------
    async function router() {
        await ensureCurrentUser();
        const hash = window.location.hash;
        app.innerHTML = "";

        // Always hide all panels first
        document.getElementById("friends-panel")?.classList.add("hidden");
        document.getElementById("matches-panel")?.classList.add("hidden");
        document.getElementById("profile-panel")?.classList.add("hidden");
        switch (hash) {
            case "":
            case "#home":
                showHome(app);
                bindHomeButtons();
                break;

            case "#tournament":
                showTournament(app);
                break;

            case "#friends":
                //await ensureCurrentUser();
                document.getElementById("friends-panel")!.classList.remove("hidden");
                await loadAllFriendsData();
                break;

            case "#matches":
                document.getElementById("matches-panel")!.classList.remove("hidden");
                //await ensureCurrentUser();
                await window.showMatchesPanel();
                break;
            case "#profile":
                document.getElementById("profile-panel")!.classList.remove("hidden");
                //await ensureCurrentUser();
                loadProfile();
                break;

            default:
                app.innerHTML = `<p class="text-red-500">Page not found</p>`;
        }
    }

    // -------------------------
    // Navbar buttons
    // -------------------------
    const homeBtn = document.getElementById("homeBtn");
    const tournamentNavBtn = document.getElementById("tournamentBtn");

    homeBtn?.addEventListener("click", () => (window.location.hash = "#home"));
    tournamentNavBtn?.addEventListener("click", () => (window.location.hash = "#tournament"));

    // For dropdown: profile + matches + friends
    const profileBtn = document.querySelector('#userMenuDropdown [data-target="profile-panel"]');
    profileBtn?.addEventListener("click", () => {
        window.location.hash = "#profile";
    });
    const matchesBtn = document.querySelector('#userMenuDropdown [data-target="matches-panel"]');
    matchesBtn?.addEventListener("click", () => {
        window.location.hash = "#matches";
    });

    const friendsBtn = document.querySelector('#userMenuDropdown [data-target="friends-panel"]');
    friendsBtn?.addEventListener("click", () => {
        window.location.hash = "#friends";
    });

    // Router activation
    window.addEventListener("hashchange", router);

    router(); // initial render
});

// -------------------------
// Hybrid storage for user/session
// -------------------------
let me = JSON.parse(sessionStorage.getItem("me") || localStorage.getItem("me") || "{}");
let token = sessionStorage.getItem("token") || localStorage.getItem("jwt");
console.log("[INIT] Loaded user:", me);
console.log("[INIT] Loaded token:", token);
const currentUserId = me.id;
(window as any).currentUserId = currentUserId;

// --- Fetch current user if token exists ---
(async () => {
    const token = sessionStorage.getItem("token") || localStorage.getItem("jwt");
    if (token) {
        try {
            const res = await fetchUserMe();
            if (res.success) {
                me = res.user; 
                window.currentUserId = me.id;
                sessionStorage.setItem("me", JSON.stringify(me));
                console.log("[INIT] Fetched current user:", me);
            } else {
                console.warn("Failed to fetch /me:", res.error);
            }
        } catch (err) {
            console.error("Error fetching current user:", err);
        }
    }
})();

// Store user in sessionStorage on login
window.saveUserSession = function (user: any) {
    console.log("[saveUserSession] Saving user:", user);
    sessionStorage.setItem("me", JSON.stringify(user));
    sessionStorage.setItem("token", user.token);

    // Optional: also persist in localStorage for regular sessions
    localStorage.setItem("me", JSON.stringify(user));
    localStorage.setItem("jwt", user.token);

    me = user;
    token = user.token;
    window.currentUserId = user.id;
    //router();
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
    if (!me?.id || socket) return;
    if (!socket) {
        const token = localStorage.getItem("jwt");
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

    const res = await getFriends(window.currentUserId);    
    if (!res.success) {
        container.innerHTML = "Failed to load friends";
        return;
    }

    container.innerHTML = "";

    res.friends.forEach(friend => {
        if (!window.currentUserId || friend.id === window.currentUserId) return;
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
    const friendIds = res.friends
        .filter(f => f.id !== window.currentUserId)
        .map(f => f.id);
    // Init socket now that we have friend IDs
    initSocket(friendIds);
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
    if (!me?.id) {
        console.error("User not loaded yet, skipping friends data loading.");
        return;
    }
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
// Show Matches Panel
// ----------------------------

window.showMatchesPanel = function (userId?: number) {
    const id = userId ?? window.currentUserId;
    console.log("[showMatchesPanel] Called with:", userId);
    console.log("[showMatchesPanel] currentUserId:", window.currentUserId);
    if (!id) {
        console.error("No valid user ID to show match history");
        const container = document.getElementById("matches-list")!;
        container.innerHTML = "<p class='text-red-400'>Cannot load match history: user not logged in.</p>";
        return;
    }

    document.getElementById("matches-panel")!.classList.remove("hidden");
    loadMatchHistory(id);
};

// ----------------------------
// Load Match History
// ----------------------------
async function loadMatchHistory(userId: number) {
    console.log("[loadMatchHistory] Called with userId =", userId);
    const container = document.getElementById("matches-list")!;
    container.innerHTML = "Loading match history...";

    function formatMatchDate(dateStr: string) {
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) return dateStr;
        return date.toLocaleString();
    }

    try {
        const token = localStorage.getItem('jwt') || sessionStorage.getItem('token');
        console.log("[loadMatchHistory] Token found:", token);
        if (!token) {
            container.innerHTML = "<p class='text-red-400'>No JWT token found. Please log in again.</p>";
            return;
        }
        console.log("[loadMatchHistory] Fetching match history for user:", userId);
        const response = await getMatchHistory(userId);
        console.log("Raw match history response:", response);

        const matches = response?.matches || [];

        if (!matches.length) {
            console.warn("[loadMatchHistory] No matches found for user:", userId);
            container.innerHTML = "<p class='text-gray-400'>No matches played yet.</p>";
            return;
        }

        container.innerHTML = matches.map(m => {
            console.log("[loadMatchHistory] Rendering match:", m);
            const isUser = m.user_id == userId;
            const myName = isUser ? m.user_name : m.opponent_name;
            const opponentName = isUser ? m.opponent_name : m.user_name;
            const myScore = isUser ? m.user_score : m.opponent_score;
            const oppScore = isUser ? m.opponent_score : m.user_score;
            const resultForUser =
                myScore > oppScore ? 'win' :
                    myScore < oppScore ? 'loss' :
                        'draw';        
            return `
                <div class="p-3 border-b border-gray-600">
                    <div class="flex flex-col justify-left">
                        <span class="text-sm text-gray-400"><strong>${myName}</strong> Vs <strong>${opponentName}</strong></span>
                        <span class="text-sm text-gray-400">Date: ${formatMatchDate(m.date)}</span>
                    </div>
                    <div class="text-sm text-gray-400">
                        Score: <span class="text-orange-400">${myScore}</span>
                        - 
                        <span class="text-blue-400">${oppScore}</span>
                    </div>
                    <div class="text-sm text-gray-400">
                        Result: <strong class="${resultForUser === 'win' ? 'text-green-400' :
                                resultForUser === 'loss' ? 'text-red-400' : 'text-yellow-400'}">
                            ${resultForUser}
                        </strong>
                    </div>
                </div>
            `;
        }).join("");

    } catch (err: any) {
        console.error("[loadMatchHistory] Failed to load match history:", err);
        container.innerHTML = "<p class='text-red-400'>Failed to load matches. Please try again later.</p>";
    }
}
