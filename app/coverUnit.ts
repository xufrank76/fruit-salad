// The homepage hero is laid out against Figma's fixed 1280x832 canvas
// (node 56:157). Every position/size/font-size scales as ONE uniform factor
// — like `object-fit: cover` — via CSS max(vw,vh), so the canvas always
// fills the viewport with no letterbox margins, cropping whichever axis has
// extra scale. Fine for decorative bleed (the fruit field); anything that
// must never disappear (e.g. the wordmark) should anchor from a safe
// distance off the true edge (right/bottom) rather than sit flush at 0.
const DESIGN_W = 1280;
const DESIGN_H = 832;

export function cover(px: number): string {
  const vw = (px / DESIGN_W) * 100;
  const vh = (px / DESIGN_H) * 100;
  return `max(${vw.toFixed(4)}vw, ${vh.toFixed(4)}vh)`;
}

export const CANVAS_WIDTH = cover(DESIGN_W);
export const CANVAS_HEIGHT = cover(DESIGN_H);
