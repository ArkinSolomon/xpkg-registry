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

const route = Router();

// TODO get rid of this route and have the client parse this data directly from their token
route.get('/data', (req, res) => {
  const author = req.user as Author;
  return res.json({ id: author.id, name: author.name });
});

route.put('/changename', async (req, res) => {
  const author = req.user as Author;
  let { newName } = req.body as { newName: string; };

  try {
    newName = newName.trim();

    const checkName = newName.toLowerCase();
    if (author.checkName === checkName ||
      !validateName(checkName))
      return res.sendStatus(400);

    const lastChangeDate = author.lastChangeDate;

    // Allow name change if it's been more than 30 days (see https://bobbyhadz.com/blog/javascript-check-if-date-within-30-days)
    const daysSinceChange = Math.abs(lastChangeDate.getTime() - Date.now()) / 8.64e7;
    if (daysSinceChange < 30)
      return res.sendStatus(406);

    await author.changeName(newName);
    author.sendEmail('Name changed', `Your name on X-Pkg has been changed successfully. Your new name is ${newName}. This name will appear to all users on X-Pkg.`);
    res.sendStatus(204);
  } catch (e) {
    console.error(e);
    return res.sendStatus(500);
  }
});

route.get('/packages', async (req, res) => {
  const author = req.user as Author;
  const data: (PackageData & { versions: (Omit<VersionData, 'uploadDate'> & { uploadDate: string; })[]; })[] = [];

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

    res.json(data);
  } catch (e) {
    console.error(e);
    return res.sendStatus(500);
  }
});

export default route;