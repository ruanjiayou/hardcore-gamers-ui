import React from 'react';
import { mountEntry } from '../../../bootstrap/entry';
import { gameManager } from '../../../core/GameManager';
import { gameUrl } from '../../../navigation';
import GameApp from './App';

const slug = '2048';

gameManager.registerLoader('2048', () => import('../../../games/2048'));
mountEntry(<GameApp />, gameUrl(slug), { showNavbar: false });
