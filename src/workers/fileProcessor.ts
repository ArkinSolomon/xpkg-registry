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
 * The data required to process a zip file and create an xpkg file.
 * 
 * @typedef {Object} FileProcessorData
 * @property {string} zipFileLoc The location of the zip file to process.
 * @property {string} authorId The id of the author that is uploading this package version.
 * @property {string} packageName The name of the package that the user provided.
 * @property {string} packageId The id of the package that the user provided.
 * @property {string} packageVersion The version of the package version that the user provided as a string. We can't send Version objects to a worker.
 * @property {PackageType} packageType The type of the package that the user provided.
 * @property {[string, string][]} dependencies The list of dependencies of the package, the name then version selection string.
 * @property {[string, string][]} incompatibilities The list of incompatibilities of the package, the name then version selection string.
 * @property {Object} accessConfig The access config of the package.
 * @property {boolean} accessConfig.isPublic True if the package is public.
 * @property {boolean} accessConfig.isPrivate True if the package is private.
 * @property {boolean} accessConfig.isStored True if the package is stored.
 * @property {boolean} xpSelection The X-Plane selection string.
 */
export type FileProcessorData = {
  zipFileLoc: string;
  authorId: string;
  packageName: string;
  packageId: string;
  packageVersion: string;
  packageType: PackageType;
  dependencies: [string, string][];
  incompatibilities: [string, string][];
  accessConfig: {
    isPublic: boolean;
    isPrivate: boolean;
    isStored: boolean;
  };
  xpSelection: string;
};

import fs from 'fs/promises';
import * as objectStorage from 'oci-objectstorage';
import { ConfigFileAuthenticationDetailsProvider } from 'oci-common';
import { existsSync as exists, rmSync } from 'fs';
import { unlinkSync, lstatSync, Stats, createReadStream} from 'fs';
import path from 'path';
import Version from '../util/version.js';
import loggerBase from '../logger.js';
import { nanoid } from 'nanoid/async';
import { isMainThread, parentPort, workerData } from 'worker_threads';
import * as packageDatabase from '../database/packageDatabase.js';
import * as authorDatabase from '../database/authorDatabase.js';
import hasha from 'hasha';
import JobsServiceManager, { JobData, JobType, PackagingInfo } from './jobsServiceManager.js';
import { unzippedFilesLocation, xpkgFilesLocation } from '../routes/packages.js';
import childProcess from 'child_process';
import { VersionStatus } from '../database/models/versionModel.js';
import { PackageType } from '../database/models/packageModel.js';

if (isMainThread) {
  console.error('Worker files can not be run as part of the main thread');
  process.exit(1); 
}

const { OCI_CONFIG_FILE, COMPARTMENT_ID, PUBLIC_BUCKET_NAME, PRIVATE_BUCKET_NAME, TEMPORARY_BUCKET_NAME } = process.env;
if (!OCI_CONFIG_FILE || !COMPARTMENT_ID || !PUBLIC_BUCKET_NAME || !PRIVATE_BUCKET_NAME || !TEMPORARY_BUCKET_NAME) {
  console.error('Missing environment variable(s) for worker thread');
  parentPort?.emit('missing_env_vars');
  process.exit(1); 
}

const provider = new ConfigFileAuthenticationDetailsProvider(OCI_CONFIG_FILE);
const client = new objectStorage.ObjectStorageClient({ authenticationDetailsProvider: provider });

const data = workerData as FileProcessorData;

const packageVersion = Version.fromString(data.packageVersion) as Version;
const {
  zipFileLoc,
  authorId,
  packageName,
  packageId,
  packageType,
  dependencies,
  accessConfig
} = data;
const [tempId, storageId] = await Promise.all([nanoid(32), nanoid(64)]);

let unzippedFileLoc = path.join(unzippedFilesLocation, tempId);
const xpkgFileLoc = path.join(xpkgFilesLocation, storageId + '.xpkg');
let originalUnzippedRoot: string;

const logger = loggerBase.child({
  packageId,
  packageVersion: packageVersion.toString(),
  tempId,
});

