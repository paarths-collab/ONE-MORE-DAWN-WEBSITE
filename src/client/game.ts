import * as Phaser from 'phaser';
import { AUTO, Game } from 'phaser';
import { Boot } from './game/scenes/Boot';
import { Preloader } from './game/scenes/Preloader';
import { Dashboard } from './game/scenes/Dashboard';
import { RoleSelect } from './game/scenes/RoleSelect';
import { Actions } from './game/scenes/Actions';
import { Vote } from './game/scenes/Vote';
import { Mission } from './game/scenes/Mission';
import { MissionEnd } from './game/scenes/MissionEnd';
import { Timeline } from './game/scenes/Timeline';
import { Leaderboard } from './game/scenes/Leaderboard';
import { H, W } from './game/ui';

const config: Phaser.Types.Core.GameConfig = {
  type: AUTO,
  parent: 'game-container',
  backgroundColor: '#121417',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: W,
    height: H,
  },
  scene: [Boot, Preloader, Dashboard, RoleSelect, Actions, Vote, Mission, MissionEnd, Timeline, Leaderboard],
};

document.addEventListener('DOMContentLoaded', () => {
  new Game(config);
});
