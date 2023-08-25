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
import * as validators from '../util/validators.js';
import Version from '../util/version.js';
import * as packageDatabase from '../database/packageDatabase.js';
import { FileProcessorData } from '../workers/fileProcessor.js';
import logger from '../logger.js';
import { Worker } from 'worker_threads';
import { rm } from 'fs/promises';
import { customAlphabet } from 'nanoid/async';
import { isMainThread } from 'worker_threads';
import SelectionChecker from '../util/versionSelection.js';
import NoSuchPackageError from '../errors/noSuchPackageError.js';
import { PackageData, PackageType } from '../database/models/packageModel.js';
import { VersionStatus } from '../database/models/versionModel.js';
import AuthToken from '../auth/authToken.js';
import InvalidListError from '../errors/invalidListError.js';
import { body, matchedData, param, validationResult } from 'express-validator';
import VersionSelection from '../util/versionSelection.js';

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

route.get('/info/:packageId/:version',
  validators.isPartialPackageId(param('packageId')),
  validators.asVersion(param('version')),
  async (req, res) => {
    const result = validationResult(req);
    if (!result.isEmpty())
      return res.sendStatus(400);
  
    const { packageId, version } = matchedData(req) as {
      version: Version,
      packageId: string
    };

    try {
      // TODO: Make sure we don't send private or unprocessed packages
      const versionData = await packageDatabase.getVersionData(packageId, version);
      res
        .status(200)
        .json({
          loc: versionData.loc,
          hash: versionData.hash,
          dependencies: versionData.dependencies,
          incompatibilities: versionData.incompatibilities
        });
    } catch (e) {
      if (e instanceof NoSuchPackageError) 
        return res.sendStatus(404);
      logger.error(e);
    }
  });

route.patch('/description',
  validators.asPartialXpkgPackageId(body('packageId')),
  validators.isValidDescription(body('newDescription')),
  async (req, res) => {
    const token = req.user as AuthToken;

    const routeLogger = logger.child({
      ip: req.ip,
      route: '/packages/description',
      authorId: token.authorId,
      requestId: req.id
    });
    routeLogger.debug('Author wants to update package description');

    const result = validationResult(req);
    if (!result.isEmpty()) {
      const message = result.array()[0].msg;
      routeLogger.info(`Validation failed with message: ${message}`);
      return res
        .status(400)
        .send(message);
    }

    const { newDescription, packageId } = matchedData(req) as {
      newDescription: string;
      packageId: string;
    };

    try {
      routeLogger.setBindings({ packageId });

      if (!token.canUpdatePackageDescription(packageId)) {
        routeLogger.info('Insufficient permissions to update package description');
        return res.sendStatus(401);
      }

      const author = await token.getAuthor();

      // We want to make sure they're updating the description for a package that they own
      if (!(await packageDatabase.doesAuthorHavePackage(token.authorId, packageId))) {
        routeLogger.info('Author does not own package');
        return res.sendStatus(403);
      }

      await packageDatabase.updateDescription(packageId, newDescription);
      res.sendStatus(204);

      const { packageName } = await packageDatabase.getPackageData(packageId);
      author.sendEmail(`X-Pkg: '${packageName}' Description updated`, `The description has been updated for the package '${packageName}' (${packageId}).`);
    } catch (e) {
      console.error(e);
      res.sendStatus(500);
    }
  });

route.post('/new', 
  validators.isPartialPackageId(body('packageId')),
  validators.isValidName(body('packageName')),
  validators.isValidDescription(body('description')),
  validators.asPackageType(body('packageType')),
  async (req, res) => {
    const token = req.user as AuthToken;
    const routeLogger = logger.child({
      ip: req.ip,
      authorId: token.authorId,
      route: '/packages/new'
    });
    routeLogger.debug('New package requested, will validate fields');

    const result = validationResult(req);
    if (!result.isEmpty()) {
      const message = result.array()[0].msg;
      routeLogger.info(`Validation failed with message: ${message}`);
      return res
        .status(400)
        .send(message);
    }

    const { packageName, packageId, description, packageType } = matchedData(req) as {
      packageName: string;
      packageId: string;
      description: string;
      packageType: PackageType;
    };

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

      await packageDatabase.addPackage(packageId, packageName, token.authorId, (await token.getAuthor()).authorName, description, packageType);
      routeLogger.info('Registered new package in database');

      res.sendStatus(204);
    } catch (e) {
      routeLogger.error(e);
      return res.sendStatus(500);
    } 
  });

