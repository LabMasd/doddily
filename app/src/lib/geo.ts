type Point = { lat: number; lng: number };

export const MI = 1609.344;

export function miles(a: Point, b: Point) {
  const R = 3958.8, rad = Math.PI / 180;
  const x =
    Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lng - a.lng) * rad) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

/** Nobody is asked how they travel. Up to here a family is taken to be walking; further, driving. */
export const WALK_MAX_MI = 3;
export const drives = (mi: number) => mi > WALK_MAX_MI;

/** The distances on offer: fine steps while it is a walk, coarser once it is a drive. */
export const DIST_STEPS = [0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25];
export const nearestStep = (mi: number) =>
  DIST_STEPS.reduce((best, step, i) => (Math.abs(step - mi) < Math.abs(DIST_STEPS[best] - mi) ? i : best), 0);

/** Walking with a buggy: about 20 min a mile, plus a quarter for streets not being straight. */
export const walkMins = (mi: number) => Math.round(mi * 1.25 * 20);
/** Driving: about 2.6 min a mile door to door on mixed roads, plus a few to park. A guide from straight-line distance, not a route. */
export function driveMins(mi: number) {
  const m = 4 + mi * 2.6;
  return m > 20 ? Math.round(m / 5) * 5 : Math.round(m);
}

export function distLabel(mi: number) {
  if (drives(mi)) return `${driveMins(mi)} min drive`;
  const walk = walkMins(mi);
  if (walk <= 35) return `${Math.max(2, walk)} min walk`;
  return `${mi.toFixed(1)} mi`;
}

/** What a chosen distance means in time, for the line under the distance control. */
export const reachHint = (mi: number) =>
  drives(mi) ? `Up to about ${driveMins(mi)} minutes’ drive.` : `Up to about ${walkMins(mi)} minutes’ walk with a buggy.`;

/** Keys of the 0.5° data tiles that overlap a circle. */
export function tileKeys(p: Point, radiusMi: number, tile: number, available: Record<string, number>) {
  const dLat = radiusMi / 69;
  const dLng = radiusMi / (69 * Math.cos((p.lat * Math.PI) / 180));
  const keys: string[] = [];
  for (let y = Math.floor((p.lat - dLat) / tile); y <= Math.floor((p.lat + dLat) / tile); y++)
    for (let x = Math.floor((p.lng - dLng) / tile); x <= Math.floor((p.lng + dLng) / tile); x++)
      if (available[`${y}_${x}`]) keys.push(`${y}_${x}`);
  return keys;
}
