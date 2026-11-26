import React from 'react';
import { mountEntry } from '../../../bootstrap/entry';
import { gameManager } from '../../../core/GameManager';
import { gameUrl } from '../../../navigation';
import GameApp from './App';

const slug = 'othello';

gameManager.registerLoader('othello', () => import('../../../games/othello'));
mountEntry(<GameApp />, gameUrl(slug), { showNavbar: false });
