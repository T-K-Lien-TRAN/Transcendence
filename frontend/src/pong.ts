import { GameState } from "./types";

export function showGame(container: HTMLElement) {
  const canvas = document.createElement("canvas");
  canvas.width = 500;
  canvas.height = 300;
  container.appendChild(canvas);

  const ctx = canvas.getContext("2d")!;
  const state: GameState = { player1Y: 100, player2Y: 100, ballX: 250, ballY: 150 };

  function draw() {
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "white";
    ctx.fillRect(10, state.player1Y, 10, 50);
    ctx.fillRect(canvas.width - 20, state.player2Y, 10, 50);
    ctx.fillRect(state.ballX, state.ballY, 10, 10);

    requestAnimationFrame(draw);
  }

  draw();
}
