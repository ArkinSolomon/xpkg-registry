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
}

import bcrypt from 'bcrypt';
import { Router } from 'express';
import * as validators from '../util/validators.js';
import * as authorDatabase from '../database/authorDatabase.js';
import { getAuthorPackages } from '../database/packageDatabase.js';
import { decode } from '../util/jwtPromise.js';
import logger from '../logger.js';
import { nanoid } from 'nanoid/async';
import { AccountValidationPayload } from '../database/models/authorModel.js';
import verifyRecaptcha from '../util/recaptcha.js';
import AuthToken, { TokenPermission } from '../auth/authToken.js';
import { PackageData } from '../database/models/packageModel.js';
import { body, check, matchedData, param, validationResult } from 'express-validator';

const route = Router();

route.post('/create',
  validators.isValidEmail(body('email')),
  validators.isValidName(body('name')),
  validators.isValidPassword(body('password')),
  body('validation').notEmpty(),
  async (req, res) => {
    const routeLogger = logger.child({
      ip: req.ip,
      route: '/auth/create',
      requestId: req.id
    });

    const result = validationResult(req);
    if (!result.isEmpty()) {
      const message = result.array()[0].msg;
      routeLogger.info(`Validation failed with message: ${message}`);
      return res
        .status(400)
        .send(message);
    }

    const { email, password, name, validation } = matchedData(req) as {
      email: string;
      password: string;
      name: string;
      validation: string;
    };

    try {
      if (!(await verifyRecaptcha(validation, req.ip || 'unknown'))) {
        routeLogger.info('ReCAPTCHA validation failed');
        return res.sendStatus(418);
      } 

      const [emailInUse, nameInUse] = await Promise.all([
        authorDatabase.emailExists(email),
        authorDatabase.nameExists(name)
      ]);

      if (emailInUse || nameInUse) {
        routeLogger.info(`${emailInUse ? 'Email' : 'Name'} already in use`);
        return res
          .status(403)
          .send(emailInUse ? 'email' : 'name');
      }

      const hash = await bcrypt.hash(password, 12);
      const newAuthorId = await nanoid(8) + Math.floor(Date.now() / 1000);
      const author =  await authorDatabase.createAuthor(
        newAuthorId,
        name,
        email,
        hash
      );

      routeLogger.setBindings({
        authorId: newAuthorId
      });
      routeLogger.debug('New author account registered in database');

      const [token, verificationToken] = await Promise.all([
        author.createAuthToken(),
        author.createVerifyToken()
      ]);

      routeLogger.debug('Generated auth and verification tokens');

      author.sendEmail('Welcome to X-Pkg', `Welcome to X-Pkg!\n\nTo start uploading packages or resources to the portal, you need to verify your email first: http://localhost:3001/verify/${verificationToken} (this link expires in 24 hours).`);
      res.json({ token });
      routeLogger.info('New author account created');
    } catch (e) {
      routeLogger.error(e);
      return res.sendStatus(500);
    }
  });

route.post('/login',
  validators.isValidEmail(body('email')),
  validators.isValidPassword(body('password')),
  body('validation').notEmpty(),
  async (req, res) => {
    const routeLogger = logger.child({
      ip: req.ip,
      route: '/auth/login',
      requestId: req.id,
    });

    const result = validationResult(req);
    if (!result.isEmpty()) {
      const message = result.array()[0].msg;
      logger.info(`Request failed with message: ${message}`);
      return res
        .status(400)
        .send(message);
    }

    const { email, password, validation } = matchedData(req);

    try {
      if (!(await verifyRecaptcha(validation, req.ip || 'unknown'))) {
        routeLogger.info('ReCAPTCHA validation failed');
        return res.sendStatus(418);
      }

      const author = await authorDatabase.getAuthorFromEmail(email);
      if (!author) {
        routeLogger.info('No account with email');
        return res.sendStatus(401);
      }

      routeLogger.setBindings({
        authorName: author.authorName
      });

      const isValid = await bcrypt.compare(password, author.password);
      if (!isValid) {
        routeLogger.info('Wrong password');
        return res.sendStatus(401);
      }

      routeLogger.debug('Login credentials valid');
      const token = await author.createAuthToken();
      routeLogger.info('Successful login, token generated');

      res.json({ token });

      await author.sendEmail('New Login', `There was a new login to your X-Pkg account from ${req.ip}`);
    } catch (e) {
      routeLogger.error(e);
      res.sendStatus(500);
    }
  });

