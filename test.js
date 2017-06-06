// jshint esversion: 6

'use strict';
var util= require('util');

var monicaAdapter= require('./index');
var env= require('./test-env.json');



return monicaAdapter.run(env, function(err, result) {
    if (err) {
        console.error('FAIL: got:', result);
        return monicaAdapter.killAllServers(function() {
            return process.exit(1);
        });
    }
    console.log('PASS: got:', result);
    return monicaAdapter.killAllServers(function() {
        return process.exit(0);
    });
});
