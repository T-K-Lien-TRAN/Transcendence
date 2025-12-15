export function showHome(app: HTMLElement) {
    app.innerHTML = `
        <h1 class="text-3xl font-bold text-gray-800 dark:text-gray-100">Welcome to Transcendence Pong!</h1>
        <p class="text-gray-600 dark:text-gray-300 max-w-2xl mx-auto">
            Play, compete, and rise through the ranks in the modern reimagining of the classic arcade game.
        </p>
    <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mt-8">
      <div class="p-6 bg-white dark:bg-gray-800 rounded-lg shadow-md hover:shadow-lg transition">
         <h2 class="text-xl font-semibold mb-2 text-gray-800 dark:text-gray-100">Start 2-Player Match</h2>
            <div class="flex justify-center gap-4 mt-3">
              <button id="playDuoBtn" class="px-4 py-2 bg-purple-600 hover:bg-blue-700 text-white rounded-md">Online</button>
              <button id="playDuoLocalBtn" class="px-4 py-2 bg-blue-600 hover:bg-gray-700 text-white rounded-md">Local</button>
            </div>
        </div>

        <div class="p-6 bg-white dark:bg-gray-800 rounded-lg shadow-md hover:shadow-lg transition">
            <h2 class="text-xl font-semibold mb-2 text-gray-800 dark:text-gray-100">Start 4-Player Match</h2>
            <div class="flex justify-center gap-4 mt-3">
              <button id="playQuadBtn" class="px-4 py-2 bg-purple-600 hover:bg-green-700 text-white rounded-md">Online</button>
              <button id="playQuadLocalBtn" class="px-4 py-2 bg-blue-600 hover:bg-gray-700 text-white rounded-md">Local</button>
            </div>
        </div>

      <div class="p-6 bg-white dark:bg-gray-800 rounded-lg shadow-md hover:shadow-lg transition">
        <h2 class="text-xl font-semibold mb-2 text-gray-800 dark:text-gray-100">Join a Tournament</h2>
        <p class="text-gray-500 dark:text-gray-400 mb-4">Compete in official events.</p>
        <button id="viewtournamentBtn"
                class="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-md">
          View Tournaments
        </button>
      </div>

      <div class="p-6 bg-white dark:bg-gray-800 rounded-lg shadow-md hover:shadow-lg transition">
        <h2 class="text-xl font-semibold mb-2 text-gray-800 dark:text-gray-100">Leaderboard</h2>
        <p class="text-gray-500 dark:text-gray-400 mb-4">See the rankings.</p>
        <button class="px-4 py-2 bg-yellow-500 hover:bg-yellow-600 text-white rounded-md">
          View Rankings
        </button>
      </div>
      <div id="gameContainer" class="mt-8"></div>
    </div>
  `;
}
