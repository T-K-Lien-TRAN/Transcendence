import { request } from "./api";

export async function renderPlayers(app: HTMLElement) {
    app.innerHTML = `<h1 class="text-2xl font-bold mb-4 text-gray-400">Players</h1>`;

    try {
        const res = await request("/user/players");

        app.innerHTML += `
            <div class="grid gap-3">
                ${res.players.map((p: any) => `
                    <div class="p-3 border rounded bg-white dark:bg-gray-800">
                        <strong class="text-gray-400">${p.username}</strong>
                        <p class="text-gray-400">ELO: ${p.elo}</p>
                        <p class="text-gray-400">Matches: ${p.matches_played}</p>
                    </div>
                `).join("")}
            </div>
        `;
    } catch (err: any) {
        app.innerHTML += `<p class="text-red-500">${err.message}</p>`;
    }
}
