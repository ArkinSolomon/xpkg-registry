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

import { Router } from 'express';
import * as packageDatabase from '../database/packageDatabase.js';
import logger from '../logger.js';
import { PackageData } from '../database/models/packageModel.js';
import { VersionData } from '../database/models/versionModel.js';
import AuthToken, { TokenPermission } from '../auth/authToken.js';
import * as validators from '../util/validators.js';
import { body, matchedData, param, validationResult } from 'express-validator';
import * as authorDatabase from '../database/authorDatabase.js';
import Version from '../util/version.js';
import NoSuchPackageError from '../errors/noSuchPackageError.js';

const route = Router();

route.get('/data', async (req, res) => {
  const token = req.user as AuthToken;
  const routeLogger = logger.child({
    route: '/account/data',
    id: req.id,
    ip: req.ip,
    authorId: token.authorId
  });

  if (!token.hasPermission(TokenPermission.ReadAuthorData)) {
    routeLogger.info('Insufficient permissions to retrieve author data');
    return res.sendStatus(401);
  }
  routeLogger.trace('Author requesting their account data');

  const author = await token.getAuthor();
  return res.json({
    id: author.authorId,
    name: author.authorName,
    email: author.authorEmail,
    isVerified: author.verified,
    usedStorage: author.usedStorage,
    totalStorage: author.totalStorage
  });
});

route.patch('/changename',
  validators.isValidName(body('newName')),
  async (req, res) => {
    const token = req.user as AuthToken;

    const routeLogger = logger.child({
      route: '/account/changename',
      id: req.id,
      ip: req.ip,
      authorId: token.authorId
    });
    routeLogger.debug('Author attempting to change thier name');

    const result = validationResult(req);
    if (!result.isEmpty()) {
      const message = result.array()[0].msg;
      routeLogger.info(`Validation failed with message: ${message}`);
      return res
        .status(400)
        .send(message);
    }

    const { newName } = matchedData(req) as {
      newName: string;
    };

    routeLogger.setBindings({
      newName
    });

    try {
      const author = await token.getAuthor();

      const checkName = (newName as string).toLowerCase();
      if (author.authorName.toLowerCase() === checkName) {
        routeLogger.debug('Author sent invalid name change request');
        return res
          .status(400)
          .send('same_name');
      }

      if (!token.hasPermission(TokenPermission.Admin)) {
        routeLogger.info('Insufficient permissions to update author data');
        return res.sendStatus(401);
      }

      const lastChangeDate = author.lastChange || new Date(0);

      // Allow name change if it's been more than 30 days (see https://bobbyhadz.com/blog/javascript-check-if-date-within-30-days)
      const daysSinceChange = Math.abs(lastChangeDate.getTime() - Date.now()) / 8.64e7;
      if (daysSinceChange < 30) {
        routeLogger.info('Author attempted to change name within 30 days of last name change');
        return res
          .status(400)
          .send('too_soon');
      }

      const nameExists = await authorDatabase.nameExists(newName);
      if (nameExists) {
        routeLogger.info('Name already taken');
        return res
          .status(400)
          .send('name_exists');
      }
    
      await author.changeName(newName as string);
      routeLogger.debug('Author changed name successfully, notifying author');
      author.sendEmail('X-Pkg Name changed', `Your name on X-Pkg has been changed successfully. Your new name is now "${newName}". This name will appear to all users on X-Pkg.`);
      res.sendStatus(204);
    } catch (e) {
      logger.error(e);
      return res.sendStatus(500);
    }
  });

type OptionalAuthorInformationPackageData = Omit<Omit<PackageData, 'authorName'>, 'authorId'> & {
  authorId?: string;
  authorName?: string;
};
type VersionDataOptIdUploadDateAsObjOrStr = Omit<Omit<VersionData, 'packageId'>, 'uploadDate'> & {
  uploadDate: Date | string;
  packageId?: string;
};
type VersionDataNoIdUploadDateAsStr = Omit<Omit<VersionData, 'packageId'>, 'uploadDate'> & {
  uploadDate: string;
};
route.get('/packages', async (req, res) => {
  const token = req.user as AuthToken;

  const routeLogger = logger.child({
    route: '/account/packages',
    authorId: token.authorId,
    id: req.id,
    ip: req.ip
  });
    
  routeLogger.debug('Author requesting their package data');

  if (!token.hasPermission(TokenPermission.ViewPackages)) {
    routeLogger.info('Insufficient permissions to retrieve packages');
    return res.sendStatus(401);
  }

  const data: (OptionalAuthorInformationPackageData & { versions: VersionDataNoIdUploadDateAsStr[]; })[] = [];
  try {
    const packages = await packageDatabase.getAuthorPackages(token.authorId) as OptionalAuthorInformationPackageData[];
    for (const pkg of packages) {
      const d = {
        ...pkg,
        versions: [] as VersionDataNoIdUploadDateAsStr[]
      };

      delete d.authorId;
      delete d.authorName;
      d.versions = (await packageDatabase.getVersionData(pkg.packageId))
        .map((v: VersionDataOptIdUploadDateAsObjOrStr) => {
          v.uploadDate = (v.uploadDate as Date).toISOString();
          delete v.packageId;
          return v as VersionDataNoIdUploadDateAsStr;
        });
      
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data.push(d);
    }

    routeLogger.debug('Author retrieved their package data');
    res.json({ packages: data });
  } catch (e) {
    routeLogger.error(e);
    return res.sendStatus(500);
  }
});

