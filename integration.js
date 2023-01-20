'use strict';

const request = require('postman-request');
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
    //do the lookup
    let requestOptions = {
      uri: 'https://api.metadefender.com/v4/hash/' + entity.value,
      method: 'GET',
      headers: { apiKey: options.apiKey },
      json: true
    };

    Logger.debug({ uri: options }, 'Request URI');

    tasks.push(function (done) {
      requestWithDefaults(requestOptions, function (error, res, body) {
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
            body: body,
            apiUsed: res.headers['x-ratelimit-remaining'],
            apiLimit: res.headers['x-ratelimit-limit'],
            apiInterval: res.headers['x-ratelimit-interval'],
            apiReset: res.headers['x-ratelimit-reset-in']
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
            detail: `Request Limit Reached ${res.headers['x-ratelimit-remanining']} / ${res.headers['x-ratelimit-limit']} lookups used.  Rate limit resets in ${res.headers['x-ratelimit-reset-in']}`,
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
            summary: getSummaryTags(result.body),
            details: {
              body: result.body,
              apiUsed: result.apiUsed,
              apiLimit: result.apiLimit,
              apiInterval: result.apiInterval,
              apiReset: apiResetToMilliseconds(result.apiReset),
              entity: result.entity.value
            }
          }
        });
      }
    });

    Logger.trace({ lookupResults: lookupResults }, 'Lookup Results');
    cb(null, lookupResults);
  });
}

/**
 * The apiReset header (x-ratelimit-reset-in) is a string and ends with the letter "s" for seconds.
 * For template rendering purposes it is much easier if we drop the trailing "s" and convert to milliseconds.
 * This allows us to use the moment duration helper to convert to an easily to human readable form.
 * @param apiReset
 */
function apiResetToMilliseconds(apiReset) {
  if (typeof apiReset === 'string' && apiReset.endsWith('s')) {
    return +apiReset.slice(0, apiReset.length - 1) * 1000;
  }
  // Unexpected format so just return as is
  return apiReset;
}

function getSummaryTags(body) {
  const tags = [];
  if (body.file_info && body.file_info.display_name) {
    tags.push(`Display Name: ${body.file_info.display_name}`);
  }

  if (body.scan_results && body.scan_results.total_detected_avs && body.scan_results.total_avs) {
    tags.push(`AVS Detected: ${body.scan_results.total_detected_avs}/${body.scan_results.total_avs}`);
  }

  if (body.scan_results && body.scan_results.scan_all_result_a) {
    tags.push(`Scan Result: ${body.scan_results.scan_all_result_a}`);
  }

  if (body.process_info && body.process_info.result) {
    tags.push(`Status: ${body.process_info.result}`);
  }

  return tags;
}

function validateOptions(userOptions, cb) {
  let errors = [];
  if (
    typeof userOptions.apiKey.value !== 'string' ||
    (typeof userOptions.apiKey.value === 'string' && userOptions.apiKey.value.length === 0)
  ) {
    errors.push({
      key: 'apiKey',
      message: 'You must provide a MetaDefender API key'
    });
  }
  cb(null, errors);
}

module.exports = {
  doLookup,
  startup,
  validateOptions
};
