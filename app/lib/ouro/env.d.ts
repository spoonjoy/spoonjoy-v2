declare namespace NodeJS {
  interface ProcessEnv {
    NODE_ENV?: string | undefined;
  }
  interface Process {
    env: ProcessEnv;
  }
}
// eslint-disable-next-line no-var
declare var process: NodeJS.Process;