logger.info({
  ...data,
  dependencies: `${data.dependencies.length} dependencies`,
  zipFileLoc,
  unzippedFileLoc
}, 'Starting processing of package');

parentPort?.postMessage('started');

let author = await authorDatabase.getAuthorDoc(authorId);

const jobData: JobData = {
  jobType: JobType.Packaging,
  info: <PackagingInfo>{
    packageId,
    packageVersion: packageVersion.toString()
  }
};
const jobsService = new JobsServiceManager(jobData, logger, abort);
await jobsService.waitForAuthorization();

let fileSize = 0;
let hasUsedStorage = false;
try {
  logger.trace('Calculating unzipped file size');
  const unzippedSize = await getUnzippedFileSize(zipFileLoc);
  logger.info({ unzippedSize}, 'Calculated unzipped file size');

  if (unzippedSize > 17179869184) {
    logger.info('Unzipped zip file is greater than 16 gibibytes, can not continue');
    await Promise.all([
      fs.rm(zipFileLoc, { force: true }),
      packageDatabase.updateVersionStatus(packageId, packageVersion, VersionStatus.FailedFileTooLarge),
      sendFailureEmail(VersionStatus.FailedFileTooLarge)
    ]);
    logger.trace('Deleted zip file, updated database, and notified author');
    process.exit(0);
  }

  logger.trace('Searching for __MACOSX directory');
  const hasMacOSX = await new Promise<boolean>((resolve, reject) => {
    const searchProcess = childProcess.exec(`unzip -l "${zipFileLoc}" | grep "__MACOSX" -c -m 1`);

    searchProcess.on('close', code => {
      resolve(code === 0);
    });

    searchProcess.on('error', reject);
  });

  logger.trace('Decompressig zip file');
  const startTime = new Date();
  await new Promise<void>((resolve, reject) => {
    childProcess.exec(`unzip -qq -d "${unzippedFileLoc}" "${zipFileLoc}" -x "__MACOSX/*" && chown -R $USER "${unzippedFileLoc}" && chmod -R 700 "${unzippedFileLoc}"`, err => {
      if (err)
        reject(err);
      resolve();
    });
  });
  logger.trace(`Zip file decompressed, took ${Date.now() - startTime.getTime()}ms`);
  await fs.rm(zipFileLoc);
  logger.trace('Zip file deleted');

  originalUnzippedRoot = unzippedFileLoc;
  let files = await fs.readdir(unzippedFileLoc);

  // Insufficient permissions to delete __MACOSX directory, so just process the sub-folder
  if (hasMacOSX) {
    logger.trace('__MACOSX directory detected');
    if (files.length !== 1) {
      logger.info('Only __MACOSX file provided');
      await cleanupUnzippedFail(VersionStatus.FailedMACOSX);
      process.exit(0);
    }
    
    const subFolderName = files[0];
    unzippedFileLoc = path.join(unzippedFileLoc, subFolderName as string);
    
    files = await fs.readdir(unzippedFileLoc);
  }

  if (!files.includes(packageId)) {
    logger.info('No directory with package id');
    await cleanupUnzippedFail(VersionStatus.FailedNoFileDir);
    process.exit(0);
  }

  if (files.includes('manifest.json')) {
    logger.info('Manifest already exists');
    await cleanupUnzippedFail(VersionStatus.FailedManifestExists);
    process.exit(0);
  }
  const manifestPath = path.join(unzippedFileLoc, 'manifest.json');

  const manifest = {
    manifestVersion: 1,
    packageName,
    packageId,
    packageVersion: packageVersion.toString(),
    authorId,
    dependencies
  };

  logger.trace('Processing files');
  let hasSymbolicLink = false;
  if (await findTrueFile(unzippedFileLoc, (s, p) => {

    // We want to delete the file if it's a .DS_STORE or desktop.ini
    if (path.basename(p) === '.DS_Store' || path.basename(p) === 'desktop.ini') {
      unlinkSync(p);
      return false;
    }

    // TODO: check for executables
    hasSymbolicLink = s.isSymbolicLink();
    return hasSymbolicLink;
  })) {
    logger.info(`Invalid file type in package: ${hasSymbolicLink ? 'symbolic link' : 'executable'}`);
    await cleanupUnzippedFail(VersionStatus.FailedInvalidFileTypes);
    process.exit(0);
  }

  await Promise.all([
    fs.writeFile(manifestPath, JSON.stringify(manifest, null, 4), 'utf-8'),
    useDefaultScript('install.ska', packageType, unzippedFileLoc, files),
    useDefaultScript('uninstall.ska', packageType, unzippedFileLoc, files),
    useDefaultScript('upgrade.ska', packageType, unzippedFileLoc, files)
  ]);

  
  // We need to make the parent so that zipping doesn't fail
  const parent = path.resolve(xpkgFileLoc, '..');
  await fs.mkdir(parent, { recursive: true });
  
  logger.trace('Done processing files, zipping xpkg file');

  await new Promise<void>((resolve, reject) => {
    childProcess.exec(`zip -r "${xpkgFileLoc}" *`, {
      cwd: unzippedFileLoc
    }, err => {
      if (err)
        reject(err);
      resolve();
    });
  });

  logger.trace('Done zipping xpkg file');
  await fs.rm(originalUnzippedRoot, {recursive: true, force: true});
  logger.trace('Deleted unzipped files');

  logger.trace('Generating file hash');
  const hashStream = createReadStream(xpkgFileLoc);
  const hash = await hasha.fromStream(hashStream, { algorithm: 'sha256', encoding: 'hex' });
  logger.info({ hash }, 'Generated xpkg file hash');

  fileSize = (await fs.stat(xpkgFileLoc)).size;
  logger.info({ fileSize }, 'Calculated xpkg file size');

  logger.trace('Calculating installed size');
  const installedSize = await getUnzippedFileSize(xpkgFileLoc);
  logger.info({ installedSize }, 'Calculated installed size');

  logger.trace('Trying to consume storage');
  author = await authorDatabase.getAuthorDoc(authorId);
  const canConsume = await author.tryConsumeStorage(fileSize);

  if (!canConsume) {
    logger.info('Author does not have enough space to store package');
    await Promise.all([
      fs.rm(xpkgFileLoc, { force: true }),
      packageDatabase.updateVersionStatus(packageId, packageVersion, VersionStatus.FailedNotEnoughSpace),
      sendFailureEmail(VersionStatus.FailedNotEnoughSpace),
    ]);
    logger.trace('Deleted xpkg file, updated database, and notified author');
    process.exit(0);
  }
  hasUsedStorage = true;
  logger.trace('Consumed storage');
  
  logger.trace('Fetching namespace from Oracle Cloud');
  const { value: namespace } = await client.getNamespace({});

  logger.trace('Uploading package version to OCI object storage');
  const fileStream = createReadStream(xpkgFileLoc);
  let objectUrl;

  if (accessConfig.isStored) {
    logger.trace('Package is stored, uploading to permanent (public or private) bucket');
    const bucketName = accessConfig.isPrivate ? PRIVATE_BUCKET_NAME : PUBLIC_BUCKET_NAME;
    const putObjectRequest: objectStorage.requests.PutObjectRequest = {
      namespaceName: namespace,
      bucketName,
      putObjectBody: fileStream,
      objectName: storageId,
      contentLength: fileSize
    };
    await client.putObject(putObjectRequest);
    objectUrl = `https://objectstorage.us-ashburn-1.oraclecloud.com/n/${namespace}/b/${bucketName}/o/${storageId}`;
  } else {
    logger.trace('Package not stored, uploading to temporary bucket');
    const putObjectRequest: objectStorage.requests.PutObjectRequest = {
      namespaceName: namespace,
      bucketName: TEMPORARY_BUCKET_NAME,
      putObjectBody: fileStream,
      objectName: storageId,
      contentLength: fileSize
    };
    await client.putObject(putObjectRequest);
    logger.trace('Uploaded file to temporary bucket, generating presigned URL');

    const preAuthReqDetails: objectStorage.models.CreatePreauthenticatedRequestDetails = {
      name: `tmp-pkg-${authorId}-${tempId}`,
      accessType: objectStorage.models.CreatePreauthenticatedRequestDetails.AccessType.ObjectRead,
      objectName: storageId,
      timeExpires: new Date(Date.now() + (24 * 60 * 60 * 1000))
    };

    const request: objectStorage.requests.CreatePreauthenticatedRequestRequest = {
      namespaceName: namespace,
      bucketName: TEMPORARY_BUCKET_NAME,
      createPreauthenticatedRequestDetails: preAuthReqDetails,
    };
    const preAuthReqResp = await client.createPreauthenticatedRequest(request);
    objectUrl = preAuthReqResp.preauthenticatedRequest.fullPath;
  }
  
  logger.trace('Uploaded package to OCI object storage');
  
  await Promise.all([
    packageDatabase.resolveVersionData(
      packageId,
      packageVersion,
      hash,
      fileSize,
      installedSize,
      accessConfig.isStored ? objectUrl : void 0
    ),
    fs.unlink(xpkgFileLoc)
  ]);
  logger.trace('Deleted local xpkg file and updated database, sending job done to jobs service');

  if (accessConfig.isStored)
    await author.sendEmail(`X-Pkg Package Uploaded (${packageId})`, `Your package ${packageId} has been successfully processed and uploaded to the X-Pkg registry.${accessConfig.isPrivate ? ' Since your package is private, to distribute it, you must give out your private key, which you can find in the X-Pkg developer portal.': ''}\n\nPackage id: ${packageId}\nPackage version: ${packageVersion.toString()}\nChecksum: ${hash}`);
  else 
    await author.sendEmail(`X-Pkg Package Processed (${packageId})`, `Your package ${packageId} has been successfully processed. Since you have decided not to upload it to the X-Pkg registry, you need to download it now. Your package will be innaccessible after the link expires, the link expires in 24 hours. Anyone with the link may download the package.\n\nPackage id: ${packageId}\nPackage version: ${packageVersion.toString()}\nChecksum: ${hash}\nLink: objectUrl`);

  logger.trace('Author notified of process success, notifying jobs service');
  await jobsService.completed();
  logger.info('Worker thread completed');
} catch (e) {
  if (jobsService.aborted)
    logger.warn(e, 'Error occured during file processing after job abortion');
  else 
    logger.error(e, 'Error occured during file processing');

  if (hasUsedStorage) {
    logger.info('Error occured after storage claimed, attempting to free');
    await author.freeStorage(fileSize).catch();
    logger.trace('Freed claimed storage');
  }

  await Promise.all([
    packageDatabase.updateVersionStatus(packageId, packageVersion, VersionStatus.Aborted),
    sendFailureEmail(VersionStatus.FailedServer),
    jobsService.completed()
  ]);
}

