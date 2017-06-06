'use strict';
var util= require('util');
var path= require('path');
var fs= require('fs');
var zmq= require('zmq');
var spawn= require('child_process').spawn;
var execFile= require('child_process').execFile;

var MONICA= require("./config").MONICA;
var tools= require('./tools');

var ERROR= console.error;
var INFO= console.log;
var DEBUG= {
    l1: console.log,
    l2: function() {},
    l3: function() {},
    l4: function() {},
};


var protocol= MONICA.protocol;
var address= MONICA.address;
var baseAddress= MONICA.baseAddress;
var monicaZmqServer= MONICA.monicaZmqServer;
var maxServers= MONICA.maxServers;
var processTimeout= MONICA.processTimeout;
var requestTimeout= MONICA.requestTimeout;
var logPath= MONICA.logPath;


var cbs= [];
var spawnCalls= 0;
var killInProgress= 0;

var monicaServers= {};

//build file name and make sure parent dir exists
var _getLogFileName= function( serverId ) {
    var logFile= logPath ? logPath + serverId : path.join(__dirname, 'log/monica/' + serverId);
    tools.createParentDirectories(logFile);
    return logFile;
};



//starts new monica server
var monicaStartFn= function(cb) {
    return tools.findFreePort(address, function(err, port) {
        if (err || !port) return cb(err);

        var serverId= tools.uuid();
        var spawnOptions= {
            detached: true,
        };

        var server;

        var task= execFile(monicaZmqServer, [ '-s', baseAddress + port ], spawnOptions);

        DEBUG.l1('MonicaAdapter: spawned new child process: id: ' + serverId + ' pid: ' + task.pid + ' on ' + baseAddress + port);

        var logFileName= _getLogFileName(serverId);
        var stdLog= fs.createWriteStream(logFileName + '.log', { 'flags': 'a' });
        stdLog.write('start:  [' + tools.dateToIso8601(new Date()) + '] MonicaAdapter: serverId: ' + serverId + ' pid: ' + task.pid + ' child process started.\n');

        /*
         * handle tasks std IO
         */
        var stdOutWrapper= function(facility, data) {
            var msgs= data.replace(/\033\[[0-9;]*m/g, '');
            msgs.split('\n').forEach(function(msg) {
                if (msg.toString().trim() === '') return;
                //output to file
                stdLog.write(facility + ': [' + tools.dateToIso8601(new Date()) + '] ' + msg + '\n');
                //output to parent process console
                DEBUG.l1(facility + ': ' + msg);
            });
        };
        task.stdout.on('data', function ( data ) {
            stdOutWrapper('stdout', data);
        });
        task.stderr.on('data', function ( data ) {
            stdOutWrapper('stderr', data);
        });

        task.on('exit', function ( code ) {
            if (code === null || code === undefined) code= cmdCb ? 1 : 0;
            DEBUG.l1('MonicaAdapter: child process: id: ' + serverId + ' pid: ' + task.pid + ' exiting with code: ' + code);
            stdLog.end('endlog: [' + tools.dateToIso8601(new Date()) + '] MonicaAdapter: serverId: ' + serverId + ' pid: ' + task.pid + ' child process exiting.\n');
            delete monicaServers[serverId];
            if (cmdCb) {
                DEBUG.l1('MonicaAdapter: child process: id: ' + serverId + ' pid: ' + task.pid + ' exiting but callback not yet called, returning error now.');
                cmdCb('MonicaAdapter: child process: id: ' + serverId + ' pid: ' + task.pid + ' unexpected exit, check job log.');
                cmdCb= undefined;
            }
        });

        var stopTimer= function() {
            if (server.timeout) {
                clearTimeout(server.timeout);
                server.timeout= undefined;
            }
            server.busy= true;
            server.cmdTimeout= setTimeout(cmdTimeoutFn, requestTimeout);

        };
        var startTimer= function() {
            if (server.cmdTimeout) {
                clearTimeout(server.cmdTimeout);
                server.cmdTimeout= undefined;
            }
            server.timeout= setTimeout(killFn, processTimeout);
            server.busy= false;
        };

        var cmdCb;
        var handleMsg= function(msg) {
            if (!cmdCb) return ERROR('MonicaAdapter: killFn: ERROR: no callback defined to process message: id: ' + serverId + ' pid: ' + task.pid + ' on ' + baseAddress + port);

            DEBUG.l3('MonicaAdapter: handleMsg: received message: id: ' + serverId + ' pid: ' + task.pid + ' at address: ' + baseAddress + port + ' msg: ' + util.inspect(msg.toString(), false, 4));
            startTimer();
            var _cmdCb= cmdCb;
            cmdCb= undefined;
            _cmdCb(null, msg);

            return getMonicaServer(cbs.shift())
        };

        var monicaRequester= zmq.socket('req');
        monicaRequester.connect(baseAddress + port);
        DEBUG.l1('MonicaAdapter: monicaRequester zmq connected to process: id: ' + serverId + ' pid: ' + task.pid + ' at address: ' + baseAddress + port);

        monicaRequester.on('message', function(msg) { return handleMsg(msg); });

        var cmdTimeoutFn= function() {
            if (!cmdCb) cmdCb= function() {};
            var msg= 'MonicaAdapter: ERROR: command timeout id: ' + serverId + ' pid: ' + task.pid + ' sending SIGTERM to server process.';
            ERROR(msg);
            task.kill('SIGTERM');
            return cmdCb(msg);
        };

        var killFn= function(cb, err) {
            if (!cb) cb= function() {};

            if (!monicaServers[serverId]) return cb('MonicaAdapter: killFn: ERROR: server process does not exists: id: ' + serverId + ' pid: ' + task.pid + ' on ' + baseAddress + port);
            if (server.busy) return cb('MonicaAdapter: killFn: ERROR: child process busy: id: ' + serverId + ' pid: ' + task.pid + ' on ' + baseAddress + port);

            stopTimer();
            var msg= {
                type: 'finish'
            };
            monicaRequester.send(JSON.stringify(msg));

            handleMsg= function(msg) {
                DEBUG.l3('MonicaAdapter: killFn: received message: id: ' + serverId + ' pid: ' + task.pid + ' at address: ' + baseAddress + port + ' msg: ' + util.inspect(msg.toString(), false, 4));
                return setTimeout(function() {
                    return cb(null, msg);
                }, 5);
            };
        };

        var cmdFn= function(env, cb) {
            var envLog= fs.createWriteStream(logFileName + '.env.json');
            envLog.end(JSON.stringify(env, null, 2));
            if (!cb) cb= function() {};
            if (server.busy) return cb('MonicaAdapter: cmdFn: ERROR: child process busy: id: ' + serverId + ' pid: ' + task.pid + ' on ' + baseAddress + port);
            stopTimer();
            server.uses++;
            monicaRequester.send(JSON.stringify(env));

            cmdCb= cb;
        };

        server= monicaServers[serverId]= {
            serverId: serverId,
            task: task,
            port: port,
            requester: monicaRequester,
            killFn: killFn,
            cmdFn: cmdFn,
            uses: 0,
            started: new Date(),
        };
        startTimer();

        return cb(null, server);
    });
};


var killServer= function(serverId, timeout, cb) {
    var interval= 15;
    if (!monicaServers[serverId].busy) return monicaServers[serverId].killFn(cb);

    if (timeout <= 0) {
        var msg= 'MonicaAdapter: ERROR: killing child processes failed: remaining process: ' + monicaServers[serverId].task.pid;
        ERROR(msg);
        return cb(msg);
    }

    return setTimeout(function() {
        if (!(serverId in monicaServers)) return cb();
        return killServer(serverId, timeout - interval, cb);
    }, interval);
};


var killAllServers= function (cb) {
    if (!Object.keys(monicaServers).length) return cb();

    //wait 2s to kill servers
    var killTimeout= 2000;

    var cbt= new tools.CallbackTracker(function(err) {
        if (err) {
            var msg= 'MonicaAdapter: ERROR: killing child processes failed: remaining processes: ';
            for (var serverId in monicaServers) {
                msg += monicaServers[serverId].task.pid + ' ';
            }
            return cb(msg + 'err: ' + err);
        }
        return cb();
    });

    for (var serverId in monicaServers) {
        cbt.call(function(cb, serverId) {
            //DEBUG.l1('MonicaAdapter: killing child process: id: ' + serverId + ' pid: ' + monicaServers[serverId].task.pid);
            return killServer(serverId, killTimeout, cb);
        }, serverId);
    }

    return cbt.last();
};



var getMonicaServer= function(cb) {
    if ( !cb ) return;

    //find server not busy
    for (var serverId in monicaServers) {
        if (!monicaServers[serverId].busy) return cb(null, monicaServers[serverId]);
    }

    if (Object.keys(monicaServers).length + spawnCalls < maxServers) {
        spawnCalls++;
        return monicaStartFn(function(err, monicaServer) {
            spawnCalls--;
            return cb(err, monicaServer);
        });
    }

    //simple fifo queue
    return cbs.push(cb);
};


var runMonica= function(env, cb) {
    return getMonicaServer(function(err, monicaServer) {
        if (err) return cb(err);

        return monicaServer.cmdFn(env, function(err, result) {
            if (err) return cb(err.toString());

            //recode for correct units
            return cb(null, tools.decodeGenerator('WINDOWS-1252')(result));
        });
    });
};



exports.run= runMonica;
exports.killAllServers= killAllServers;
