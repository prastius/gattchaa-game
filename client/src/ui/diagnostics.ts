import type Phaser from "phaser";
import type { Room } from "@colyseus/sdk";

/**
 * Small live readout (F3, or tap the online counter): FPS, worst frame, ping,
 * reconnects and GPU context losses. Answers "is the stutter/blink my network
 * or my device?" without opening dev tools.
 */
export class Diagnostics {
  private el = document.getElementById("diag")!;
  private ping = -1;
  private drops = 0;
  private contextLosses = 0;
  private worstFrame = 0;
  private lastFrameAt = performance.now();

  constructor(
    game: Phaser.Game,
    room: Room,
    private extra?: () => string,
  ) {
    room.onDrop(() => this.drops++);
    setInterval(() => room.ping((ms) => (this.ping = Math.round(ms))), 2000);

    game.events.on("poststep", () => {
      const now = performance.now();
      this.worstFrame = Math.max(this.worstFrame, now - this.lastFrameAt);
      this.lastFrameAt = now;
    });
    game.canvas.addEventListener("webglcontextlost", () => {
      this.contextLosses++;
      console.warn("WebGL context lost");
    });

    const toggle = () => (this.el.hidden = !this.el.hidden);
    window.addEventListener("keydown", (e) => {
      if (e.key === "F3") {
        e.preventDefault();
        toggle();
      }
    });
    document.getElementById("online")?.addEventListener("click", toggle);

    setInterval(() => {
      if (this.el.hidden) return;
      const fps = Math.round(game.loop.actualFps);
      const worst = Math.round(this.worstFrame);
      this.worstFrame = 0;
      this.el.textContent = [
        `FPS ${fps}   worst frame ${worst} ms`,
        `ping ${this.ping < 0 ? "…" : `${this.ping} ms`}   reconnects ${this.drops}`,
        `GPU resets ${this.contextLosses}   ${game.renderer.type === 2 ? "WebGL" : "Canvas"} @${window.devicePixelRatio}x`,
        ...(this.extra ? [this.extra()] : []),
      ].join("\n");
    }, 500);
  }
}
