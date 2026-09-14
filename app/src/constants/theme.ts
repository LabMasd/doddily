import '@/global.css';

// Little Days palette: cool milk and navy ink, one marigold accent, leaf green for "free".
export const C = {
  milk: '#F4F6F8',
  card: '#FFFFFF',
  ink: '#1E2536',
  muted: '#667085',
  line: '#DFE3E9',
  marigold: '#F2A007',
  marigoldSoft: '#FFF1D3',
  marigoldText: '#7A4E00',
  leaf: '#2F7A52',
  leafSoft: '#E3F2EA',
  rain: '#3D6FB6',
  chip: '#EEF0F3',
  chipText: '#3B4456',
  warn: '#9A3412',
  warnSoft: '#FBE9E7',
} as const;

export const F = {
  display: 'BricolageGrotesque_700Bold',
  displayMedium: 'BricolageGrotesque_500Medium',
  text: 'Figtree_400Regular',
  textMedium: 'Figtree_500Medium',
  textSemi: 'Figtree_600SemiBold',
} as const;

export const R = { lg: 18, md: 12, pill: 999 } as const;
export const GUTTER = 16;
export const MaxContentWidth = 720;
