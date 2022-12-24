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

import path from 'path';
import { Router } from 'express';
import multer from 'multer';
import os from 'os';
import fs from 'fs';
import fsProm from 'fs/promises';
import { nanoid } from 'nanoid/async';
import unzip from 'unzipper';
import crypto from 'crypto';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import Author from '../author.js';
import * as validators from '../util/validators.js';
import isVersionValid from '../util/version.js';
import fileProcessor from '../util/fileProcessor.js';
import packageDatabase from '../database/mysqlPackageDB.js';

const storeFile = path.resolve('./data.json');
const route = Router();
const upload = multer({ dest: os.tmpdir() });

const bucketName = 'xpkgregistrydev';

const s3client = new S3Client({
  region: 'us-east-2'
});

route.get('/', (_, res) => {
  res.sendFile(storeFile);
});

route.get('/:packageId/:version', async (req, res) => {
  const { packageId, version: versionString } = req.params as {
    packageId: string; 
    version: string;
  };

  const version = isVersionValid(versionString);
  if (!version)
    return res.sendStatus(400);

  const versionData = await packageDatabase.getVersionData(packageId, version);

  if (!versionData.approved || !versionData.published)
    return res.sendStatus(404);

  res
    .status(200)
    .json({
      loc: versionData.loc,
      hash: versionData.hash
    });
});

route.post('/new', upload.single('file'), async (req, res) => {
  const file = req.file;
  const author = req.user as Author;

  let packageId, packageName, packageType, description, initialVersion;
  const publishedPackage = req.body.published;
  const privatePackage = req.body.private;
  try {
    packageId = req.body.packageId.trim().toLowerCase();
    packageName = req.body.packageName.trim();

    // TODO make this an enum
    packageType = req.body.packageType.trim().toLowerCase();

    description = req.body.description.trim();
    initialVersion = req.body.initialVersion.trim().toLowerCase();

    checkType(packageId, 'string');
    checkType(packageName, 'string');
    checkType(packageType, 'string');
    checkType(description, 'string');
    checkType(initialVersion, 'string');
    checkType(publishedPackage, 'boolean');
    checkType(privatePackage, 'boolean');
  } catch (e) {
    console.error(e);
    return res
      .status(400)
      .send('missing_form_data');
  }

  if (!file)
    return res
      .status(400)
      .send('no_file');

  if (packageId.length < 6)
    return res
      .status(400)
      .send('short_id');
  else if (packageId.length > 32)
    return res
      .status(400)
      .send('long_id');
  else if (!/^[a-z0-9_.]+$/i.test(packageId))
    return res
      .status(400)
      .send('invalid_id');

  if (packageName.length < 3)
    return res
      .status(400)
      .send('short_name');
  else if (packageName.length > 32)
    return res
      .status(400)
      .send('long_name');

  if (description.length < 10)
    return res
      .status(400)
      .send('short_desc');
  else if (description.length > 8192)
    return res
      .status(400)
      .send('long_desc');

  if (initialVersion.length < 1)
    return res
      .status(400)
      .send('no_version');
  else if (initialVersion.length > 15)
    return res
      .status(400)
      .send('long_version');

  const version = isVersionValid(initialVersion);
  if (!version)
    return res
      .status(400)
      .send('invalid_verison');

  if (validators.isProfane(packageId))
    return res
      .status(400)
      .send('profane_id');
  else if (validators.isProfane(packageName))
    return res
      .status(400)
      .send('profane_name');
  else if (validators.isProfane(description))
    return res
      .status(400)
      .send('profane_desc');

  try {
    const [packageIdExists, packageNameExists] = await Promise.all([
      packageDatabase.packageIdExists(packageId),
      packageDatabase.packageNameExists(packageName)
    ]);

    if (packageIdExists)
      return res
        .status(400)
        .send('id_in_use');
    else if (packageNameExists)
      return res
        .status(400)
        .send('name_in_use');
  } catch (e) {
    console.error(e);
    return res.sendStatus(500);
  }

  const [n, awsId] = await Promise.all([nanoid(32), nanoid(64)]);

  // const destFile = path.join(os.tmpdir(), 'unzipped', n, packageId + '.zip');
  // const outFile = path.join(os.tmpdir(), 'xpkg', n, packageId + '.xpkg');
  const destFile = path.join('/Users', 'arkinsolomon', 'Desktop', 'X_PKG_TMP_DIR', 'unzipped', n, packageId);
  const outFile = path.join('/Users', 'arkinsolomon', 'Desktop', 'X_PKG_TMP_DIR', 'xpkg-files', n, awsId + '.xpkg');

  // Process the package
  try {
    await fs
      .createReadStream(file.path)
      .pipe(unzip.Extract({ path: destFile }))
      .promise();
    await fileProcessor(destFile, outFile, author.id, packageName, packageId, version, packageType);
  } catch (e) {
    console.error(e);
    return res
      .status(422)
      .send('invalid_package');
  }

  // Upload the package and add it to the database
  try {
    const fileBuffer = await fsProm.readFile(outFile);
    const hashSum = crypto.createHash('sha256');
    hashSum.update(fileBuffer);
    const hash = hashSum.digest('hex');

    const putCmd = new PutObjectCommand({
      Bucket: bucketName,
      Key: awsId,
      Body: fileBuffer
    });
    await s3client.send(putCmd);

    await Promise.all([
      packageDatabase.addPackage(packageId, packageName, author, description, packageType),
      packageDatabase.addPackageVersion(packageId, version, author, hash, `https://xpkgregistrydev.s3.us-east-2.amazonaws.com/${awsId}`, {
        isPublished: publishedPackage,
        isPrivate: privatePackage
      })
    ]);

    author.sendEmail('Package uploaded!', 'Idk i haven\'t written this yet BUT you uploaded a package lol so');

    return res.sendStatus(204);
  } catch (e) {
    console.error(e);
    return res.sendStatus(500);
  }
});

/**
 * Check the type of a variable and throw an exception if they don't match.
 * 
 * @param {*} variable The variable to check the type of.
 * @param {string} type The type that the variable is expected to be. 
 */
function checkType(variable: unknown, type: string): void {
  if (typeof variable !== type)
    throw new Error('Types don\'t match');
}

export default route;