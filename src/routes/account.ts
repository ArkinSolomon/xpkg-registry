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
import { validateName } from '../util/validators.js';
import * as packageDatabase from '../database/packageDatabase.js';
import logger from '../logger.js';
import { PackageData } from '../database/models/packageModel.js';
import { VersionData } from '../database/models/versionModel.js';
import AuthToken, { TokenPermission } from '../auth/authToken.js';

const route = Router();

route.get('/data', async (req, res) => {
  const token = req.user as AuthToken;

  const routeLogger = logger.child({
    route: '/account/data',
    id: req.id,
    ip: req.ip || req.socket.remoteAddress,
    authorId: token.authorId
  });

  if (!token.hasPermission(TokenPermission.ReadAuthorData)) {
    routeLogger.info('Insufficient permissions to retrieve author data');
    return res.sendStatus(401);
  }
  routeLogger.debug('Author requesting their account data');

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

route.patch('/changename', async (req, res) => {
  const token = req.user as AuthToken;
  let { newName } = req.body as { newName?: unknown; };

  const routeLogger = logger.child({
    route: '/account/changename',
    id: req.id,
    ip: req.ip || req.socket.remoteAddress,
    authorId: token.authorId
  });

  if (typeof newName !== 'string') {
    routeLogger.info('New name not provided, or invalid type');
    return res.sendStatus(400);
  }

  try {
    newName = newName.trim();
    routeLogger.setBindings({
      newName
    });

    const author = await token.getAuthor();

    const checkName = (newName as string).toLowerCase();
    if (author.authorName.toLowerCase() === checkName || !validateName(checkName)) {
      routeLogger.debug('Author sent invalid name change request');
      return res.sendStatus(400);
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
      return res.sendStatus(403);
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

route.get('/packages', async (req, res) => {
  const token = req.user as AuthToken;

  const routeLogger = logger.child({
    route: '/account/packages',
    authorId: token.authorId,
    id: req.id,
    ip: req.ip || req.socket.remoteAddress
  });
    
  routeLogger.debug('Author requesting their package data');

  if (!token.hasPermission(TokenPermission.ViewPackages)) {
    routeLogger.info('Insufficient permissions to retrieve packages');
    return res.sendStatus(401);
  }

  const data: (PackageData & { versions: VersionData[]; })[] = [];
  try {
    const packages = await packageDatabase.getAuthorPackages(token.authorId);
    for (const pkg of packages) {
      const d = {
        ...pkg,
        versions: [] as (Omit<VersionData, 'uploadDate'> & { uploadDate: Date | string; })[]
      };

      d.versions = (await packageDatabase.getVersionData(pkg.packageId))
        .map((v: Omit<VersionData, 'uploadDate'> & { uploadDate: Date | string; }) => {
          v.uploadDate = (v.uploadDate as Date).toISOString();
          return v as Omit<VersionData, 'uploadDate'> & { uploadDate: string; };
        });
      
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data.push(d as any);
    }

    routeLogger.debug('Author retrieved their package data');
    res.json(data);
  } catch (e) {
    routeLogger.error(e);
    return res.sendStatus(500);
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
    ip: req.ip || req.socket.remoteAddress
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