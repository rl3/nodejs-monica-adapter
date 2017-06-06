'use strict';
var fs= require('fs');
var Iconv= require('iconv').Iconv;


var leadZeros= function(num, length) {
    var leadStr;
    for (var i= 0; i < length; i++) {
        leadStr += '0';
    }
    return (leadStr + num).slice(-length);
};



/*
 * convert Date to human readable String with UTC Time
 */
var dateToIso8601= function(date) {
    // iso8601Format "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'"
    var iso8601Format=
        leadZeros(date.getUTCFullYear(), 4) + '-' +
        leadZeros(date.getUTCMonth() + 1, 2) + '-' +
        leadZeros(date.getUTCDate(), 2) + 'T' +
        leadZeros(date.getUTCHours(), 2) + ':' +
        leadZeros(date.getUTCMinutes(), 2) + ':' +
        leadZeros(date.getUTCSeconds(), 2) + '.' +
        leadZeros(date.getUTCMilliseconds(), 3) + 'Z';
    return iso8601Format;
};

/*
 * Returns a function to decode a buffer
 * if encoding is not set or UTF-8, buffer will be passed
 */
var decodeGenerator= function( encoding ) {
    if ( !encoding || encoding.toUpperCase() === 'UTF-8' ) {
        return function( buffer ) { return buffer; };
    }

    var iconv= new Iconv(encoding, 'UTF-8');

    return function( buffer ) {
        try {
            //convert charset if input is different from utf-8
            return iconv.convert(buffer);
        }
        catch(err) {
            //continue with original data on convert error
        }
        return buffer;
    };
};


var uuid= function() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random()*16|0, v = c == 'x' ? r : (r&0x3|0x8);
        return v.toString(16);
    });
};


var findFreePort= function(address, cb) {
    var server= require('net').createServer();
    var port;

    server.on('listening', function() {
        port= server.address().port;
        server.close();
    });
    server.on('close', function() {
        return cb(null, port);
    });
    server.on('error', function(err) {
        return cb(err, null);
    });
    server.listen(0, address);
};


/* creates a new callbackTracker
 * it calls callback only once - when all other pending jobs are done
 *
 * * call .call(function(cb) {...; cb(err, value)}) for every job you want to be done
 * * you MUST call .last() once - after starting other callbacks with .call(...)
 * * call .finish(err, value) to call callback immediately and disable further calls and callbacks
 *
 * maxParallel: only start this much processes parallel
 * maxStackDepth: start a new stack every x jobs (process.nextTick())
 */
var CallbackTracker= function( callback, maxParallel, maxStackDepth ) {
    if ( !maxParallel ) maxParallel= 10000;
    if ( !maxStackDepth ) maxStackDepth= 1000;

    if ( !(this instanceof CallbackTracker) ) return new CallbackTracker(callback);

    var callbackAlreadyCalled= false;

    // the final callback should always be called without a stack
    var _callback= function( err, data ) {
        if ( callbackAlreadyCalled ) return;

        callbackAlreadyCalled= true;
        return setImmediate(function() {
            return callback(err, data);
        });
    };

    var self= this;

    // number of currently running functions
    var counter= 0;

    // set to true, when all functions have been added
    var isFinished= false;

    // queue of functions to call
    var funcsToCall= [];
    var funcsToCallIndex= 0;

    var cb= function( err, data, finish, stackDepth ) {
        if ( callbackAlreadyCalled ) return;

        if ( err || finish ) return self.finish(err, data);

        // if funcsToCall contains funcs to run,
        // do not decrement counter and start next function instead
        if ( funcsToCall.length > funcsToCallIndex ) {
            var fnObj= funcsToCall[funcsToCallIndex++];
            return run(fnObj.fn, fnObj.param, stackDepth);
        }

        counter--;

        if ( isFinished && counter === 0 ) return _callback(null, data);
    };

    var run= function( fn, param, stackDepth ) {
        if ( !maxParallel || !maxStackDepth ) return fn(cb, param);

        stackDepth= ((stackDepth || 0) + 1) % maxStackDepth;

        return fn(function( err, data, finish ) {
            if ( stackDepth === 0 ) {
                return setImmediate(function() {
                    return cb(err, data, finish, 0);
                });
            }

            return cb(err, data, finish, stackDepth);
        }, param);
    };

    this.call= function( fn, param ) {
        if ( callbackAlreadyCalled ) return;

        if ( maxParallel && counter >= maxParallel ) {
            return funcsToCall.push({ fn: fn, param: param, });
        }

        counter++;
        return run(fn, param, 0);
    };

    this.last= function( err, data ) {
        isFinished= true;
        if ( err || counter === 0 ) return _callback(err, data);

        return;
    };

    this.cb= function() {
        console.trace('Call this.last() instead');
        return self.last();
    };

    this.finish= function( err, data ) {
        isFinished= true;
        return _callback(err, data);
    };

    this.setCallback= function( fn ) {
        callback= fn;
    };
};

/**
 * Makes sure file's parent directories exist
 */
var createParentDirectories= function( filename ) {
    var pathParts= filename.split(/\//);
    for ( var i= 0; i < pathParts.length; i++ ) {
        var path= pathParts.slice(0, i).join('/');
        if ( !path ) continue;

        // fs.exists is deprecated
        // statSync throws an exception, so we have to check it with try/catch
        try {
            if ( fs.statSync(path).isDirectory() ) continue;
        }
        catch ( e ) {
            fs.mkdirSync(path);
        }
    }
};



exports.decodeGenerator= decodeGenerator;
exports.dateToIso8601= dateToIso8601;
exports.uuid= uuid;
exports.findFreePort= findFreePort;
exports.CallbackTracker= CallbackTracker;
exports.createParentDirectories= createParentDirectories;
