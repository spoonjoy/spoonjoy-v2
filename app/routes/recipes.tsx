import { Outlet } from "react-router";

// This is a public layout route. Child routes load their own data and enforce authentication in
// their own loaders/actions. It has no loader on purpose: a layout loader would re-run on every
// same-URL navigation under /recipes, including leaving a recipe's cook mode (`#cook`), which
// would then wait on (or, offline, fail on) a data request for nothing.

export default function RecipesLayout() {
  return <Outlet />;
}
