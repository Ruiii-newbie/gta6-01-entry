// Vice Coast — shared constants.
// Original sun-soaked coastal city. No Rockstar / GTA names, assets or maps.
export const CITY_SIZE = 480; // city spans x,z in [-240, 240]
export const HALF_CITY = CITY_SIZE / 2; // 240
export const BLOCK = 40; // building block size
export const ROAD_WIDTH = 12; // road width
export const ROAD_PITCH = BLOCK + ROAD_WIDTH; // 52, distance between road centre lines
export const ROAD_LINES = [-208, -156, -104, -52, 0, 52, 104, 156, 208];
export const BLOCK_CENTERS = [-182, -130, -78, -26, 26, 78, 130, 182];
export const WORLD_SEED = 1;

export const BEACH_X = -214; // sand starts west of this line
export const WATER_X = -238; // ocean edge (walkable limit)

// Movement / driving
export const WALK_SPEED = 5; // m/s on foot
export const SPRINT_SPEED = 9; // m/s on foot with Shift
export const PLAYER_RADIUS = 0.6;
export const CAR_RADIUS = 2.1;
export const CAR_TOP_SPEED = 42; // m/s (~151 km/h)
export const CAR_ACCEL = 24; // m/s^2
export const CAR_BRAKE = 34; // m/s^2
export const CAR_REVERSE_TOP = 12; // m/s
export const CAR_STEER = 1.9; // rad/s at full lock, scaled by speed
export const ENTER_CAR_DIST = 4; // metres to enter a car

// Traffic / pedestrians
export const TRAFFIC_COUNT = 10;
export const PED_COUNT = 14;
export const TRAFFIC_SPEED_MIN = 7; // m/s
export const TRAFFIC_SPEED_MAX = 12; // m/s

// Camera (main.js owns the camera; these are its tuning values)
export const CAM_FOV = 60;
export const CAM_FOLLOW_DIST = 11;
export const CAM_FOLLOW_HEIGHT = 6.5;
export const CAM_DRIVE_DIST = 13;
export const CAM_DRIVE_HEIGHT = 6;
export const CAM_LOOK_AHEAD = 6;

// Palette — golden-hour Vice Coast: low warm sun, orange-pink sky.
// The whole game is lit for 17:21 sunset; the sky dome (world.js) blends
// COLORS.horizon at the horizon into COLORS.sky at the zenith.
export const COLORS = {
  sky: 0x6b4a8f,
  horizon: 0xff9a4d,
  fog: 0xe89a6a,
  sun: 0xffb36b,
  ground: 0x8a9a7a,
  sand: 0xecc98a,
  ocean: 0x1e7fa8,
  oceanDeep: 0x0d5a80,
  asphalt: 0x3a3d42,
  sidewalk: 0xb9b3a4,
  buildingGlass: 0x5a7d9a,
  palmTrunk: 0x7a5a38,
  palmLeaf: 0x2e8b4a,
  lampPole: 0x2c2f33,
  hydrant: 0xc23b2e,
};

export const CAR_COLORS = [
  0xd23b2e, 0x2e6fd2, 0xe8c832, 0x2ed27a, 0xe8e8e8,
  0x22242a, 0xd27a2e, 0x8a4fd2, 0x4fd2c8, 0xc8c8d2,
];

export const SHIRT_COLORS = [
  0xd23b2e, 0x2e6fd2, 0xe8c832, 0x2ed27a, 0xe8e8e8,
  0xd27a2e, 0x8a4fd2, 0x4fd2c8, 0xf2f2f2, 0x333333,
];
