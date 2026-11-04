export interface Logger {
  info(msg: string): void;
  ok(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

const color = (code: string) => (s: string) =>
  process.stdout.isTTY && !process.env.NO_COLOR ? `\x1b[${code}m${s}\x1b[0m` : s;
const green = color('32');
const yellow = color('33');
const red = color('31');

export const consoleLogger: Logger = {
  info: (m) => console.log(m),
  ok: (m) => console.log(`${green('✓')} ${m}`),
  warn: (m) => console.warn(`${yellow('!')} ${m}`),
  error: (m) => console.error(`${red('✗')} ${m}`),
};

export const silentLogger: Logger = { info() {}, ok() {}, warn() {}, error() {} };