/**
 * Use a default installation script if the author does not provide one
 * 
 * @param {string} scriptName The name of the script to use the default for (like install.ska).
 * @param {PackageType} packageType The type of the package.
 * @param {string} file The root directory of the package.
 * @param {string[]} files The files in the root directory of the package.
 */
async function useDefaultScript(scriptName: string, packageType: PackageType, file: string, files: string[]): Promise<void> {
  if (!files.includes(scriptName)){
    const resourceFile = path.resolve('resources', 'default_scripts', packageType, scriptName);
    if (!exists(resourceFile))
      return;
    
    return fs.copyFile(resourceFile, path.join(file, scriptName));
  }
}

/** 
 * Find if the callback is true for any child file in any recursive subdirectory.
 * 
 * @param {string} dir The top most parent directory.
 * @param {(Stats, string) => boolean} cb The callback to check for truthiness.
 * @returns True if cb is true for any file, or false otherwise.
 */
async function findTrueFile(dir: string, cb: (stats: Stats, path: string) => boolean): Promise<boolean> {
  const stats = await fs.lstat(dir);
  if (stats.isDirectory()) {

    for (const file of await fs.readdir(dir)) {
      const filePath = path.join(dir, file);
      const stats = lstatSync(filePath);

      if (stats.isDirectory())
        return findTrueFile(filePath, cb);
      else if (cb(stats, filePath))
        return true;
    }

    return false;
  } else
    return cb(stats, dir);
}

