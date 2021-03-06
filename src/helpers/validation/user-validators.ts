/**
 * Validation functions for user-related fields, used in field validation.
 *
 * On *peerio-desktop* they are used in conjunction with the ValidatedInput and OrderedFormStore
 * components. ValidatedInputs expect validators of the format below as parameters,
 * and will run through them on change & blur as needed.
 *
 * Validators are (arrays of) objects, with signature:
 *  {
 *      action: 'function',
 *      message: ''
 *  }
 *
 *  The action function accepts arguments:
 *  - value -- usually a string
 *  - additionalArguments -- optional object
 *
 *  It returns true if the value passes validation. Otherwise it may return an
 *  object with the signature:
 *
 *  {
 *      message: 'optional specific validation message (string)',
 *      result: false
 *      // additional data as needed
 *  }
 *
 *  if the function does not return a message, the default message provided by the
 *  validator will be used.
 *
 */
import IsEmail from 'isemail';

import socket from '../../network/socket';
import { getFirstLetter } from '../string';
import config from '../../config';
import { LocalizationStrings } from '../../copy/defs';

const VALIDATION_THROTTLING_PERIOD_MS = 400;
const usernameRegex = /^\w{1,16}$/;
const medicalIdRegex = /MED\d{10}/i;
const usernameLength = config.user.maxUsernameLength;
// const phoneRegex =
//     /^\s*(?:\+?(\d{1,3}))?([-. (]*(\d{3})[-. )]*)?((\d{3})[-. ]*(\d{2,4})(?:[-.x ]*(\d+))?)\s*$/i;

const serverValidationStore = { request: {} };

export type ValidationContext = 'signup' | 'medcryptor_doctor' | 'medcryptor_admin';
/**
 * Throttled & promisified call to validation API.
 * @param context - context for field, e.g "signup"
 * @param name - field name
 */
function _callServer(
    context: ValidationContext,
    name: string,
    value: string | number,
    subkey: string
): Promise<boolean> {
    const key = `${context}::${name}::${subkey}`;
    const pending = serverValidationStore.request[key];
    if (pending) {
        clearTimeout(pending.timeout);
        pending.resolve(undefined);
    }
    return new Promise(resolve => {
        const timeout = setTimeout(() => {
            socket
                .send('/noauth/validate', { context, name, value }, false)
                .then(resp => {
                    resolve(!!resp && resp.valid);
                })
                .catch(e => {
                    if (e && e.name === 'DisconnectedError') resolve(undefined);
                    else resolve(false);
                });
        }, VALIDATION_THROTTLING_PERIOD_MS);
        serverValidationStore.request[key] = { timeout, resolve };
    });
}

function isValidUsernameLength(name: string) {
    if (name) {
        return Promise.resolve(name.length <= usernameLength);
    }
    return Promise.resolve(false);
}

function isValidUsername(name: string) {
    if (name) {
        return Promise.resolve(!!name.match(usernameRegex));
    }
    return Promise.resolve(false);
}

function isValidEmail(val: string) {
    return Promise.resolve(IsEmail.validate(val));
}

function isValidMedicalId(val: string) {
    return Promise.resolve(medicalIdRegex.test(val));
}

function isValid(context: ValidationContext, name: string, subKey?: string) {
    return (value: string, n?: string) =>
        value ? _callServer(context, name || n, value, subKey) : Promise.resolve(false);
}

function isNonEmptyString(name: string) {
    return Promise.resolve(!!(name && name.length > 0));
}

function isValidLoginUsername(name: string) {
    return (
        isValid('signup', 'username')(name)
            // we get undefined for throttled requests and false for completed
            .then(value => (value === undefined ? value : value === false))
    );
}

interface AdditionalArguments<T> {
    equalsValue: T;
    equalsErrorMessage: keyof LocalizationStrings;
    /**
     * Is the value non-nullable (or if it's a value with a `length` property,
     * is it allowed to be empty?)
     */
    required?: boolean;
}

