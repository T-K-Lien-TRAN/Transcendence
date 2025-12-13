import { request } from "./api";

export async function renderRankings(app: HTMLElement) {
    app.innerHTML = `<h1 class="text-2xl font-bold mb-4 text-gray-400">Leaderboard</h1>`;

    try {
        const res = await request("/user/rankings");

        // General stats
        app.innerHTML += `
            <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <div class="p-4 bg-white dark:bg-gray-800 rounded shadow">
                    <p class="text-gray-500">Total Users</p>
                    <strong class="text-xl text-gray-900 dark:text-gray-100">${res.totalUsers}</strong>
                </div>
                <div class="p-4 bg-white dark:bg-gray-800 rounded shadow">
                    <p class="text-gray-500">Total Matches</p>
                    <strong class="text-xl text-gray-900 dark:text-gray-100">${res.totalMatches}</strong>
                </div>
                <div class="p-4 bg-white dark:bg-gray-800 rounded shadow">
                    <p class="text-gray-500">Ongoing Tournaments</p>
                    <strong class="text-xl text-gray-900 dark:text-gray-100">${res.ongoingTournaments}</strong>
                </div>
            </div>
        `;

        // Top players
        app.innerHTML += `
            <div class="mb-6">
                <h2 class="text-xl font-semibold mb-2 text-gray-400">Top Players</h2>
                <ul class="bg-white dark:bg-gray-800 rounded shadow divide-y divide-gray-200 dark:divide-gray-700">
                    ${res.topPlayers.map((p: any, i: number) => `
                        <li class="p-3 flex justify-between">
                            <span class="text-gray-400">#${i + 1} ${p.username}</span>
                            <span class="font-bold text-gray-400">${p.elo}</span>
                        </li>
                    `).join("")}
                </ul>
            </div>
        `;

        // Recent matches
        app.innerHTML += `
            <div class="mb-6">
                <h2 class="text-xl font-semibold mb-2 text-gray-400">Recent Matches</h2>
                <ul class="bg-white dark:bg-gray-800 rounded shadow divide-y divide-gray-200 dark:divide-gray-700">
                    ${res.recentMatches.map((m: any) => `
                        <li class="p-3 flex justify-between">
                            <span class="text-gray-400">${m.player} vs ${m.opponent}</span>
                            <span class="text-gray-400">${m.result} - ${new Date(m.date).toLocaleDateString()}</span>
                        </li>
                    `).join("")}
                </ul>
            </div>
        `;
    } catch (err: any) {
        app.innerHTML += `<p class="text-red-500">${err.message}</p>`;
    }
}
