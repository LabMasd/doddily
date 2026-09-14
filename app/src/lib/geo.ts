type Point = { lat: number; lng: number };

export const MI = 1609.344;

export function miles(a: Point, b: Point) {
  const R = 3958.8, rad = Math.PI / 180;
  const x =
    Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lng - a.lng) * rad) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

/** Walking with a buggy: about 20 min a mile, plus a quarter for streets not being straight. */
export function distLabel(mi: number) {
  const walk = Math.round(mi * 1.25 * 20);
  if (walk <= 35) return `${Math.max(2, walk)} min walk`;
  return `${mi.toFixed(1)} mi`;
}

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
