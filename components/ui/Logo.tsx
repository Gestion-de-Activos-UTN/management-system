// SIAM brand mark, from siam-logo.svg. Defaults to its own pine gradient
// (for light surfaces, e.g. the header); pass `color` for a flat fill —
// the gradient's dark end has poor contrast on the dark pine login panel.
// Actual artwork bounding box is x:[27,143] y:[28,197] — not centered in the
// original 0 0 162 217 canvas (27/19 left/right, 28/20 top/bottom margins).
// Cropped to that box + 4px padding so the rendered icon is actually centered
// in its own box — otherwise every flex/grid centering against it looks off.
const LOGO_VIEWBOX = '23 24 124 177';

export function Logo({ height = 28, color }: { height?: number; color?: string }) {
  return (
    <svg height={height} width={(height * 124) / 177} viewBox={LOGO_VIEWBOX} xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="siam-logo-gradient" gradientUnits="userSpaceOnUse" x1="30" y1="190" x2="140" y2="30">
          <stop offset="0%" stopColor="#23443e" />
          <stop offset="48%" stopColor="#3d7266" />
          <stop offset="100%" stopColor="#92b6ab" />
        </linearGradient>
      </defs>
      <g fill={color ?? 'url(#siam-logo-gradient)'}>
        <path d="M 142.0,28.0 L 109.0,37.0 L 115.0,44.0 L 68.0,92.0 L 65.0,99.0 L 65.0,102.0 L 67.0,105.0 L 77.0,111.0 L 128.0,56.0 L 135.0,62.0 Z" />
        <path d="M 93.0,38.0 L 65.0,45.0 L 64.0,46.0 L 70.0,52.0 L 44.0,75.0 L 36.0,84.0 L 51.0,94.0 L 80.0,62.0 L 87.0,67.0 Z" />
        <path d="M 143.0,71.0 L 116.0,78.0 L 115.0,79.0 L 121.0,86.0 L 108.0,99.0 L 98.0,93.0 L 86.0,106.0 L 87.0,108.0 L 113.0,124.0 L 137.0,140.0 L 140.0,133.0 L 139.0,123.0 L 137.0,119.0 L 132.0,114.0 L 126.0,111.0 L 120.0,105.0 L 131.0,94.0 L 138.0,100.0 L 138.0,95.0 L 140.0,90.0 Z" />
        <path d="M 34.0,86.0 L 33.0,86.0 L 30.0,93.0 L 31.0,104.0 L 36.0,111.0 L 49.0,119.0 L 50.0,121.0 L 39.0,132.0 L 32.0,127.0 L 27.0,155.0 L 55.0,148.0 L 49.0,141.0 L 61.0,128.0 L 71.0,134.0 L 84.0,121.0 L 83.0,119.0 L 47.0,96.0 Z" />
        <path d="M 104.0,123.0 L 93.0,116.0 L 42.0,170.0 L 35.0,164.0 L 30.0,191.0 L 28.0,196.0 L 31.0,197.0 L 35.0,195.0 L 61.0,189.0 L 55.0,182.0 L 102.0,134.0 L 104.0,131.0 Z" />
        <path d="M 134.0,143.0 L 125.0,136.0 L 119.0,133.0 L 89.0,166.0 L 82.0,160.0 L 76.0,189.0 L 104.0,183.0 L 105.0,182.0 L 99.0,176.0 L 131.0,147.0 Z" />
      </g>
    </svg>
  );
}
