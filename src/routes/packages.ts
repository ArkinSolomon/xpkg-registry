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
import fs from 'fs';
import Author from '../author.js';
import * as validators from '../util/validators.js';
import Version from '../util/version.js';
import * as packageDatabase from '../database/packageDatabase.js';
import { FileProcessorData } from '../workers/fileProcessor.js';
import logger from '../logger.js';
import { Worker } from 'worker_threads';
import { rm } from 'fs/promises';
import { customAlphabet } from 'nanoid/async';
import { isMainThread } from 'worker_threads';
import SelectionChecker from '../util/selectionChecker.js';
import NoSuchPackageError from '../errors/noSuchPackageError.js';
import InvalidPackageError from '../errors/invalidPackageError.js';
import { PackageData, PackageType } from '../database/models/packageModel.js';
import { VersionStatus } from '../database/models/versionModel.js';

const storeFile = path.resolve('./data.json');
const route = Router();

const UPLOAD_PATH = path.resolve(os.tmpdir(), 'xpkg-downloads');

if (isMainThread) {
  if (fs.existsSync(UPLOAD_PATH))
    await rm(UPLOAD_PATH, { recursive: true, force: true });
}
const upload = multer({ dest: UPLOAD_PATH });

const FILE_PROCESSOR_WORKER_PATH = path.resolve('.', 'dist', 'workers', 'fileProcessor.js');

export const unzippedFilesLocation = path.join('/Users', 'arkinsolomon', 'Desktop', 'X_PKG_TMP_DIR', 'unzipped');
export const xpkgFilesLocation = path.join('/Users', 'arkinsolomon', 'Desktop', 'X_PKG_TMP_DIR', 'xpkg-files');

const privateKeyNanoid = customAlphabet('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789');

route.get('/', (_, res) => {
  res.sendFile(storeFile);
});

