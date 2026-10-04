// Parkour courses. Platforms are listed in path order: x/z are the center,
// y is the walkable top, w/d the size along x/z. Static platforms are ice pillars
// reaching down into the water; moving, crumbling and spring platforms float.
//   type: 'snow' (default) | 'ice' (slippery) | 'bounce' (spring) | 'crumble' (breaks shortly after you land)
//   move: [dx, dy, dz] travelled back and forth every `period` seconds
// fish: [x, y, z] collectibles · checkpoints: [x, top, z] · finish: [x, top, z]
// hazards: spinning bars { x, y (bar height), z, len (half length), r, speed (rad/s) }

const P = (x, y, z, w, d, o = {}) => ({ x, y, z, w, d, ...o });
const ice = { type: 'ice' };
const crumble = { type: 'crumble' };
const bounce = { type: 'bounce' };

const steps = {
  id: 'steps',
  name: 'Первые шаги',
  sub: 'Прыжки, двойной прыжок и первый чекпоинт',
  par: 32,
  spawn: { x: 0, y: 0, z: 52, yaw: 0 },
  platforms: [
    P(0, 0, 50, 8, 8),
    P(0, 0, 42, 4, 4),
    P(0, 0.5, 36, 3, 3),
    P(2.5, 1, 30.5, 3, 3),
    P(0, 1.5, 25, 3, 3),
    P(0, 2.5, 20.5, 3, 2),
    P(0, 3.5, 17, 3, 2),
    P(0, 4.5, 13.5, 3, 2),
    P(0, 4.5, 8, 6, 6),
    P(0, 4.5, -0.5, 1.2, 11),
    P(0, 4.5, -8.5, 3, 3),
    P(0, 4.5, -15.5, 3, 3),
    P(0, 7.3, -21.5, 3, 3),
    P(0, 5.5, -28, 4, 4),
    P(0, 5.5, -37, 8, 8),
  ],
  fish: [[0, 1.2, 42], [2.5, 2.2, 30.5], [0, 5.7, 13.5], [0, 5.7, -0.5], [0, 6.4, -12], [0, 8.5, -21.5]],
  checkpoints: [[0, 4.5, 8]],
  finish: [0, 5.5, -37],
  hints: [
    { z: 49, text: 'Пробел — прыжок' },
    { z: 10, text: 'Чекпоинт! Упадёшь в воду — вернёшься сюда' },
    { z: -10, text: 'Длинный прыжок — разбегись' },
    { z: -17, text: 'Слишком высоко? Нажми пробел ещё раз в воздухе!' },
  ],
};

const slippery = {
  id: 'slippery',
  name: 'Скользкий путь',
  sub: 'Гладкий лёд, движущиеся льдины и пружины',
  par: 42,
  spawn: { x: 0, y: 0, z: 52, yaw: 0 },
  platforms: [
    P(0, 0, 50, 8, 8),
    P(0, 0, 41, 5, 6, ice),
    P(4, 0.5, 33, 4, 4, ice),
    P(4, 0.5, 26, 3, 3, { move: [-8, 0, 0], period: 4 }),
    P(-4, 0.5, 19, 3, 3),
    P(-4, 0.5, 12.5, 5, 5),
    P(-4, 0.5, 5.5, 3, 3, bounce),
    P(-4, 5.5, -2, 4, 4),
    P(-4, 5.5, -10, 3, 8, ice),
    P(-4, 5.5, -19, 3, 3, { move: [0, 0, -6], period: 4 }),
    P(-4, 5.5, -31, 4, 4),
    P(0.5, 5.5, -31, 3, 3, { move: [0, 5, 0], period: 5 }),
    P(6, 10.5, -31, 4, 4),
    P(6, 10.5, -37, 3, 3, bounce),
    P(6, 14, -46, 8, 8),
  ],
  fish: [[0, 1.2, 41], [0, 1.7, 26], [-4, 4, 5.5], [-4, 6.7, -10], [-4, 6.7, -22], [0.5, 11.6, -31]],
  checkpoints: [[-4, 0.5, 12.5], [-4, 5.5, -31, -Math.PI / 2]],
  finish: [6, 14, -46],
  hints: [
    { z: 44, text: 'Голубой лёд скользкий — тормози заранее' },
    { z: 9, text: 'Розовая пружина подбросит высоко' },
    { z: -29, text: 'Лифт! Запрыгивай, когда он внизу' },
  ],
};

