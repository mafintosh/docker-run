var tape = require('tape')
var concat = require('concat-stream')
var run = require('./')

var fs = require('fs')
var path = require('path')

tape('spawn bash', function(t) {
  var child = run('mafintosh/dev')

  child.stdin.end('echo hello world')
  child.stdout.pipe(concat(function(data) {
    t.same(data.toString(), 'hello world\n', 'echoes hello world')
    t.end()
  }))
})

tape('env', function(t) {
  var child = run('mafintosh/dev', {
    env:{
      'ENV_TEST_VAR':'hello world'
    }
  })

  child.stdin.end('echo $ENV_TEST_VAR')
  child.stdout.pipe(concat(function(data) {
    t.same(data.toString(), 'hello world\n', 'echoes $ENV_TEST_VAR')
    t.end()
  }))
})

tape('volume', function(t) {
  var child = run('mafintosh/dev', {
    volumes:{
      '/test':__dirname
    }
  })

  var licenceContent = fs.readFileSync(path.join(__dirname, 'LICENSE'), 'utf8')
  child.stdin.end('cat /test/LICENSE')
  child.stdout.pipe(concat(function(data) {
    t.same(data.toString(), licenceContent, 'echoes license file through volume')
    t.end()
  }))
})

tape('destroy', function(t) {
  var child = run('mafintosh/dev')

  child.destroy()
  child.on('exit', function(code) {
    t.ok(code !== 0, 'not ok exit')
    t.end()
  })
})
