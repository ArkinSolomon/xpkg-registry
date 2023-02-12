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

import path from 'path';
import { Router } from 'express';
import multer from 'multer';
import os from 'os';
import fsProm from 'fs/promises';
import { nanoid, customAlphabet } from 'nanoid/async';
import decompress from 'decompress';
import crypto from 'crypto';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import Author from '../author.js';
import * as validators from '../util/validators.js';
import isVersionValid, { Version, versionStr } from '../util/version.js';
import fileProcessor from '../util/fileProcessor.js';
import packageDatabase from '../database/mysqlPackageDB.js';
import { PackageType } from '../database/packageDatabase.js';

const storeFile = path.resolve('./data.json');
const route = Router();
const upload = multer({ dest: os.tmpdir() });

const privateKeyNanoId = customAlphabet('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789');

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

  try {
    const versionData = await packageDatabase.getVersionData(packageId, version);

    if (!versionData.isPublic)
      return res.sendStatus(404);

    res
      .status(200)
      .json({
        loc: versionData.loc,
        hash: versionData.hash,
        dependencies: versionData.dependencies,
        optionalDependencies: versionData.optionalDependencies,
        incompatibilities: versionData.incompatibilities
      });
  } catch {
    return res.sendStatus(404);
  }
});


route.put('/description', async (req, res) => {
  const author = req.user as Author;

  if (!req.body.newDescription)
    return res
      .status(400)
      .send('no_desc');

  if (!req.body.packageId)
    return res
      .status(400)
      .send('no_id');

  let packageId, newDescription;
  try {
    checkType(req.body.packageId, 'string');
    checkType(req.body.newDescription, 'string');

    packageId = req.body.packageId.trim().toLowerCase();
    newDescription = req.body.newDescription.trim();
  } catch (e) {
    return res
      .status(400)
      .send('invalid_type');
  }

  if (newDescription.length < 10)
    return res
      .status(400)
      .send('short_desc');
  else if (newDescription.length > 8192)
    return res
      .status(400)
      .send('long_desc');

  try {

    // We want to make sure they're updating the description for a package that they own
    if (!(await author.hasPackage(packageId)))
      return res.sendStatus(403);

    await packageDatabase.updateDescription(packageId, newDescription);

    res.sendStatus(204);

    const { packageName } = await packageDatabase.getPackageData(packageId);
    author.sendEmail(`X-Pkg: '${packageName}' Description updated`, `Description updated for the package '${packageName}' (${packageId}).`);
  } catch (e) {
    console.error(e);
    res.sendStatus(500);
  }
});

