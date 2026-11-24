// Stands in for `virtual:react-router/server-build` in the workers lane, which runs
// workers/app.ts without React Router's Vite plugin. The lane's tests never send a request
// through React Router's handler. workers/app.ts reads only the build's route paths outside it,
// to name a route in its transient D1 error lines, so the stub has no routes.
export const routes = {};
