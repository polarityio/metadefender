'use strict';

const request = require('request');
const config = require('./config/config');
const async = require('async');
const fs = require('fs');

let Logger;
let requestWithDefaults;

const MAX_PARALLEL_LOOKUPS = 5;

/**
 *
 * @param entities
 * @param options
 * @param cb
 */

function startup(logger) {
  Logger = logger;
  let defaults = {};

  if (typeof config.request.cert === 'string' && config.request.cert.length > 0) {
    defaults.cert = fs.readFileSync(config.request.cert);
  }

  if (typeof config.request.key === 'string' && config.request.key.length > 0) {
    defaults.key = fs.readFileSync(config.request.key);
  }

  if (typeof config.request.passphrase === 'string' && config.request.passphrase.length > 0) {
    defaults.passphrase = config.request.passphrase;
  }

  if (typeof config.request.ca === 'string' && config.request.ca.length > 0) {
    defaults.ca = fs.readFileSync(config.request.ca);
  }

  if (typeof config.request.proxy === 'string' && config.request.proxy.length > 0) {
    defaults.proxy = config.request.proxy;
  }

  requestWithDefaults = request.defaults(defaults);
}

/**
 * The metadefender API will return a 200 even when there is no response.  The response data will be an object with
 * a single key where the key is the entity value in uppercase and the value is "Not Found".  For example:
 *
 * {
 *    "FD904ADDBDFE548C22FFA5223ED9EEE7S": "Not Found"
 * }
 *
 * @param response
 * @param body
 * @param entity
 * @returns {boolean}
 * @private
 */
function _isMiss(response, body, entity) {
  if (response.statusCode === 404 || response.statusCode === 202 || body[entity.value.toUpperCase()] === 'Not Found') {
    return true;
  }
  return false;
}

function doLookup(entities, options, cb) {
  let lookupResults = [];
  let tasks = [];

  Logger.debug(entities);

  entities.forEach((entity) => {
    if (entity.value) {
      //do the lookup
      let requestOptions = {
        uri: 'https://api.metadefender.com/v2/hash/' + entity.value,
        method: 'GET',
        headers: { apiKey: options.apiKey },
        json: true
      };

      Logger.debug({ uri: options }, 'Request URI');

      tasks.push(function(done) {
        requestWithDefaults(requestOptions, function(error, res, body) {
          Logger.debug({ body: body, statusCode: res.statusCode }, 'Result of Lookup');

          if (error) {
            return done({
              detail: 'HTTP Request Error',
              error
            });
          }

          if (_isMiss(res, body, entity)) {
            Logger.debug({ entity: entity.value }, 'Entity is a Miss');
            done(null, {
              entity: entity,
              body: null
            });
          } else if (res.statusCode === 200) {
            // we got data!
            done(null, {
              entity: entity,
              body: body
            });
          } else if (res.statusCode === 401) {
            done({
              detail: 'Invalid API Key',
              statusCode: res.statusCode
            });
          } else if (res.statusCode === 400) {
            done({
              detail: 'Bad Request: Not supported HTTP method or invalid http request',
              statusCode: res.statusCode,
              uri: requestOptions.uri
            });
          } else if (res.statusCode === 503) {
            done({
              detail: 'Request Limit Reached',
              statusCode: res.statusCode
            });
          } else if (res.statusCode === 504) {
            done({
              detail: 'Gateway Timeout',
              statusCode: res.statusCode,
              entity: entity.value
            });
          } else {
            done({
              detail: 'Unexpected HTTP Status Code Received',
              statusCode: res.statusCode,
              body: body
            });
          }
        });
      });
    }
  });

  async.parallelLimit(tasks, MAX_PARALLEL_LOOKUPS, (err, results) => {
    if (err) {
      cb(err);
      return;
    }

    results.forEach((result) => {
      if (result.body === null) {
        lookupResults.push({
          entity: result.entity,
          data: null
        });
      } else {
        lookupResults.push({
          entity: result.entity,
          data: {
            summary: [],
            details: { body: result.body, entity: result.entity.value }
          }
        });
      }
    });

    Logger.trace({ lookupResults: lookupResults }, 'Lookup Results');
    cb(null, lookupResults);
  });
}

function validateOptions(userOptions, cb) {
  let errors = [];
  if (
    typeof userOptions.apiKey.value !== 'string' ||
    (typeof userOptions.apiKey.value === 'string' && userOptions.apiKey.value.length === 0)
  ) {
    errors.push({
      key: 'apiKey',
      message: 'You must provide a Metadefender API key'
    });
  }
  cb(null, errors);
}

module.exports = {
  doLookup: doLookup,
  startup: startup,
  validateOptions: validateOptions
};