function areEqualValues<T>(value: T, additionalArguments: AdditionalArguments<T>) {
    if (additionalArguments.required !== false && (!value || (value as any).length === 0)) {
        return Promise.resolve({
            result: false,
            message: 'error_fieldRequired'
        });
    }
    if (value === additionalArguments.equalsValue) return Promise.resolve(true);
    return Promise.resolve({
        result: false,
        message: additionalArguments.equalsErrorMessage
    });
}

function pair<T extends any[]>(
    action: (...args: T) => Promise<boolean>,
    message: keyof LocalizationStrings
) {
    return { action, message };
}

const isValidSignupEmail = isValid('signup', 'emailAvailability');
const isValidSignupUsername = isValid('signup', 'username');
const isValidSignupUsernameSuggestion = isValid('signup', 'username', 'suggestion');
const isValidSignupFirstName = isValid('signup', 'firstName');
const isValidSignupLastName = isValid('signup', 'lastName');
const emailFormat = pair(isValidEmail, 'error_invalidEmail');
const medicalIdFormat = pair(isValidMedicalId, 'mcr_error_ahrpa');
const emailAvailability = pair(isValidSignupEmail, 'error_addressTaken');
const usernameFormat = pair(isValidUsername, 'error_usernameBadFormat');
const usernameLengthCheck = pair(isValidUsernameLength, 'error_usernameLengthExceeded');
const usernameAvailability = pair(isValidSignupUsername, 'error_usernameNotAvailable');
const usernameExistence = pair(isValidLoginUsername, 'error_usernameNotFound');
const stringExists = pair(isNonEmptyString, 'error_fieldRequired');
const firstNameReserved = pair(isValidSignupFirstName, 'error_invalidName');
const lastNameReserved = pair(isValidSignupLastName, 'error_invalidName');

// `areEqualValues` is the only validator that doesn't conform to the standard
// validator signature, so to preserve its signature we form the object manually
// instead of using the `pair` helper.
const valueEquality = { action: areEqualValues, message: 'error_mustMatch' };

const isValidMcrDoctorAhpra = isValid('medcryptor_doctor', 'ahpra');
const isValidMcrAdminAhpra = isValid('medcryptor_admin', 'ahpra');
const mcrDoctorAhpraAvailability = pair(isValidMcrDoctorAhpra, 'mcr_error_ahrpa');
const mcrAdminAhpraAvailability = pair(isValidMcrAdminAhpra, 'mcr_error_ahrpa');

const suggestUsername = async (firstName: string, lastName: string): Promise<string[]> => {
    const initial = getFirstLetter(firstName);
    const maxSuggestions = 3;
    const suggestions = [];

    const options = [
        `${firstName}`,
        `${firstName}${lastName}`,
        `${firstName}_${lastName}`,
        `${lastName}`,
        `${initial}${lastName}`,
        `${lastName}${initial}`
    ];

    const validOptions = options.map(x =>
        x
            .trim()
            .replace(/[^a-z|A-Z|0-9|_]/g, '')
            .substring(0, usernameLength - 1)
            .toLocaleLowerCase()
    );

    for (const option of validOptions) {
        if (suggestions.length >= maxSuggestions) break;
        const normalized = option.toLocaleLowerCase();
        const available = await isValidSignupUsernameSuggestion(normalized);
        if (available) {
            suggestions.push(normalized);
        }
    }

    return suggestions;
};

const validators = {
    /* available validators:
     * {
     *      message: 'error message (string)',
     *      action: function
     * }
     */
    emailFormat,
    emailAvailability,
    usernameFormat,
    usernameAvailability,
    stringExists,
    firstNameReserved,
    lastNameReserved,
    email: [stringExists, emailFormat, emailAvailability],
    username: [stringExists, usernameFormat, usernameAvailability, usernameLengthCheck],
    usernameLogin: [stringExists, usernameFormat, usernameExistence],
    firstName: [stringExists, firstNameReserved],
    lastName: [stringExists, lastNameReserved],
    mcrDoctorAhpraAvailability,
    mcrAdminAhpraAvailability,
    medicalIdFormat,
    valueEquality,
    isValidSignupEmail,
    isValidSignupFirstName,
    isValidSignupLastName,
    isValidLoginUsername,
    suggestUsername
};

export default validators;
