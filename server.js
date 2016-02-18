const express = require('express');
const bodyParser = require('body-parser');
const http = require('http');
const https = require('https');
const urlParse = require('url').parse;
const joi = require('joi');
const validate = require('express-validation');
const sslify = require('express-sslify');
const debug = require('debug')('cors-proxy:server');

// Schema for json request and http headers
const RequestSchema = {
  body: {
    url: joi.string().uri().required(),
    method: joi.string().optional().valid(
      'GET', 'POST', 'DELETE', 'PUT', 'OPTIONS', 'TRACE', 'PATCH'),
    headers: joi.object().optional().pattern(/.+/, joi.string()),
    data: joi.string().optional()
  },
  headers: {
    'content-type': joi.string().required().valid('application/json')
  }
};

// Handle proxy requests
function requestHandler(req, res) {
  let {
    url,
    method = undefined,
    headers = undefined,
    data = ''
  } = req.body;

  url = urlParse(url);
  const httpModule = url.protocol == 'http:' ? http : https;

  if (!url.search) {
    url.search = '';
  }

  let request = httpModule.request({
    hostname: url.hostname,
    protocol: url.protocol,
    port: url.port,
    path: url.path + url.search,
    auth: url.auth,
    method,
    headers,
  }, function(requestResponse) {
    const sc = requestResponse.statusCode;

    // if nothing else goes wrong, the status is the same
    // as returned by the remote website
    res.status(sc);

    if (requestResponse.statusCode != 200) {
      debug(`Request to ${req.body.hostname} returned status code ${sc}`);
    }

    res.set(requestResponse.headers);

    // This header will allow sites under taskcluster.net domain
    // to receive the response from the proxy
    res.set('Access-Control-Allow-Origin', 'https://*.taskcluster.net');

    res.on('finish', function() {
      res.end();
    });

    res.on('error', function(err) {
      debug(`Fail to read response: ${err}`);
      res.status(500).json(err);
      res.end();
    });

    requestResponse.pipe(res);
  });

  request.on('error', function(err) {
    res.status(500).json(err);
  });

  request.write(req.body.data);
  request.end();
}

export function run(port = 80) {
  return new Promise(async function(accept, reject) {
    const app = express();

    const nodeEnv = process.env.NODE_ENV || 'developemnt';
    if (nodeEnv === 'production') {
      app.use(sslify.HTTPS({trustProtoHeader: true}));
    }

    app.use(bodyParser.json());
    app.post('/request', validate(RequestSchema), requestHandler);
    app.use(function(err, req, res, next) {
      res.status(400).json(err);
    });

    const server = http.createServer(app);

    server.listen(port, () => {
      debug('Cors proxy running');
      accept(server);
    });
  });
}

if (!module.parent) {
  run(process.env.PORT).catch(err => {
    console.err(err.stack);
  });
}
