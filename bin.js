#!/usr/bin/env node

var run = require('./')
var minimist = require('minimist')
var fs = require('fs')

var argv = minimist(process.argv.slice(2), {
  boolean: ['tty', 'remove', 'version'],
  alias: {
    tty:'t',
    remove:'r',
    version:'v',
    host:'h'
  },
  default: {
    tty: process.stdin.isTTY && process.stdout.isTTY,
    remove: true,
    width: process.stdout.columns,
    height: process.stdout.rows
  }
})

if (!argv._.length) {
  console.error(fs.readFileSync(require.resolve('./help.txt'), 'utf-8'))
  process.exit(1)
}

var image = argv._[0]
var child = run(image, argv)

if (argv.tty && !argv.fork) process.stdin.setRawMode(true)

if (!argv.fork) {
  process.stdin.pipe(child.stdin)
  child.stdout.pipe(process.stdout)
  child.stderr.pipe(process.stderr)
}

process.stdout.on('resize', function() {
  child.resize(process.stdout.columns, process.stdout.rows)
})

child.on('error', function(err) {
  console.error('Error: %s', err.message)
  process.exit(1)
})

child.on('exit', function(code) {
  process.exit(code)
})
