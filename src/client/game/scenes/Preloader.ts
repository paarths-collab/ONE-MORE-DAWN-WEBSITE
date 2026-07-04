import * as Phaser from 'phaser';
import { H, W } from '../ui';

export class Preloader extends Phaser.Scene {
  constructor() {
    super('Preloader');
  }

  init() {
    //  We loaded this image in our Boot Scene, so we can display it here
    this.add.image(W / 2, H / 2, 'background');

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

  preload() {
    //  Load the assets for the game - Replace with your own assets
    this.load.setPath('../assets');

    this.load.image('logo', 'logo.png');
  }

  create() {
    //  When all the assets have loaded, hand off to the city dashboard.
    this.scene.start('Dashboard');
  }
}