/**
 * Cleanup the unzipped directory as well as update the status in the database.
 * 
 * @param {VersionStatus} failureStatus The status to set in the database.
 * @returns {Promise<void>} A promise which resolves if the operation completes successfully.
 */
async function cleanupUnzippedFail(failureStatus: VersionStatus): Promise<void> {
  logger.info('Packaging failed, cleaning up unzipped directory and updating status: ' + failureStatus);
  await Promise.all([
    fs.rm(originalUnzippedRoot, { recursive: true, force: true }),
    packageDatabase.updateVersionStatus(packageId, packageVersion, failureStatus),
    sendFailureEmail(failureStatus)
  ]);
  logger.info('Cleaned up unzipped directory, status updated, and author notified');
}

/**
 * Abort the job.
 * 
 * @async
 * @returns {Promise<void>} A promise which resolves once the processing has been aborted.
 */
async function abort(): Promise<void> {
  await Promise.all([
    packageDatabase.updateVersionStatus(packageId, packageVersion, VersionStatus.Aborted),
    sendFailureEmail(VersionStatus.Aborted)
  ]);
  rmSync(xpkgFileLoc, { force: true });
  rmSync(unzippedFileLoc, { recursive: true, force: true });
  rmSync(zipFileLoc, { force: true });
  logger.info('Cleaned up jobs for abortion');
}

