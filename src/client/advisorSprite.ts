// Young Maren — the city's lantern-keeper, drawn as a PIXEL-ART sprite so she
// reads with the same retro/Silkscreen character as the rest of the UI. The art
// is a set of small character-grids ("pixel maps") keyed to a palette; a run
// merger turns each row of same-colour pixels into one <rect> so the node count
// stays low and every rect lands on the pixel grid (crisp with crispEdges).
// Feature layers (eyes, mouth, lantern arms) are kept SEPARATE from the base so
// the coach animation hooks (blink, talk, point) still drive them.
//
// Pixels are PX units inside a 72x92 viewBox. Column index == x, so only the
// LEADING dots of a row matter for alignment (trailing pixels are optional).

export const PX = 3;

// One flat palette. '.' (and any unmapped char) is transparent.
export const PAL: Record<string, string> = {
  H: '#2c2416', // hood shadow
  h: '#463a1f', // hood mid
  L: '#6d571e', // hood trim (warm gold-brown)
  r: '#43301d', // hair dark
  R: '#6b4626', // hair mid
  y: '#9c6a34', // hair highlight (young, warm)
  s: '#e8b184', // skin
  S: '#c98a5d', // skin shadow
  k: '#f7d3a8', // skin highlight
  b: '#3f2a17', // brow
  p: '#241a10', // eye
  w: '#fbf3df', // eye catchlight
  m: '#7c463c', // mouth
  t: '#c07d6f', // open-mouth rim
  c: '#33270f', // cloak dark
  C: '#4d3c1a', // cloak mid
  g: '#e6bf46', // gold (clasp, lantern body)
  G: '#fff2ab', // lantern flame
};

export type Rect = { x: number; y: number; w: number; h: number; c: string; k: string };

/** Merge each row of same-colour pixels into one rect. Blanks/unknown chars are
 *  transparent. Rows may be any length; column index maps to x. */
export function pixelRuns(rows: string[], ox = 0, oy = 0): Rect[] {
  const out: Rect[] = [];
  for (let ry = 0; ry < rows.length; ry++) {
    const row = rows[ry] ?? '';
    let x = 0;
    while (x < row.length) {
      const ch = row[x] ?? '.';
      const col = PAL[ch];
      if (!col) { x++; continue; }
      let run = 1;
      while (x + run < row.length && row[x + run] === ch) run++;
      out.push({ x: ox + x * PX, y: oy + ry * PX, w: run * PX, h: PX, c: col, k: `${x}-${ry}` });
      x += run;
    }
  }
  return out;
}

// ---- BASE: hood, hair, face, brows, nose, neck, cloak ------------------------
// Face skin sits at columns 7-16; eyes/mouth are drawn as separate layers below.
export const BASE: string[] = [
  '........HHHHHHHH', //  0 hood crown
  '......HHhhhhhhhhHH', //  1
  '.....HhhhhhhhhhhhhhH', //  2
  '....HhhrrrrrrrrrrhhH', //  3 hair bangs appear
  '....HhrrrrrryyrrrrhH', //  4
  '...LhrrryyyyyyyyrrrhL', //  5 hood trim + hair highlight
  '...LhrrssssssssssrrhL', //  6 forehead
  '...LhrrssssssssssrrhL', //  7
  '...LhrrssssssssssrrhL', //  8
  '...LhrrssssssssssrrhL', //  9
  '...LhrrsbbbssbbbsrrhL', // 10 brows
  '...LhrrssssssssssrrhL', // 11
  '...LhrrssssssssssrrhL', // 12 <- eyes layer
  '...LhrrssssssssssrrhL', // 13
  '...LhrrssssSSssssrrhL', // 14 nose
  '...LhrrsssSSSSsssrrhL', // 15
  '...LhrrssssssssssrrhL', // 16 <- mouth layer
  '...LhrrRssssssssRrrhL', // 17 jaw
  '....LhrRRssssssRRrhL', // 18
  '....hRRRRssssRRRRh', // 19 chin
  '.....hRRRsssRRRh', // 20 neck
  '......ccRsssRcc', // 21
  '......ccCsssCcc', // 22 collar
  '.....ccCCCsCCCcc', // 23
  '....ccCCCCggCCCCcc', // 24 gold clasp
  '...cCCCCCCggCCCCCCc', // 25
  '..ccCCCCCCCCCCCCCCcc', // 26 shoulders
  '..cCCCCCCCCCCCCCCCCc', // 27
  '.ccCCCCCCCCCCCCCCCCcc', // 28
  '.cCCCCCCCCCCCCCCCCCCc', // 29
];

// ---- EYES (co-eyes group: blink squashes it) --------------------------------
// Big, bright, young eyes: a dark pupil with a white catchlight on the outer edge.
export const EYES: string[] = [
  '........wp...pw', // row 12: left eye (cols 8-9), right eye (cols 13-14)
];
export const EYES_OY = 12 * PX;

// ---- MOUTH closed / open (toggled by .talking) ------------------------------
export const MOUTH_CLOSED: string[] = ['..........mmm']; // cols 10-12, row 16
export const MOUTH_CLOSED_OY = 16 * PX;
export const MOUTH_OPEN: string[] = ['..........ttt', '..........mmm']; // rows 16-17
export const MOUTH_OPEN_OY = 16 * PX;

// ---- LANTERN ARM resting at her side (co-arm-side) --------------------------
export const ARM_SIDE: string[] = [
  '................cCc', // row 25 upper arm
  '................cCc',
  '................ggg', // lantern hood
  '...............gGGGg', // flame
  '...............gGGGg',
  '................ggg', // lantern base
];
export const ARM_SIDE_OY = 25 * PX;
export const ARM_SIDE_HALO = { cx: 17.5 * PX, cy: 29 * PX, r: 6 * PX };

// ---- LANTERN ARM raised to point upward (co-arm-up) -------------------------
export const ARM_UP: string[] = [
  '................ggg', // row 1 lantern hood, held high
  '...............gGGGg', // flame
  '...............gGGGg',
  '................ggg', // base
  '................cCc', // forearm dropping back toward the shoulder
  '................cCc',
  '...............ccC',
  '..............ccC',
  '.............ccC',
];
export const ARM_UP_OY = 1 * PX;
export const ARM_UP_HALO = { cx: 17.5 * PX, cy: 2.5 * PX, r: 7 * PX };
