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
import { decode } from '../util/jwtPromise.js';
import logger from '../logger.js';
import { nanoid } from 'nanoid/async';
import { AccountValidationPayload } from '../database/models/authorModel.js';
import verifyRecaptcha from '../util/recaptcha.js';

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
      authorName: author?.authorName
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
  let id;
  try {
    const payload = await decode(req.params.verificationToken, process.env.EMAIL_VERIFY_SECRET as string) as AccountValidationPayload;
    id = payload.id;
  } catch {
    logger.info(`Invalid token in verification request from ${req.ip || req.socket.remoteAddress}`);
    return res.sendStatus(401);
  }

  const routeLogger = logger.child({
    ip: req.ip || req.socket.remoteAddress,
    route: '/auth/verify/:verificationToken',
    authorId: id,
    requestId: req.id
  });

  try {
    const isVerified = await authorDatabase.isVerified(id);
    if (isVerified) { 
      routeLogger.info('Author already verified, can not reverify');
      return res.sendStatus(403);
    }

    routeLogger.info('Will attempt to set the verification status of the author to true');
    await authorDatabase.verify(id);
    routeLogger.info('Verification status changed');
    res.sendStatus(204);
  } catch(e) {
    routeLogger.error(e);
    res.sendStatus(500);
  }
});

export default route;