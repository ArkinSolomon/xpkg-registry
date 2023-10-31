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

/**
 * The payload of the JWT tokens used for password resets.
 * 
 * @typedef {Object} PasswordResetPayload
 * @property {string} id The id of the author trying to reset their password.
 * @property {string} session The current session of the user to invalidate after the password has been changed.
 */
export type PasswordResetPayload = {
  id: string;
  session: string;
};

import bcrypt from 'bcrypt';
import { Router } from 'express';
import { logger, validators, verifyRecaptcha } from 'xpkg-common';
import * as customValidators from '../util/customValidators.js';
import * as authorDatabase from '../database/authorDatabase.js';
import { getAuthorPackages } from '../database/packageDatabase.js';
import { decode } from '../util/jwtPromise.js';
import { nanoid } from 'nanoid';
import { AccountValidationPayload } from '../database/models/authorModel.js';
import AuthToken, { TokenPermission } from '../auth/authToken.js';
import { PackageData } from '../database/models/packageModel.js';
import { body, check, matchedData, param, validationResult } from 'express-validator';

const route = Router();

route.post('/issue',
  body('expires').isInt({
    min: 1,
    max: 365
  }),
  validators.isValidName(body('name')).isLength({
    min: 3,
    max: 32
  }),
  body('description').optional().isString().isAscii().default('').trim(),
  customValidators.isValidPermissions(body('permissions')),

  body('versionUploadPackages').default([]).isArray({
    max: 32
  }),
  validators.asPartialXpkgPackageId(check('versionUploadPackages.*').notEmpty()),

  body('descriptionUpdatePackages').optional().default([]).isArray({
    max: 32
  }),
  validators.asPartialXpkgPackageId(check('descriptionUpdatePackages.*').notEmpty()),

  body('updateVersionDataPackages').default([]).isArray({
    max: 32
  }),
  validators.asPartialXpkgPackageId(check('updateVersionDataPackages.*').notEmpty()),

  body('viewAnalyticsPackages').default([]).isArray({
    max: 32
  }),
  validators.asPartialXpkgPackageId(check('viewAnalyticsPackages.*').notEmpty()),
  async (req, res) => {
    const token = req.user as AuthToken;

    const routeLogger = logger.child({
      ip: req.ip,
      route: '/auth/issue',
      authorId: token.authorId,
      requestId: req.id
    });
    routeLogger.trace('Author wants to issue a token');

    const result = validationResult(req);
    if (!result.isEmpty())
      return res
        .status(400)
        .send('bad_request');

    if (!token.hasPermission(TokenPermission.Admin)) {
      routeLogger.info('Insufficient permissions to issue a new token');
      return res.sendStatus(401);
    }

    const author = await token.getAuthor();
    if (author.tokens.length >= 64) {
      routeLogger.info('Author has too many tokens (too_many_tokens)');
      return res
        .status(400)
        .send('too_many_tokens');
    }

    const {
      expires,
      name,
      description,
      permissions,
      versionUploadPackages: unprocessedVersionUploadPackages,
      descriptionUpdatePackages: unprocessedDescriptionUpdatePackages,
      updateVersionDataPackages: unprocessedUpdateVersionDataPackages,
      viewAnalyticsPackages: unprocessedViewAnalyticsPackages
    } = matchedData(req) as {
      expires: number;
      name: string;
      description: string;
      permissions: number;
      versionUploadPackages: string[];
      descriptionUpdatePackages: string[];
      updateVersionDataPackages: string[];
      viewAnalyticsPackages: string[];
    };

    if (author.hasTokenName(name)) {
      routeLogger.info('Author already has token with name (name_exists)');
      return res
        .status(400)
        .send('name_exists');
    }

    routeLogger.trace('Name checks passed');

    const hasSpecificDescriptionUpdatePermission = (permissions & TokenPermission.UpdateDescriptionSpecificPackages) > 0;
    const hasSpecificVersionUploadPermission = (permissions & TokenPermission.UploadVersionSpecificPackages) > 0;
    const hasSpecificUpdateVersionDataPermission = (permissions & TokenPermission.UploadVersionSpecificPackages) > 0;
    const hasSpecificViewAnalyticsPermission = (permissions & TokenPermission.ViewAnalyticsSpecificPackages) > 0;

    if ((permissions & TokenPermission.UpdateDescriptionAnyPackage) > 0 && hasSpecificDescriptionUpdatePermission) {
      routeLogger.info('Permissions UpdateDescriptionAnyPackage and UpdateDescriptionSpecificPackage are both provided (invalid_perm)');
      return res
        .status(400)
        .send('invalid_perm');
    } else if (hasSpecificDescriptionUpdatePermission && (!unprocessedDescriptionUpdatePackages || !(unprocessedDescriptionUpdatePackages as string[]).length)) {
      routeLogger.info('UpdateDescriptionSpecificPackage permission provided, but no array was given (invalid_perm)');
      return res
        .status(400)
        .send('invalid_perm');
    } else if ((permissions & TokenPermission.UploadVersionAnyPackage) > 0 && hasSpecificVersionUploadPermission) {
      routeLogger.info('Permissions UploadVersionsAnyPackage and UploadVersionSpecificPackages are both provided (invalid_perm)');
      return res
        .status(400)
        .send('invalid_perm');
    } else if (hasSpecificVersionUploadPermission && (!unprocessedVersionUploadPackages || !(unprocessedVersionUploadPackages as string[]).length)) {
      routeLogger.info('UploadVersionSpecificPackages permission provided, but no array was given (invalid_perm)');
      return res
        .status(400)
        .send('invalid_perm');
    } else if ((permissions & TokenPermission.UpdateVersionDataAnyPackage) > 0 && hasSpecificUpdateVersionDataPermission) {
      routeLogger.info('Permissions UpdateVersionDataAnyPackage and UploadVersionDataSpecificPackages are both provided (invalid_perm)');
      return res
        .status(400)
        .send('invalid_perm');
    } else if (hasSpecificUpdateVersionDataPermission && (!unprocessedUpdateVersionDataPackages || !(unprocessedUpdateVersionDataPackages as string[]).length)) {
      routeLogger.info('UploadVersionDataSpecificPackages permission provided, but no array was given (invalid_perm)');
      return res
        .status(400)
        .send('invalid_perm');
    } else if ((permissions & TokenPermission.ViewAnalyticsAnyPackage) > 0 && hasSpecificViewAnalyticsPermission) {
      routeLogger.info('Permissions ViewAnalyticsAnyPackage and ViewAnalyticsSpecificPackages are both provided (invalid_perm)');
      return res
        .status(400)
        .send('invalid_perm');
    } else if (hasSpecificViewAnalyticsPermission && (!unprocessedViewAnalyticsPackages || !(unprocessedViewAnalyticsPackages as string[]).length)) {
      routeLogger.info('ViewAnalyticsSpecificPackages permission provided, but no array was given (invalid_perm)');
      return res
        .status(400)
        .send('invalid_perm');
    }

    routeLogger.trace('Permissions checks passed');

    try {
      const author = await token.getAuthor();
      const authorPackages = await getAuthorPackages(author.authorId);

      routeLogger.trace('Retrieved author data');

      const descriptionUpdatePackages = processPackageIdList(unprocessedDescriptionUpdatePackages, authorPackages);
      const versionUploadPackages = processPackageIdList(unprocessedVersionUploadPackages, authorPackages);
      const updateVersionDataPackages = processPackageIdList(unprocessedUpdateVersionDataPackages, authorPackages);
      const viewAnalyticsPackages = processPackageIdList(unprocessedViewAnalyticsPackages, authorPackages);

      if (!descriptionUpdatePackages || !versionUploadPackages || !updateVersionDataPackages || !viewAnalyticsPackages) {
        routeLogger.info('One or more package identifier lists failed to process (invalid_arr)');
        return res
          .status(400)
          .send('invalid_arr');
      }

      routeLogger.trace('Processed packages');

      if (
        !hasSpecificDescriptionUpdatePermission && descriptionUpdatePackages.length ||
        !hasSpecificVersionUploadPermission && versionUploadPackages.length ||
        !hasSpecificUpdateVersionDataPermission && updateVersionDataPackages.length ||
        !hasSpecificViewAnalyticsPermission && viewAnalyticsPackages.length
      ) {
        routeLogger.info('Specific permissions not granted, but specific array was recieved (extra_arr)');
        return res
          .status(400)
          .send('extra_arr');
      }

      const tokenSession = nanoid();
      const newToken = new AuthToken({
        tokenSession,
        session: author.session,
        authorId: token.authorId,
        permissions,
        descriptionUpdatePackages,
        versionUploadPackages,
        updateVersionDataPackages,
        viewAnalyticsPackages
      });
      routeLogger.trace('Token information generated');

      await author.registerNewToken(newToken, expires, name, description);
      routeLogger.trace('Registered new token in author database');

      const signed = await newToken.sign(`${expires}d`);
      routeLogger.trace('Signed new token');

      await author.sendEmail('New Token', 'A new token has been issued for your X-Pkg account. If you did not request this, reset your password immediately.');
      logger.info('New token signed successfully');
      return res.json({
        token: signed
      });
    } catch {
      return res.status(500);
    }
  });

/**
 * Check a set of package ids to make sure that it is valid, and that the author owns all of them. Also ensures that there are no duplicates.
 * 
 * @param {string[]} packages The list of package ids to process.
 * @param {PackageData[]} authorPackages The package data of an author.
 * @returns {string[]|null} The processed list of package ids, or null if the list is invalid.
 */
function processPackageIdList(packages: string[], authorPackages: PackageData[]): string[] | null {
  const authorPackageSet = new Set(authorPackages.map(p => p.packageId));
  const processedPackages: string[] = [];
  for (let packageId of packages) {
    packageId = packageId.trim().toLowerCase();
    if (!authorPackageSet.has(packageId))
      return null;

    processedPackages.push(packageId);
    authorPackageSet.delete(packageId);
  }
  return processedPackages;
}

export default route;