// German UI texts.
export const T = {
  appName: 'Misty Mahjong',
  tagline: 'Ein stilles Mahjong',
  play: 'Spielen',
  continueGame: 'Weiter',
  newGame: 'Neues Spiel',
  settings: 'Einstellungen',
  howToPlay: 'So wird gespielt',
  back: 'Zurück',
  close: 'Schließen',
  quit: 'Beenden',
  resume: 'Weiterspielen',
  paused: 'Pause',
  hint: 'Tipp',
  pairs: 'Paare',
  time: 'Zeit',
  score: 'Punkte',
  tiles: 'Steine',
  highScore: 'Bestleistung',
  noHighScore: 'Noch keine Bestleistung',
  chain: 'Folge',
  shuffling: 'Keine Paare mehr – die Steine werden neu gemischt',
  timeRunningOut: 'Die Zeit wird knapp',
  quitConfirm: 'Spiel wirklich beenden?',
  quitYes: 'Ja, beenden',
  quitNo: 'Nein',
  // End screen
  endWon: 'Der Garten ist frei',
  endTimeout: 'Die Zeit ist um',
  endQuit: 'Spiel beendet',
  endStuck: 'Keine Züge mehr',
  baseScore: 'Punkte für Paare',
  completion: 'Abschluss',
  timeBonus: 'Zeitbonus',
  total: 'Gesamt',
  newRecord: 'Neue Bestleistung',
  playAgain: 'Noch einmal',
  toTitle: 'Zum Anfang',
  // Settings
  music: 'Musik',
  effects: 'Effekte',
  haptics: 'Vibration',
  markFree: 'Freie Steine hervorheben',
  background: 'Hintergrund',
  tileset: 'Steine',
  on: 'An',
  off: 'Aus',
  // Help
  help1: 'Tippe zwei gleiche Steine an, um sie vom Spielfeld zu nehmen. Alle Blumen passen zueinander, ebenso alle Jahreszeiten.',
  help2: 'Ein Stein ist frei, wenn kein anderer auf ihm liegt und seine linke oder rechte Seite offen ist.',
  help3: 'Jedes Paar zählt den Wert seiner Farbe mal die Zahl der noch liegenden Steine. Folgen in derselben Farbe vervielfachen die Punkte.',
  help4: 'Die Uhr läuft ab dem ersten Paar zehn Minuten. Wer das Feld leert, bekommt die Restzeit als Bonus. Ein Tipp unterbricht die Folge.',
  helpFlowers: 'Blumen',
  helpSeasons: 'Jahreszeiten',
  suitNames: {
    character: 'Zeichen',
    dot: 'Kreise',
    bamboo: 'Bambus',
    wind: 'Winde',
    dragon: 'Drachen',
    flower: 'Blumen',
    season: 'Jahreszeiten',
  },
};

export function formatTime(ms) {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function formatNumber(n) {
  return new Intl.NumberFormat('de-DE').format(n);
}
