import React from 'react';
import App from './App';
import { mountEntry } from './bootstrap/entry';

mountEntry(<App />, process.env.PUBLIC_URL as string);
