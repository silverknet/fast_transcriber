const e = require('electron')
console.log('typeof electron:', typeof e, '| has app:', !!(e && e.app))
process.exit(0)
