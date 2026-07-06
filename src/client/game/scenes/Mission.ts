import * as Phaser from 'phaser';
import { BALANCE } from '../../../shared/balance';
import { generateMap, rollCrateContents } from '../../../shared/mapgen';
import type {
  CrateContents,
  MissionMap,
  MissionStartResponse,
  MissionStatus,
} from '../../../shared/types';
import { COLORS, FONT, W } from '../ui';

/** Raw result the mission scene reports on finish. The host (React) turns this
 *  into the /mission/complete request — the scene never touches the network. */
export type MissionPlayResult = {
  status: MissionStatus;
  collectedCrateIds: string[];
  clientDurationMs: number;
};

export type MissionSceneData = {
  start: MissionStartResponse;
  threat: number;
  onDone: (result: MissionPlayResult) => void;
};

const TILE = 48;
const STEP_MS = 160;
const HAZARD_ARM_INTERVAL_MS = 4000;
const HAZARD_ARMED_LIFETIME_MS = 2500;
const LOW_AIR_SECONDS = 20;
const GRID_TOP = 200;

type Tile = { x: number; y: number };

// Frozen direction constants so readHeldDirection doesn't allocate per frame.
const DIR_UP: Readonly<Tile> = Object.freeze({ x: 0, y: -1 });
const DIR_DOWN: Readonly<Tile> = Object.freeze({ x: 0, y: 1 });
const DIR_LEFT: Readonly<Tile> = Object.freeze({ x: -1, y: 0 });
const DIR_RIGHT: Readonly<Tile> = Object.freeze({ x: 1, y: 0 });

type HazardState = {
  x: number;
  y: number;
  rect: Phaser.GameObjects.Rectangle;
  armed: boolean;
  armedUntil: number;
  arming: boolean;
};

export class Mission extends Phaser.Scene {
  private start_!: MissionStartResponse;
  private threat_ = 0;
  private map_!: MissionMap;
  private contents_!: CrateContents[];

  private gridX = 0;
  private gridY = GRID_TOP;

  private player_!: Phaser.GameObjects.Rectangle;
  private pos_: Tile = { x: 0, y: 0 };
  private path_: Tile[] = [];
  private stepAccumulator_ = 0;
  private heldStepAccumulator_ = 0;

  private collected_ = new Set<string>();
  private crateRects_ = new Map<string, Phaser.GameObjects.Rectangle>();
  private hazardStates_: HazardState[] = [];

  private airLeft_ = 0;
  private airText_!: Phaser.GameObjects.Text;
  private lootText_!: Phaser.GameObjects.Text;
  private airHeartbeatOn_ = false;

  private startedAt_ = 0;
  private done_ = false;
  private onDone_!: (result: MissionPlayResult) => void;

  private keys_!: {
    w: Phaser.Input.Keyboard.Key;
    a: Phaser.Input.Keyboard.Key;
    s: Phaser.Input.Keyboard.Key;
    d: Phaser.Input.Keyboard.Key;
    up: Phaser.Input.Keyboard.Key;
    left: Phaser.Input.Keyboard.Key;
    down: Phaser.Input.Keyboard.Key;
    right: Phaser.Input.Keyboard.Key;
  };

  constructor() {
    super('Mission');
  }

