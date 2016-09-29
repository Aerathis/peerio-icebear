// @flow
/**
 * Peerio custom error types and error handling helpers
 * @module errors
 */

/* CUSTOM ERROR TEMPLATE
function CustomError(message, nestedError, otherData) {
  var error = Error.call(this, message);
  this.name = 'CustomError';
  this.message = error.message;
  this.stack = error.stack;
  this.nestedError = nestedError;
  this.otherData = otherData;
}

CustomError.prototype = Object.create(Error.prototype);
CustomError.prototype.constructor = CustomError;
*/

/**
 * Use this helper to resolve returning error value.
 * If you:
 * - have an error result from catch() or reject()
 * - don't know what exactly that result is, Error, string, undefined or something else
 * - don't need custom errors just want to generate meaningful Error object
 * then call normalize and pass the result you've got together with fallback message
 * that will be wrapped in Error object and returned in case the result wasn't instance of Error
 */
module.exports.normalize = function(unknownErrorObject: any, failoverMessage: string): Error {
    if (unknownErrorObject) {
        if (unknownErrorObject instanceof Error) {
            return unknownErrorObject;
        }
        // we don't want to loose this data, but caller will most likedy discard it,
        // so we log it to console
        console.error(unknownErrorObject);
    }
    return new Error(failoverMessage);
};

// -- Server Errors ----------------------------------------------------------------------------------------------------
const serverErrorCodes = {
    notFound: 404,
    malformedRequest: 406,
    apiVersionError: 410,
    incorrectPublicKey: 411,
    quotaExceeded: 413,
    authError: 423,
    twoFAAuthRequired: 424,
    accountThrottled: 425,
    accountBlacklisted: 426,
    captchaPending: 435,
    accountClosed: 488,
    incorrectTimestamp: 442,
    genericServerError: 400
};
// reverse map
const serverErrorMap = {};
Object.keys(serverErrorCodes).forEach((key: string) => {
    serverErrorMap[serverErrorCodes[key]] = key;
});

function ServerError(code: number) {
    const type = serverErrorMap[code] || 'Unknown server error';
    this.message = type;
    const error = Error.call(this, this.message);
    this.name = `ServerError: ${code}: ${type}`;
    this.code = code;
    this.stack = error.stack;
}

ServerError.prototype = Object.create(Error.prototype);
ServerError.prototype.constructor = ServerError;
ServerError.codes = serverErrorCodes;

module.exports.ServerError = ServerError;
//----------------------------------------------------------------------------------------------------------------------
