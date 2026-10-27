import Phaser from "phaser";
import { ITEMS, RARITY, type ItemDef, type ItemId } from "../../shared/items";
import { ICON, itemIcon } from "./character";

const FONT = "system-ui, -apple-system, Segoe UI, sans-serif";
/** Drawn a bit smaller than in the bag, so loot sits on the grass at character scale. */
const SCALE = 0.75;

/** The Phaser texture for an item's icon (made once from the same canvas the bag uses). */
async function iconTexture(scene: Phaser.Scene, id: ItemId): Promise<string> {
  const key = `item:${id}`;
  if (!scene.textures.exists(key)) {
    const canvas = await itemIcon(id);
    if (!scene.textures.exists(key)) scene.textures.addCanvas(key, canvas);
  }
  return key;
}

/**
 * An item lying on the ground. It pops out with a little bounce, rarer items
 * glow in their rarity colour, and loot that's still someone else's for a few
 * seconds is drawn faded.
 */
export class DropSprite {
  readonly container: Phaser.GameObjects.Container;
  readonly item: ItemDef;
  private icon?: Phaser.GameObjects.Image;
  private label: Phaser.GameObjects.Text;
  private glowTween?: Phaser.Tweens.Tween;
  private destroyed = false;

  constructor(
    private scene: Phaser.Scene,
    id: ItemId,
    n: number,
    readonly x: number,
    readonly y: number,
    textRes: () => number,
  ) {
    this.item = ITEMS[id];
    const rarity = RARITY[this.item.rarity];
    const color = Phaser.Display.Color.HexStringToColor(rarity.color).color;

    const shadow = scene.add.ellipse(0, 0, 18, 6, 0x000000, 0.28);
    const parts: Phaser.GameObjects.GameObject[] = [shadow];
    if (this.item.rarity !== "common") {
      // A soft pool of light in the rarity colour, breathing slowly.
      const glow = scene.add.ellipse(0, -2, 30, 12, color, 0.45);
      parts.push(glow);
      this.glowTween = scene.tweens.add({ targets: glow, alpha: 0.15, duration: 900, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
      if (this.item.rarity === "legendary") {
        // A pillar of light you can spot from across the field.
        const beam = scene.add.rectangle(0, -60, 12, 120, color, 0.4).setBlendMode(Phaser.BlendModes.ADD);
        parts.push(beam);
        scene.tweens.add({ targets: beam, scaleX: 1.8, alpha: 0.15, duration: 1100, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
      }
    }
    this.label = scene.add
      .text(0, -ICON * SCALE - 8, n > 1 ? `${this.item.name} ×${n}` : this.item.name, {
        fontFamily: FONT,
        fontSize: "10px",
        fontStyle: "bold",
        color: rarity.color,
        stroke: "#10202b",
        strokeThickness: 3,
      })
      .setOrigin(0.5, 1)
      .setResolution(textRes())
      .setVisible(false);
    parts.push(this.label);
    // Just below anyone standing on the same spot.
    this.container = scene.add.container(x, y, parts).setDepth(y - 8);

    iconTexture(scene, id).then((key) => {
      if (this.destroyed) return;
      this.icon = scene.add.image(0, 0, key).setOrigin(0.5, 0.85).setScale(SCALE);
      this.container.addAt(this.icon, this.container.list.indexOf(this.label));
      // Pops up out of the monster and bounces onto the grass.
      this.icon.y = -18;
      this.icon.setScale(SCALE * 0.4);
      scene.tweens.add({ targets: this.icon, y: 0, duration: 420, ease: "Bounce.easeOut" });
      scene.tweens.add({ targets: this.icon, scale: SCALE, duration: 200, ease: "Back.easeOut" });
    });
  }

  /** Where a click or tap picks it up (a little bigger than the icon, for fingers). */
  hitBox(): Phaser.Geom.Rectangle {
    return new Phaser.Geom.Rectangle(this.x - 16, this.y - 30, 32, 36);
  }

  set hovered(on: boolean) {
    this.label.setVisible(on);
  }

  /** Someone else's loot for a few more seconds: faded. */
  set locked(on: boolean) {
    this.container.setAlpha(on ? 0.5 : 1);
  }

  destroy() {
    this.destroyed = true;
    this.glowTween?.stop();
    this.scene.tweens.killTweensOf(this.container.list);
    this.container.destroy();
  }
}
