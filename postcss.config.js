import tailwindcss from "@tailwindcss/postcss";
import autoprefixer from "autoprefixer";
import { squircleCorners } from "./app/lib/ouro/squircle-corners.ts";
import { shapeVarFallback } from "./scripts/shape-var-fallback.mjs";

// Every Vite build reads this file: the app (vite.config.ts), Storybook (.storybook/main.ts builds
// with vite.config.ts) and the Storybook tests (.storybook/vite.config.ts). squircleCorners() runs
// last, on Tailwind's output, and is the one way Ouro UI draws squircles where the engine has no
// corner-shape (WebKit): it sets corner-shape: squircle where the engine has it, and a squircle
// clip-path where it does not (Ouro UI UPGRADING, "After v1.3.506 (squircles)"). shapeVarFallback()
// keeps Chromium before 158 parsing the whole stylesheet past ouro-base's avatar notch clip-path.
export default {
  plugins: [tailwindcss(), autoprefixer(), squircleCorners(), shapeVarFallback()],
};
