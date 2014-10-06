var raw = require('docker-raw-stream')
var docker = require('docker-remote-api')
var through = require('through2')
var pump = require('pump')
var events = require('events')
var debug = require('debug')('docker-run')

var noop = function() {}

var run = function(image, opts) {
  if (!opts) opts = {}

  var request = docker(opts.host, {version:'v1.14'})
  var that = new events.EventEmitter()
  var tty = !!opts.tty

  that.stdin = through()
  that.stderr = through()
  that.stdout = through()

  that.destroy =
  that.kill = function() {
    if (that.id) return stop(that.id, noop)
    that.on('spawn', that.kill)
  }

  var destroy = function(cb) {
    destroyed = true
  }

  var create = function(cb) {
    debug('creating container')
    request.post('/containers/create', {
      json: {
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true,
        OpenStdin: true,
        StdinOnce: true,
        Tty: tty,
        Image: image
      }
    }, cb)
  }

  var attach = function(id, cb) {
    debug('attaching to stdio for %s', id)
    var stdin = request.post('/containers/'+id+'/attach', {
      qs: {
        stderr: 1,
        stdout: 1,
        stdin: 1,
        stream: 1
      },
      headers: {
        'Content-Length': '0'
      }
    }, function(err, response) {
      if (err) return cb(err)
      if (tty) return cb(null, stdin, response)

      var parser = response.pipe(raw())
      cb(null, stdin, parser.stdout, parser.stderr)
    })

    if (!stdin._header && stdin._implicitHeader) stdin._implicitHeader()
    if (stdin._send) stdin._send(new Buffer(0))
  }

  var remove = function(id, cb) {
    debug('removing %s', id)
    request.del('/containers/'+id, cb)
  }

  var stop = function(id, cb) {
    debug('stopping %s', id)
    request.post('/containers/'+id+'/stop', {
      qs: opts.wait || 10,
      json: true,
      body: null
    }, cb)
  }

  var start = function(id, cb) {
    debug('starting %s', id)
    request.post('/containers/'+id+'/start', {
      json: true,
      body: null
    }, cb)
  }

  var wait = function(id, cb) {
    debug('waiting for %s to exit', id)
    request.post('/containers/'+id+'/wait', {
      json: true,
      body: null
    }, function(err, response) {
      if (err) return cb(err)
      cb(null, response.StatusCode)
    })
  }

  var onerror = function(id, err) {
    debug('%s crashed with error %s', id, err.message)
    that.emit('error', err)
  }

  create(function(err, container) {
    if (err) return onerror(null, err)

    debug('spawned %s', container.Id)
    that.id = container.Id

    attach(container.Id, function(err, stdin, stdout, stderr) {
      if (err) return onerror(container.Id, err)

      start(container.Id, function(err) {
        if (err) return onerror(container.Id, err)

        stdin.on('finish', function() {
          stdin.socket.end() // force end
        })

        pump(that.stdin, stdin)
        pump(stdout, that.stdout)
        if (stderr) pump(stderr, that.stderr)
        else that.stderr.end()

        wait(container.Id, function(err, code) {
          if (err) return onerror(container.Id, err)
          remove(container.Id, function() {
            that.emit('exit', code)
          })
        })

        that.emit('spawn', that.id)
      })
    })
  })

  return that
}

module.exports = run