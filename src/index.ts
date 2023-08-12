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
 * The full registry data sent when requesting `/packages`.
 * 
 * @typedef {Object} FullRegistryData
 * @property {string} generated The ISO string of when the data was generated.
 * @property {Object[]} packages The packages with all of its data on the registry.
 * @property {string} packages.packageId The identifier of the package.
 * @property {string} packages.packageName The name of the package.
 * @property {string} packages.authorId The identifier of the author.
 * @property {string} packages.authorName The name of the author.
 * @property {string} packages.description The description of the package.
 * @property {PackageType} packages.packageType The type of the package.
 * @property {Object[]} packages.versions All of the versions of the package.
 * @property {string} packages.versions.version The version string of the package version.
 * @property {[string, string][]} packages.versions.dependencies All of the dependencies of the package.
 * @property {[string, string][]} packages.versions.incompatibilities All of the incompatibilities of the package.
 * @property {string} packages.versions.xplaneSelection The X-Plane selection string of the version.
 */
type FullRegistryData = {
  generated: string;
  packages: {
    packageId: string;
    packageName: string;
    authorId: string;
    authorName: string;
    description: string;
    packageType: PackageType;
    versions: {
      version: string;
      dependencies: [string, string][];
      incompatibilities: [string, string][];
      xplaneSelection: string;
    }[];
  }[];
};

import dotenv from 'dotenv';
dotenv.config();

import Express from 'express';
import fs from 'fs/promises';
import path from 'path';
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

logger.debug('Cleaning up leftover files from last run');
await Promise.all([
  fs.rm(unzippedFilesLocation, { recursive: true, force: true }),
  fs.rm(xpkgFilesLocation, { recursive: true, force: true })
]);
await Promise.all([
  fs.mkdir(unzippedFilesLocation, { recursive: true }),
  fs.mkdir(xpkgFilesLocation, { recursive: true })
]);
logger.debug('Done cleaning up files');

const app = Express();
app.use(bodyParser.json());
app.use(cors());
app.use(function (_, res, next) {
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

import * as packageDatabase from './database/packageDatabase.js';
import { PackageType } from './database/models/packageModel.js';
import { VersionStatus } from './database/models/versionModel.js';
import rateLimiter from './util/rateLimiter.js';
import authorizeRoute from './auth/authorizeRoute.js';

// Update this with all routes that require tokens
const authRoutes = [
  '/auth/issue',
  '/packages/upload',
  '/packages/new',
  '/packages/description',
  '/packages/upload',
  '/packages/retry',
  '/packages/incompatibilities',
  '/account/*'
];

app.use(authRoutes, authorizeRoute);

app.use('/meta', rateLimiter('meta', 10, 10));

app.use('/account/data', rateLimiter('account-data', 8, 5));
app.use('/account/changename', rateLimiter('account-changename', 3, 5));
app.use('/account/packages', rateLimiter('account-packages', 5, 3));

app.use('/auth/login', rateLimiter('auth-login', 5, 3));
app.use('/auth/create', rateLimiter('auth-create', 5, 3));
app.use('/auth/verify', rateLimiter('auth-verify', 3, 4));
app.use('/auth/issue', rateLimiter('auth-issue', 3, 3));

app.use('/packages/info', rateLimiter('packages-info', 10, 2));
app.use('/packages/new', rateLimiter('packages-new', 3, 5));
app.use('/packages/upload', rateLimiter('packages-upload', 3, 8));
app.use('/packages/description', rateLimiter('packages-description', 3, 4));
app.use('/packages/incompatibilities', rateLimiter('packages-incompatibilities', 3, 4));

app.use('/account', account);
app.use('/auth', auth);
app.use('/packages', packages);

app.get('/meta', (_, res) => {
  res
    .status(200)
    .json({
      name: 'X-Pkg',
      identifier: 'xpkg',
      description: 'X-Pkg\'s official repository.'
    });
});

/**
 * Update the JSON file which is storing all of the data.
 * 
 * @async
 * @returns {Promise<void>} A promise which resolves when the operation completes.
 */
async function updateData(): Promise<void> {
  logger.debug('Updating package data');
  const data: FullRegistryData = {
    generated: '',
    packages: []
  };

  const allPackageData = await packageDatabase.getPackageData();
  for (const pkg of allPackageData) {
    const pkgData: FullRegistryData['packages'][0] = {
      packageId: pkg.packageId,
      packageName: pkg.packageName,
      authorId: pkg.authorId,
      authorName: pkg.authorName,
      description: pkg.description,
      packageType: pkg.packageType,
      versions: []
    };

    // Get only the version strings of all of the versions of the package
    pkgData.versions = (await packageDatabase.getVersionData(pkg.packageId))
      .filter(v => v.isPublic && v.status === VersionStatus.Processed)
      .map(v => ({
        version: v.version,
        dependencies: v.dependencies,
        incompatibilities: v.incompatibilities,
        xplaneSelection: v.xpSelection,
      }));

    if (pkgData.versions.length)
      data.packages.push(pkgData);
  }

  logger.debug(`Package data updated, ${data.packages.length || 'no'} package${data.packages.length == 1 ? '' : 's'}`);
  data.generated = new Date().toISOString();
  return fs.writeFile(storeFile, JSON.stringify(data), 'utf-8');
}

await updateData();
const updateInterval = 60 * 1000;
setInterval(updateData, updateInterval);
logger.info(`Package data updating every ${updateInterval}ms`);

const port = process.env.PORT || 443;
app.listen(port, () => {
  logger.info(`Server started, listening on port ${port}`);
});