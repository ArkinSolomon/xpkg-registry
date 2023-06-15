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
 * @property {[string, string][]} incompatibilities The list of incompatibilites of the package, the name then version selection string.
 * @property {Object} accessConfig The access config of the package.
 * @property {boolean} accessConfig.isPublic True if the package is public.
 * @property {boolean} accessConfig.isPrivate True if the package is private.
 * @property {boolean} accessConfig.isStroed True if the package is stored.
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
}

import fs from 'fs/promises';
import { existsSync as exists, rmSync } from 'fs';
import { unlinkSync, lstatSync, Stats, createReadStream} from 'fs';
import path from 'path';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import Version from '../util/version.js';
import { PackageType, VersionStatus } from '../database/packageDatabase.js';
import loggerBase from '../logger.js';
import { nanoid } from 'nanoid/async';
import { isMainThread, parentPort, workerData } from 'worker_threads';
import { packageDatabase } from '../database/databases.js';
import hasha from 'hasha';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import Author from '../author.js';
import JobsServiceManager, { JobData, JobType, PackagingInfo } from './jobsServiceManager.js';
import { unzippedFilesLocation, xpkgFilesLocation } from '../routes/packages.js';
import childProcess from 'child_process';

if (isMainThread) {
  console.error('Worker files can not be run');
  process.exit(1); 
}

const PUBLIC_BUCKET_NAME = 'xpkgregistrydev';
const PRIVATE_BUCKET_NAME = 'xpkgprivatepackagesdev';
const data = workerData as FileProcessorData;

const packageVersion = Version.fromString(data.packageVersion) as Version;
const {
  zipFileLoc,
  authorId,
  packageName,
  packageId,
  packageType,
  dependencies,
  incompatibilities,
  accessConfig
} = data;
const [tempId, awsId] = await Promise.all([nanoid(32), nanoid(64)]);

let unzippedFileLoc = path.join(unzippedFilesLocation, tempId);
const xpkgFileLoc = path.join(xpkgFilesLocation, awsId + '.xpkg');
let originalUnzippedRoot: string;

const logger = loggerBase.child({
  ...data,
  tempId,
  zipFileLoc,
  unzippedFileLoc,
  packageVersion: packageVersion.toString()
});
logger.info('Starting processing of package');
parentPort?.postMessage('started');

const author = await Author.fromDatabase(authorId);

const jobData: JobData = {
  jobType: JobType.Packaging,
  info: <PackagingInfo>{
    packageId,
    version: packageVersion.toString()
  }
};
const jobsService = new JobsServiceManager(jobData, logger, abort);
await jobsService.waitForAuthorization();

