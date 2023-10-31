/*
 * Copyright (c) 2023. Arkin Solomon.
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
import { PackageType } from '../database/models/packageModel.js';
import { TokenPermission } from '../auth/authToken.js';
import { ValidationChain } from 'express-validator';

/**
 * Transform a package string into a {@link PackageType}.
 * 
 * @param {ValidationChain} chain The source of the identifier to validate.
 * @returns {ValidationChain} The validation chain provided to an Express route, or used for further modification.
 */
export function asPackageType(chain: ValidationChain): ValidationChain {
  return chain
    .trim()
    .notEmpty().bail().withMessage('invalid_or_empty_str')
    .custom(value => {
      const pkgType = (() => {
        switch (value) {
        case 'aircraft': return PackageType.Aircraft;
        case 'scenery': return PackageType.Scenery;
        case 'plugin': return PackageType.Plugin;
        case 'livery': return PackageType.Livery;
        case 'executable': return PackageType.Livery;
        case 'other': return PackageType.Other;
        default: return null;
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
      max: 1 << 15 /* << Update this */ - 1
    }).bail().withMessage('invalid_num')
    .custom(value => (value & TokenPermission.Admin) > 0).withMessage('is_admin');
}