route.post('/verify/:verificationToken',
  param('verificationToken').trim().notEmpty(),
  body('validation').trim().notEmpty(),
  async (req, res) => {

    const result = validationResult(req);
    if (!result.isEmpty()) {
      logger.info('Request body field validation failed');
      return res.sendStatus(400);
    }

    const { verificationToken, validation } = matchedData(req);

    const routeLogger = logger.child({
      ip: req.ip,
      route: '/auth/verify/:verificationToken',
      id: req.id
    });

    const isTokenValid = await verifyRecaptcha(validation, req.ip as string);
    if (!isTokenValid) {
      routeLogger.info('Could not validate reCAPTCHA token');
      return res.sendStatus(418);
    }

    let authorId;
    try {
      const payload = await decode(verificationToken, process.env.EMAIL_VERIFY_SECRET as string) as AccountValidationPayload;
      authorId = payload.id;
    } catch {
      routeLogger.info(`Invalid token in verification request from ${req.ip}`);
      return res.sendStatus(401);
    }

    routeLogger.setBindings({
      authorId
    });

    try {
      const isVerified = await authorDatabase.isVerified(authorId);
      if (isVerified) { 
        routeLogger.info('Author already verified, can not reverify');
        return res.sendStatus(403);
      }

      routeLogger.debug('Will attempt to set the verification status of the author to true');
      await authorDatabase.verify(authorId);
      routeLogger.info('Verification status changed');
      res.sendStatus(204);
    } catch(e) {
      routeLogger.error(e);
      res.sendStatus(500);
    }
  });

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
  validators.isValidPermissions(body('permissions')),

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
  async (req, res) => {
    const token = req.user as AuthToken;

    const routeLogger = logger.child({
      ip: req.ip,
      route: '/auth/issue',
      authorId: token.authorId,
      requestId: req.id
    });
    routeLogger.debug('Author wants to issue a token');

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
      updateVersionDataPackages: unprocessedUpdateVersionDataPackages
    } = matchedData(req) as {
      expires: number;
      name: string;
      description: string;
      permissions: number;
      versionUploadPackages: string[];
      descriptionUpdatePackages: string[];
      updateVersionDataPackages: string[];
    };

    if (author.hasTokenName(name)) {
      routeLogger.info('Author already has token with name (name_exists)');
      return res
        .status(400)
        .send('name_exists');
    }

    routeLogger.debug('Name checks passed');

    const hasSpecificDescriptionUpdatePermission = (permissions & TokenPermission.UpdateDescriptionSpecificPackages) > 0;
    const hasSpecificVersionUploadPermission = (permissions & TokenPermission.UploadVersionSpecificPackages) > 0;
    const hasSpecificUpdateVersionDataPermission = (permissions & TokenPermission.UploadVersionSpecificPackages) > 0;

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
    }  else if ((permissions & TokenPermission.UpdateVersionDataAnyPackage) > 0 && hasSpecificUpdateVersionDataPermission) {
      routeLogger.info('Permissions UpdateVersionDataAnyPackage and UploadVersionDataSpecificPackages are both provided (invalid_perm)');
      return res
        .status(400)
        .send('invalid_perm');
    } else if (hasSpecificUpdateVersionDataPermission && (!unprocessedUpdateVersionDataPackages || !(unprocessedUpdateVersionDataPackages as string[]).length)) {
      routeLogger.info('UploadVersionDataSpecificPackages permission provided, but no array was given (invalid_perm)');
      return res
        .status(400)
        .send('invalid_perm');
    }

    routeLogger.debug('Permissions checks passed');

    try {
      const author = await token.getAuthor();
      const authorPackages = await getAuthorPackages(author.authorId);

      routeLogger.debug('Retrieved author data');

      const descriptionUpdatePackages = processPackageIdList(unprocessedDescriptionUpdatePackages, authorPackages);
      const versionUploadPackages = processPackageIdList(unprocessedVersionUploadPackages, authorPackages);
      const updateVersionDataPackages = processPackageIdList(unprocessedUpdateVersionDataPackages, authorPackages);

      if (!descriptionUpdatePackages || !versionUploadPackages || !updateVersionDataPackages) {
        routeLogger.info('Package id lists failed to process (invalid_arr)');
        return res
          .status(400)
          .send('invalid_arr');
      }

      routeLogger.debug('Processed packages');

      if (!hasSpecificDescriptionUpdatePermission && descriptionUpdatePackages.length ||
      !hasSpecificVersionUploadPermission && versionUploadPackages.length || 
      !hasSpecificUpdateVersionDataPermission && updateVersionDataPackages.length
      ) {
        routeLogger.info('Specific permissions not granted, but specific array was recieved (extra_arr)');
        return res
          .status(400)
          .send('extra_arr');
      }
  
      const tokenSession = await nanoid();
      const newToken = new AuthToken({
        tokenSession,
        session: author.session,
        authorId: token.authorId,
        permissions,
        descriptionUpdatePackages,
        versionUploadPackages,
        updateVersionDataPackages
      });
      routeLogger.debug('Token information generated');

      await author.registerNewToken(newToken, expires, name, description);
      routeLogger.debug('Registered new token in author database');

      const signed = await newToken.sign(`${expires}d`);
      routeLogger.debug('Signed new token');

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