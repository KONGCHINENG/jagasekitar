export const MALAYSIA_STATES = {
  PRK: 'Perak',
  SEL: 'Selangor',
  KDH: 'Kedah',
  PNG: 'Pulau Pinang',
  JHR: 'Johor',
  PHG: 'Pahang',
  TRG: 'Terengganu',
  KTN: 'Kelantan',
  MLK: 'Melaka',
  NSN: 'Negeri Sembilan',
  PLS: 'Perlis',
  SBH: 'Sabah',
  SWK: 'Sarawak',
  WLH: 'WP Kuala Lumpur',
} as const;
export type StateCode = keyof typeof MALAYSIA_STATES;

export const PERAK_DISTRICTS = [
  'Bagan Datuk',
  'Batang Padang',
  'Hilir Perak',
  'Hulu Perak',
  'Kampar',
  'Kerian',
  'Kuala Kangsar',
  'Kinta',
  'Larut Matang dan Selama',
  'Manjung',
  'Muallim',
  'Perak Tengah',
] as const;

/** Fire/wind bounding box: Sumatra, Kalimantan, Peninsular Malaysia, Borneo. [W, S, E, N] */
export const HAZE_BBOX = [95, -6, 120, 8] as const;

export const DISCLAIMER = {
  en: 'Predictions are estimates. Always follow official advice from JPS, MetMalaysia, NADMA and KKM.',
  ms: 'Ramalan ini adalah anggaran. Sentiasa ikut nasihat rasmi JPS, MetMalaysia, NADMA dan KKM.',
};
