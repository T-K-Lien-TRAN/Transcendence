import { showHome } from "./home";
import { showGame } from "./pong";
import { showTournament } from "./tournament";

const app = document.getElementById("pongContent")!;

function router() {
    const hash = window.location.hash;

    app.innerHTML = ""; // always clear before loading a new view

    if (!hash || hash === "#home") {
        showHome(app);
    } else if (hash === "#game") {
        showGame(app);
    } else if (hash === "#tournament") {
        showTournament(app);
    } else {
        app.innerHTML = `<p class="text-red-500">Page not found</p>`;
    }
}

// Top navbar buttons
document.getElementById("homeBtn")!.onclick = () => (window.location.hash = "#home");
document.getElementById("tournamentBtn")!.onclick = () => (window.location.hash = "#tournament");

window.addEventListener("hashchange", router);
window.addEventListener("load", router);

import { sendFriendRequest, acceptFriend, getFriends } from "./api";

let currentUserId = localStorage.getItem("userId");
window.showFriendsPanel = function () {
    document.getElementById("friends-panel")!.classList.remove("hidden");
    loadFriends();
}
// ----------------------------
// Load friend list
// ----------------------------
async function loadFriends() {
    const container = document.getElementById("friends-list");
    container.innerHTML = "Loading...";

    const res = await getFriends(currentUserId);
    if (!res.success) {
        container.innerHTML = "Failed to load friends";
        return;
    }

    container.innerHTML = "";
    res.friends.forEach(friend => {
        const item = document.createElement("div");
        item.className = "p-2 border rounded mb-1";

        item.innerHTML = `
                <strong>${friend.username}</strong>
                <span class="ml-2 text-sm text-gray-500">(${friend.status})</span>
                ${friend.status === "pending"
                ? `<button data-id="${friend.id}" class="accept-btn ml-2 px-2 py-1 bg-green-600 text-white text-xs rounded">
                         Accept
                       </button>`
                : ""
            }
            `;

        container.appendChild(item);
    });

    // Attach event listeners for ACCEPT buttons
    document.querySelectorAll(".accept-btn").forEach(btn => {
        btn.addEventListener("click", async () => {
            const friendId = btn.getAttribute("data-id");
            const result = await acceptFriend(currentUserId, friendId);

            if (result.success) loadFriends();
        });
    });
}

// ----------------------------
// Send friend request
// ----------------------------
document.getElementById("friend-send-form").addEventListener("submit", async (e) => {
    e.preventDefault();

    const targetId = document.getElementById("friend-id-input").value.trim();
    const msg = document.getElementById("friend-send-message");

    if (!targetId) {
        msg.textContent = "Please enter a user ID.";
        return;
    }

    const res = await sendFriendRequest(currentUserId, Number(targetId));

    msg.textContent = res.success
        ? "Friend request sent!"
        : "Error: " + res.error;

    loadFriends();
});

// ----------------------------
// Run when opening Friends panel
// ----------------------------
window.showFriendsPanel = function () {
    loadFriends();
};
