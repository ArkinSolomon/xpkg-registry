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
 * The data returned from the SQL server.
 * 
 * @typedef {object} DatabaseRecord
 * @property {string} packageId The id of the package.
 * @property {string} packageName The name of the package.
 * @property {string} authorName The name of the author that published this package.
 * @property {string} description The description of the package.
 * @property {string[]?} versions All of the versions of the package.
 */
type DatabaseRecord = {
  packageId: string,
  packageName: string,
  authorName: string,
  description: string,
  versions?: string[]
};

import dotenv from 'dotenv';
dotenv.config();

import mysql from 'mysql2';
import Express from 'express';
import fs from 'fs/promises';
import path from 'path';
import query from './database.js';
import * as jwtPromise from './jwtPromise.js';
import bodyParser from 'body-parser';
import cors from 'cors';

const app = Express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(cors());

const storeFile = path.resolve('./data.json');

import html from './routes/html.js';
import packages from './routes/packages.js';
import auth, { AuthTokenPayload } from './routes/auth.js';
import account from './routes/account.js';

// Update this with all routes that require tokens
const authRoutes = ['/packages/upload', '/dashboard'];

let authSessionCache: Record<string, string> = {};

// We don't want the cache to get too big, and we don't want to hold it for too long
const maxCacheSize = 500;
setInterval(() => {
  authSessionCache = {};
}, 3e5);

app.use(authRoutes, async (req, res, next) => {

  const { authorization: token } = req.body.token;
  try {
    if (!token || typeof token !== 'string' || !token.length)
      
      // Just throw and let exception handling redirect/notify
      throw null;

    const payload = await jwtPromise.decode(token, process.env.AUTH_SECRET as string) as AuthTokenPayload;
    const { id, session } = payload;

    let expectedSession: string;
    if (Object.hasOwnProperty.call(authSessionCache, id))
      expectedSession = authSessionCache[id];
    else {
      const sessionLookupQuery = mysql.format('SELECT session FROM authors WHERE authorId=?;', [id]);
      expectedSession = await new Promise<string>((resolve, reject) =>
        query(sessionLookupQuery, (err, r: { session: string }[]) => {
          if (err || r.length !== 1)
            return reject(err);
          resolve(r[0].session);
        })
      );
    }

    if (session.toLowerCase() !== expectedSession.toLowerCase())
      throw null;

    if (Object.keys(authSessionCache).length > maxCacheSize)
      authSessionCache = {};
    authSessionCache[id] = expectedSession;

    req.user = payload;

    next();
  } catch (_) {
    return res.sendStatus(401);
  }
});

app.use('/', html);
app.use('/packages', packages);
app.use('/auth', auth);
app.use('/account', account);

/**
 * Update the JSON file which is storing all of the data.
 */
async function updateJSON(): Promise<void> {
  const data: DatabaseRecord[] = [];

  const packageData = await new Promise<DatabaseRecord[]>((resolve, reject) => {
    query('SELECT packageId, packageName, authorName, description FROM packages;', (err, data: DatabaseRecord[]) => {
      if (err)
        return reject(err);
      resolve(data);
    });
  });

  for (const i in packageData) {
    const d = packageData[i];
    d.versions = await getVersions(d.packageId);

    if (d.versions.length)
      data.push(d);
  }

  await fs.writeFile(storeFile, JSON.stringify({ data }), 'utf-8');
}

/**
 * Get all of the versions that a package has.
 * 
 * @param {string} packageId The id of the package to get the version of.
 * @returns {Promise<string[]>} All of the versions of the pacakge.
 */
async function getVersions(packageId: string): Promise<string[]> {
  return new Promise<string[]>((resolve, reject) => {
    const queryStr = mysql.format('SELECT version FROM versions WHERE packageId = ? AND approved = true AND published = true;', [packageId]);
    query(queryStr, (err, d: { version: string }[]) => {
      if (err)
        return reject(err);
      const data = d.map(v => v.version);
      resolve(data);
    });
  });
}

await updateJSON();
setInterval(updateJSON, 60 * 1000);
app.listen(5020, () => {
  console.log('Server started');
});