let fileSize = 0;
let hasUsedStorage = false;
try {
  logger.debug('Calculating unzipped file size');
  const unzippedSize =await getUnzippedFileSize(zipFileLoc);
  logger.setBindings({
    unzippedSize
  });
  logger.debug('Calculated unzipped file size');

  if (unzippedSize > 17179869184) {
    logger.info('Unzipped zip file is greater than 16 gibibytes');
    await Promise.all([
      fs.rm(zipFileLoc, { force: true }),
      packageDatabase.updatePackageStatus(packageId, packageVersion, VersionStatus.FailedFileTooLarge),
      sendFailureEmail(VersionStatus.FailedFileTooLarge)
    ]);
    logger.debug('Deleted zip file, updated database, and notified author');
    process.exit(0);
  }

  logger.debug('Decompressing zip file');
  const hasMacOSX = await new Promise<boolean>((resolve, reject) => {
    const searchProcess = childProcess.exec(`unzip -l "${zipFileLoc}" | grep "__MACOSX" -c -m 1`);

    searchProcess.on('close', code => {
      resolve(code === 0);
    });

    searchProcess.on('error', reject);
  });

  await new Promise<void>((resolve, reject) => {
    childProcess.exec(`unzip -qq -d "${unzippedFileLoc}" "${zipFileLoc}" -x "__MACOSX/*" && chown -R $USER "${unzippedFileLoc}" && chmod -R 700 "${unzippedFileLoc}"`, err => {
      if (err)
        reject(err);
      resolve();
    });
  });
  logger.debug('Zip file decompressed');
  await fs.rm(zipFileLoc);
  logger.debug('Zip file deleted');

  originalUnzippedRoot = unzippedFileLoc;
  let files = await fs.readdir(unzippedFileLoc);

  // Insufficient permissions to delete __MACOSX directory, so just process the sub-folder
  if (hasMacOSX) {
    logger.debug('__MACOSX directory detected');
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
    dependencies,
    incompatibilities
  };

  logger.debug('Processing files');
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
  
  logger.debug('Done processing files, zipping xpkg file');

  await new Promise<void>((resolve, reject) => {
    childProcess.exec(`zip -r "${xpkgFileLoc}" *`, {
      cwd: unzippedFileLoc
    }, err => {
      if (err)
        reject(err);
      resolve();
    });
  });

  logger.debug('Done zipping xpkg file');
  await fs.rm(originalUnzippedRoot, {recursive: true, force: true});
  logger.debug('Deleted unzipped files');

  logger.debug('Generating file hash');
  const hashStream = createReadStream(xpkgFileLoc);
  const hash = await hasha.fromStream(hashStream, { algorithm: 'sha256', encoding: 'hex' });
  logger.setBindings({ hash });
  logger.debug('Generated xpkg file hash');

  fileSize = (await fs.stat(xpkgFileLoc)).size;
  logger.setBindings({
    fileSize
  });
  logger.debug('Calculated xpkg file size');

  logger.debug('Calculating installed size');
  const installedSize = await getUnzippedFileSize(xpkgFileLoc);
  logger.setBindings({
    installedSize
  });
  logger.debug('Calculated installed size');

  logger.debug('Trying to consume storage');
  const canConsume = await author.tryConsumeStorage(fileSize);

  if (!canConsume) {
    logger.info('Author does not have enough space to store package');
    await Promise.all([
      fs.rm(xpkgFileLoc, { force: true }),
      packageDatabase.updatePackageStatus(packageId, packageVersion, VersionStatus.FailedNotEnoughSpace),
      sendFailureEmail(VersionStatus.FailedNotEnoughSpace)
    ]);
    logger.debug('Deleted xpkg file, updated database, and notified author');
    process.exit(0);
  } 
  hasUsedStorage = true;
  logger.debug('Consumed storage');

  const s3client = new S3Client({
    region: 'us-east-2'
  });

  logger.debug('Uploading package version to S3');
  const fileStream = createReadStream(xpkgFileLoc);
  let privateUrl;
  if (accessConfig.isStored) {
    const putCmd = new PutObjectCommand({
      Bucket: PUBLIC_BUCKET_NAME,
      Key: awsId,
      Body: fileStream
    });
    await s3client.send(putCmd);
  } else {
    const putCmd = new PutObjectCommand({
      Bucket: PRIVATE_BUCKET_NAME,
      Key: awsId,
      Body: fileStream
    });
    await s3client.send(putCmd);

    const getCmd = new GetObjectCommand({
      Bucket: PRIVATE_BUCKET_NAME,
      Key: awsId,
      ResponseContentDisposition: `attachment; filename="${packageId}@${packageVersion.toString()}.xpkg"`
    });
  
    // Get a URL that expires in a day
    privateUrl = await getSignedUrl(s3client, getCmd, { expiresIn: 24 * 60 * 60 }) as string;
  }
  
  logger.debug('Uploaded package to S3');
  await packageDatabase.resolveVersionData(
    packageId,
    packageVersion,
    hash,
    accessConfig.isStored ? `https://d2cbjuk8vv1874.cloudfront.net/${awsId}` : 'NOT_STORED',
    fileSize,
    installedSize
  );
  logger.debug('Updated database with version');
  await fs.unlink(xpkgFileLoc);
  logger.debug('Deleted local xpkg file, sending job done to jobs service');

  if (accessConfig.isStored)
    await author.sendEmail(`X-Pkg Package Uploaded (${packageId})`, `${author.greeting()},\n\nYour package ${packageId} has been successfully processed and uploaded to the X-Pkg registry.${accessConfig.isPrivate ? ' Since your package is private, to distribute it, you must give out your private key, which you can find in the X-Pkg developer portal.': ''}\n\nPackage id: ${packageId}\nPackage version: ${packageVersion.toString()}\nChecksum: ${hash}`);
  else 
    await author.sendEmail(`X-Pkg Package Processed (${packageId})`, `${author.greeting()},\n\nYour package ${packageId} has been successfully processed. Since you have decided not to upload it to the X-Pkg registry, you need to download it now. Your package will be innaccessible after the link expires, the link expires in 24 hours. Anyone with the link may download the package.\n\nPackage id: ${packageId}\nPackage version: ${packageVersion.toString()}\nChecksum: ${hash}\nLink: ${privateUrl}`);

  logger.debug('Author notified of process success, notifying jobs service');
  await jobsService.completed();
  logger.info('Worker thread completed');
} catch (e) {
  if (hasUsedStorage) {
    logger.info('Error occured after storage claimed, attempting to free');
    await author.freeStorage(fileSize);
  }

  if (jobsService.aborted)
    logger.warn(e, 'Error occured after abortion');
  else {
    logger.error(e);
    throw e;
  }
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
    packageDatabase.updatePackageStatus(packageId, packageVersion, failureStatus),
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
    packageDatabase.updatePackageStatus(packageId, packageVersion, VersionStatus.Aborted),
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
  return author.sendEmail(`X-Pkg Packaging Failure (${packageId})`, `${author.greeting()},\n\nYour package, ${packageId}, was not able to be processed. ${getVersionStatusReason(failureStatus)}\n\nPackage id: ${packageId}\nPackage version: ${packageVersion.toString()}`);
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
  default: return '<<Unknown Reason>>';
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