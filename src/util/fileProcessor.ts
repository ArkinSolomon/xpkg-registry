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
import fs from 'fs/promises';
import { unlinkSync, lstatSync, Stats, createWriteStream } from 'fs';
import path from 'path';
import XPkgInvalidPackageError from './xPkgInvalidPackageError.js';
import Mode from 'stat-mode';
import archiver from 'archiver';
import { Version } from './version.js';

/**
 * Process a zip file and create an xpkg file.
 * 
 * @param {string} file The absolute path to the file to process.
 * @param {string} dest The absolute path to the destination file (include .xpkg).
 * @param {string} authorId The id of the author that is uploading this package version,
 * @param {string} packageName The name of the package that the user provided.
 * @param {string} packageId The id of the package that the user provided.
 * @param {Version} packageVersion The version of the package version that the user provided.
 * @param {string} packageType The type of the package that the user provided.
 */
export default async function processFile(file: string, dest: string, authorId: string, packageName: string, packageId: string, packageVersion: Version, packageType: string) {
  const files = await fs.readdir(file);

  if (!files.includes(packageId))
    throw new XPkgInvalidPackageError('no_file_dir');

  const packagePath = path.join(file, packageId);

  const packageFiles = await fs.readdir(packagePath);

  if (packageFiles.includes('manifest.json'))
    throw new XPkgInvalidPackageError('manifest_exists');

  const manifest = {
    packageName,
    packageId,
    packageVersion,
    authorId
  };

  let hasSymbolicLink = false;
  if (await findTrueFile(packagePath, (s, p) => {

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

  const parent = path.resolve(dest, '..');
  await fs.mkdir(parent, { recursive: true });
  await zipDirectory(packagePath, dest);
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