route.get('/packages/:packageId', 
  validators.isPartialPackageId(param('packageId')),
  async (req, res) => {
    const token = req.user as AuthToken;

    const routeLogger = logger.child({
      route: '/packages/:packageId',
      authorId: token.authorId,
      id: req.id,
      ip: req.ip
    });
    routeLogger.info('Author requesting specific package data');

    const result = validationResult(req);
    if (!result.isEmpty()) {
      const message = result.array()[0].msg;
      routeLogger.info(`Validation failed with message: ${message}`);
      return res.status(400);
    }

    const { packageId } = matchedData(req) as {
      packageId: string
    };
    routeLogger.setBindings({ packageId });
    routeLogger.debug('Author requesting their package data');

    if (!token.hasPermission(TokenPermission.ViewPackages)) {
      routeLogger.info('Insufficient permissions to retrieve specific package information');
      return res.sendStatus(401);
    }

    try {
      const data: OptionalAuthorInformationPackageData & { versions: VersionDataNoIdUploadDateAsStr[]; } = {
        ...(await packageDatabase.getPackageData(packageId)),
        versions: []
      };

      if (data.authorId !== token.authorId) {
        logger.info('Author tried to retrieve data for a package that they do not own');
        return res.sendStatus(404);
      }

      delete data.authorId;
      delete data.authorName;
  
      data.versions = (await packageDatabase.getVersionData(packageId))
        .map((v: VersionDataOptIdUploadDateAsObjOrStr) => {
          v.uploadDate = (v.uploadDate as Date).toISOString();
          delete v.packageId;
          return v as VersionDataNoIdUploadDateAsStr;
        });
        
      routeLogger.info('Author retrieved package information for package');
      res.json(data);
    } catch (e) {
      if (e instanceof NoSuchPackageError) {
        routeLogger.info(e, 'No such package');
        return res.sendStatus(404);
      }

      logger.error(e);
      res.sendStatus(500);
    }
  });

route.get('/packages/:packageId/:packageVersion', 
  validators.isPartialPackageId(param('packageId')),
  validators.asVersion(param('packageVersion')),
  async (req, res) => {
    const token = req.user as AuthToken;

    const routeLogger = logger.child({
      route: '/packages/:packageId/:packageVersion',
      authorId: token.authorId,
      id: req.id,
      ip: req.ip
    });

    const result = validationResult(req);
    if (!result.isEmpty()) {
      const message = result.array()[0].msg;
      routeLogger.info(`Validation failed with message: ${message}`);
      return res.status(400);
    }

    const { packageId, packageVersion } = matchedData(req) as {
      packageVersion: Version,
      packageId: string
    };
    routeLogger.setBindings({ packageId, packageVersion });
    routeLogger.info('Author is requesting information for a specific package version');

    if (!token.hasPermission(TokenPermission.ViewPackages)) {
      routeLogger.info('Insufficient permissions to retrieve specific package information');
      return res.sendStatus(401);
    }

    try {
      const packageData = await packageDatabase.getPackageData(packageId);

      if (packageData.authorId !== token.authorId) {
        logger.info('Author tried to retrieve data for a package version that they do not own');
        return res.sendStatus(404);
      }
  
      const versionData = await packageDatabase.getVersionData(packageId, packageVersion) as VersionDataOptIdUploadDateAsObjOrStr;
      versionData.uploadDate = (versionData.uploadDate as Date).toISOString();
      delete versionData.packageId;
        
      routeLogger.info('Author retrieved package information for package');
      res.json({
        ...packageData,
        versionData: versionData as VersionDataNoIdUploadDateAsStr
      });
    } catch (e) {
      if (e instanceof NoSuchPackageError) {
        routeLogger.info(e, 'No such package version');
        return res.sendStatus(404);
      }

      logger.error(e);
      res.sendStatus(500);
    }
  });

route.post('/reverify', async (req, res) => {
  const token = req.user as AuthToken;

  const body = req.body as {
    validation: unknown;
  };

  const routeLogger = logger.child({
    route: '/account/packages',
    authorId: token.authorId,
    id: req.id,
    ip: req.ip
  });
  routeLogger.debug('Author is attempting to resend a verification email');

  if (typeof body.validation !== 'string') {
    routeLogger.info('No reCAPTCHA validation token provided');
    return res.sendStatus(400);
  }

  if (!token.hasPermission(TokenPermission.Admin)) {  
    routeLogger.info('Insufficient permissions to resent verification email');
    return res.sendStatus(401);
  }

  try {
    const author = await token.getAuthor();
    if (author.verified) {
      routeLogger.info('An already-verified author tried to resend a verification email');
      return res.sendStatus(403);
    }

    const verificationToken = await author.createVerifyToken();
    await author.sendEmail('X-Pkg Verification', `Click on this link to verify your account: http://localhost:3000/verify/${verificationToken} (this link expires in 24 hours).`);
    routeLogger.debug('Author resent verification email');
    res.sendStatus(204);
  } catch(e) {
    routeLogger.error(e);
    res.sendStatus(500);
  }
});

export default route;