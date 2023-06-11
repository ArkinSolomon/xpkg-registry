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
 * @property {Version} packageVersion The version of the package version that the user provided.
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
  packageVersion: Version;
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
import { existsSync as exists } from 'fs';
import { unlinkSync, lstatSync, Stats, createWriteStream, createReadStream} from 'fs';
import path from 'path';
import Mode from 'stat-mode';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import archiver from 'archiver';
import { Version, versionStr } from '../util/version.js';
import { PackageType, VersionStatus } from '../database/packageDatabase.js';
import loggerBase from '../logger.js';
import decompress from 'decompress';
import { nanoid } from 'nanoid/async';
import { isMainThread, parentPort, workerData } from 'worker_threads';
import { packageDatabase } from '../database/databases.js';
import hasha from 'hasha';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import Author from '../author.js';

if (isMainThread) {
  console.error('Worker files can not be run');
  process.exit(1); 
}

const PUBLIC_BUCKET_NAME = 'xpkgregistrydev';
const PRIVATE_BUCKET_NAME = 'xpkgprivatepackagesdev';
const data = workerData as FileProcessorData;

const { zipFileLoc, authorId, packageName, packageId, packageVersion, packageType, dependencies, incompatibilities, accessConfig } = data;
const [tempId, awsId] = await Promise.all([nanoid(32), nanoid(64)]);

let unzippedFileLoc = path.join('/Users', 'arkinsolomon', 'Desktop', 'X_PKG_TMP_DIR', 'unzipped', tempId);
const xpkgFileLoc = path.join('/Users', 'arkinsolomon', 'Desktop', 'X_PKG_TMP_DIR', 'xpkg-files', awsId + '.xpkg');

const logger = loggerBase.child({ ...data, tempId, zipFileLoc, unzippedFileLoc });
parentPort?.postMessage('started');

const author = await Author.fromDatabase(authorId);

logger.info('Decompressing zip file');
await decompress(zipFileLoc, unzippedFileLoc);
logger.info('Zip file decompressed');
await fs.unlink(zipFileLoc);
logger.info('Zip file deleted');

const originalUnzippedRoot = unzippedFileLoc;
let files = await fs.readdir(unzippedFileLoc);

// Insufficient permissions to delete __MACOSX directory, so just process the sub-folder
if (files.includes('__MACOSX')) {
  if (files.length != 2) {
    logger.info('Only __MACOSX file provided');
    await cleanupUnzippedFail(VersionStatus.FailedMACOSX);
    process.exit(1);
  }
    
  const subFolderName = files.find(fName => fName !== '__MACOSX');
  unzippedFileLoc = path.join(unzippedFileLoc, subFolderName as string);
    
  files = await fs.readdir(unzippedFileLoc);
}

if (!files.includes(packageId)) {
  logger.info('No directory with package id');
  await cleanupUnzippedFail(VersionStatus.FailedNoFileDir);
  process.exit(1);

}

if (files.includes('manifest.json')) {
  logger.info('Manifest already exists');
  await cleanupUnzippedFail(VersionStatus.FailedManifestExists);
  process.exit(1);

}
const manifestPath = path.join(unzippedFileLoc, 'manifest.json');

const manifest = {
  packageName,
  packageId,
  packageVersion: versionStr(packageVersion),
  authorId,
  dependencies,
  incompatibilities
};

let hasSymbolicLink = false;
if (await findTrueFile(unzippedFileLoc, (s, p) => {
  const mode = Mode(s);

  // We want to delete the file if it's a .DS_STORE or desktop.ini
  if (path.basename(p) === '.DS_Store' || path.basename(p) === 'desktop.ini') {
    unlinkSync(p);
    return false;
  }

  hasSymbolicLink = s.isSymbolicLink();
  return hasSymbolicLink

      // Need to test to make sure this catches windows, mac, and linux executables
      || ((mode.owner.execute || mode.group.execute || mode.others.execute) && packageType !== 'executable');
})) {
  logger.info('Invalid file type in package');
  await cleanupUnzippedFail(VersionStatus.FailedInvalidFileTypes);
  process.exit(1);
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
  
logger.info('Done processing files, zipping xpkg file');
await zipDirectory(unzippedFileLoc, xpkgFileLoc);
logger.info('Done zipping xpkg file');
await fs.rm(originalUnzippedRoot, {recursive: true, force: true});
logger.info('Deleted unzipped files');

const hashStream = createReadStream(xpkgFileLoc);
const hash = await hasha.fromStream(hashStream, { algorithm: 'sha256', encoding: 'hex' });
logger.info(`Created xpkg file hash: ${hash}`);

const s3client = new S3Client({
  region: 'us-east-2'
});

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
  privateUrl = await getSignedUrl(s3client, getCmd, {expiresIn: 24 * 60 * 60}) as string;
}

logger.info('Uploaded package to S3');
await packageDatabase.resolveVersionData(packageId, packageVersion, hash, accessConfig.isStored ? `https://xpkgregistrydev.s3.us-east-2.amazonaws.com/${awsId}` : 'NOT_STORED');
logger.info('Updated database');
await fs.unlink(xpkgFileLoc);
logger.info('Deleted local xpkg file');

if (accessConfig.isStored)
  await author.sendEmail(`X-Pkg Package Uploaded (${packageId})`, `${author.greeting()},\n\nYour package ${packageId} has been successfully processed and uploaded to the X-Pkg registry.${accessConfig.isPrivate ? ' Since your package is private, to distribute it, you must give out your private key, which you can find in the X-Pkg developer portal.': ''}\n\nPackage id: ${packageId}\nPackage version: ${versionStr(packageVersion)}\nChecksum: ${hash}`);
else 
  await author.sendEmail(`X-Pkg Package Processed (${packageId})`, `${author.greeting()},\n\nYour package ${packageId} has been successfully processed. Since you have decided not to upload it to the X-Pkg registry, you need to download it now. Your package will be innaccessible after the link expires, the link expires in 24 hours. Anyone with the link may download the package.\n\nPackage id: ${packageId}\nPackage version: ${versionStr(packageVersion)}\nChecksum: ${hash}\nLink: ${privateUrl}`);


logger.info('Worker thread done, emails sent');

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
    author.sendEmail(`X-Pkg Packaging Failure (${packageId})`, `${author.greeting()},\n\nYour package ${packageId} was not able to be processed. ${getVersionStatusReason(failureStatus)}\n\nPackage id: ${packageId}\nPackage version: ${versionStr(packageVersion)}`)
  ]);
  logger.info('Cleaned up unzipped directory, status updated, and author notified');
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
  case VersionStatus.Removed:
  case VersionStatus.Downloaded:
  case VersionStatus.Processed:
  case VersionStatus.Processing:
    return 'If you see this sentence, something broke.';
  default: return 'Unknown';
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
 * Zip an entire directory to a path. See https://stackoverflow.com/questions/15641243/need-to-zip-an-entire-directory-using-node-js.
 * 
 * @param {String} sourceDir The directory of the folder to compress (/some/folder/to/compress)
 * @param {String} outPath The otuput path of the zip (/path/to/created.zip)
 * @returns {Promise<void>} A promise which resolves when the zip file is done writing.
 */
function zipDirectory(sourceDir: string, outPath: string): Promise<void> {
  const archive = archiver('zip', { zlib: { level: 9 } });
  const stream = createWriteStream(outPath);

  return new Promise((resolve, reject) => {
    archive
      .directory(sourceDir, false)
      .on('error', (err: unknown) => reject(err))
      .pipe(stream);

    stream.on('close', () => resolve());
    archive.finalize();
  });
}