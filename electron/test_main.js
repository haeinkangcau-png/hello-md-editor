try {
  const e = require('electron')
  process.stdout.write('TYPE: ' + typeof e + '\n')
  process.stdout.write('VALUE: ' + JSON.stringify(e) + '\n')
  if (e && typeof e === 'object') {
    process.stdout.write('KEYS: ' + Object.keys(e).slice(0,10).join(',') + '\n')
  }
} catch(err) {
  process.stdout.write('ERROR: ' + err.message + '\n')
}
setTimeout(() => process.exit(0), 1000)
