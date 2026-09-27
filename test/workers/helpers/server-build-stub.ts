// Stands in for `virtual:react-router/server-build` in the workers lane, which runs
// workers/app.ts without React Router's Vite plugin. The lane's tests never send a request
// through React Router's handler, which is the only place the build is read.
export {};
