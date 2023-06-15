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
import { PackageData, VersionData } from '../database/packageDatabase.js';
import Author from '../author.js';
import { packageDatabase } from '../database/databases.js';
import logger from '../logger.js';

const route = Router();

route.get('/data', (req, res) => {
  const author = req.user as Author;

  const routeLogger = logger.child({
    route: '/account/data',
    authorId: author.id
  });
  routeLogger.debug('Author requesting their account data');

  return res.json({
    id: author.id,
    name: author.name,
    isVerified: author.isVerified,
    usedStorage: author.usedStorage,
    totalStorage: author.totalStorage
  });
});

route.get('/storage', (req, res) => {
  const author = req.user as Author;

  const routeLogger = logger.child({
    route: '/account/storage',
    authorId: author.id
  });
  routeLogger.debug('Author requesting storage data');

  return res.json({
    usedStorage: author.usedStorage,
    totalStorage: author.totalStorage
  });
});

route.put('/changename', async (req, res) => {
  const author = req.user as Author;
  let { newName } = req.body as { newName: string; };

  const routeLogger = logger.child({
    route: '/account/changename',
    authorId: author.id
  });

  if (!newName) {
    routeLogger.info('New name not provided');
    return res.sendStatus(400);
  }

  routeLogger.setBindings({
    newName
  });
  newName = newName.trim();

  try {
    const checkName = newName.toLowerCase();
    if (author.checkName === checkName || !validateName(checkName)) {
      routeLogger.debug('Author sent invalid name change request');
      return res.sendStatus(400);
    }

    const lastChangeDate = author.lastChangeDate;

    // Allow name change if it's been more than 30 days (see https://bobbyhadz.com/blog/javascript-check-if-date-within-30-days)
    const daysSinceChange = Math.abs(lastChangeDate.getTime() - Date.now()) / 8.64e7;
    if (daysSinceChange < 30) {
      routeLogger.info('Author attempted to change name within 30 days of last name change');
      return res.sendStatus(406);
    }
    
    await author.changeName(newName);
    routeLogger.debug('Author changed name successfully, notifying author');
    author.sendEmail('X-Pkg Name changed', `${author.greeting()},\nYour name on X-Pkg has been changed successfully. Your new name is now "${newName}". This name will appear to all users on X-Pkg.`);
    res.sendStatus(204);
  } catch (e) {
    logger.error(e);
    return res.sendStatus(500);
  }
});

route.get('/packages', async (req, res) => {
  const author = req.user as Author;
  const data: (PackageData & { versions: (Omit<VersionData, 'uploadDate'> & { uploadDate: string; })[]; })[] = [];

  const routeLogger = logger.child({
    route: '/account/packages',
    authorId: author.id
  });
  routeLogger.debug('Author requesting their package data');

  try {
    const packages = await author.getPackages();
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
  const author = req.user as Author;
  const routeLogger = logger.child({
    route: '/account/reverify',
    authorId: author.id
  });
  routeLogger.debug('Author is attempting to resend a verification email');

  if (author.isVerified) {
    routeLogger.info('An already-verified author tried to resend a verification email');
    return res.sendStatus(400);
  }

  try {
    const token = await author.createVerifyToken();
    await author.sendEmail('X-Pkg Verification', `Click on this link to verify your account: http://localhost:3000/verify/${token} (this link expires in 24 hours).`);
    routeLogger.debug('Author resent verification email');
    res.sendStatus(204);
  } catch(e) {
    routeLogger.error(e);
    res.sendStatus(500);
  }
});

export default route;