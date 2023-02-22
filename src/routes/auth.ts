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

const route = Router();

route.post('/login', async (req, res) => {
  const body = req.body as { email: string; password: string; };
  const { password } = body;

  // TODO I need better validation for this stuff this looks bad
  let email!: string;
  try {
    email = body.email.toLowerCase();
  } catch (e) {
    console.error(e);
    return res.sendStatus(500);
  }

  try {
    if (!validators.validateEmail(email) || !validators.validatePassword(password))
      return res.sendStatus(400);

    const author = await Author.login(email, password);
    const token = await author.createAuthToken();

    res.json({ token });

    await author.sendEmail('New Login', `There was a new login to your X-Pkg account from ${req.socket.remoteAddress}`);
  } catch (e) {
    if (e instanceof NoSuchAccountError) 
      return res.sendStatus(401);

    console.error(e);
    res.sendStatus(500);
  }
});

route.post('/create', async (req, res) => {
  const body = req.body as { password: string; email: string; name: string; };

  try {
    const name = body.name.trim();
    const { password } = body;
    const email = body.email.trim().toLowerCase();

    if (!validators.validateName(name) || !validators.validatePassword(password) || !validators.validateEmail(email))
      return res.sendStatus(400);

    const [emailInUse, nameInUse] = await Promise.all([
      authorDatabase.emailExists(email),
      authorDatabase.nameExists(name)
    ]);

    if (emailInUse || nameInUse)
      return res.sendStatus(409);

    const hash = await bcrypt.hash(password, 12);
    const author = await Author.create(name, email, hash);

    const [token, verificationToken] = await Promise.all([
      author.createAuthToken(),
      author.createVerifyToken()
    ]);

    author.sendEmail('Welcome to X-Pkg', `Welcome to X-Pkg! To start uploading packages or resources to the portal, you need to verify your email first:  http://localhost:3000/verify/${verificationToken} (this link expires in 24 hours).`);
    res.json({ token });
  } catch (e) {
    console.error(e);
    return res.sendStatus(500);
  }
});

route.post('/verify/:verificationToken', async (req, res) => {
  let id;
  try {
    const payload = await decode(req.params.verificationToken, process.env.EMAIL_VERIFY_SECRET as string) as AccountValidationPayload;
    id = payload.id;
  } catch {
    return res.sendStatus(401);
  }

  try {
    const isVerified = await authorDatabase.isVerified(id);
    if (isVerified)
      return res.sendStatus(403);

    await authorDatabase.verify(id);
    res.sendStatus(204);
  } catch {
    res.sendStatus(500);
  }
});

export default route;