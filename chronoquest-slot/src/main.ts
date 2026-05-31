import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { SlotScene } from './scenes/SlotScene';
import { InfoScene } from './scenes/InfoScene';

// ChronoQuest: Team Showdown — free-play demo entry point.
const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game-container',
  width: 1280,
  height: 720,
  backgroundColor: '#05060f',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_HORIZONTALLY,
  },
  render: {
    antialias: true,
    roundPixels: true,
  },
  scene: [BootScene, SlotScene, InfoScene],
};

// eslint-disable-next-line no-new
new Phaser.Game(config);
