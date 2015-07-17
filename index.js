//jshint laxcomma: true, node: true, indent: false, camelcase: false, expr: true, newcap: false, quotmark: false
'use strict';
var raw = require('docker-raw-stream');
var docker = require('docker-remote-api');
var through = require('through2');
var pump = require('pump');
var events = require('events');
var debug = require('debug')('docker-run');
var _ = require('lodash');

var noop = function() {};

var run = function(opts) {

 opts = opts || {};

 var defaultCreate = {
    AttachStdin: true,
    AttachStdout: true,
    AttachStderr: true,
    OpenStdin: true,
    StdinOnce: true,
    Tty: false,
    ExposedPorts: {},
    Env: [],
    Volumes: {}
  };

  var defaultStart = {
    PortBindings: {},
    Binds: [],
    Privileged: false
  };

  var sopts = _.defaults(opts.start || {}, defaultStart);
  var copts = _.defaults(opts.create || {}, defaultCreate);


  var request = docker(opts.host, {version:'v1.14'});
  var that = new events.EventEmitter();



  that.stdin = copts.AttachStdin ? through() : null;
  that.stderr = copts.AttachStdout ? through() : null;
  that.stdout = copts.AttachStderr ? through() : null;
  that.setMaxListeners(0);

  var ready = function(cb) {
    if (that.id) return cb()
    that.on('spawn', cb)
  }

  that.destroy =
  that.kill = function() {
    ready(function() {
      stop(that.id, noop)
    })
  }

  that.resize = function(wid, hei) {
    ready(function() {
      resize(that.id, wid, hei, noop)
    })
  }

  var create = function(cb) {
    debug('creating container', copts);
    var qs = {}
    if (opts.name) qs.name = opts.name
    request.post('/containers/create', {json: copts, qs:qs}, cb)
  }

  var attach = function(id, cb) {
    if (opts.fork) return cb()

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
      if (copts.Tty) return cb(null, stdin, response)

      var parser = response.pipe(raw())
      cb(null, stdin, parser.stdout, parser.stderr)
    })

    if (!stdin._header && stdin._implicitHeader) stdin._implicitHeader()
    if (stdin._send) stdin._send(new Buffer(0))

    stdin.on('finish', function() {
      stdin.socket.end() // force end
    })
  }

  var remove = function(id, cb) {
    debug('removing %s', id)
    request.del('/containers/'+id, {qs:{force:true}}, cb)
  }

  that.remove = function(cb) {
    ready(function() {
      remove(that.id, cb)
    })
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
    debug('starting %s', id, sopts)
    request.post('/containers/'+id+'/start', {json: sopts}, cb)
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

  var resize = function(id, wid, hei, cb) {
    debug('resizing %s to %dx%d', id, wid, hei)
    request.post('/containers/'+id+'/resize', {
      qs: {
        h: hei,
        w: wid
      },
      buffer: true,
      body: null
    }, cb)
  }

  var resizeDefault = function(id, cb) {
    if (opts.width && opts.height) return resize(id, opts.width, opts.height, cb)
    cb()
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

        resizeDefault(container.Id, function(err) {
          if (err) return onerror(container.Id, err)

          if (!stdin) return that.emit('spawn', that.id)

          pump(that.stdin, stdin)
          pump(stdout, that.stdout)
          if (stderr) pump(stderr, that.stderr)
          else that.stderr.end()

          wait(container.Id, function(err, code) {
            if (err) return onerror(container.Id, err)
            if (opts.remove) {
             that.remove(container.Id, function() {
               that.emit('exit', code)
               that.emit('close')
             })
            }
          })

          that.emit('spawn', that.id)
        })
      })
    })
  })

  return that
}

module.exports = run
