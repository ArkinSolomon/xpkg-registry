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

import query from '../database.js';
import mysql from 'mysql2';
import bcrypt from 'bcrypt';
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { nanoid } from 'nanoid/async';

const route = Router();

route.get('*', (_, res) => res.redirect('/dashboard'));

const expiresIn = 2.592e9;

route.post('/login', (req, res) => {
  const { email, password } = req.body as { email: string; password: string; };
  if (!email || !password)
    return res.sendStatus(400);

  if (typeof password !== 'string' || typeof email !== 'string' || !email.length || !password.length)
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

    res
      .cookie('authorization', token, {
        maxAge: expiresIn,
        signed: true
      })
      .sendStatus(204);
  });
});

route.post('/create', async (req, res) => {
  const { password, email, name } = req.body as { password: string; email: string; name: string; };

  if (!password || !email || !name
    || typeof password !== 'string' || typeof email !== 'string' || typeof name !== 'string'
    || password.length < 8 || password.length > 64
    || name.length < 3 || name.length > 32)
    return res.sendStatus(400);

  const userOrEmailQuery = mysql.format('SELECT authorID FROM authors WHERE authorEmail=? OR authorName=?;', [email, name]);
  query(userOrEmailQuery, (err, r: { authorId: string; }[]) => {
    if (err)
      return res.sendStatus(500);
    if (r.length)
      return res.sendStatus(409);
  });

  const hash = await bcrypt.hash(password, 12);
  const id = await nanoid(32);
  const session = await nanoid(12);

  const createQuery = mysql.format('INSERT INTO authors (authorId, authorName, authorEmail, password, session) VALUES (?, ?, ?, ?, ?)', [id, req.body.name, req.body.email, hash, session]);
  query(createQuery, err => {
    if (err)
      return res.sendStatus(500);

    const token = jwt.sign(<AuthTokenPayload>{
      id,
      name: req.body.name,
      session
    }, process.env.AUTH_SECRET as string, { expiresIn });

    res
      .cookie('authorization', token, {
        maxAge: expiresIn,
        signed: true
      })
      .sendStatus(204);
  });
});

export default route;