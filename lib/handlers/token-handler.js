
/**
 * Module dependencies.
 */

var _ = require('lodash');
var BearerTokenType = require('../token-types/bearer-token-type');
var InvalidArgumentError = require('../errors/invalid-argument-error');
var InvalidClientError = require('../errors/invalid-client-error');
var InvalidRequestError = require('../errors/invalid-request-error');
var OAuthError = require('../errors/oauth-error');
var Promise = require('bluebird');
var Request = require('../request');
var Response = require('../response');
var ServerError = require('../errors/server-error');
var UnauthorizedClientError = require('../errors/unauthorized-client-error');
var UnsupportedGrantTypeError = require('../errors/unsupported-grant-type-error');
var auth = require('basic-auth');
var is = require('../validator/is');
var tokenUtil = require('../utils/token-util');

/**
 * Grant types.
 */

var grantTypes = {
  authorization_code: require('../grant-types/authorization-code-grant-type'),
  client_credentials: require('../grant-types/client-credentials-grant-type'),
  password: require('../grant-types/password-grant-type'),
  refresh_token: require('../grant-types/refresh-token-grant-type')
};

/**
 * Constructor.
 */

function TokenHandler(options) {
  options = options || {};

  if (!options.accessTokenLifetime) {
    throw new InvalidArgumentError('Missing parameter: `accessTokenLifetime`');
  }

  if (!options.model) {
    throw new InvalidArgumentError('Missing parameter: `model`');
  }

  if (!options.refreshTokenLifetime) {
    throw new InvalidArgumentError('Missing parameter: `refreshTokenLifetime`');
  }

  if (!options.model.getClient) {
    throw new ServerError('Server error: model does not implement `getClient()`');
  }

  if (!options.model.saveToken) {
    throw new ServerError('Server error: model does not implement `saveToken()`');
  }

  this.accessTokenLifetime = options.accessTokenLifetime;
  this.grantTypes = _.assign({}, grantTypes, options.extendedGrantTypes);
  this.model = options.model;
  this.refreshTokenLifetime = options.refreshTokenLifetime;
}

/**
 * Token Handler.
 */

TokenHandler.prototype.handle = function(request, response) {
  if (!(request instanceof Request)) {
    throw new InvalidArgumentError('Invalid argument: `request` must be an instance of Request');
  }

  if (!(response instanceof Response)) {
    throw new InvalidArgumentError('Invalid argument: `response` must be an instance of Response');
  }

  if ('POST' !== request.method) {
    return Promise.reject(new InvalidRequestError('Invalid request: method must be POST'));
  }

  if (!request.is('application/x-www-form-urlencoded')) {
    return Promise.reject(new InvalidRequestError('Invalid request: content must be application/x-www-form-urlencoded'));
  }

  return Promise.bind(this)
    .then(function() {
      return this.getClient(request);
    })
    .then(function(client) {
      return this.handleGrantType(request, client)
        .bind(this)
        .then(function(instance) {
          var fns = [
            this.generateAccessToken(),
            this.generateRefreshToken(client),
            this.getAccessTokenExpiresOn(),
            this.getRefreshTokenExpiresOn(client),
            this.getScope(request),
            this.getUser(request, instance)
          ];

          return Promise.all(fns)
            .bind(this)
            .spread(function(accessToken, refreshToken, accessTokenExpiresOn, refreshTokenExpiresOn, scope, user) {
              return this.saveToken(accessToken, refreshToken, accessTokenExpiresOn, refreshTokenExpiresOn, scope, client, user)
                .bind(this)
                .then(function(token) {
                  var tokenType = this.getTokenType(accessToken, refreshToken, scope);

                  this.updateSuccessResponse(response, tokenType);

                  return token;
                });
            });
        });
    }).catch(function(e) {
      if (!(e instanceof OAuthError)) {
        e = new ServerError(e.message);
      }

      this.updateErrorResponse(response, e);

      throw e;
    });
};

/**
 * Generate access token.
 */

TokenHandler.prototype.generateAccessToken = Promise.method(function() {
  if (this.model.generateAccessToken) {
    return this.model.generateAccessToken();
  }

  return tokenUtil.generateRandomToken();
});

/**
 * Generate refresh token.
 */

TokenHandler.prototype.generateRefreshToken = Promise.method(function(client) {
  if (!_.contains(client.grants, 'refresh_token')) {
    return;
  }

  if (this.model.generateRefreshToken) {
    return this.model.generateRefreshToken();
  }

  return tokenUtil.generateRandomToken();
});

/**
 * Get access token expires on.
 */

TokenHandler.prototype.getAccessTokenExpiresOn = Promise.method(function() {
  var expires = new Date();

  expires.setSeconds(expires.getSeconds() + this.accessTokenLifetime);

  return expires;
});

/**
 * Get the client from the model.
 */

