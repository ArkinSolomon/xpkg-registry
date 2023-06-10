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
import Author, { AccountValidationPayload } from '../author.js';
import NoSuchAccountError from '../errors/noSuchAccountError.js';
import { authorDatabase } from '../database/databases.js';
import { decode } from '../util/jwtPromise.js';
import logger from '../logger.js';

const route = Router();

route.post('/login', async (req, res) => {
  const body = req.body as { email: string; password: string; };

  if (!body.email || !body.password) {
    logger.info(`Missing form data in login request from ${req.socket.remoteAddress}`);
    return res.sendStatus(400);
  }

  const email = body.email.trim().toLowerCase();
  const { password } = body;
  const routeLogger = logger.child({
    ip: req.socket.remoteAddress,
    path: '/login',
    email,
    requestId: req.id
  });

  try {
    if (!validators.validateEmail(email) || !validators.validatePassword(password)) {
      routeLogger.info('Invalid email or password');
      return res.sendStatus(400);
    }

    const author = await Author.login(email, password);
    routeLogger.info(`Login credentials valid for author: ${author.name}`);
    const token = await author.createAuthToken();
    routeLogger.info(`Token generated for author: ${author.name}`);

    res.json({ token });

    await author.sendEmail('New Login', `There was a new login to your X-Pkg account from ${req.socket.remoteAddress}`);
  } catch (e) {
    if (e instanceof NoSuchAccountError) {
      routeLogger.info('No account with email/password combination');
      return res.sendStatus(401);
    }

    routeLogger.error(e);
    res.sendStatus(500);
  }
});

route.post('/create', async (req, res) => {
  const body = req.body as { password: string; email: string; name: string; };

  if (!body.password || !body.email || !body.name) {
    logger.info(`Missing form data in login request from ${req.socket.remoteAddress}`);
    return res.sendStatus(400);
  }

  const routeLogger = logger.child({
    ip: req.socket.remoteAddress,
    path: '/create',
    email: body.email.trim().toLowerCase(),
    name: body.name.trim(),
    requestId: req.id
  });

  try {
    const name = body.name.trim();
    const { password } = body;
    const email = body.email.trim().toLowerCase();

    if (!validators.validateName(name) || !validators.validatePassword(password) || !validators.validateEmail(email)) {
      routeLogger.info('Invalid, email, username, or password');
      return res.sendStatus(400);
    }

    const [emailInUse, nameInUse] = await Promise.all([
      authorDatabase.emailExists(email),
      authorDatabase.nameExists(name)
    ]);

    if (emailInUse || nameInUse) {
      routeLogger.info('Email or name already in use');
      return res.sendStatus(409);
    }

    const hash = await bcrypt.hash(password, 12);
    const author = await Author.create(name, email, hash);

    routeLogger.info(`New author account created with an id of ${author.id}`);

    const [token, verificationToken] = await Promise.all([
      author.createAuthToken(),
      author.createVerifyToken()
    ]);

    routeLogger.info(`Author authorization token and verification tokens generated for the author with the id of ${author.id}`);

    author.sendEmail('Welcome to X-Pkg', `Welcome to X-Pkg! To start uploading packages or resources to the portal, you need to verify your email first:  http://localhost:3000/verify/${verificationToken} (this link expires in 24 hours).`);
    res.json({ token });
  } catch (e) {
    routeLogger.error(e);
    return res.sendStatus(500);
  }
});

route.post('/verify/:verificationToken', async (req, res) => {
  let id;
  try {
    const payload = await decode(req.params.verificationToken, process.env.EMAIL_VERIFY_SECRET as string) as AccountValidationPayload;
    id = payload.id;
  } catch {
    logger.info(`Invalid token in verification request from ${req.socket.remoteAddress}`);
    return res.sendStatus(401);
  }

  const routeLogger = logger.child({
    ip: req.socket.remoteAddress,
    path: '/verify/:verificationToken',
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