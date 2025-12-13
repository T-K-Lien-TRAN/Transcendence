import { request } from "./api";

export async function renderTournaments(app: HTMLElement) {
    app.innerHTML = `<h1 class="text-2xl font-bold mb-4 text-gray-400">Tournaments</h1>`;

    try { 
        const res = await request("/user/tournaments");

        const list = res.tournaments.map((t: any) => `
            <div class="p-4 border rounded mb-3 bg-white dark:bg-gray-800">
                <h2 class="font-semibold text-gray-400">${t.name}</h2>
                <p class="text-gray-400">Status: ${t.status}</p>
                <p class="text-gray-400">Players: ${t.player_count}/${t.max_players}</p>
            </div>
        `).join("");

        app.innerHTML += list || "<p>No tournaments available</p>";

    } catch (err: any) {
        app.innerHTML += `<p class="text-red-500">${err.message}</p>`;
    }
}
