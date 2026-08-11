#!/usr/bin/env node

const [command, ...args] = process.argv.slice(2);

if (command === 'migration') {
  require('./sqlex-migrate').main(args).catch(fail);
} else if (command === 'openapi') {
  require('./sqlex-openapi').main(args).catch(fail);
} else {
  fail(
    'Usage: sqlex migration <make|sql|up|down|status|baseline>\n' +
    '       sqlex openapi [--config <file>] [--out <file>]'
  );
}

function fail(error) {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
}
