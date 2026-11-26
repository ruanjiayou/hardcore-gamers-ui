import React from 'react';
import { mountEntry } from '../../../bootstrap/entry';
import { gameManager } from '../../../core/GameManager';
import { gameUrl } from '../../../navigation';
import GameApp from './App';

const slug = 'xiangqi';

gameManager.registerLoader('xiangqi', () => import('../../../games/xiangqi'));
mountEntry(<GameApp />, gameUrl(slug), { showNavbar: false });
