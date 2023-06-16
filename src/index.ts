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
import dotenv from 'dotenv';
dotenv.config();

import Express from 'express';
import fs from 'fs/promises';
import path from 'path';
import * as jwtPromise from './util/jwtPromise.js';
import bodyParser from 'body-parser';
import cors from 'cors';
import { pinoHttp } from 'pino-http';
import logger from './logger.js';
import { unzippedFilesLocation, xpkgFilesLocation } from './routes/packages.js';

logger.info('X-Pkg registry server starting');

process.on('unhandledRejection', err => {
  logger.error(err, 'Unhandled rejection');
});

process.on('uncaughtException', err => {
  logger.error(err, 'Uncaught exception');
});

logger.info('Cleaning up leftover files from last run');
await Promise.all([
  fs.rm(unzippedFilesLocation, { recursive: true, force: true }),
  fs.rm(xpkgFilesLocation, { recursive: true, force: true })
]);
await Promise.all([
  fs.mkdir(unzippedFilesLocation, { recursive: true }),
  fs.mkdir(xpkgFilesLocation, { recursive: true })
]);
logger.info('Done cleaning up files');

const app = Express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(cors());
app.use(function (req, res, next) {
  res.setHeader('X-Powered-By', 'Express, X-Pkg contributors, and you :)');
  next();
});
app.use(pinoHttp({
  logger,
  serializers: {
    req: req => ({
      id: req.id,
      method: req.method,
      url: req.url,
      remoteAddress: req.remoteAddress
    })
  }
}));

const storeFile = path.resolve('./data.json');

import packages from './routes/packages.js';
import auth from './routes/auth.js';
import account from './routes/account.js';

import { authorDatabase, packageDatabase } from './database/databases.js';

import { PackageData, VersionStatus } from './database/packageDatabase.js';
import Author, { AuthTokenPayload } from './author.js';

// Update this with all routes that require tokens
const authRoutes = [
  '/packages/upload',
  '/packages/new',
  '/packages/description',
  '/packages/upload',
  '/packages/retry',
  '/account/*'
];

// A cache indexed by author id
let authSessionCache: Record<string, string> = {};
let authorCache: Record<string, Author> = {};

// We don't want to hold the cache for too long
setInterval(() => {
  authSessionCache = {};
  authorCache = {};
}, 1500);

app.use(authRoutes, async (req, res, next) => {
  try {
    const token = req.headers.authorization;
    if (!token || typeof token !== 'string')

      // Just throw and let exception handling redirect/notify
      throw null;

    const payload = await jwtPromise.decode(token, process.env.AUTH_SECRET as string) as AuthTokenPayload;
    const { id, session } = payload;
  
    const expectedSession = Object.hasOwnProperty.call(authSessionCache, id) ?
      authSessionCache[id] : await authorDatabase.getSession(id);
    
    // If the session is invalid remove it from the cache
    if (session !== expectedSession) {
      delete authSessionCache[id];
      delete authorCache[id];

      logger.info(`Invalid session: ${session}`);
      throw null;
    }
    
    const author = Object.hasOwnProperty.call(authorCache, id) ?
      authorCache[id] : await Author.fromDatabase(id);

    // Update the cache
    authSessionCache[id] = expectedSession;
    authorCache[id] = author;

    req.user = author;
    next();
  } catch (_) {
    logger.info(`Unauthorized login attempt from ${req.socket.remoteAddress}`);
    return res.sendStatus(401);
  }
});

app.use('/packages', packages);
app.use('/auth', auth);
app.use('/account', account);

/**
 * Update the JSON file which is storing all of the data.
 * 
 * @async
 * @returns {Promise<void>} A promise which resolves when the operation completes.
 */
async function updateData(): Promise<void> {
  logger.debug('Updating package data');
  const data: (PackageData & { versions: string[]; })[] = [];

  const allPackageData = await packageDatabase.getPackageData();
  for (const pkg of allPackageData) {
    const newData = {
      ...pkg,
      versions: [] as string[]
    };

    // Get only the version strings of all of the versions of the package
    newData.versions = (await packageDatabase.getVersionData(pkg.packageId))
      .filter(v => v.isPublic && v.status === VersionStatus.Processed)
      .map(v => v.version);

    if (newData.versions.length)
      data.push(newData);
  }

  logger.debug(`Package data updated, ${data.length || 'no'} package${data.length == 1 ? '' : 's'}`);
  return fs.writeFile(storeFile, JSON.stringify({ data }), 'utf-8');
}

await updateData();
const updateInterval = 60 * 1000;
setInterval(updateData, updateInterval);
logger.info(`Package data updating every ${updateInterval}ms`);

const port = process.env.port || 5020;
app.listen(port, () => {
  logger.info(`Server started, listening on port ${port}`);
});