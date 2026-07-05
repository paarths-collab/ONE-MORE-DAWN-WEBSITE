import * as Phaser from 'phaser';
import { COLORS, H, W } from '../ui';

export class Preloader extends Phaser.Scene {
  constructor() {
    super('Preloader');
  }

  init() {
    //  Plain fill instead of a 295 KB background image — nothing to download.
    this.cameras.main.setBackgroundColor(COLORS.bg);

    //  A simple progress bar. This is the outline of the bar.
    this.add.rectangle(W / 2, H / 2, 468, 32).setStrokeStyle(1, 0xffffff);

    //  This is the progress bar itself. It will increase in size from the left based on the % of progress.
    const bar = this.add.rectangle(W / 2 - 230, H / 2, 4, 28, 0xffffff);

    //  Use the 'progress' event emitted by the LoaderPlugin to update the loading bar
    this.load.on('progress', (progress: number) => {
      //  Update the progress bar (our bar is 464px wide, so 100% = 464px)
      bar.width = 4 + 460 * progress;
    });
  }

  create() {
    //  No assets to load — Phaser fires create immediately with an empty
    //  load queue, so hand straight off to the hub.
    //  PIXEL_HUB is the fallback lever: flip to false to land on the classic
    //  city Dashboard instead of the pixel Village if the pixel view misbehaves.
    const PIXEL_HUB = true;
    this.scene.start(PIXEL_HUB ? 'Village' : 'Dashboard');
  }
}
