/*
 * Copyright (c) 2022. X-Pkg Registry Contributors.
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
 * The payload of the JWT tokens used for authorization.
 * 
 * @typedef {Object} AuthTokenPayload
 * @property {string} id The id of the author.
 * @property {string} name The name of the author.
 * @property {string} session The current session of the user to be invalidated on password change.
 */
export type AuthTokenPayload = {
  id: string;
  name: string;
  session: string;
}

/**
 * The payload of the JWT tokens used for account validation.
 * 
 * @typedef {Object} AccountValidationPayload
 * @property {string} id The id of the author that is verifying their account.
 */
export type AccountValidationPayload = {
  id: string;
}

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

import query from '../database.js';
import mysql from 'mysql2';
import bcrypt from 'bcrypt';
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import * as jwtPromise from '../jwtPromise.js';
import { nanoid } from 'nanoid/async';
import sendEmail from '../email.js';

const route = Router();
const expiresIn = 2.592e9;

route.post('/login', (req, res) => {
  const body = req.body as { email: string; password: string; };
  const { password } = body;
  const email = body.email.toLowerCase();

  if (!validateEmail(email) || !validatePassword(password))
    return res.sendStatus(400);

  const lookupQuery = mysql.format('SELECT * FROM authors WHERE authorEmail=?;', [email]);
  query(lookupQuery, async (err, r: { authorId: string, authorName: string, password: string, email: string, session: string }[]) => {
    if (err) {
      console.error(err);
      return res.sendStatus(500);
    }
    if (r.length != 1)
      return res.sendStatus(403);

    const user = r[0];
    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid)
      return res.sendStatus(403);

    const token = jwt.sign(<AuthTokenPayload>{
      id: user.authorId,
      name: user.authorName,
      session: user.session
    }, process.env.AUTH_SECRET as string, { expiresIn });

    await sendEmail(email, 'New Login', `There was a new login to your X-Pkg account from ${req.socket.remoteAddress}`);
    res.json({ token });
  });
});

route.post('/create', (req, res) => {
  const body = req.body as { password: string; email: string; name: string; };
  const { name, password } = body;
  const email = body.email.toLowerCase();

  if (!validateName(name) || !validatePassword(password) || !validateEmail(email))
    return res.sendStatus(400);
  const checkName = name.toLowerCase();

  const userOrEmailQuery = mysql.format('SELECT authorID FROM authors WHERE authorEmail=? OR authorName=? OR checkName=?;', [email, name, checkName]);
  query(userOrEmailQuery, async (err, r: { authorId: string; }[]) => {
    if (err) {
      console.error(err);
      return res.sendStatus(500);
    }
    if (r.length)
      return res.sendStatus(409);

    const hash = await bcrypt.hash(password, 12);
    const id = await nanoid(32);
    const session = await nanoid(16);

    const createQuery = mysql.format('INSERT INTO authors (authorId, authorName, authorEmail, password, session, checkName) VALUES (?, ?, ?, ?, ?, ?)', [id, req.body.name, req.body.email, hash, session, checkName]);
    query(createQuery, async err => {
      if (err) {
        console.error(500);
        return res.sendStatus(500);
      }

      const token = jwt.sign(<AuthTokenPayload>{
        id,
        name: req.body.name,
        session
      }, process.env.AUTH_SECRET as string, { expiresIn });

      const verifyToken = createVerifyToken(id);
      await sendEmail(email, 'Welcome to X-Pkg', 'Welcome to X-Pkg! To start uploading packages or resources to the portal, you need to verify your email first: ' + `http://localhost:5020/auth/verify/${verifyToken}`);
      res.json({ token });
    });
  });
});

route.post('/reset/:resetToken', async (req, res) => {
  const { resetToken } = req.params;
  const { newPassword } = req.body;
  if (!resetToken || typeof resetToken !== 'string')
    return res.sendStatus(403);
  if (!validatePassword(newPassword))
    return res.sendStatus(400);

  const { id, session: expectedSession } = await jwtPromise.decode(resetToken, process.env.PASSWORD_RESET_SECRET as string) as PasswordResetPayload;

  const sessionQuery = mysql.format('SELECT session, email FROM authors WHERE id=?;', id);
  query(sessionQuery, async (err, rows: { session: string; email: string; }[]) => {
    if (err)
      return res.sendStatus(500);
    if (rows.length !== 1)
      return res.sendStatus(418);

    const { session: actualSession, email } = rows[0];
    if (expectedSession !== actualSession)
      return res.sendStatus(401);

    const newSession = await nanoid(16);
    const hash = await bcrypt.hash(newPassword, 12);

    const updateQuery = mysql.format('UPDATE authors SET session=?, password=? WHERE id=?;', [newSession, hash, id]);
    query(updateQuery, async err => {
      if (err)
        return res.sendStatus(500);

      sendEmail(email, 'Password Updated', 'Your password has been updated. If you didn\'t do this... sucks tbh lol');
      res.sendStatus(204);
    });
  });
});

/**
 * Check if a password is valid.
 * 
 * @param {string} password The password to validate.
 * @returns {boolean} True if the password is valid.
 */
function validatePassword(password: string): boolean {
  return (password && typeof password === 'string' && password.length >= 8 && password.length <= 64 && password.toLowerCase() !== 'password') as boolean;
}

/**
 * Check if an email is valid.
 * 
 * @param {string} email The email to validate.
 * @returns {boolean} True if the email is valid.
 */
function validateEmail(email: string): boolean {
  return /^\S+@\S+\.\S+$/.test(
    email
      .toLowerCase()
      .trim()
  ) && (email && typeof email === 'string' && email.length >= 4 && email.length <= 64) as boolean;
}

/**
 * Check if a name is valid.
 * 
 * @param {string} name The name to validate.
 * @returns {boolean} True if the name is valid.
 */
export function validateName(name: string): boolean {
  return (name && typeof name === 'string' && name.length > 3 && name.length <= 32) as boolean;
}

/**
 * Create a token that a user/author can use to verify their account from their email.
 * 
 * @param {string} id The id of the user's token.
 * @returns {string} The token the user can use to verify their account.
 */
function createVerifyToken(id: string): string {
  return jwt.sign(<AccountValidationPayload>{ id }, process.env.EMAIL_VERIFY_SECRET as string, { expiresIn: '12h' });
}

export default route;