import type { Category } from './types';

export const CATS: Record<Category, { e: string; label: string }> = {
  library: { e: '📚', label: 'Rhymes & stories' },
  stayplay: { e: '🧸', label: 'Stay & play' },
  support: { e: '💬', label: 'Baby & toddler group' },
  music: { e: '🎵', label: 'Music' },
  sensory: { e: '✨', label: 'Sensory' },
  movement: { e: '🤸', label: 'Movement' },
  massage: { e: '🤲', label: 'Massage & yoga' },
  fitness: { e: '🏃', label: 'Fitness with baby' },
  swim: { e: '🏊', label: 'Swim' },
  cinema: { e: '🎬', label: 'Cinema' },
  museum: { e: '🏛️', label: 'Museum' },
  farm: { e: '🐐', label: 'Farm' },
  softplay: { e: '🧩', label: 'Soft play' },
  cafe: { e: '☕', label: 'Café' },
  outdoor: { e: '🌳', label: 'Outdoors' },
  playground: { e: '🛝', label: 'Playground' },
  park: { e: '🌳', label: 'Park' },
  libplace: { e: '📚', label: 'Library' },
  change: { e: '🚼', label: 'Baby change' },
  pool: { e: '🏊', label: 'Swimming pool' },
  softplace: { e: '🧩', label: 'Soft play' },
  farmplace: { e: '🐐', label: 'Farm' },
  museumplace: { e: '🏛️', label: 'Museum' },
};

export type GroupId = 'all' | 'rhymes' | 'classes' | 'swim' | 'softplay' | 'cinema' | 'out' | 'parks' | 'change';

export const GROUPS: { id: GroupId; label: string; cats?: Category[] }[] = [
  { id: 'all', label: 'Everything' },
  { id: 'rhymes', label: 'Rhymes & stay-and-play', cats: ['library', 'stayplay', 'support'] },
  { id: 'classes', label: 'Classes', cats: ['music', 'sensory', 'movement', 'massage', 'fitness'] },
  { id: 'swim', label: 'Swim', cats: ['swim', 'pool'] },
  { id: 'softplay', label: 'Soft play', cats: ['softplay', 'softplace'] },
  { id: 'cinema', label: 'Cinema', cats: ['cinema'] },
  { id: 'out', label: 'Days out', cats: ['museum', 'farm', 'cafe', 'outdoor', 'farmplace', 'museumplace'] },
  { id: 'parks', label: 'Parks & playgrounds', cats: ['playground', 'park'] },
  { id: 'change', label: 'Baby change', cats: ['change', 'libplace'] },
];

/** Place types that would flood "Everything"; they live under their own filter. */
export const QUIET_IN_ALL: Category[] = ['change', 'libplace', 'playground', 'pool'];
