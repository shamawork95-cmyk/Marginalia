import { UserSettings } from '../types';

/** Preferences a fresh installation starts with, before the user changes anything. */
export const initialSettings: UserSettings = {
  name: 'Reader',
  typography: 'Literata (Default)',
  fontSize: 18,
  darkMode: false,
  readerMode: false,
  activeThemes: [
    { id: '1', name: 'Key Concepts', color: '#52796f' },
    { id: '2', name: 'Questions', color: '#5e60ce' },
    { id: '3', name: 'Metaphors', color: '#d97706' }
  ]
};