TokenHandler.prototype.getClient = Promise.method(function(request) {
  var credentials = this.getClientCredentials(request);

  if (!credentials.clientId) {
    throw new InvalidRequestError('Missing parameter: `client_id`');
  }

  if (!credentials.clientSecret) {
    throw new InvalidRequestError('Missing parameter: `client_secret`');
  }

  if (!is.vschar(credentials.clientId)) {
    throw new InvalidRequestError('Invalid parameter: `client_id`');
  }

  if (!is.vschar(credentials.clientSecret)) {
    throw new InvalidRequestError('Invalid parameter: `client_secret`');
  }

  return Promise.try(this.model.getClient, [credentials.clientId, credentials.clientSecret])
    .then(function(client) {
      if (!client) {
        throw new InvalidClientError('Invalid client: client is invalid');
      }

      if (!client.grants) {
        throw new InvalidClientError('Invalid client: missing client `grants`');
      }

      if (!(client.grants instanceof Array)) {
        throw new InvalidClientError('Invalid client: `grants` must be an array');
      }

      return client;
    });
});

/**
 * Get refresh token expires on.
 */

TokenHandler.prototype.getRefreshTokenExpiresOn = Promise.method(function(client) {
  if (!_.contains(client.grants, 'refresh_token')) {
    return;
  }

  var expires = new Date();

  expires.setSeconds(expires.getSeconds() + this.refreshTokenLifetime);

  return expires;
});

/**
 * Get scope from the request body.
 */

TokenHandler.prototype.getScope = Promise.method(function(request) {
  if (!is.nqschar(request.body.scope)) {
    throw new InvalidArgumentError('Invalid parameter: `scope`');
  }

  return request.body.scope;
});

/**
 * Get client credentials.
 *
 * The client credentials may be sent using the HTTP Basic authentication scheme or, alternatively,
 * the `client_id` and `client_secret` can be embedded in the body.
 *
 * (See: https://tools.ietf.org/html/rfc6749#section-2.3.1)
 */

TokenHandler.prototype.getClientCredentials = function(request) {
  var credentials = auth(request);

  if (credentials) {
    return { clientId: credentials.name, clientSecret: credentials.pass };
  }

  if (request.body.client_id && request.body.client_secret) {
    return { clientId: request.body.client_id, clientSecret: request.body.client_secret };
  }

  throw new InvalidClientError('Invalid client: cannot retrieve client credentials');
};

/**
 * Handle grant type.
 */

TokenHandler.prototype.handleGrantType = Promise.method(function(request, client) {
  var grantType = request.body.grant_type;

  if (!grantType) {
    throw new InvalidRequestError('Missing parameter: `grant_type`');
  }

  if (!is.nchar(grantType) && !is.uri(grantType)) {
    throw new InvalidRequestError('Invalid parameter: `grant_type`');
  }

  if (!_.has(this.grantTypes, grantType)) {
    throw new UnsupportedGrantTypeError('Unsupported grant type: `grant_type` is invalid');
  }

  if (!_.contains(client.grants, grantType)) {
    throw new UnauthorizedClientError('Unauthorized client: `grant_type` is invalid');
  }

  var Type = this.grantTypes[grantType];

  return new Type(this.model)
    .handle(request, client);
});

/**
 * Get user.
 */

TokenHandler.prototype.getUser = Promise.method(function(request, instance) {
  if ('authorization_code' === request.body.grant_type) {
    return instance.user;
  }

  if ('refresh_token' === request.body.grant_type) {
    return instance.user;
  }

  return instance;
});

/**
 * Save token.
 */

TokenHandler.prototype.saveToken = Promise.method(function(accessToken, refreshToken, accessTokenExpiresOn, refreshTokenExpiresOn, scope, client, user) {
  var token = {
    accessToken: accessToken,
    accessTokenExpiresOn: accessTokenExpiresOn,
    scope: scope
  };

  if (refreshToken) {
    token.refreshToken = refreshToken;
    token.refreshTokenExpiresOn = refreshTokenExpiresOn;
  }

  return this.model.saveToken(token, client, user);
});

/**
 * Get token type.
 */

TokenHandler.prototype.getTokenType = function(accessToken, refreshToken, scope) {
  return new BearerTokenType(accessToken, this.accessTokenLifetime, refreshToken, scope);
};

/**
 * Update response when a token is generated.
 */

TokenHandler.prototype.updateSuccessResponse = Promise.method(function(response, tokenType) {
  response.body = tokenType.valueOf();

  response.set('Cache-Control', 'no-store');
  response.set('Pragma', 'no-cache');
});

/**
 * Update response when an error is thrown.
 */

TokenHandler.prototype.updateErrorResponse = Promise.method(function(response, error) {
  response.body = {
    error: error.name,
    error_description: error.message
  };

  response.status = error.code;
});

/**
 * Export constructor.
 */

module.exports = TokenHandler;
