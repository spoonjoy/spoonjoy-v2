import { defineFlag } from "../define-flag";

declare module "../define-flag" {
  interface DeclaredFlags {
    recipe_visibility: true;
  }
}

export default defineFlag("recipe_visibility", "Cooks choose who reads each recipe (private or public) and their default for new ones");
