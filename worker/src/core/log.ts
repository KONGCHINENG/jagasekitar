const stamp = () => new Date().toISOString().slice(11, 19);

export const log = {
  info: (scope: string, msg: string) => console.log(`${stamp()} [${scope}] ${msg}`),
  warn: (scope: string, msg: string) => console.warn(`${stamp()} [${scope}] WARN ${msg}`),
  error: (scope: string, msg: string) => console.error(`${stamp()} [${scope}] ERROR ${msg}`),
};