route.post('/upload',
  upload.single('file'),
  validators.asPartialXpkgPackageId(body('packageId')),
  validators.asVersion(body('packageVersion')),
  validators.asVersionSelection(body('xpSelection')),
  body('isPublic').isBoolean().withMessage('not_bool'),
  body('isPrivate').isBoolean().withMessage('not_bool'),
  body('isStored').isBoolean().withMessage('not_bool'),
  body('dependencies').customSanitizer(v => JSON.parse(v)).isArray({
    min: 0,
    max: 128
  }).withMessage('bad_dep_arr'),
  body('incompatibilities').customSanitizer(v => JSON.parse(v)).isArray({
    min: 0,
    max: 128
  }).withMessage('bad_inc_arr'),
  async (req, res) => {
    const file = req.file;
    const token = req.user as AuthToken;

    const routeLogger = logger.child({
      ip: req.ip,
      authorId: token.authorId,
      route: '/packages/upload',
      id: req.id
    });
    routeLogger.debug('New version upload request, will validate fields');

    const fileDeleteCb = async () => {
      if (file) {
        routeLogger.debug('Forcefully deleting downloaded file on finish');
        await rm(file.path, { force: true });
      } else 
        routeLogger.debug('Will not forcefully delete downloaded file');
    };
    res.once('finish', fileDeleteCb);

    const result = validationResult(req);
    if (!result.isEmpty()) {
      const message = result.array()[0].msg;
      routeLogger.info(`Validation failed with message: ${message}`);
      return res
        .status(400)
        .send(message);
    }

    const data = matchedData(req) as {
      packageId: string;
      packageVersion: Version;
      xpSelection: VersionSelection;
      isPublic: boolean;
      isPrivate: boolean;
      isStored: boolean;
      dependencies: [string, string][];
      incompatibilities: [string, string][];
    };
    const { packageId, packageVersion, xpSelection, isPublic, isPrivate, isStored } = data;
    let { incompatibilities, dependencies } = data;

    if (!file) {
      routeLogger.info('No file uploaded (no_file)');
      return res
        .status(400)
        .send('no_file');
    }

    if (!token.canUploadPackageVersion(packageId)) {
      routeLogger.info('Insufficient permissions to upload a package version');
      return res.sendStatus(401);
    }

    try {
      [dependencies, incompatibilities] = validateLists(packageId, dependencies, incompatibilities);

      const author = await token.getAuthor();
      const authorHasPackage = await packageDatabase.doesAuthorHavePackage(author.authorId, packageId);

      if (!authorHasPackage) {
        routeLogger.info('Author does not own package');
        return res.status(403);
      }
      const authorPackages = await packageDatabase.getAuthorPackages(author.authorId);
      const thisPackage = authorPackages.find(p => p.packageId === packageId) as PackageData;

      const versionExists = await packageDatabase.versionExists(packageId, packageVersion);

      if (versionExists) {
        routeLogger.info('Version already exists');
        return res
          .status(400)
          .send('version_exists');
      }

      await packageDatabase.addPackageVersion(packageId, packageVersion, {
        isPublic: isPublic,
        isStored: isStored,
        privateKey: !isPublic && isStored ? await privateKeyNanoid(32) : void (0)
      }, dependencies, incompatibilities, xpSelection);

      routeLogger.debug('Registered package version in database');

      const fileProcessorData: FileProcessorData = {
        zipFileLoc: file.path,
        authorId: author.authorId,
        packageName: thisPackage.packageName,
        packageId,
        packageVersion: packageVersion.toString(),
        packageType: thisPackage.packageType,
        dependencies,
        incompatibilities,
        accessConfig: {
          isPublic,
          isPrivate,
          isStored
        },
        xpSelection: xpSelection.toString()
      };

      res.removeListener('finish', fileDeleteCb);
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
      if (e instanceof InvalidListError) {
        routeLogger.info(e.message);
        return res
          .status(400)
          .send(e.response);
      }

      routeLogger.error(e);
      return res.sendStatus(500);
    }
  });