  create(data: MissionSceneData) {
    this.start_ = data.start;
    this.threat_ = data.threat;
    this.onDone_ = data.onDone;
    // Route must match the server token — it regenerates with token.route,
    // so a mismatch would produce crate ids that fail validation.
    this.map_ = generateMap(this.start_.layoutSeed, this.threat_, this.start_.route);
    this.contents_ = rollCrateContents(this.map_, this.start_.lootSeed, this.start_.route);
    this.pos_ = { x: this.map_.spawn.x, y: this.map_.spawn.y };
    this.collected_.clear();
    this.crateRects_.clear();
    this.hazardStates_ = [];
    this.path_ = [];
    this.stepAccumulator_ = 0;
    this.heldStepAccumulator_ = 0;
    this.done_ = false;
    this.airLeft_ = this.start_.airSeconds;
    this.startedAt_ = Date.now();
    this.airHeartbeatOn_ = false;

    const gridWidth = this.map_.width * TILE;
    this.gridX = Math.round((W - gridWidth) / 2);
    this.gridY = GRID_TOP;

    this.cameras.main.setBackgroundColor(COLORS.bg);

    // ---------- HUD ----------
    this.add
      .text(W / 2, 24, 'THE RUINS', {
        fontFamily: FONT,
        fontSize: '30px',
        color: COLORS.text,
        fontStyle: 'bold',
      })
      .setOrigin(0.5, 0);
    const routeName =
      this.start_.route.charAt(0).toUpperCase() + this.start_.route.slice(1);
    this.add
      .text(W / 2, 66, `${routeName} route — grab what you can. Reach the exit before your air runs out.`, {
        fontFamily: FONT,
        fontSize: '16px',
        color: COLORS.dim,
      })
      .setOrigin(0.5, 0);

    this.airText_ = this.add
      .text(W / 2, 100, '', {
        fontFamily: FONT,
        fontSize: '42px',
        color: COLORS.text,
        fontStyle: 'bold',
      })
      .setOrigin(0.5, 0);
    this.lootText_ = this.add
      .text(W / 2, 158, '', {
        fontFamily: FONT,
        fontSize: '18px',
        color: COLORS.dim,
      })
      .setOrigin(0.5, 0);

    this.refreshAirLabel();
    this.refreshLootLabel();

    // ---------- Grid ----------
    this.drawGrid();

    // ---------- Crates ----------
    const isScout = this.start_.player.role === 'scout';
    for (const crate of this.map_.crates) {
      const px = this.tileCenterX(crate.x);
      const py = this.tileCenterY(crate.y);
      const rect = this.add
        .rectangle(px, py, TILE - 8, TILE - 8, COLORS.warn, 1)
        .setStrokeStyle(2, 0x8a6c19);
      this.crateRects_.set(crate.id, rect);
      if (isScout) {
        const summary = this.crateSummary(crate.id);
        if (summary) {
          this.add
            .text(px, py - TILE / 2 - 6, summary, {
              fontFamily: FONT,
              fontSize: '11px',
              color: '#e8e6e3',
              backgroundColor: '#1d2126',
              padding: { x: 3, y: 1 },
            })
            .setOrigin(0.5, 1)
            .setDepth(5);
        }
      }
    }

    // ---------- Hazards ----------
    for (const h of this.map_.hazards) {
      const rect = this.add
        .rectangle(this.tileCenterX(h.x), this.tileCenterY(h.y), TILE - 6, TILE - 6, COLORS.bad, 0.18)
        .setStrokeStyle(1, COLORS.bad);
      this.hazardStates_.push({
        x: h.x,
        y: h.y,
        rect,
        armed: false,
        armedUntil: 0,
        arming: false,
      });
    }

    // ---------- Player ----------
    this.player_ = this.add
      .rectangle(
        this.tileCenterX(this.pos_.x),
        this.tileCenterY(this.pos_.y),
        TILE - 12,
        TILE - 12,
        COLORS.accent,
        1,
      )
      .setStrokeStyle(2, 0xffffff)
      .setDepth(10);

    // ---------- Input ----------
    const kb = this.input.keyboard;
    if (kb) {
      this.keys_ = {
        w: kb.addKey(Phaser.Input.Keyboard.KeyCodes.W),
        a: kb.addKey(Phaser.Input.Keyboard.KeyCodes.A),
        s: kb.addKey(Phaser.Input.Keyboard.KeyCodes.S),
        d: kb.addKey(Phaser.Input.Keyboard.KeyCodes.D),
        up: kb.addKey(Phaser.Input.Keyboard.KeyCodes.UP),
        left: kb.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT),
        down: kb.addKey(Phaser.Input.Keyboard.KeyCodes.DOWN),
        right: kb.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT),
      };
    }

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.onPointerDown(p));

    // ---------- Timers ----------
    this.time.addEvent({
      delay: 1000,
      loop: true,
      callback: () => this.tickAir(),
    });
    this.time.addEvent({
      delay: HAZARD_ARM_INTERVAL_MS,
      loop: true,
      callback: () => this.armRandomHazard(),
    });
  }

  override update(_time: number, delta: number) {
    if (this.done_) return;

    // path-following (auto-walk from tap)
    if (this.path_.length > 0) {
      this.stepAccumulator_ += delta;
      while (this.stepAccumulator_ >= STEP_MS && this.path_.length > 0) {
        this.stepAccumulator_ -= STEP_MS;
        const next = this.path_.shift()!;
        this.stepTo(next.x, next.y);
        if (this.done_) return;
      }
      return;
    }

    // held keyboard movement (WASD/arrows)
    const dir = this.readHeldDirection();
    if (dir) {
      this.heldStepAccumulator_ += delta;
      if (this.heldStepAccumulator_ >= STEP_MS) {
        this.heldStepAccumulator_ -= STEP_MS;
        const nx = this.pos_.x + dir.x;
        const ny = this.pos_.y + dir.y;
        if (this.walkable(nx, ny)) this.stepTo(nx, ny);
      }
    } else {
      // ready to step immediately on next press
      this.heldStepAccumulator_ = STEP_MS;
    }
  }

  // ---------- helpers ----------

  private tileCenterX(tx: number): number {
    return this.gridX + tx * TILE + TILE / 2;
  }
  private tileCenterY(ty: number): number {
    return this.gridY + ty * TILE + TILE / 2;
  }

  private walkable(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.map_.width || y >= this.map_.height) return false;
    const row = this.map_.tiles[y];
    if (!row) return false;
    return row[x] !== 'wall';
  }

  private drawGrid() {
    for (let y = 0; y < this.map_.height; y++) {
      for (let x = 0; x < this.map_.width; x++) {
        const kind = this.map_.tiles[y]![x]!;
        const cx = this.tileCenterX(x);
        const cy = this.tileCenterY(y);
        let color = 0x1a1d22;
        if (kind === 'wall') color = 0x2a2e33;
        else if (kind === 'exit') color = COLORS.good;
        const rect = this.add.rectangle(cx, cy, TILE - 1, TILE - 1, color, 1);
        if (kind === 'exit') {
          rect.setStrokeStyle(2, 0xffffff);
          this.add
            .text(cx, cy, 'EXIT', {
              fontFamily: FONT,
              fontSize: '12px',
              color: '#121417',
              fontStyle: 'bold',
            })
            .setOrigin(0.5);
        }
      }
    }
  }

  private crateSummary(crateId: string): string {
    const c = this.contents_.find((x) => x.crateId === crateId);
    if (!c) return '';
    const abbr: Record<string, string> = { food: 'f', medicine: 'm', scrap: 's' };
    return Object.entries(c.loot)
      .map(([k, v]) => `${abbr[k] ?? k[0]}${v}`)
      .join(' ');
  }

  private readHeldDirection(): Readonly<Tile> | null {
    if (!this.keys_) return null;
    if (this.keys_.w.isDown || this.keys_.up.isDown) return DIR_UP;
    if (this.keys_.s.isDown || this.keys_.down.isDown) return DIR_DOWN;
    if (this.keys_.a.isDown || this.keys_.left.isDown) return DIR_LEFT;
    if (this.keys_.d.isDown || this.keys_.right.isDown) return DIR_RIGHT;
    return null;
  }

  private onPointerDown(p: Phaser.Input.Pointer) {
    if (this.done_) return;
    const tx = Math.floor((p.worldX - this.gridX) / TILE);
    const ty = Math.floor((p.worldY - this.gridY) / TILE);
    if (!this.walkable(tx, ty)) return;
    if (tx === this.pos_.x && ty === this.pos_.y) return;
    const path = this.findPath(this.pos_, { x: tx, y: ty });
    if (path && path.length > 0) {
      this.path_ = path;
      this.stepAccumulator_ = STEP_MS; // step immediately on first update tick
    }
  }

  private findPath(from: Tile, to: Tile): Tile[] | null {
    if (!this.walkable(to.x, to.y)) return null;
    const key = (t: Tile) => `${t.x},${t.y}`;
    const prev = new Map<string, Tile | null>();
    prev.set(key(from), null);
    const queue: Tile[] = [from];
    let found = false;
    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (cur.x === to.x && cur.y === to.y) {
        found = true;
        break;
      }
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const nx = cur.x + dx;
        const ny = cur.y + dy;
        if (!this.walkable(nx, ny)) continue;
        const nk = `${nx},${ny}`;
        if (prev.has(nk)) continue;
        prev.set(nk, cur);
        queue.push({ x: nx, y: ny });
      }
    }
    if (!found) return null;
    const path: Tile[] = [];
    let cursor: Tile | null = to;
    while (cursor && !(cursor.x === from.x && cursor.y === from.y)) {
      path.unshift(cursor);
      cursor = prev.get(key(cursor)) ?? null;
    }
    return path;
  }

  private stepTo(x: number, y: number) {
    if (this.done_) return;
    if (!this.walkable(x, y)) return;
    this.pos_ = { x, y };
    this.player_.setPosition(this.tileCenterX(x), this.tileCenterY(y));

    // crate pickup
    const crate = this.map_.crates.find((c) => c.x === x && c.y === y);
    if (crate && !this.collected_.has(crate.id)) {
      this.collected_.add(crate.id);
      const rect = this.crateRects_.get(crate.id);
      if (rect) rect.setAlpha(0.25);
      this.cameras.main.flash(80, 217, 164, 41, false);
      this.refreshLootLabel();
    }

    // hazard-on-step check (armed hazards fire on entry too)
    const hz = this.hazardStates_.find((h) => h.x === x && h.y === y);
    if (hz && hz.armed) {
      this.cameras.main.shake(240, 0.012);
      this.finish('hazard');
      return;
    }

    // exit
    if (x === this.map_.exit.x && y === this.map_.exit.y) {
      this.finish('escaped');
    }
  }

  private armRandomHazard() {
    if (this.done_) return;
    if (this.hazardStates_.length === 0) return;
    // pick a currently-idle hazard
    const idle = this.hazardStates_.filter((h) => !h.armed && !h.arming);
    if (idle.length === 0) return;
    const hz = idle[Math.floor(Math.random() * idle.length)]!;
    hz.arming = true;
    this.tweens.add({
      targets: hz.rect,
      alpha: 0.75,
      yoyo: true,
      repeat: 3,
      duration: Math.floor(BALANCE.mission.hazardWarningMs / 8),
      onComplete: () => {
        if (this.done_) return;
        hz.arming = false;
        hz.armed = true;
        hz.armedUntil = this.time.now + HAZARD_ARMED_LIFETIME_MS;
        hz.rect.setAlpha(0.85);
        hz.rect.setFillStyle(COLORS.bad, 0.85);
        // subtle warning shake as the hazard goes hot
        this.cameras.main.shake(150, 0.003);
        // if player is standing on it right now → fire
        if (this.pos_.x === hz.x && this.pos_.y === hz.y) {
          this.cameras.main.shake(240, 0.012);
          this.finish('hazard');
          return;
        }
        // schedule de-arm
        this.time.delayedCall(HAZARD_ARMED_LIFETIME_MS, () => {
          if (this.done_) return;
          hz.armed = false;
          hz.rect.setAlpha(0.18);
          hz.rect.setFillStyle(COLORS.bad, 0.18);
        });
      },
    });
  }

  private tickAir() {
    if (this.done_) return;
    this.airLeft_ -= 1;
    if (this.airLeft_ <= 0) {
      this.airLeft_ = 0;
      this.refreshAirLabel();
      this.finish('timeout');
      return;
    }
    this.refreshAirLabel();
  }

  private refreshAirLabel() {
    const low = this.airLeft_ <= LOW_AIR_SECONDS;
    this.airText_.setText(`AIR  ${this.airLeft_}s`);
    this.airText_.setColor(low ? '#c4453c' : COLORS.text);
    if (low && !this.airHeartbeatOn_) {
      this.airHeartbeatOn_ = true;
      this.tweens.add({
        targets: this.airText_,
        scale: 1.12,
        yoyo: true,
        duration: 300,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }
  }

  private refreshLootLabel() {
    const totals: Record<string, number> = {};
    for (const id of this.collected_) {
      const c = this.contents_.find((x) => x.crateId === id);
      if (!c) continue;
      for (const [k, v] of Object.entries(c.loot)) {
        totals[k] = (totals[k] ?? 0) + (v ?? 0);
      }
    }
    const parts = Object.entries(totals)
      .filter(([, v]) => v > 0)
      .map(([k, v]) => `${k} ×${v}`);
    const crateCount = this.collected_.size;
    const prefix = `PACK  ${crateCount}/${this.map_.crates.length} crates`;
    this.lootText_.setText(parts.length > 0 ? `${prefix}  —  ${parts.join('   ')}` : prefix);
  }

  private finish(status: MissionStatus) {
    if (this.done_) return;
    this.done_ = true;

    // Instant feedback while the completion request is in flight — the scene
    // transition destroys these automatically.
    const cam = this.cameras.main;
    this.add
      .rectangle(cam.centerX, cam.centerY, cam.width, cam.height, 0x000000, 0.6)
      .setDepth(2000);
    this.add
      .text(cam.centerX, cam.centerY, 'Heading home…', {
        fontFamily: FONT,
        fontSize: '24px',
        color: COLORS.text,
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setDepth(2001);

    if (this.airHeartbeatOn_) {
      this.tweens.killTweensOf(this.airText_);
      this.airText_.setScale(1);
      this.airHeartbeatOn_ = false;
    }
    const collectedCrateIds = [...this.collected_];
    const clientDurationMs = Date.now() - this.startedAt_;
    // Hand the raw result to the host (React), which owns the /mission/complete
    // request and the native result screen. Small delay so the "Heading home…"
    // frame paints before the scene is torn down.
    this.time.delayedCall(280, () => this.onDone_({ status, collectedCrateIds, clientDurationMs }));
  }
}
