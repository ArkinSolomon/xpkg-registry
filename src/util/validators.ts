/*
 * Copyright (c) 2022-2023. Arkin Solomon.
 * 
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 * 
 *     http://www.apache.org/licenses/LICENSE-2.0
 * 
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
 * either express or implied limitations under the License.
 */
import { ValidationChain } from 'express-validator';
import fs from 'fs';
import path from 'path';
import { TokenPermission } from '../auth/authToken.js';
import Version from './version.js';
import { PackageType } from '../database/models/packageModel.js';
import logger from '../logger.js';
import VersionSelection from './versionSelection.js';

const profaneWords = fs
  .readFileSync(path.resolve('.', 'resources', 'profanity_list.txt'), 'utf-8')
  .split(/\n/g);

/**
 * Determine if a text has profanity.
 * 
 * @param {string} text The text to determine.
 * @return {boolean} True if the text is considered vulgar.
 */
export function isProfane(text: string): boolean {
  const parts = text.split(/[\s._]/);
  
  for (const part of parts) {
    if (profaneWords.includes(part.toLowerCase())) {
      logger.debug({ part }, 'Profane word detected!');
      return true;
    }
  }

  return false;
}

/**
 * Check if a password is valid.
 * 
 * @param {string} password The password to validate.
 * @returns {boolean} True if the password is valid.
 */
export function validatePassword(password: string): boolean {
  return (password && typeof password === 'string' && password.length >= 8 && password.length <= 64 && password.toLowerCase() !== 'password') as boolean;
}

/**
 * Check if an email is valid.
 * 
 * @param {string} email The email to validate.
 * @returns {boolean} True if the email is valid.
 */
export function validateEmail(email: string): boolean {
  return ((email && typeof email === 'string') && /^\S+@\S+\.\S+$/.test(
    email
      .toLowerCase()
      .trim()
  ) && (email.length >= 5 && email.length <= 64)) as boolean;
}

/**
 * Check if a name is valid.
 * 
 * @param {string} name The name to validate.
 * @returns {boolean} True if the name is valid.
 */
export function validateName(name: string): boolean {
  return (name && typeof name === 'string' && name.length >= 3 && name.length <= 32 && !isProfane(name)) as boolean;
}

/**
 * Check if a package identifier is valid.
 * 
 * @param {unknown} packageId The identifier to validate.
 * @returns {boolean} True if the identifier is valid.
 */
export function validateId(packageId: unknown): boolean {
  if (typeof packageId !== 'string')
    return false;

  // We declare this new variable otherwise TS complains saying packageId is unknown
  let pId = packageId;
  if (packageId.includes('/')) {
    const parts = packageId.split('/');
    const [repo] = parts;
    pId = parts[1] as string;
    if (!/^[a-z]{3,8}$/i.test(repo))
      return false;
  }

  if (pId.length > 32 || pId.length < 6)
    return false;

  return /^([a-z][a-z0-9_-]*\.)*[a-z][a-z0-9_-]*$/i.test(pId);
}

/**
 * Ensure that a provided value is an email.
 * 
 * @param {ValidationChain} chain The source of the value to validate.
 * @returns {ValidationChain} The validation chain provided to an Express route, or used for further modification.
 */
export function isValidEmail(chain: ValidationChain): ValidationChain {
  return chain
    .trim()
    .notEmpty().withMessage('invalid_or_empty_str')
    .isEmail().withMessage('bad_email')
    .isLength({
      min: 5,
      max: 64
    }).withMessage('bad_len')
    .toLowerCase();
}

/**
 * Ensure that a provided value can be a name.
 * 
 * @param {ValidationChain} chain The source of the value to validate.
 * @returns {ValidationChain} The validation chain provided to an Express route, or used for further modification.
 */
export function isValidName(chain: ValidationChain): ValidationChain {
  return chain
    .trim()
    .notEmpty().withMessage('invalid_or_empty_str')
    .custom(value => !isProfane(value)).withMessage('profane')
    .custom(value => /^[a-z][a-z0-9\x20-.]+[a-z0-9]$/i.test(value)).withMessage('invalid_name');
}

/**
 * Ensure that a provided value is a valid password.
 * 
 * @param {ValidationChain} chain The source of the value to validate.
 * @returns {ValidationChain} The validation chain provided to an Express route, or used for further modification.
 */
export function isValidPassword(chain: ValidationChain): ValidationChain {
  return chain
    .notEmpty().withMessage('invalid_or_empty_str')
    .isLength({
      min: 8, 
      max: 64
    }).withMessage('bad_len')
    .custom(value => value.toLowerCase() !== 'password').withMessage('is_password');
}

/**
 * Ensure that a provided value is a valid permissions number without administrator permissions.
 * 
 * @param {ValidationChain} chain The source of the value to validate.
 * @returns {ValidationChain} The validation chain provided to an Express route, or used for further modification.
 */
