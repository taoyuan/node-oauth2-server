
/**
 * Module dependencies.
 */

var InvalidArgumentError = require('../errors/invalid-argument-error');
var InvalidGrantError = require('../errors/invalid-grant-error');
var InvalidRequestError = require('../errors/invalid-request-error');
var Promise = require('bluebird');
var ServerError = require('../errors/server-error');
var is = require('../validator/is');

/**
 * Constructor.
 */

function AuthCodeGrantType(model) {
  if (!model) {
    throw new InvalidArgumentError('Missing parameter: `model`');
  }

  if (!model.getAuthCode) {
    throw new ServerError('Server error: model does not implement `getAuthCode()`');
  }

  this.model = model;
}

/**
 * Retrieve an authorization code from the model.
 *
 * (See: https://tools.ietf.org/html/rfc6749#section-4.1.3)
 */

AuthCodeGrantType.prototype.handle = function(request, client) {
  if (!request) {
    throw new InvalidArgumentError('Missing parameter: `request`');
  }

  if (!client) {
    throw new InvalidArgumentError('Missing parameter: `client`');
  }

  if (!request.body.code) {
    return Promise.reject(new InvalidRequestError('Missing parameter: `code`'));
  }

  if (!is.vschar(request.body.code)) {
    return Promise.reject(new InvalidRequestError('Invalid parameter: `code`'));
  }

  return Promise.try(this.model.getAuthCode, request.body.code)
    .then(function(authCode) {
      if (!authCode) {
        throw new InvalidGrantError('Invalid grant: authorization code is invalid');
      }

      if (!authCode.client) {
        throw new ServerError('Server error: `getAuthCode()` did not return a `client` object');
      }

      if (!authCode.user) {
        throw new ServerError('Server error: `getAuthCode()` did not return a `user` object');
      }

      if (authCode.client.id !== client.id) {
        throw new InvalidGrantError('Invalid grant: authorization code is invalid');
      }

      if (!(authCode.expiresOn instanceof Date)) {
        throw new ServerError('Server error: `expiresOn` must be a Date instance');
      }

      if (authCode.expiresOn < new Date()) {
        throw new InvalidGrantError('Invalid grant: authorization code has expired');
      }

      return authCode;
    });
};

/**
 * Export constructor.
 */

module.exports = AuthCodeGrantType;
