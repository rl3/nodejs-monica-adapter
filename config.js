'use strict';

var MONICA= {
    protocol: 'tcp',
    address: '127.0.0.1',
    get baseAddress() { return this.protocol + '://' + this.address + ':'; },
    monicaZmqServer: '/var/atb/monica/monica/monica-zmq-server',
    maxServers: 5,
    //return error if no response for x ms
    requestTimeout: 10000,
    //kill processes if unused for x ms
    processTimeout: 60000,
    logPath: 'log/monica/'
};


exports.MONICA= MONICA;