export function isValidPermissions(chain: ValidationChain): ValidationChain {
  return chain
    .isInt({
      min: 2,
      
      // If there is a bit set greater than the highest permission bit
      max: 1 << 13 /* << Update this */ - 1
    }).withMessage('invalid_num')
    .custom(value => (value & TokenPermission.Admin) > 0).withMessage('is_admin');
}

/**
 * Sanitize a full package identifier to ensure that it is valid and part of the X-Pkg repository, or validate a partial identifier.
 * 
 * @param {ValidationChain} chain The source of the identifier to validate.
 * @returns {ValidationChain} The validation chain provided to an Express route, or used for further modification.
 */
export function asPartialXpkgPackageId(chain: ValidationChain): ValidationChain {
  return chain
    .trim()
    .notEmpty().withMessage('invalid_or_empty_str')
    .custom(value => validateId(value) && !value.startsWith('xpkg/')).withMessage('wrong_repo')
    .customSanitizer(value => value.replace('xpkg/', ''))
    .trim();
}

/**
 * Ensure that the provided value is a partial package identifier.
 * 
 * @param {ValidationChain} chain The source of the identifier to validate.
 * @returns {ValidationChain} The validation chain provided to an Express route, or used for further modification.
 */
export function isPartialPackageId(chain: ValidationChain): ValidationChain {
  return chain
    .trim()
    .notEmpty().withMessage('invalid_or_empty_str')
    .custom(value => validateId(value) && !value.includes('/')).withMessage('full_id');
}

/**
 * Ensure that a description is valid. Also trim it. 
 * 
 * @param {ValidationChain} chain The source of the identifier to validate.
 * @returns {ValidationChain} The validation chain provided to an Express route, or used for further modification.
 */
export function isValidDescription(chain: ValidationChain): ValidationChain {
  return chain
    .trim()
    .notEmpty().withMessage('invalid_or_empty_str')
    .isLength({
      min: 10,
      max: 8192
    }).withMessage('bad_desc_len')
    .custom(value => !isProfane(value)).withMessage('profane_desc');
}

/**
 * Transform a package string into a {@link PackageType}.
 * 
 * @param {ValidationChain} chain The source of the identifier to validate.
 * @returns {ValidationChain} The validation chain provided to an Express route, or used for further modification.
 */
export function asPackageType(chain: ValidationChain): ValidationChain {
  return chain
    .trim()
    .notEmpty().withMessage('invalid_or_empty_str')
    .custom(value => {
      const pkgType = (() => {
        switch (value) {
        case 'aircraft': return PackageType.Aircraft;
        case 'scenery': return PackageType.Scenery;
        case 'plugin': return PackageType.Plugin;
        case 'livery': return PackageType.Livery;
        case 'executable': return PackageType.Livery;
        case 'other': return PackageType.Other;
        default:
          logger.debug({ value }, 'Invalid package type given');
          return null;
        }
      })();
      if (!pkgType)
        return false;
      (chain as ValidationChain & { __xpkgPkgTypeCache: PackageType | null }).__xpkgPkgTypeCache = pkgType;
      return true;
    })
    .bail().withMessage('invalid_pkg_type')
    .customSanitizer(() => (chain as ValidationChain & { __xpkgPkgTypeCache: PackageType }).__xpkgPkgTypeCache);
}

/**
 * Transform a version string into a {@link Version} object. Invalidates if the provided string is not a valid version string. 
 * 
 * @param {ValidationChain} chain The source of the identifier to validate.
 * @returns {ValidationChain} The validation chain provided to an Express route, or used for further modification.
 */
export function asVersion(chain: ValidationChain): ValidationChain {
  return chain
    .notEmpty().withMessage('invalid_or_empty_str')
    .custom(value => {
      const version = Version.fromString(value);
      if (!version)
        return false;
      (chain as ValidationChain & { __xpkgVersionCache: Version; }).__xpkgVersionCache = version;
      return true;
    })
    .bail().withMessage('invalid_version')
    .customSanitizer(() => {
      return (chain as ValidationChain & { __xpkgVersionCache: Version; }).__xpkgVersionCache;
    });
}

/**
 * Transform a version selection string into a {@link VersionSelection}.
 * 
 * @param {ValidationChain} chain The source of the identifier to validate.
 * @returns {ValidationChain} The validation chain provided to an Express route, or used for further modification.
 */
export function asVersionSelection(chain: ValidationChain): ValidationChain {
  return chain
    .notEmpty().withMessage('invalid_or_empty_str')
    .custom(value => {
      const selection = new VersionSelection(value);
      if (!selection.isValid)
        return false;
      (chain as ValidationChain & { __xpkgSelectionCache: VersionSelection }).__xpkgSelectionCache = selection;
      return true;
    })
    .bail().withMessage('invalid_selection')
    .customSanitizer(() => (chain as ValidationChain & { __xpkgSelectionCache: VersionSelection }).__xpkgSelectionCache);
}