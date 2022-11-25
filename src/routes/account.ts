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
 * The data given from the server for a package version.
 * 
 * @typedef {Object} VersionData
 * @property {string} version The version string.
 * @property {string} hash The hash of the data in the package.
 * @property {boolean} approved True if the package is approved.
 * @property {boolean} published True if the package is published.
 * @property {string} loc The URL from which to download the package.
 */
type VersionData = {
  version: string;
  hash: string;
  approved: boolean;
  publishd: boolean;
  loc: string;
};

/**
 * The data given from the server for a single package.
 * 
 * @typedef {Object} PackageData
 * @property {string} packageId The id of the package.
 * @property {string} packageName The name of the package.
 * @property {string} packageDescription The description of the package.
 * @property {number} installs The number of installations the package has.
 * @property {string} packageType The type of the package.
 * @property {VersionData[]} versions The versions of the package.
 */
type PackageData = {
  packageId: string;
  packageName: string;
  packageDescription: string;
  installs: number;
  packageType: string;
  versions: VersionData[];
};

import { Router } from 'express';
import { AuthTokenPayload, validateName } from './auth.js';
import mysql from 'mysql2';
import query from '../database.js';
import { nanoid } from 'nanoid/async';
import email from '../email.js';

const route = Router();

route.post('/data', (req, res) => {
  const user = req.user as AuthTokenPayload;
  return res.json({ id: user.id, name: user.name });
});

route.post('/changename', (req, res) => {
  const user = req.user as AuthTokenPayload;
  const { newName } = req.body as { newName: string; };

  const checkName = newName.trim().toLowerCase();
  if (user.name.trim().toLowerCase() === checkName ||
    !validateName(checkName))
    return res.sendStatus(400);

  const getQuery = mysql.format('SELECT lastChange, authorEmail FROM authors WHERE authorId = ? AND session = ?;', [user.id, user.session]);
  query(getQuery, async (err, rows: { lastChange: Date | null; authorEmail: string; }[]) => {
    if (err) {
      console.error(err);
      return res.sendStatus(500);
    }

    if (rows.length !== 1)
      return res.sendStatus(401);

    const lastChangeDate = rows[0].lastChange;

    // Allow name change if it's been more than 10 days (see https://bobbyhadz.com/blog/javascript-check-if-date-within-30-days)
    // or if there is no date stored (the account has just been created)
    const daysSinceChange = Math.abs((lastChangeDate as unknown as Date).getTime() - 2.592e9) / 8.64e7;
    if (lastChangeDate || daysSinceChange < 30)
      return res.sendStatus(406);

    const session = await nanoid(16);

    // TODO test update of packages table
    const updateQuery1 = mysql.format('UPDATE authors SET authorName = ?, checkName = ?, session = ?, lastChange = ? WHERE authorId = ?;', [newName.trim(), checkName, session, new Date(), user.id]);
    const updateQuery2 = mysql.format('UPDATE packages SET authorName = ? WHERE authorId = ?;', [newName.trim(), user.id]);
    try {
      await Promise.all([query(updateQuery1), query(updateQuery2)]);

      email(rows[0].authorEmail, 'Name changed', `Your name on X-Pkg has been changed successfully. Your new name is ${newName.trim()}. This name will appear to all users.`);
      res.sendStatus(204);
    } catch (e) {
      console.error(e);
      return res.sendStatus(500);
    }
  });
});

route.post('/packages', async (req, res) => {
  const { id } = req.user as AuthTokenPayload;
  if (!id)
    return res.sendStatus(401);

  const packagesQuery = mysql.format('SELECT packageId, packageName, description, packageType, installs FROM packages WHERE authorId = ?;', id);
  const versionsQuery = mysql.format('SELECT packageId, version, HEX(hash), approved, published, loc FROM versions WHERE authorId = ?;', id);
  try {
    const data: PackageData[] = [];
    const packages: Omit<PackageData, 'versions'>[] = await query(packagesQuery);
    const versions: (VersionData & { packageId?: string; })[] = await query(versionsQuery);

    for (const pkg of packages) {
      const pkgData: PackageData = {
        ...pkg,
        versions: []
      };

      let v = versions.findIndex(v => v.packageId === pkg.packageId);
      while (v > -1) {
        const version = versions.splice(v, 1)[0];
        delete version.packageId;
        pkgData.versions.push(version);
        v = versions.findIndex(v => v.packageId === pkg.packageId);
      }

      data.push(pkgData);
    }

    res.json(data);
  } catch (e) {
    console.error(e);
    return res.sendStatus(500);
  }
});

export default route;