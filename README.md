# nodejs-monica-adapter
Node.js adapter to use the [model for Nitrogen and Carbon in agricultural systems](https://github.com/zalf-lsa/monica)  from ZALF Muencheberg, Germany

# Requirements
You need to install monica and two by monica required packages:  
https://github.com/zalf-lsa/monica  
https://github.com/zalf-lsa/util  
https://github.com/zalf-lsa/sys-libs  

Additionally install monica-parameters to use predefined crop, cultivar, residue etc. parameters.  
https://github.com/zalf-lsa/monica-parameters


# Installation
Simply install this module with `npm`  
```sh
npm install nodejs-monica-adapter
```

To install it globally run  
```sh
npm install -g nodejs-monica-adapter
```

# Usage
You have to compose your own "env" json object with all the information needed for a monica calculation. The Node.js adapter uses monica-zmq-server. Monica server processes are forked in the background and calculation data is sent to these processes. Communication is handled by "zero message queue".


```js
'use strict';
var util= require('util');

var monicaAdapter= require('monica-adapter');
//test data included in modules source code
var env= require('./node_modules/monica-adapter/test-env.json');

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
```
