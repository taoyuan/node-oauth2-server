
/**
 * Module dependencies.
 */

var AbstractGrantType = require('./abstract-grant-type');
var InvalidArgumentError = require('../errors/invalid-argument-error');
var InvalidGrantError = require('../errors/invalid-grant-error');
var InvalidRequestError = require('../errors/invalid-request-error');
var Promise = require('bluebird');
var ServerError = require('../errors/server-error');
var is = require('../validator/is');
var util = require('util');

/**
 * Constructor.
 */

function RefreshTokenGrantType(options) {
  options = options || {};

  if (!options.model) {
    throw new InvalidArgumentError('Missing parameter: `model`');
  }

  if (!options.model.getRefreshToken) {
    throw new InvalidArgumentError('Invalid argument: model does not implement `getRefreshToken()`');
  }

  if (!options.model.revokeToken) {
    throw new InvalidArgumentError('Invalid argument: model does not implement `revokeToken()`');
  }

  if (!options.model.saveToken) {
    throw new InvalidArgumentError('Invalid argument: model does not implement `saveToken()`');
  }

  AbstractGrantType.call(this, options);
}

/**
 * Inherit prototype.
 */

util.inherits(RefreshTokenGrantType, AbstractGrantType);

/**
 * Handle refresh token grant.
 *
 * @see https://tools.ietf.org/html/rfc6749#section-6
 */

RefreshTokenGrantType.prototype.handle = function(request, client) {
  if (!request) {
    throw new InvalidArgumentError('Missing parameter: `request`');
  }

  if (!client) {
    throw new InvalidArgumentError('Missing parameter: `client`');
  }

  var scope = this.getScope(request);

  return Promise.bind(this)
    .then(function() {
      return this.getRefreshToken(request, client);
    })
    .tap(function(token) {
      return this.revokeToken(token);
    })
    .then(function(token) {
      return this.saveToken(token.user, client, scope);
    });
};

/**
 * Get refresh token.
 */

RefreshTokenGrantType.prototype.getRefreshToken = function(request, client) {
  if (!request.body.refresh_token) {
    return Promise.reject(new InvalidRequestError('Missing parameter: `refresh_token`'));
  }

  if (!is.vschar(request.body.refresh_token)) {
    return Promise.reject(new InvalidRequestError('Invalid parameter: `refresh_token`'));
  }

  return Promise.try(this.model.getRefreshToken, request.body.refresh_token)
    .then(function(token) {
      if (!token) {
        throw new InvalidGrantError('Invalid grant: refresh token is invalid');
      }

      if (!token.client) {
        throw new ServerError('Server error: `getRefreshToken()` did not return a `client` object');
      }

      if (!token.user) {
        throw new ServerError('Server error: `getRefreshToken()` did not return a `user` object');
      }

      if (token.client.id !== client.id) {
        throw new InvalidGrantError('Invalid grant: refresh token is invalid');
      }

      if (token.refreshTokenExpiresOn && !(token.refreshTokenExpiresOn instanceof Date)) {
        throw new ServerError('Server error: `refreshTokenExpiresOn` must be a Date instance');
      }

      if (token.refreshTokenExpiresOn && token.refreshTokenExpiresOn < new Date()) {
        throw new InvalidGrantError('Invalid grant: refresh token has expired');
      }

      return token;
    });
};

/**
 * Revoke the refresh token.
 *
 * @see https://tools.ietf.org/html/rfc6749#section-6
 */

RefreshTokenGrantType.prototype.revokeToken = Promise.method(function(token) {
  return Promise.try(this.model.revokeToken, token)
    .then(function(token) {
      if (!token) {
        throw new InvalidGrantError('Invalid grant: refresh token is invalid');
      }

      if (!(token.refreshTokenExpiresOn instanceof Date)) {
        throw new ServerError('Server error: `refreshTokenExpiresOn` must be a Date instance');
      }

      if (token.refreshTokenExpiresOn >= new Date()) {
        throw new ServerError('Server error: authorization code should be expired');
      }

      return token;
    });
});

/**
 * Save token.
 */

RefreshTokenGrantType.prototype.saveToken = function(user, client, scope) {
  var fns = [
    this.generateAccessToken(),
    this.generateRefreshToken(),
    this.getAccessTokenExpiresOn(),
    this.getRefreshTokenExpiresOn()
  ];

  return Promise.all(fns)
    .bind(this)
    .spread(function(accessToken, refreshToken, accessTokenExpiresOn, refreshTokenExpiresOn) {
      var token = {
        accessToken: accessToken,
        accessTokenExpiresOn: accessTokenExpiresOn,
        refreshToken: refreshToken,
        refreshTokenExpiresOn: refreshTokenExpiresOn,
        scope: scope
      };

      return this.model.saveToken(token, client, user);
    });
};

/**
 * Export constructor.
 */

module.exports = RefreshTokenGrantType;
