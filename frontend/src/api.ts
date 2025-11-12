const API_BASE = "https://localhost:3000/api";

async function request(endpoint: string, options: RequestInit = {}) {
  const token = localStorage.getItem("token");
  const headers = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const res = await fetch(`${API_BASE}${endpoint}`, { ...options, headers });
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
      if (data.token) localStorage.setItem("token", data.token);
      return data;
    });

export const setup2FA = (userId: number) =>
  request(`/user/${userId}/2fa/setup`, { method: "POST" });

export const verify2FA = (userId: number, token: string) =>
  request(`/user/${userId}/2fa/verify`, {
    method: "POST",
    body: JSON.stringify({ token }),
  });

// --- FRIENDS ---
export const sendFriendRequest = (userId: number, friendId: number) =>
  request("/friend", { method: "POST", body: JSON.stringify({ userId, friendId }) });

export const acceptFriend = (userId: number, friendId: number) =>
  request("/friend/accept", { method: "PUT", body: JSON.stringify({ userId, friendId }) });

export const getFriends = (userId: number) =>
  request(`/user/${userId}/friends`);

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