route.post('/retry',
  upload.single('file'),
  validators.asPartialXpkgPackageId(body('packageId')),
  validators.asVersion(body('packageVersion')),
  async (req, res) => {
    const file = req.file;
    const token = req.user as AuthToken;

    const routeLogger = logger.child({
      ip: req.ip,
      authorId: token.authorId,
      route: '/packages/retry'
    });
    routeLogger.debug('Processing retry request');

    if (!file) {
      routeLogger.info('No file uploaded (no_file)');
      return res
        .status(400)
        .send('no_file');
    }

    const result = validationResult(req);
    if (!result.isEmpty()) {
      const message = result.array()[0].msg;
      routeLogger.info(`Validation failed with message: ${message}`);
      return res
        .status(400)
        .send(message);
    }

    const { packageId, packageVersion } = matchedData(req) as {
      packageId: string;
      packageVersion: Version;
    };

    try {
      const author = await token.getAuthor();
      const authorPackages = await packageDatabase.getAuthorPackages(author.authorId);

      if (!token.canUploadPackageVersion(packageId)) {
        routeLogger.info('Insufficient permissions to retry upload');
        await rm(file.path, { force: true });
        return res.sendStatus(401);
      }

      const thisPackage = authorPackages.find(p => p.packageId === packageId);
      if (!thisPackage) {
        routeLogger.info('Author does not own package, or it doesn\'t exist (no_package)');
        return res
          .status(400)
          .send('no_package');
      }
  
      const versionData = await packageDatabase.getVersionData(packageId, packageVersion);
      routeLogger.debug('Got version data');

      if (versionData.status === VersionStatus.Processed || versionData.status === VersionStatus.Processing) {
        routeLogger.info('Author is attempting to re-upload non-failed package');
        return res
          .status(400)
          .send('cant_retry');
      }

      routeLogger.debug('Setting version status back to processing');
      await packageDatabase.updateVersionStatus(packageId, packageVersion, VersionStatus.Processing);

      const fileProcessorData: FileProcessorData = {
        zipFileLoc: file.path,
        authorId: author.authorId,
        packageName: thisPackage.packageName,
        packageId,
        packageVersion: packageVersion.toString(),
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
        routeLogger.info(e, 'Version does not exist (version_not_exist)');
        return res
          .status(400)
          .send('version_not_exist');
      }

      routeLogger.error(e, 'Error while attempting to get version data');
      return res.sendStatus(500);
    }
  });

route.patch('/incompatibilities',
  validators.asPartialXpkgPackageId(body('packageId')),
  validators.asVersion(body('packageVersion')),
  body('incompatibilities').isArray({
    min: 0,
    max: 128
  }),
  async (req, res) => {
    const token = req.user as AuthToken;

    const routeLogger = logger.child({
      ip: req.ip,
      authorId: token.authorId,
      route: '/packages/incompatibilities'
    });
    
    const result = validationResult(req);
    if (!result.isEmpty()) {
      const message = result.array()[0].msg;
      routeLogger.trace(result);
      routeLogger.info(`Validation failed with message: ${message}`);
      return res
        .status(400)
        .send(message);
    }

    const data = matchedData(req) as {
      packageId: string;
      packageVersion: Version;
      incompatibilities: [string, string][];
    };
    const { packageId, packageVersion } = data;
    let { incompatibilities } = data;

    routeLogger.setBindings({
      packageId,
      version: packageVersion.toString()
    });

    if (!token.canUpdateVersionData(packageId)) {
      routeLogger.info('Insufficient permissions to update incompatibilities');
      return res.sendStatus(401);
    }

    try {
      const versionData = await packageDatabase.getVersionData(packageId, packageVersion);

      [, incompatibilities] = validateLists('xpkg/' + packageId, versionData.dependencies, incompatibilities);
    } catch (e) {
      if (e instanceof NoSuchPackageError) {
        routeLogger.info(e, 'No such package found');
        return res.sendStatus(401);
      }

      if (e instanceof InvalidListError) {
        routeLogger.info(e.message);
        return res
          .status(400)
          .send(e.response);
      }

      routeLogger.error(e);
      return res.sendStatus(500);
    }

    try {
      await packageDatabase.updateVersionIncompatibilities(packageId, packageVersion, incompatibilities);
      routeLogger.info('Incompatibilities updated successfully');
      res.sendStatus(204);
    } catch (e) {
      logger.error(e);
      return res.sendStatus(500);
    }
  });

route.patch('/xpselection',
  validators.asPartialXpkgPackageId(body('packageId')),
  validators.asVersion(body('packageVersion')),
  validators.asVersionSelection(body('xpSelection')),
  async (req, res) => {
    const token = req.user as AuthToken;

    const routeLogger = logger.child({
      ip: req.ip,
      authorId: token.authorId,
      route: '/packages/xpselection'
    });

    const result = validationResult(req);
    if (!result.isEmpty()) {
      const message = result.array()[0].msg;
      routeLogger.info(`Validation failed with message: ${message}`);
      return res
        .status(400)
        .send(message);
    }

    const { packageId, packageVersion, xpSelection } = matchedData(req) as {
      packageId: string;
      packageVersion: Version;
      xpSelection: VersionSelection;
    };

    routeLogger.setBindings({
      packageId,
      packageVersion,
      newXpSel: xpSelection.toString()
    });

    if (!token.canUpdateVersionData(packageId)) {
      routeLogger.info('Insufficient permissions to update incompatibilities');
      return res.sendStatus(401);
    }

    try {
      await packageDatabase.updateVersionXPSelection(packageId, packageVersion, xpSelection); 
      routeLogger.info('X-Plane version updated successfully');
      res.sendStatus(204);
    } catch (e) {
      if (e instanceof NoSuchPackageError) {
        routeLogger.info(e, 'No such package found');
        return res.sendStatus(401);
      }

      routeLogger.error(e);
      return res.sendStatus(500);
    }
  });