const melting = {
  id: 'melting',
  name: 'Тающие льдины',
  sub: 'Трескающийся лёд и крутящиеся балки',
  par: 45,
  spawn: { x: 0, y: 0, z: 52, yaw: 0 },
  platforms: [
    P(0, 0, 50, 8, 8),
    P(0, 0, 42.5, 3, 3, crumble),
    P(0, 0, 37, 3, 3, crumble),
    P(0, 0, 31.5, 3, 3, crumble),
    P(0, 0, 24, 6, 6),
    P(0, 0, 15.5, 5, 5),
    P(0, 1, 9, 1.6, 3, crumble),
    P(2.5, 2, 4, 1.6, 3, crumble),
    P(0, 3, -1, 1.6, 3, crumble),
    P(0, 3, -9, 7, 7),
    P(0, 3, -17, 3, 3, { move: [6, 0, 0], period: 5 }),
    P(6, 3, -24, 3, 3, crumble),
    P(6, 3, -31, 5, 5),
    P(6, 4.5, -38, 3, 3, crumble),
    P(6, 6, -44, 3, 3, crumble),
    P(6, 6, -53, 8, 8),
  ],
  hazards: [
    { x: 0, y: 0.45, z: 24, len: 2.8, r: 0.28, speed: 2 },
    { x: 0, y: 3.45, z: -9, len: 3.3, r: 0.28, speed: -2.6 },
  ],
  fish: [[0, 1.2, 37], [2.2, 1.2, 24], [2.5, 3.2, 4], [0, 4.2, -9], [3, 4.2, -17], [6, 6.4, -41]],
  checkpoints: [[0, 0, 15.5], [6, 3, -31]],
  finish: [6, 6, -53],
  hints: [
    { z: 46, text: 'Треснувший лёд проваливается — не стой на месте!' },
    { z: 28, text: 'Перепрыгни крутящуюся балку' },
  ],
};

// A spiral of small floes around a giant ice column; the finish is on top of the column.
function tower() {
  // floes float (no pillars) because the spiral passes over itself every lap
  const floe = { pillar: false };
  const platforms = [P(+(7 * Math.sin(-0.9)).toFixed(2), 0, +(7 * Math.cos(-0.9)).toFixed(2), 5, 5, floe)];
  const fish = [];
  const checkpoints = [];
  const N = 22;
  let y = 0;
  for (let i = 1; i <= N; i++) {
    const a = -0.9 + i * 0.72;
    const prevType = platforms[platforms.length - 1].type;
    y += prevType === 'bounce' ? 4 : 1.2;
    const x = +(7 * Math.sin(a)).toFixed(2), z = +(7 * Math.cos(a)).toFixed(2);
    const cp = i === 8 || i === 16;
    let o = {}; // checkpoints stay roomy plain floes
    if (cp) o = {};
    else if (i === 11) o = bounce;
    else if (i === 19) o = { move: [0, 1.5, 0], period: 3 };
    else if (i % 5 === 3) o = crumble;
    else if (i % 5 === 0) o = ice;
    platforms.push(P(x, +y.toFixed(2), z, cp ? 3.6 : 2.6, cp ? 3.6 : 2.6, { ...floe, ...o }));
    if (cp) checkpoints.push([x, +y.toFixed(2), z, a - Math.PI / 2]);
    if (i % 4 === 2) fish.push([x, +(y + 1.2).toFixed(2), z]);
  }
  const summit = +(y + 1.2).toFixed(2);
  platforms.push(P(0, summit, 0, 6, 6));
  return {
    id: 'tower',
    name: 'Ледяная башня',
    sub: 'Финальный подъём на вершину айсберга',
    par: 60,
    spawn: { x: platforms[0].x, y: 0, z: platforms[0].z, yaw: -0.9 - Math.PI / 2 },
    platforms,
    fish,
    checkpoints,
    finish: [0, summit, 0],
    hints: [],
  };
}

export const LEVELS = [steps, slippery, melting, tower()];
