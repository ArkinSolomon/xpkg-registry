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
import fs from 'fs/promises';
import { unlinkSync, lstatSync, Stats, createWriteStream } from 'fs';
import path from 'path';
import XPkgInvalidPackageError from '../errors/invalidPackageError.js';
import Mode from 'stat-mode';
import archiver from 'archiver';
import { Version, versionStr } from './version.js';
import { PackageType } from '../database/packageDatabase.js';

/**
 * Process a zip file and create an xpkg file.
 * 
 * @param {string} file The absolute path to the file to process, that is the directory that contains the package id directory.
 * @param {string} dest The absolute path to the destination file (include .xpkg).
 * @param {string} authorId The id of the author that is uploading this package version.
 * @param {string} authorName The name of the author that is uploading this package verison.
 * @param {string} packageName The name of the package that the user provided.
 * @param {string} packageId The id of the package that the user provided.
 * @param {Version} packageVersion The version of the package version that the user provided.
 * @param {PackageType} packageType The type of the package that the user provided.
 * @param {[string, string][]} dependencies The list of dependencies of the package, the name then version selection string.
 * @param {[string, string][]} optionalDependencies The list of optional dependencies of the package, the name then version selection string.
 * @param {[string, string][]} incompatibilities The list of incompatibilites of the package, the name then version selection string.
 * @param {[string, string][]} stored True if the package is being stored.
 */
export default async function processFile(
  file: string,
  dest: string,
  authorId: string,
  authorName: string,
  packageName: string,
  packageId: string,
  packageVersion: Version,
  packageType: PackageType,
  dependencies: [string, string][],
  optionalDependencies: [string, string][],
  incompatibilities: [string, string][],
  stored: boolean
): Promise<void> {
  const files = await fs.readdir(file);

  // Insufficient permissions to delete __MACOSX directory, so just process the sub-folder
  if (files.includes('__MACOSX')) {
    if (files.length != 2)
      throw new XPkgInvalidPackageError('invalid_macosx');
    
    const subFolderName = files.find(fName => fName !== '__MACOSX');
    file = path.join(file, subFolderName as string);
    
    return processFile(file, dest, authorId, authorName, packageName, packageId, packageVersion, packageType, dependencies, optionalDependencies, incompatibilities, stored);
  }

  if (!files.includes(packageId))
    throw new XPkgInvalidPackageError('no_file_dir');

  // const packagePath = path.join(file, packageId);
  // const packageFiles = await fs.readdir(packagePath);

  if (files.includes('manifest.json'))
    throw new XPkgInvalidPackageError('manifest_exists');
  const manifestPath = path.join(file, 'manifest.json');

  const manifest = {
    packageName,
    packageId,
    packageVersion: versionStr(packageVersion),
    authorId,
    dependencies,
    optionalDependencies,
    incompatibilities,
    stored
  };

  let hasSymbolicLink = false;
  if (await findTrueFile(file, (s, p) => {

    const mode = Mode(s);

    // We want to delete the file if it's a .DS_STORE
    if (path.basename(p) === '.DS_Store') {
      unlinkSync(p);
      return false;
    }

    hasSymbolicLink = s.isSymbolicLink();
    return hasSymbolicLink

      // Need to test to make sure this catches windows, mac, and linux executables
      || ((mode.owner.execute || mode.group.execute || mode.others.execute) && packageType !== 'executable');
  }))
    throw new XPkgInvalidPackageError(hasSymbolicLink ? 'has_symbolic_link' : 'has_exec');
  
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 4), 'utf-8');
  
  // We need to make the parent so that zipping doesn't fail
  const parent = path.resolve(dest, '..');
  await fs.mkdir(parent, { recursive: true });
  
  await zipDirectory(file, dest);
}

/** 
 * Find if the callback is true for any child file in any recursive subdirectory.
 * 
 * @param dir The top most parent directory.
 * @param cb The callback to check for truthiness.
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