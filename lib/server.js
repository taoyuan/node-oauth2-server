
/**
 * Module dependencies.
 */

var _ = require('lodash');
var AuthenticateHandler = require('./handlers/authenticate-handler');
var AuthorizeHandler = require('./handlers/authorize-handler');
var InvalidArgumentError = require('./errors/invalid-argument-error');
var TokenHandler = require('./handlers/token-handler');

/**
 * Constructor.
 *
 * Default access token lifetime is 1 hour.
 * Default authorization code lifetime is 5 minutes.
 * Default refresh token lifetime is 2 weeks.
 */

function OAuth2Server(options) {
  options = options || {};

  if (!options.model) {
    throw new InvalidArgumentError('Missing parameter: `model`');
  }

  this.options = _.assign({
    accessTokenLifetime: 60 * 60,
    authorizationCodeLifetime: 5 * 60,
    refreshTokenLifetime: 60 * 60 * 24 * 14
  }, options);
}

/**
 * Authenticate a token.
 */

OAuth2Server.prototype.authenticate = function(request, options, callback) {
  options = _.assign({}, this.options, options);

  return new AuthenticateHandler(options)
    .handle(request)
    .nodeify(callback);
};

/**
 * Authorize a request.
 */

OAuth2Server.prototype.authorize = function(request, response, options, callback) {
  options = _.assign({}, this.options, options);

  return new AuthorizeHandler(options)
    .handle(request, response)
    .nodeify(callback);
};

/**
 * Create a token.
 */

OAuth2Server.prototype.token = function(request, response, options, callback) {
  options = _.assign({}, this.options, options);

  return new TokenHandler(options)
    .handle(request, response)
    .nodeify(callback);
};

/**
 * Export constructor.
 */

module.exports = OAuth2Server;
