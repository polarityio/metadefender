"use strict";

const request = require("request");
const config = require("./config/config");
const async = require("async");
const fs = require("fs");

let Logger;

let requestWithDefaults;

const MAX_PARALLEL_LOOKUPS = 10;

/**
 *
 * @param entities
 * @param options
 * @param cb
 */

function startup(logger) {
  Logger = logger;
  let defaults = {};

  if (
    typeof config.request.cert === "string" &&
    config.request.cert.length > 0
  ) {
    defaults.cert = fs.readFileSync(config.request.cert);
  }

  if (typeof config.request.key === "string" && config.request.key.length > 0) {
    defaults.key = fs.readFileSync(config.request.key);
  }

  if (
    typeof config.request.passphrase === "string" &&
    config.request.passphrase.length > 0
  ) {
    defaults.passphrase = config.request.passphrase;
  }

  if (typeof config.request.ca === "string" && config.request.ca.length > 0) {
    defaults.ca = fs.readFileSync(config.request.ca);
  }

  if (
    typeof config.request.proxy === "string" &&
    config.request.proxy.length > 0
  ) {
    defaults.proxy = config.request.proxy;
  }

  requestWithDefaults = request.defaults(defaults);
}

function doLookup(entities, options, cb) {
  let lookupResults = [];
  let tasks = [];

  Logger.debug(entities);

  entities.forEach(entity => {
    if (entity.value) {
      //do the lookup
      let requestOptions = {
        uri: "https://api.metadefender.com/v2/hash/" + entity.value,
        method: "GET",
        headers: { apiKey: options.apiKey },
        json: true
      };

      Logger.debug({ uri: options }, "Request URI");

      tasks.push(function(done) {
        requestWithDefaults(requestOptions, function(error, res, body) {
          Logger.debug(
            { body: body, statusCode: res.statusCode },
            "Result of Lookup"
          );

          if (error) {
            done(error);
            return;
          }

          let result = {};

          if (res.statusCode === 200) {
            // we got data!
            result = {
              entity: entity,
              body: body
            };
          } else if (res.statusCode === 404) {
            // no result found
            result = {
              entity: entity,
              body: null
            };
          } else if (res.statusCode === 202) {
            // no result found
            result = {
              entity: entity,
              body: null
            };
          } else if (res.statusCode === 503) {
            // reached request limit
            done("Request Limit Reached");
            return;
          }

          if (Object.keys(body).length <= 1) {
            // entity not found
            result = {
              entity: entity,
              body: null
            };
          }

          done(null, result);
        });
      });
    }
  });

  async.parallelLimit(tasks, MAX_PARALLEL_LOOKUPS, (err, results) => {
    if (err) {
      cb(err);
      return;
    }

    results.forEach(result => {
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

    cb(null, lookupResults);
  });
}

function validateOptions(userOptions, cb) {
  let errors = [];
  if (
    typeof userOptions.apiKey.value !== "string" ||
    (typeof userOptions.apiKey.value === "string" &&
      userOptions.apiKey.value.length === 0)
  ) {
    errors.push({
      key: "apiKey",
      message: "You must provide a Metadefender API key"
    });
  }
  cb(null, errors);
}

module.exports = {
  doLookup: doLookup,
  startup: startup,
  validateOptions: validateOptions
};
