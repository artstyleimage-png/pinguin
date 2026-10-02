// Skin catalogue. Every skin is the same penguin model with different
// colors and an optional accessory (built in public/js/penguin.js).
export const RARITIES = {
  common:    { label: 'Common',    color: '#8a9bb0', weight: 5 },
  uncommon:  { label: 'Uncommon',  color: '#5bbf3a', weight: 4 },
  rare:      { label: 'Rare',      color: '#2f8cf0', weight: 3 },
  epic:      { label: 'Epic',      color: '#a64cf0', weight: 2 },
  legendary: { label: 'Legendary', color: '#f0912f', weight: 1 },
};

const base = { body: 0x1d2442, belly: 0xffffff, beak: 0xffa21f, feet: 0xff8c1a, accessory: null };

export const SKINS = [
  { ...base, id: 'classic', name: 'Classic', rarity: 'common', starter: true },
  { ...base, id: 'blueberry', name: 'Blueberry', rarity: 'common', body: 0x2c5bd8, starter: true },
  { ...base, id: 'chilly', name: 'Chilly Chick', rarity: 'common', body: 0xd8342f },
  { ...base, id: 'iceberg', name: 'Ice Berg Jr', rarity: 'common', body: 0xf3c41c },
  { ...base, id: 'mint', name: 'Mint Slider', rarity: 'uncommon', body: 0x35c995 },
  { ...base, id: 'bubblegum', name: 'Bubblegum', rarity: 'uncommon', body: 0xf06aa8 },
  { ...base, id: 'goggles', name: 'Speed Goggles', rarity: 'rare', accessory: 'goggles' },
  { ...base, id: 'santa', name: 'Frosty Santa', rarity: 'rare', body: 0x27315a, accessory: 'santa' },
  { ...base, id: 'pirate', name: 'Captain Flipper', rarity: 'rare', body: 0x3b2a22, accessory: 'pirate' },
  { ...base, id: 'viking', name: 'Viking', rarity: 'epic', body: 0x5a6b7d, accessory: 'viking' },
  { ...base, id: 'ninja', name: 'Shadow Ninja', rarity: 'epic', body: 0x15151a, belly: 0x2a2a33, accessory: 'ninja' },
  { ...base, id: 'gentleman', name: 'Sir Waddles', rarity: 'epic', body: 0x23262e, accessory: 'tophat' },
  { ...base, id: 'frost', name: 'Frostbite', rarity: 'legendary', body: 0x8fdcff, belly: 0xe8fbff, beak: 0x7fc8ff, feet: 0x7fc8ff, accessory: 'frost' },
  { ...base, id: 'gold', name: 'Golden Emperor', rarity: 'legendary', body: 0xd8a52a, belly: 0xfff4cf, accessory: 'crown' },
];

export const SKIN_BY_ID = Object.fromEntries(SKINS.map((s) => [s.id, s]));
export const STARTER_SKINS = SKINS.filter((s) => s.starter).map((s) => s.id);