/**
 * Send an email stating that packaging failed.
 * 
 * @param {VersionStatus} failureStatus The resulting status which is the reason for the failure.
 * @returns {Promise<void>} A promise which resolves once the email is sent.
 */
async function sendFailureEmail(failureStatus: VersionStatus): Promise<void> {
  return author.sendEmail(`X-Pkg Packaging Failure (${packageId})`, `Your package, ${packageId}, was not able to be processed. ${getVersionStatusReason(failureStatus)}\n\nPackage id: ${packageId}\nPackage version: ${packageVersion.toString()}`);
}

/**
 * Get a sentence that describes the version status.
 * 
 * @param {VersionStatus} versionStatus The status to describe.
 * @return {string} A human-readable sentence which describes the version status.
 */
function getVersionStatusReason(versionStatus: VersionStatus): string {
  switch (versionStatus) {
  case VersionStatus.FailedMACOSX: return 'The file was zipped improperly, the only directory present is the __MACOSX directory.';
  case VersionStatus.FailedInvalidFileTypes:
    if (packageType === PackageType.Executable)
      return 'You can not have symbolic links in your packages.';
    else
      return 'You can not have symbolic links or executables in your packages.';
  case VersionStatus.FailedManifestExists:  return 'You can not have a file named "manifest.json" in your zip folder root.';
  case VersionStatus.FailedNoFileDir: return 'No directory was found with the package id.';
  case VersionStatus.FailedServer: return 'The server failed to process the file, please try again later.';
  case VersionStatus.FailedFileTooLarge: return 'The zip file uploaded exceeded 16 gibibytes when unzipped.';
  case VersionStatus.FailedNotEnoughSpace: return 'You do not have enough storage space to store this package.';
  case VersionStatus.Aborted: return 'The process was aborted for an unknown reason.';
  case VersionStatus.Removed:
  case VersionStatus.Processed:
  case VersionStatus.Processing:
    return 'If you see this sentence, something broke.';
  default: return '<Unknown Reason>';
  }
}

/**
 * Get the size of an unzipped file in bytes.
 * 
 * @param {string} file The zip file to get the unzipped size of.
 * @returns {Promise<number>} A promise which resolves to the size of the unzipped file in bytes, or rejects on error.
 */
function getUnzippedFileSize(file: string): Promise<number> {
  return new Promise((resolve, reject) => {
    childProcess.exec(`unzip -Zt ${file} | awk '{print $3}'`, (err, stdout) => {
      if (err)
        reject(err);
      resolve(parseInt(stdout, 10));
    });
  });
}