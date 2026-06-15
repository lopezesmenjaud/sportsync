// Renders the FanSchedule wordmark SVG to PNG at 1600x400 (4:1), transparent bg.
const sharp = require("sharp");
const path = require("path");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="400" viewBox="0 0 800 200">
  <g transform="translate(20, 20) scale(1.333)">
    <rect width="120" height="120" fill="#1C2430"/>
    <rect x="42" y="28" width="8" height="14" rx="3" fill="#F18006"/>
    <rect x="70" y="28" width="8" height="14" rx="3" fill="#F18006"/>
    <rect x="26" y="38" width="68" height="60" rx="10" fill="#F18006"/>
    <path d="M46,50 H78 V60 H56 V65 H72 V74 H56 V88 H46 Z" fill="#1C2430"/>
  </g>
  <text x="220" y="100" font-family="'Segoe UI', Arial, sans-serif" font-weight="700" font-size="80" dominant-baseline="central">
    <tspan fill="#F18006">Fan</tspan><tspan fill="#FFFFFF">Schedule</tspan>
  </text>
</svg>`;

const out = path.resolve(__dirname, "../frontend/public/fanschedule-logo.png");

sharp(Buffer.from(svg), { density: 144 })
  .resize(1600, 400, { fit: "fill", background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toFile(out)
  .then((info) => {
    console.log("Wrote", out);
    console.log(JSON.stringify(info));
  })
  .catch((err) => {
    console.error("RENDER FAILED:", err);
    process.exit(1);
  });
