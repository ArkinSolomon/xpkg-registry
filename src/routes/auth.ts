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

const route = Router();

route.post('/create', async (req, res) => {
  const body = req.body as {
    password?: unknown;
    email?: unknown;
    name?: unknown;
    validation?: unknown;
  };

  const routeLogger = logger.child({
    ip: req.ip || req.socket.remoteAddress,
    route: '/auth/create',
    requestId: req.id
  });

  if (typeof body.email !== 'string' || typeof body.password !== 'string' || typeof body.name !== 'string' || typeof body.validation !== 'string') {
    routeLogger.info('Missing form data or invalid types');
    return res.sendStatus(400);
  }

  try {
    const name = body.name.trim();
    const { password } = body;
    const email = body.email.trim().toLowerCase();

    if (!validators.validateName(name) || !validators.validatePassword(password) || !validators.validateEmail(email)) {
      routeLogger.info('Invalid, email, username, or password');
      return res.sendStatus(400);
    }

    if (!(await verifyRecaptcha(body.validation, req.ip || req.socket.remoteAddress || 'unknown'))) {
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

    author.sendEmail('Welcome to X-Pkg', `Welcome to X-Pkg!\n\nTo start uploading packages or resources to the portal, you need to verify your email first: http://localhost:3000/verify/${verificationToken} (this link expires in 24 hours).`);
    res.json({ token });
    routeLogger.info('New author account created');
  } catch (e) {
    routeLogger.error(e);
    return res.sendStatus(500);
  }
});

route.post('/login', async (req, res) => {
  const body = req.body as {
    email?: unknown;
    password?: unknown;
    validation?: unknown;
  };

  const routeLogger = logger.child({
    ip: req.ip || req.socket.remoteAddress,
    route: '/auth/login',
    requestId: req.id,
  });

  if (typeof body.email !== 'string' || typeof body.password !== 'string' || typeof body.validation !== 'string') {
    routeLogger.info('Missing form data or invalid types');
    return res.sendStatus(400);
  }

  const email = body.email.trim().toLowerCase();
  const { password } = body;

  try {
    if (!validators.validateEmail(email) || !validators.validatePassword(password)) {
      routeLogger.info('Invalid email or password values');
      return res.sendStatus(401);
    }

    if (!(await verifyRecaptcha(body.validation, req.ip || req.socket.remoteAddress || 'unknown'))) {
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

    await author.sendEmail('New Login', `There was a new login to your X-Pkg account from ${req.ip || req.socket.remoteAddress}`);
  } catch (e) {
    routeLogger.error(e);
    res.sendStatus(500);
  }
});

route.post('/verify/:verificationToken', async (req, res) => {
  const { validation } = req.body as { validation: unknown; };

  const routeLogger = logger.child({
    ip: req.ip || req.socket.remoteAddress,
    route: '/auth/verify/:verificationToken',
    id: req.id
  });

  if (typeof validation !== 'string') {
    routeLogger.info('No reCAPTCHA validation provided');
    return res.sendStatus(400);
  }

  const isTokenValid = await verifyRecaptcha(validation, req.ip || req.socket.remoteAddress as string);
  if (!isTokenValid) {
    routeLogger.info('Could not validate reCAPTCHA token');
    return res.sendStatus(418);
  }

  let authorId;
  try {
    const payload = await decode(req.params.verificationToken, process.env.EMAIL_VERIFY_SECRET as string) as AccountValidationPayload;
    authorId = payload.id;
  } catch {
    routeLogger.info(`Invalid token in verification request from ${req.ip || req.socket.remoteAddress}`);
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

route.post('/issue', async (req, res) => {
  const token = req.user as AuthToken;
  const body = req.body as {
    expires: unknown;
    name: unknown;
    description: unknown;
    permissions: unknown;
    versionUploadPackages: unknown;
    descriptionUpdatePackages: unknown;
  };

  const routeLogger = logger.child({
    ip: req.ip || req.socket.remoteAddress,
    route: '/auth/issue',
    authorId: token.authorId,
    requestId: req.id
  });
  routeLogger.debug('Author wants to issue a token');

  if (!token.hasPermission(TokenPermission.Admin)) {  
    routeLogger.info('Insufficient permissions to issue a new token');
    return res.sendStatus(401);
  }

  if (typeof body.expires !== 'number' ||
    typeof body.name !== 'string' ||
    (body.description && typeof body.description !== 'string') ||
    typeof body.permissions !== 'number' ||
    (body.versionUploadPackages && !Array.isArray(body.versionUploadPackages)) ||
    (body.descriptionUpdatePackages && !Array.isArray(body.descriptionUpdatePackages))) {
    return res
      .status(400)
      .send('missing_form_data');
  }

  routeLogger.debug('All form data provided');

  const author = await token.getAuthor();
  if (author.tokens.length >= 64) {
    routeLogger.info('Author has too many tokens (too_many_tokens)');
    return res
      .status(400)
      .send('too_many_tokens');
  }

  const { expires, permissions } = body;
  let description = body.description as string | undefined;

  if (description) {
    description = description.trim();
    if (description.length === 0)
      description = '';
    else if (description.length > 256) {
      routeLogger.info('Token description too long (long_desc)');
      return res
        .status(400)
        .send('long_desc');
    } else
      description = description.trim();
  }

  routeLogger.debug('Description checks passed');

  const name = body.name.trim();
  if (name.length < 3) {
    routeLogger.info('Token name too short (short_name)');
    return res
      .status(400)
      .send('short_name'); 
  } else if (name.length > 32) {
    routeLogger.info('Token name too long (long_name)');
    return res
      .status(400)
      .send('long_name'); 
  } else if (author.hasTokenName(name)) {
    routeLogger.info('Author already has token with name (name_exists)');
    return res
      .status(400)
      .send('name_exists');
  }

  routeLogger.debug('Name checks passed');

  if (expires <= 0) {
    routeLogger.info('Token expiry is less than or equal to zero (neg_or_zero_expiry)');
    return res
      .status(400)
      .send('neg_or_zero_expiry');
  } else if (expires > 365) {
    routeLogger.info('Token expiry is longer than 365 days (long_expiry)');
    return res
      .status(400)
      .send('long_expiry');
  } else if (!Number.isSafeInteger(expires)) {
    routeLogger.info('Non-integer provided for token expiry (float_expiry)');
    return res
      .status(400)
      .send('float_expiry');
  }

  const hasSpecificDescriptionUpdatePermission = (permissions & TokenPermission.UpdateDescriptionSpecificPackages) > 0;
  const hasSpecificVersionUploadPermission = (permissions & TokenPermission.UploadVersionSpecificPackages) > 0;

  if (permissions <= 0) {
    routeLogger.info('No permissions provided (zero_perm)');
    return res
      .status(400)
      .send('zero_perm');
  } else if (!Number.isSafeInteger(permissions)) {
    routeLogger.info('Unsafe integer or floating point provided (float_perm)');
    return res
      .status(400)
      .send('float_perm');
  }

  // If there is a bit set greater than the highest permission bit
  else if (permissions >= 1 << 11 /* << Update this */) {
    routeLogger.info('Permissions number too large (large_perm)');
    return res
      .status(400)
      .send('large_perm');
  } else if ((permissions & TokenPermission.Admin) > 0) {
    routeLogger.info('Attempt to generate admin token (admin_perm)');
    return res
      .status(400)
      .send('admin_perm');
  } else if ((permissions & TokenPermission.UpdateDescriptionAnyPackage) > 0 && hasSpecificDescriptionUpdatePermission) {
    routeLogger.info('Permissions UpdateDescriptionAnyPackage and UpdateDescriptionSpecificPackage are both provided (invalid_perm)');
    return res
      .status(400)
      .send('invalid_perm');
  } else if (hasSpecificDescriptionUpdatePermission && (!body.descriptionUpdatePackages || !(body.descriptionUpdatePackages as string[]).length)) {
    routeLogger.info('UpdateDescriptionSpecificPackage permission provided, but no array was given (invalid_perm)');
    return res
      .status(400)
      .send('invalid_perm');
  } else if ((permissions & TokenPermission.UploadVersionAnyPackage) > 0 && hasSpecificVersionUploadPermission) {
    routeLogger.info('Permissions UploadVersionsAnyPackage and UploadVersionSpecificPackages are both provided (invalid_perm)');
    return res
      .status(400)
      .send('invalid_perm');
  } else if (hasSpecificVersionUploadPermission && (!body.versionUploadPackages || !(body.versionUploadPackages as string[]).length)) {
    routeLogger.info('UploadVersionSpecificPackages permission provided, but no array was given (invalid_perm)');
    return res
      .status(400)
      .send('invalid_perm');
  }

  routeLogger.debug('Permissions checks passed');

  try {
    const author = await token.getAuthor();
    const authorPackages = await getAuthorPackages(author.authorId);

    routeLogger.debug('Retrieved author data');

    const unprocessedDescriptionUpdatePackages = body.descriptionUpdatePackages as string[] ?? [];
    const unprocessedVersionUploadPackages = body.versionUploadPackages as string[] ?? [];

    if (unprocessedDescriptionUpdatePackages.length > 32 || unprocessedVersionUploadPackages.length > 32) {
      routeLogger.info('Too many specific packages specified (long_arr)');
      return res
        .status(400)
        .send('long_arr');
    }

    const descriptionUpdatePackages = processPackageIdList(unprocessedDescriptionUpdatePackages, authorPackages);
    const versionUploadPackages = processPackageIdList(unprocessedVersionUploadPackages, authorPackages);

    if (!descriptionUpdatePackages || !versionUploadPackages) {
      routeLogger.info('Package id lists failed to process (invalid_arr)');
      return res
        .status(400)
        .send('invalid_arr');
    }

    routeLogger.debug('Processed packages');

    if (!hasSpecificDescriptionUpdatePermission && descriptionUpdatePackages.length || !hasSpecificVersionUploadPermission && versionUploadPackages.length) {
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
    });
    routeLogger.debug('Token information generated');

    await author.registerNewToken(newToken, expires, name, description);
    routeLogger.debug('Registered new token in author database');

    const signed = await newToken.sign(`${expires}d`);
    routeLogger.debug('Signed new token');

    await author.sendEmail('New Token', 'A new token has been issued for your X-Pkg account. If you did not request this, reset your password immediately');
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
    if (typeof packageId !== 'string')
      return null;
    
    packageId = packageId.trim().toLowerCase();
    if (!authorPackageSet.has(packageId))
      return null;
    
    processedPackages.push(packageId);
    authorPackageSet.delete(packageId);
  }
  return processedPackages;
}

export default route;