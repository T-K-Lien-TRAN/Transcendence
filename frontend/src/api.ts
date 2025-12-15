//const API_BASE = "https://localhost:3000/api";
const API_BASE = window.location.origin + "/api";

async function request(endpoint: string, options: RequestInit = {}) {
   //const token = localStorage.getItem("jwt");
   const token = localStorage.getItem("jwt") || localStorage.getItem("token");
  console.log("Token retrieved:", token);
  const mergedHeaders = {
    "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
  };

  const res = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: mergedHeaders,
  });

  const data = await res.json();

  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

// --- AUTH ---
export const register = (user: { username: string; email: string; password: string }) =>
  request("/register", { method: "POST", body: JSON.stringify(user) });

export const login = (user: { username: string; password: string; token?: string }) =>
  request("/auth/signin", { method: "POST", body: JSON.stringify(user) })
    .then((data) => {
        //if (data.token) localStorage.setItem("token", data.token);
        if (data.token) {
            localStorage.setItem("jwt", data.token);
            sessionStorage.setItem("token", data.token);
        }
      return data;
    });

// --- 2FA ---
export const setup2FA = () => {
    return request("/user/2fa/setup", {
        method: "POST",
        body: JSON.stringify({}),
    });
};

export const verify2FA = (tokenValue: string) => {
    return request("/user/2fa/verify", {
        method: "POST",
        body: JSON.stringify({ token: tokenValue }),
    });
};
export const disable2FA = () => {
    return request("/user/2fa", { method: "DELETE", body: JSON.stringify({}) });
}

// --- FRIENDS ---
export const sendFriendRequest = (username: string) => {
  const token = localStorage.getItem("jwt");
  return request("/user/friend-by-username", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify({ username }),
  });
};
export const acceptFriend = (requesterId: number) =>
  request("/user/friend/accept", { method: "PUT", body: JSON.stringify({ userId: requesterId}) });

export const blockFriend = (userId: number) =>
  request("/user/friend/block", {
    method: "PUT",
    body: JSON.stringify({ userId })
  });

export const unblockFriend = (userId: number) =>
    request("/user/friend/unblock", {
        method: "PUT",
        body: JSON.stringify({ userId })
    });

export const getFriends = (userId: number) =>
    request(`/user/${userId}/friends`);

export const getIncomingRequests = (userId: number) =>
    request(`/user/${userId}/friend-requests`);

export const getSentRequests = (userId: number) =>
      request(`/user/${userId}/sent-requests`, {
      cache: "no-store"
  });
  
// --- MATCHS ---

export const fetchUserMe = () => request("/user/me");

export const getMatchHistory = (userId: number) =>
    request(`/user/${userId}/match-history`);

// --- STATS ---
export const getUserProfile = (userId: number) =>
  request(`/user/${userId}`);

export const getLeaderboard = () => request("/stats/leaderboard");

// --- TOURNAMENT ---
export const createTournament = (data: any) =>
  request("/tournament", { method: "POST", body: JSON.stringify(data) });

export const joinTournament = (data: any) =>
  request("/tournament/join", { method: "POST", body: JSON.stringify(data) });

export const fetchPlayers = async (tournament_id: number) => {
  return request(`/tournament/${tournament_id}/players`);
};

// --- NOTIFICATIONS ---
export const getNotifications = (userId: number) =>
  request(`/notifications/${userId}`);

// --- Avatar upload helper (multipart) ---
export const uploadAvatar = async (file: File) => {
  const form = new FormData();
  form.append("file", file);
  // do not set Content-Type — browser will set boundary automatically
  return request("/user/avatar", { method: "POST", body: form });
};
