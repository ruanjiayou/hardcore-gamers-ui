import React from 'react';
import { mountEntry } from '../../../bootstrap/entry';
import { gameManager } from '../../../core/GameManager';
import { gameUrl } from '../../../navigation';
import GameApp from './App';

const slug = 'tetris';

gameManager.registerLoader('tetris', () => import('../../../games/tetris'));
mountEntry(<GameApp />, gameUrl(slug), { showNavbar: false });