route.get('/:packageId/:version', async (req, res) => {
  const { packageId, version: versionString } = req.params as {
    packageId: string;
    version: string;
  };

  const version = Version.fromString(versionString);
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

route.post('/new', upload.none(), async (req, res) => {
  const author = req.user as Author;

  const routeLogger = logger.child({
    ip: req.ip || req.socket.remoteAddress,
    authorId: author.id,
    body: req.body,
    route: '/packages/new'
  });
  routeLogger.info('New package requested, will validate fields');

  let packageId: string;
  let packageName: string;
  let description: string;
  let packageTypeStr: string;

  try {
    packageId = req.body.packageId.trim().toLowerCase();
    packageName = req.body.packageName.trim();
    description = req.body.description.trim();
    packageTypeStr = req.body.packageType.trim().toLowerCase();

    checkType(packageId, 'string');
    checkType(packageName, 'string');
    checkType(packageTypeStr, 'string');
    checkType(description, 'string');
  } catch {
    routeLogger.info('Missing form data (missing_form_data)');
    return res
      .status(400)
      .send('missing_form_data');
  }

  let packageType: PackageType;
  try {
    packageType = getPackageType(packageTypeStr);
  } catch {
    routeLogger.info('Invalid package type string provided (invalid_package_type)');
    return res
      .status(400)
      .send('invalid_package_type');
  }

  if (packageId.length < 6) {
    routeLogger.info('Package id too short (short_id)');
    return res
      .status(400)
      .send('short_id');
  }
  else if (packageId.length > 32) {
    routeLogger.info('Package id too long (long_id)');
    return res
      .status(400)
      .send('long_id');
  }
  else if (!validateId(packageId)) { 
    routeLogger.info('Invalid package id (invalid_id)');
    return res
      .status(400)
      .send('invalid_id');
  }

  if (packageName.length < 3) {
    routeLogger.info('Package name too short (short_name)');
    return res
      .status(400)
      .send('short_name');
  }
  else if (packageName.length > 32) {
    routeLogger.info('Package name too long (long_name)');
    return res
      .status(400)
      .send('long_name');
  }

  if (description.length < 10) {
    routeLogger.info('Description too short (short_desc)');
    return res
      .status(400)
      .send('short_desc');
  }
  else if (description.length > 8192) {
    routeLogger.info('Description too long (long_desc)');
    return res
      .status(400)
      .send('long_desc');
  }

  if (validators.isProfane(packageId)) {
    routeLogger.info('Profane package id provided (profane_id)');
    return res
      .status(400)
      .send('profane_id');
  }
  else if (validators.isProfane(packageName)) {
    routeLogger.info('Profane package name provided (profane_name)');
    return res
      .status(400)
      .send('profane_name');
  }
  else if (validators.isProfane(description)) {
    routeLogger.info('Profanity in description (profane_desc)');
    return res
      .status(400)
      .send('profane_desc');
  }

  try {
    const [packageIdExists, packageNameExists] = await Promise.all([
      packageDatabase.packageIdExists(packageId),
      packageDatabase.packageNameExists(packageName)
    ]);

    if (packageIdExists) {
      routeLogger.info('Package id already in use (id_in_use)');
      return res
        .status(400)
        .send('id_in_use');
    }
    else if (packageNameExists) {
      routeLogger.info('Package name already in use (name_in_use)');
      return res
        .status(400)
        .send('name_in_use');
    }

    await packageDatabase.addPackage(packageId, packageName, author, description, packageType);
    routeLogger.info('Registered new package in database');

    res.sendStatus(204);
  } catch (e) {
    routeLogger.error(e);
    return res.sendStatus(500);
  } 
});

route.post('/upload', upload.single('file'), async (req, res) => {
  const file = req.file;
  const author = req.user as Author;

  const routeLogger = logger.child({
    ip: req.ip || req.socket.remoteAddress,
    authorId: author.id,
    body: req.body,
    route: '/packages/upload'
  });
  routeLogger.debug('New version upload request, will validate fields');

  let packageId: string;
  let packageVersion: string;
  let xplaneSelectionStr: string;
  let isPublic: boolean;
  let isPrivate: boolean;
  let isStored: boolean;
  let dependencies: [string, string][];
  let incompatibilities: [string, string][];

  try {
    packageId = req.body.packageId.trim().toLowerCase();
    packageVersion = req.body.packageVersion.trim().toLowerCase();
    xplaneSelectionStr = req.body.xplaneSelection.trim().toLowerCase();

    isPublic = typeof req.body.isPublic === 'string' && req.body.isPublic === 'true';
    isPrivate = typeof req.body.isPrivate === 'string' && req.body.isPrivate === 'true';
    isStored = typeof req.body.isStored === 'string' && req.body.isStored === 'true';

    dependencies = typeof req.body.dependencies === 'string' && JSON.parse(req.body.dependencies);
    incompatibilities = typeof req.body.incompatibilities === 'string' && JSON.parse(req.body.incompatibilities);
  } catch {
    routeLogger.info('Missing form data (missing_form_data)');
    return res
      .status(400)
      .send('missing_form_data');
  }

  if (!file) {
    routeLogger.info('No file uploaded (no_file)');
    return res
      .status(400)
      .send('no_file');
  }

  if (packageId.length < 6) {
    routeLogger.info('Package id too short (short_id)');
    return res
      .status(400)
      .send('short_id');
  }
  else if (packageId.length > 32) {
    routeLogger.info('Package id too long (long_id)');
    return res
      .status(400)
      .send('long_id');
  }
  else if (!validateId(packageId)) { 
    routeLogger.info('Invalid package id (invalid_id)');
    return res
      .status(400)
      .send('invalid_id');
  }

  if (packageVersion.length < 1) {
    routeLogger.info('No version provided (no_version)');
    return res
      .status(400)
      .send('no_version');
  }
  else if (packageVersion.length > 15) {
    routeLogger.info('Version too long (long_version)');
    return res
      .status(400)
      .send('long_version');
  }

  const version = Version.fromString(packageVersion);
  if (!version) {
    routeLogger.info('Invalid version provided (invalid_verison)');
    return res
      .status(400)
      .send('invalid_verison');
  }

  if (isPublic && (isPrivate || !isStored)) {
    routeLogger.info('Invalid access config (invalid_access_config)');
    return res
      .status(400)
      .send('invalid_access_config');
  }

  const xplaneSelection = new SelectionChecker(xplaneSelectionStr);
  if (!xplaneSelectionStr.length) {
    routeLogger.info('X-Plane selection string is empty (empty_xp_sel)');
    return res
      .status(400)
      .send('empty_xp_sel');
  } else if (xplaneSelectionStr.length > 256) {
    routeLogger.info('X-Plane selection string is too long (long_xp_sel)');
    return res
      .status(400)
      .send('long_xp_sel');
  } else if (!xplaneSelection.isValid) {
    routeLogger.info('Invalid X-Plane selection (invalid_xp_sel)');
    return res
      .status(400)
      .send('invalid_xp_sel');
  }

  try {
    const authorHasPackage = await author.hasPackage(packageId);

    if (!authorHasPackage) {
      routeLogger.info('Author does not own package (unowned_pkg)');
      return res
        .status(400)
        .send('unowned_pkg');
    }
    const authorPackages = await author.getPackages();
    const thisPackage = authorPackages.find(p => p.packageId === packageId) as PackageData;

    const versionExists = await packageDatabase.versionExists(packageId, version);

    if (versionExists) {
      routeLogger.info('Version already exists');
      return res
        .status(400)
        .send('version_exists');
    }

    const xpSelection = xplaneSelection.toString();
    await packageDatabase.addPackageVersion(packageId, version, {
      isPublic: isPublic,
      isStored: isStored,
      privateKey: !isPublic && isStored ? await privateKeyNanoid(32) : void (0)
    }, dependencies, incompatibilities, xpSelection);

    routeLogger.debug('Registered package version in database');

    const fileProcessorData: FileProcessorData = {
      zipFileLoc: file.path,
      authorId: author.id,
      packageName: thisPackage.packageName,
      packageId,
      packageVersion: version.toString(),
      packageType: thisPackage.packageType,
      dependencies,
      incompatibilities,
      accessConfig: {
        isPublic,
        isPrivate,
        isStored
      },
      xpSelection
    };

    const worker = new Worker(FILE_PROCESSOR_WORKER_PATH, { workerData: fileProcessorData });
    worker.on('message', v => {
      if (v === 'started') {
        routeLogger.debug('Package processing started');
        res.sendStatus(204);
      }
    });

    worker.on('error', err => {
      routeLogger.error(err, 'Error while processing package');
    });
  } catch (e) {
    if (e instanceof InvalidPackageError) {
      logger.info(e, 'Invalid access config caught after database feeding');
      return res
        .status(400)
        .send(e.shortMessage);
    }

    routeLogger.error(e);
    return res.sendStatus(500);
  }
});

route.post('/retry', upload.single('file'), async (req, res) => {
  const file = req.file;
  const author = req.user as Author;

  const routeLogger = logger.child({
    ip: req.ip || req.socket.remoteAddress,
    authorId: author.id,
    body: req.body,
    route: '/packages/retry'
  });
  routeLogger.debug('Processing retry request');

  if (!file) {
    routeLogger.info('No file uploaded (no_file)');
    return res
      .status(400)
      .send('no_file');
  }

  const { packageVersion } = req.body as {
    packageId?: string;
    packageVersion?: string;
  };
  let { packageId } = req.body;

  if (!packageId || !packageVersion) {
    routeLogger.info('Missing form data (missing_form_data)');
    return res
      .status(400)
      .send('missing_form_data');
  }

  try {
    checkType(packageId, 'string');
    checkType(packageVersion, 'string');
  } catch (e) {
    routeLogger.info(e, 'Invalid form data provided (invalid_form_data)');
    return res
      .status(400)
      .send('invalid_form_data');
  }

  packageId = packageId.trim().toLowerCase();
  const version = Version.fromString(packageVersion);
  if (!version) {
    routeLogger.info('Invalid package version (invalid_version)');
    return res
      .status(400)
      .send('invalid_version');
  }

  try {
    const authorPackages = await author.getPackages();

    const thisPackage = authorPackages.find(p => p.packageId === packageId);
    if (!thisPackage) {
      routeLogger.info('Author does not own package, or it doesn\'t exist (no_package)');
      return res
        .status(400)
        .send('no_package');
    }
  
    const versionData = await packageDatabase.getVersionData(packageId, version);
    routeLogger.debug('Got version data');

    if (versionData.status === VersionStatus.Processed || versionData.status === VersionStatus.Processing) {
      routeLogger.info('Author is attempting to re-upload non-failed package');
      return res
        .status(400)
        .send('cant_retry');
    }

    routeLogger.debug('Setting version status back to processing');
    await packageDatabase.updateVersionStatus(packageId, version, VersionStatus.Processing);

    const fileProcessorData: FileProcessorData = {
      zipFileLoc: file.path,
      authorId: author.id,
      packageName: thisPackage.packageName,
      packageId,
      packageVersion: version.toString(),
      packageType: thisPackage.packageType,
      dependencies: versionData.dependencies,
      incompatibilities: versionData.incompatibilities,
      accessConfig: {
        isPublic: versionData.isPublic,
        isPrivate: !versionData.isPublic,
        isStored: versionData.isStored,
      },
      xpSelection: versionData.xpSelection
    };

    const worker = new Worker(FILE_PROCESSOR_WORKER_PATH, { workerData: fileProcessorData });
    worker.on('message', v => {
      if (v === 'started') {
        routeLogger.debug('Package processing started');
        res.sendStatus(204);
      }
    });

    worker.on('error', err => {
      routeLogger.error(err, 'Error while processing package');
    });
  } catch (e) {
    if (e instanceof NoSuchPackageError) {
      routeLogger.info('Version does not exist (no_version)');
      return res
        .status(400)
        .send('no_version');
    }

    routeLogger.error(e, 'Error while attempting to get version data');
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