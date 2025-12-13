import { request } from "./api";

export async function renderMatches(app: HTMLElement) {
    app.innerHTML = `<h1 class="text-2xl font-bold mb-4 text-gray-400">Recent Matches</h1>`;

    try {
        const res = await request("/user/matches");

        app.innerHTML += res.matches.map((m: any) => `
            <div class="p-3 border rounded mb-2 bg-white dark:bg-gray-800">
                <p>
                    <strong class="text-gray-400">${m.user_name}</strong>
                    vs
                    <strong class="text-gray-400">${m.opponent_name}</strong>
                </p>
                <p class="text-gray-400">Score: ${m.user_score} - ${m.opponent_score}</p>
                <p class="text-gray-400">Result: ${m.result}</p>
            </div>
        `).join("");
    } catch (err: any) {
        app.innerHTML += `<p class="text-red-500">${err.message}</p>`;
    }
}
