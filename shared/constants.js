// Values shared by the server simulation and the browser client.
export const MAX_PLAYERS = 10;
export const MAX_PARTY = 4;

export const ARENA_HALF = 10;        // half-size of the square ice arena (meters)
export const ARENA_MIN_HALF = 4.5;   // the arena never melts below this
export const ARENA_SHRINK = 1.1;     // meters lost per round once melting starts
export const SHRINK_FROM_ROUND = 3;

export const WATER_LEVEL = -1.0;     // the ice top is at y = 0
export const PENGUIN_RADIUS = 0.8;
export const MAX_AIM = 7;            // longest arrow (meters) = full power
export const MAX_SPEED = 12;         // launch speed at full power (m/s)
