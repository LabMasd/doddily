export type Day = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun';

export type Category =
  | 'library' | 'stayplay' | 'support' | 'music' | 'sensory' | 'movement' | 'massage' | 'fitness'
  | 'swim' | 'cinema' | 'museum' | 'farm' | 'softplay' | 'cafe' | 'outdoor'
  // live places from OpenStreetMap
  | 'playground' | 'park' | 'libplace' | 'change' | 'pool' | 'softplace' | 'farmplace' | 'museumplace';

export type Session = { day: Day; start: string | null; end: string | null };

export type Activity = {
  id: string;
  name: string;
  provider?: string;
  category: Category;
  venue?: string;
  address?: string;
  postcode?: string;
  lat: number;
  lng: number;
  sessions: Session[];
  tier: 'timetable' | 'venue' | 'place';
  schedule_note?: string;
  age_min_months?: number;
  age_max_months?: number | null;
  price?: string;
  free: boolean;
  booking: 'drop-in' | 'book' | 'term';
  indoor: boolean;
  description?: string;
  url?: string;
  phone?: string;
  confidence?: 'high' | 'medium' | 'low';
  osm?: boolean;
};

export type Loc = { lat: number; lng: number; name: string; postcode: string };

/** A child in the family. We ask for an age band, never a birthday. */
/** The app that opens for walking directions. */
export type MapApp = 'apple' | 'google' | 'waze' | 'citymapper';

export type AgeBandId = 'u6' | '6to12' | '1to2' | '2to3' | '3to5';
export type Kid = { id: string; name: string; band: AgeBandId };

/** An activity placed relative to the user; `s` is the session on the chosen day. */
export type Row = { it: Activity; d: number; s?: Session };
