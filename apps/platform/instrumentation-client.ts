type ConsoleWithOptionalTimeStamp = Omit<Console, 'timeStamp'> & {
  timeStamp?: Console['timeStamp'];
};

if (process.env.NODE_ENV === 'development') {
  const devConsole = console as ConsoleWithOptionalTimeStamp;

  if (
    typeof devConsole.timeStamp === 'function' &&
    typeof performance.measure === 'function'
  ) {
    try {
      devConsole.timeStamp = undefined;
    } catch {
      Object.defineProperty(devConsole, 'timeStamp', {
        configurable: true,
        value: undefined,
        writable: true,
      });
    }
  }
}