/**
 * Validate and simplify the dependency and incompatibility lists. Merges duplicates, and disallows the same identifier in both lists. Also enforces list-schema, and prevents self-dependency and self-incompatibilities.
 * 
 * @param {string} packageId The full package identifier of the package which these lists are for.
 * @param {[string, string][]} dependencies The client-provided dependency list, which is an array of tuples, where the first element is the full identifier of the dependency, and the second element is the selection of the dependency.
 * @param {[string, string][]} incompatibilities The client-provided incompatibility list, which is an array of tuples, where the first element is the full identifier of the incompatibility, and the second element is the selection of the incompatibility.
 * @returns {[[string, string][], [string, string][]]} A tuple of two lists of tuples, where the first element is a list of tuples is the new (simplified) dependency list, and the second element is also a list of tuples, which is the new (simplified) incompatibility list.
 */
function validateLists(packageId: string, dependencies: [string, string][], incompatibilities: [string, string][]): [[string, string][], [string, string][]] {
  
  const dependencyMap: Map<string, string> = new Map();
  for (const dependency of dependencies) {
    if (!Array.isArray(dependency) || dependency.length !== 2)
      throw new InvalidListError('bad_dep_tuple', 'Bad dependency tuple');

    let dependencyId = dependency[0].trim().toLowerCase();
    const dependencySelection = dependency[1];
  
    if (typeof dependencyId !== 'string' || typeof dependencySelection !== 'string')
      throw new InvalidListError('invalid_dep_tuple_types', 'Dependency tuple contains invalid types');
  
    if (!validators.validateId(dependencyId))
      throw new InvalidListError('invalid_dep_tuple_id', 'Dependency tuple contains invalid identifier');
      
    if (!dependencyId.includes('/'))
      dependencyId = 'xpkg/' + dependencyId;
      
    if (dependencyId === packageId)
      throw new InvalidListError('self_dep', 'Declared dependency is self');
  
    if (dependencyMap.has(dependencyId)) {
      const oldSelection = dependencyMap.get(dependencyId);
      dependencyMap.set(dependencyId, oldSelection + ',' + dependencySelection);
    } else
      dependencyMap.set(dependencyId, dependencySelection);
  }

  const dependencyIdList = dependencies.map(d => d[0]);
  const incompatibilityMap: Map<string, string> = new Map();

  for (const incompatibility of incompatibilities) {
    if (!Array.isArray(incompatibility) || incompatibility.length !== 2)
      throw new InvalidListError('bad_inc_tuple', 'Bad incompatibility tuple');

    let incompatibilityId = incompatibility[0].trim().toLowerCase();
    const incompatibilitySelection = incompatibility[1];

    if (typeof incompatibilityId !== 'string' || typeof incompatibilitySelection !== 'string')
      throw new InvalidListError('invalid_inc_tuple_types', 'Incompatibility tuple contains invalid types');

    if (!validators.validateId(incompatibilityId))
      throw new InvalidListError('invalid_inc_tuple_id', 'Incompatibility tuple contains invalid identifier');
    
    if (!incompatibilityId.includes('/'))
      incompatibilityId = 'xpkg/' + incompatibilityId;
    
    if (incompatibilityId === packageId || dependencyIdList.includes(incompatibilityId))
      throw new InvalidListError('dep_or_self_inc', 'Declared incompatibility is self or a dependency');

    if (incompatibilityMap.has(incompatibilityId)) {
      const oldSelection = incompatibilityMap.get(incompatibilityId);
      incompatibilityMap.set(incompatibilityId, oldSelection + ',' + incompatibilitySelection);
    } else
      incompatibilityMap.set(incompatibilityId, incompatibilitySelection);
  }

  // Make sure we simplify all selections before putting them back into the database
  const newDependencies = Array.from(dependencyMap.entries());
  newDependencies.forEach(d => {
    const selection = new SelectionChecker(d[1]);
    if (!selection.isValid)
      throw new InvalidListError('invalid_dep_sel', 'Invalid dependency selection for ' + d[0]);

    d[1] = selection.toString();
  });

  const newIncompatibilities = Array.from(incompatibilityMap.entries());
  newIncompatibilities.forEach(i => {
    const selection = new SelectionChecker(i[1]);
    if (!selection.isValid)
      throw new InvalidListError('invalid_inc_sel', 'Invalid incompatibility selection for ' + i[0]);

    logger.warn(newIncompatibilities);
    i[1] = selection.toString();
  });

  return [newDependencies, newIncompatibilities];
}

export default route;