route.post('/new', upload.single('file'), async (req, res) => {
  const file = req.file;
  const author = req.user as Author;

  let packageId: string;
  let packageName: string;
  let packageTypeStr: string;
  let description: string;
  let initialVersion: string;
  let xplaneVersion: string;
  let isPublic: boolean;
  let isPrivate: boolean;
  let isStored: boolean;
  let dependencies: [string, string][];
  let optionalDependencies: [string, string][];
  let incompatibilities: [string, string][];

  try {
    packageId = req.body.packageId.trim().toLowerCase();
    packageName = req.body.packageName.trim();

    packageTypeStr = req.body.packageType.trim().toLowerCase();

    description = req.body.description.trim();
    initialVersion = req.body.initialVersion.trim().toLowerCase();
    xplaneVersion = req.body.xplaneVersion.trim().toLowerCase();

    checkType(packageId, 'string');
    checkType(packageName, 'string');
    checkType(packageTypeStr, 'string');
    checkType(description, 'string');
    checkType(initialVersion, 'string');
    checkType(xplaneVersion, 'string');

    isPublic = typeof req.body.isPublic === 'string' && req.body.isPublic === 'true';
    isPrivate = typeof req.body.isPrivate === 'string' && req.body.isPrivate === 'true';
    isStored = typeof req.body.isStored === 'string' && req.body.isStored === 'true';

    dependencies = typeof req.body.dependencies === 'string' && JSON.parse(req.body.dependencies);
    optionalDependencies = typeof req.body.optionalDependencies === 'string' && JSON.parse(req.body.optionalDependencies);
    incompatibilities = typeof req.body.incompatibilities === 'string' && JSON.parse(req.body.incompatibilities);
  } catch (e) {
    console.error(e);
    return res
      .status(400)
      .send('missing_form_data');
  }

  let packageType: PackageType;
  try {
    packageType = getPackageType(packageTypeStr);
  } catch {
    return res
      .status(400)
      .send('invalid_package_type');
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
  else if (!validateId(packageId))
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

  if (isPublic && (isPrivate || !isStored))
    return res
      .status(400)
      .send('invalid_access_config');

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
  const destFile = path.join('/Users', 'arkinsolomon', 'Desktop', 'X_PKG_TMP_DIR', 'unzipped', n);
  const outFile = path.join('/Users', 'arkinsolomon', 'Desktop', 'X_PKG_TMP_DIR', 'xpkg-files', n, awsId + '.xpkg');

  // Process the package
  try {
    await decompress(file.path, destFile);
    
    // Note that destFile is the unzipped file, NOT the target zip file
    await fileProcessor(
      destFile,
      outFile,
      author.id,
      author.name,
      packageName,
      packageId,
      version,
      packageType,
      dependencies,
      optionalDependencies,
      incompatibilities,
    );
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

    if (isStored) {
      const putCmd = new PutObjectCommand({
        Bucket: bucketName,
        Key: awsId,
        Body: fileBuffer
      });
      await s3client.send(putCmd);
    }

    await Promise.all([
      packageDatabase.addPackage(packageId, packageName, author, description, packageType),
      packageDatabase.addPackageVersion(packageId, version, hash, isStored ? `https://xpkgregistrydev.s3.us-east-2.amazonaws.com/${awsId}` : 'NOT_STORED', {
        isPublic: isPublic,
        isStored: isStored
      }, dependencies, optionalDependencies, incompatibilities)
    ]);

    author.sendEmail(`X-Pkg: '${packageName}' published`, `Your package '${packageName}' (${packageId}) was successfully uploaded to the registry.\n\nInitial version: ${versionStr(version)}\nChecksum: ${hash}`);

    return res.sendStatus(204);
  } catch (e) {
    console.error(e);
    return res.sendStatus(500);
  }
});

route.post('/newversion', upload.single('file'), async (req, res) => {
  const author = req.user as Author;
  const file = req.file;
  
  let packageId: string;
  let versionString: string;
  let xplaneVersion: string;
  let isPublic: boolean;
  let isPrivate: boolean;
  let isStored: boolean;
  let dependencies: [string, string][];
  let optionalDependencies: [string, string][];
  let incompatibilities: [string, string][];

  let version: Version | undefined;

  let packageName: string;
  let packageType: PackageType;
  
  try {
    packageId = req.body.packageId.trim().toLowerCase();
    versionString = req.body.versionString.trim().toLowerCase();
    xplaneVersion = req.body.xplaneVersion.trim().toLowerCase();

    checkType(packageId, 'string');
    checkType(versionString, 'string');
    checkType(xplaneVersion, 'string');

    isPublic = typeof req.body.isPublic === 'string' && req.body.isPublic === 'true';
    isPrivate = typeof req.body.isPrivate === 'string' && req.body.isPrivate === 'true';
    isStored = typeof req.body.isStored === 'string' && req.body.isStored === 'true';

    dependencies = typeof req.body.dependencies === 'string' && JSON.parse(req.body.dependencies);
    optionalDependencies = typeof req.body.optionalDependencies === 'string' && JSON.parse(req.body.optionalDependencies);
    incompatibilities = typeof req.body.incompatibilities === 'string' && JSON.parse(req.body.incompatibilities);
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

  try {
    const authorPackages = await packageDatabase.getAuthorPackages(author.id);
    const thisPackage = await authorPackages.find(d => d.packageId === packageId);
    if (!packageId || !thisPackage)
      return res
        .sendStatus(403);
    
    packageName = thisPackage.packageName as string;
    packageType = thisPackage.packageType;

    if (versionString.length < 1)
      return res
        .status(400)
        .send('no_version');
    else if (versionString.length > 15)
      return res
        .status(400)
        .send('long_version');

    version = isVersionValid(versionString);
    if (!version)
      return res
        .status(400)
        .send('invalid_verison');

    const versionExists = await packageDatabase.versionExists(packageId, version);
    if (versionExists)
      return res
        .status(400)
        .send('version_exists');
  } catch (e) {
    console.error(e);
    return res.sendStatus(500);
  }

  if (isPublic && (isPrivate || !isStored))
    return res
      .status(400)
      .send('invalid_access_config');
  
  const [n, awsId] = await Promise.all([nanoid(32), nanoid(64)]);

  // const destFile = path.join(os.tmpdir(), 'unzipped', n, packageId + '.zip');
  // const outFile = path.join(os.tmpdir(), 'xpkg', n, packageId + '.xpkg');
  const destFile = path.join('/Users', 'arkinsolomon', 'Desktop', 'X_PKG_TMP_DIR', 'unzipped', n);
  const outFile = path.join('/Users', 'arkinsolomon', 'Desktop', 'X_PKG_TMP_DIR', 'xpkg-files', n, awsId + '.xpkg');

  try {
    await decompress(file.path, destFile);
    
    // Note that destFile is the unzipped file, NOT the target zip file, outFile is the target zip
    await fileProcessor(
      destFile,
      outFile,
      author.id,
      author.name,
      packageName,
      packageId,
      version,
      packageType,
      dependencies,
      optionalDependencies,
      incompatibilities,
    );
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

    if (isStored) {
      const putCmd = new PutObjectCommand({
        Bucket: bucketName,
        Key: awsId,
        Body: fileBuffer
      });
      await s3client.send(putCmd);
    }

    await packageDatabase.addPackageVersion(packageId, version, hash, isStored ? `https://xpkgregistrydev.s3.us-east-2.amazonaws.com/${awsId}` : 'NOT_STORED', {
      isPublic: isPublic,
      isStored: isStored,
      privateKey: !isPublic && isStored ? await privateKeyNanoId(32) : void (0)
    }, dependencies, optionalDependencies, incompatibilities);

    author.sendEmail(`X-Pkg: '${packageName}' new version uploaded`, `Your package '${packageName}' (${packageId}) had a new version added to it.\n\nNew version: ${versionStr(version)}\nChecksum: ${hash}`);
    
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

/**
 * Get the package type enumeration from a string.
 * 
 * @param {string} packageType The string of the package type.
 * @returns {PackageType} The package type enumeration based on the string.
 * @throws {Error} Error thrown if the package type string is not valid.
 */
function getPackageType(packageType: string): PackageType {
  switch (packageType) {
  case 'aircraft': return PackageType.Aircraft;
  case 'scenery': return PackageType.Scenery;
  case 'plugin': return PackageType.Plugin;
  case 'livery': return PackageType.Livery;
  case 'executable': return PackageType.Livery;
  case 'other': return PackageType.Other;
  default:
    throw new Error(`Invalid package type: "${packageType}"`);
  }
}

/**
 * Check if a package id is valid.
 * 
 * @param {string} id The package id to check.
 * @returns {boolean} True if the package id is valid, otherwise false.
 */
function validateId(id: string): boolean {
  return (id && /^[a-z]([a-z]|[_\-.]|\d){5,31}$/i.test(id)) as boolean;
}

export default route;