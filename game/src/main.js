import { Game } from './game.js';

const dustline = new Game();
window.__game = dustline;
window.__shotReady = false;
dustline.start();
