#!/usr/bin/env node

const [command, ...args] = process.argv.slice(2);

if (command !== 'migration') {
  fail('Usage: sqlex migration <make|sql|up|down|status|baseline>');
} else {
  require('./sqlex-migrate').main(args).catch(fail);
}

function fail(error) {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
}
