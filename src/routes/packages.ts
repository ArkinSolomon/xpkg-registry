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
 * The data within the xpkg-manifest.json file of a package.
 * 
 * @typedef {object} ManifestData
 * @property {string} [id] The id of the package.
 * @property {string} [version] The version of the package.
 * @property {string} [type] The type of the object.
 */
type ManifestData = {
  id?: string;
  version?: string;
  type?: string;
  authorId?: string;
};

/**
 * The temporary data stored while the user is going through the upload wizard.
 * 
 * @typedef {object} TempData
 * @property {string} id The id of the package.
 * @property {string} authorId The id of the package author.
 * @property {boolean} installFound True if there was an `install.xpkgs` script in the package's root directory.
 * @property {boolean} uninstallFound True if there was an `uninstall.xpkgs` script in the package's root directory.
 * @property {boolean} upgradeFound True if there was an `upgrade.xpkgs` script in the package's root directory.
 */
type TempData = {
  id: string;
  authorId: string;
  installFound: boolean;
  uninstallFound: boolean;
  upgradeFound: boolean;
};

import archiver from 'archiver';
import path from 'path';
import query from '../util/database.js';
import { Router } from 'express';
import mysql from 'mysql2';
import multer from 'multer';
import os from 'os';
import fs from 'fs';
import fsProm from 'fs/promises';
import { nanoid } from 'nanoid/async';
import unzip from 'unzipper';
import crypto from 'crypto';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { AuthTokenPayload } from './auth.js';
import isProfane from '../util/profanityFilter.js';
import isVersionValid from '../util/version.js';
import fileProcessor from '../util/fileProcessor.js';

const storeFile = path.resolve('./data.json');
const route = Router();
const upload = multer({ dest: os.tmpdir() });

const defaultInstallScript = path.resolve('.', 'resources', 'default_scripts', 'install.xpkgs');
const defaultUninstallScript = path.resolve('.', 'resources', 'default_scripts', 'uninstall.xpkgs');
const defaultUpgradeScript = path.resolve('.', 'resources', 'default_scripts', 'upgrade.xpkgs');

const bucketName = 'xpkgregistrydev';

const s3client = new S3Client({
  region: 'us-east-2'
});

// Get a list of all packages
route.get('/', (_, res) => {
  res.sendFile(storeFile);
});

// Get the hash and location of a package
route.get('/:package/:version', (req, res) => {
  const { package: packageId, version: versionStr } = req.params;
  const queryStr = mysql.format('SELECT loc, published, approved, HEX(hash) FROM versions WHERE packageId = ? AND version = ?;', [packageId, versionStr]);

  query(queryStr, (err, data: { loc: string, 'HEX(hash)': string, published: boolean, approved: boolean }[]) => {
    if (err) {
      console.error(err);
      return res.sendStatus(500);
    }

    if (data.length < 1)
      return res.sendStatus(404);
    else if (data.length > 1)
      return res.sendStatus(400);

    const [version] = data;

    let { loc } = version;
    const { published, approved } = version;
    if (!approved)
      res.sendStatus(404);
    else if (!published)
      loc = 'NOT_PUBLISHED';

    res.json({ loc, hash: version['HEX(hash)'] });
  });
});

route.post('/new', upload.single('file'), async (req, res) => {

  const file = req.file;

  let packageId, packageName, checkPackageName, packageType, description, initialVersion;
  try {
    packageId = req.body.packageId.trim().toLowerCase();
    packageName = req.body.packageName.trim();
    checkPackageName = packageName.toLowerCase();

    // TODO make this an enum
    packageType = req.body.packageType.trim().toLowerCase();

    description = req.body.description.trim();
    initialVersion = req.body.initialVersion.trim().toLowerCase();

    checkType(packageId, 'string');
    checkType(packageName, 'string');
    checkType(packageType, 'string');
    checkType(description, 'string');
    checkType(initialVersion, 'string');
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

  if (isProfane(packageId))
    return res
      .status(400)
      .send('profane_id');
  else if (isProfane(packageName))
    return res
      .status(400)
      .send('profane_name');
  else if (isProfane(description))
    return res
      .status(400)
      .send('profane_desc');

  const { id: authorId, name: authorName } = req.user as AuthTokenPayload;

  const n = await nanoid(32);
  const destFile = path.join(os.tmpdir(), 'unzipped', n, packageId + '.zip');
  const outFile = path.join(os.tmpdir(), 'xpkg', n, packageId + '.xpkg');
  await fs.createReadStream(file.path).pipe(unzip.Extract({ path: destFile })).promise();
  try {
    await fileProcessor(destFile, outFile, authorId, packageName, packageId, version, packageType);
    console.log(destFile);
    console.log(outFile);
  } catch (e) {
    return res
      .sendStatus(422)
      .send('no_package_folder');
  }

  // Check for duplicates
  try {
    const idLookupQuery = mysql.format('SELECT packageId FROM packages WHERE packageId = ?;', [packageId]);
    const nameLookupQuery = mysql.format('SELECT packageId FROM packages WHERE checkPackageName = ?;', [checkPackageName]);
    const lookupRes = await Promise.all([
      query(idLookupQuery),
      query(nameLookupQuery)
    ]);

    if (lookupRes[0].length)
      return res
        .status(400)
        .send('id_in_use');
    else if (lookupRes[1].length)
      return res
        .status(400)
        .send('name_in_use');

    const packageCommand = mysql.format('INSERT INTO packages (packageId, packageName, authorId, authorName, description, packageType, checkPackageName) VALUES (?, ?, ?, ?, ?, ?, ?);',
      /*       Get around eslint + auto formatting lol      */[packageId, packageName, authorId, authorName, description, packageType, checkPackageName]);
    await query(packageCommand);

    return res.sendStatus(204);
  } catch (e) {
    console.error(e);
    return res.sendStatus(500);
  }
});

route.post('/upload', upload.single('file'), async (req, res) => {
  console.log(req.file);
  // const file = req.file;
  // const n = await nanoid(32);
  // const destFile = path.join(os.tmpdir(), 'unzipped', n);

  // let packageName, checkPackageName, packageId, version, type;
  // try {
  //   packageName = req.body.packageName.trim();
  //   checkPackageName = req.body.packageName.trim().toLowerCase();
  //   packageId = req.body.packageId.trim().toLowerCase();
  //   version = req.body.version.trim().toLowerCase();
  //   type = req.body.type.trim().toLowerCase();
  // } catch (e) {
  //   console.error(e);
  //   return res
  //     .status(400)
  //     .send('invalid_form_data');
  // }

  // // Ensure no duplicates
  // try {
  //   const idLookupQuery = mysql.format('SELECT packageId FROM packages WHERE packageId = ?;', [packageId]);
  //   const nameLookupQuery = mysql.format('SELECT packageId FROM packages WHERE checkPackageName = ?;', [checkPackageName]);
  //   const lookupRes = await Promise.all([
  //     query(idLookupQuery),
  //     query(nameLookupQuery)
  //   ]);

  //   if (lookupRes[0].length)
  //     return res
  //       .status(400)
  //       .send('id_in_use');
  //   else if (lookupRes[1].length)
  //     return res
  //       .status(400)
  //       .send('name_in_use');
  // } catch (e) {
  //   console.error(e);
  //   return res.sendStatus(500);
  // }

  // const { id: authorId, name: authorName } = req.user as AuthTokenPayload;

  // if (!file || !packageId || !version || !type)
  //   return res.sendStatus(400);

  // await fs.createReadStream(file.path).pipe(unzip.Extract({ path: destFile })).promise();

  // if (!['other', 'executable'].includes(type))
  //   return res.sendStatus(400);

  // try {
  //   const files = await fsProm.readdir(destFile);

  //   if (!files.includes(packageId))
  //     return res.sendStatus(400);

  //   const packagePath = path.join(destFile, packageId);
  //   const manifestPath = path.join(packagePath, 'xpkg-manifest.json');

  //   let manifest = <ManifestData>{
  //     id: packageId,
  //     version,
  //     type
  //   };
  //   if (fs.existsSync(manifestPath))
  //     manifest = JSON.parse(await fsProm.readFile(manifestPath, 'utf-8'));

  //   // Yeah this code will run even if we made the manifest from scratch, it's not a big deal for now
  //   if (manifest.id || manifest.version || manifest.type) {
  //     if (!manifest.id || !manifest.version || !manifest.type)
  //       return res.sendStatus(400);

  //     manifest.id = manifest.id.trim().toLowerCase();
  //     manifest.version = manifest.version.trim().toLowerCase();
  //     manifest.type = manifest.type.trim().toLowerCase();

  //     if (manifest.id !== packageId || manifest.version !== version || manifest.type !== type)
  //       return res
  //         .status(400)
  //         .send('manifest_mismatch');
  //   }

  //   if (manifest.authorId)
  //     return res
  //       .status(400)
  //       .send('author_id');

  //   manifest.authorId = authorId;

  // if (findTrueFileRecursively(packagePath, (s, p) => {
  //   const mode = Mode(s);

  //   // We also want to delete the file if it's a .DS_STORE
  //   if (path.basename(p) === '.DS_STORE') {
  //     fs.unlinkSync(p);
  //     return false;
  //   }

  //   return s.isSymbolicLink()

  //     // Need to test to make sure this catches windows, mac, and linux executables
  //     || ((mode.owner.execute || mode.group.execute || mode.others.execute) && manifest.type !== 'executable');
  // }))
  //   return res
  //     .status(400)
  //     .send('invalid_files');

  //   const foundScripts = (await fsProm.readdir(packagePath))
  //     .filter(f => f.endsWith('.xpkgs'));

  //   const installScript = path.join(packagePath, 'install.xpkgs');
  //   const uninstallScript = path.join(packagePath, 'uninstall.xpkgs');
  //   const upgradeScript = path.join(packagePath, 'upgrade.xpkgs');

  //   const installFound = foundScripts.includes('install.xpkgs');
  //   const uninstallFound = foundScripts.includes('uninstall.xpkgs');
  //   const upgradeFound = foundScripts.includes('upgrade.xpkgs');

  //   const promises = [] as Promise<void>[];
  //   if (installFound)
  //     promises.push(fsProm.copyFile(defaultInstallScript, installScript, fsProm.constants.COPYFILE_EXCL));
  //   if (uninstallFound)
  //     promises.push(fsProm.copyFile(defaultUninstallScript, uninstallScript, fsProm.constants.COPYFILE_EXCL));
  //   if (upgradeFound)
  //     promises.push(fsProm.copyFile(defaultUpgradeScript, upgradeScript, fsProm.constants.COPYFILE_EXCL));

  //   await Promise.all(promises);

  //   // Store some processing things
  //   const tempPath = path.join(destFile, 'temporary.json');
  //   const tempData: TempData = {
  //     id: manifest.id as string,
  //     authorId,
  //     installFound,
  //     uninstallFound,
  //     upgradeFound
  //   };
  //   await fsProm.writeFile(tempPath, JSON.stringify(tempData), 'utf-8');

  //   const tmpZipDirPath = path.join(os.tmpdir(), 'zipped', n);
  //   const packageZipName = `${manifest.id}.xpkg`;
  //   const zippedPath = path.join(tmpZipDirPath, packageZipName);
  //   await fsProm.mkdir(tmpZipDirPath, { recursive: true });
  //   await zipDirectory(packagePath, zippedPath);

  //   const fileBuffer = await fsProm.readFile(zippedPath);
  //   console.log(zippedPath);
  //   const hashSum = crypto.createHash('sha256');
  //   hashSum.update(fileBuffer);
  //   const hash = hashSum.digest('hex');

  //   const putCmd = new PutObjectCommand({
  //     Bucket: bucketName,
  //     Key: manifest.id,
  //     Body: fileBuffer
  //   });
  //   await s3client.send(putCmd);

  //   const getCmd = new GetObjectCommand({
  //     Bucket: bucketName,
  //     Key: manifest.id
  //   });
  //   const url = await getSignedUrl(s3client, getCmd, { expiresIn: 604800 });

  //   const packageCommand = mysql.format('INSERT INTO packages (packageId, packageName, authorId, authorName, description, packageType) VALUES (?, ?, ?, ?, "no desc", ?, ?);', [manifest.id, packageName, manifest.authorId, authorName, manifest.type, checkPackageName]);

  //   query(packageCommand, err => {
  //     if (err)
  //       return res.sendStatus(500);

  //     const versionCommand = mysql.format('INSERT INTO versions (packageId, version, hash, published, approved, loc, authorId) VALUES (?, ?, UNHEX(?), True, True, ?, ?);', [manifest.id, manifest.version, hash, url, manifest.authorId]);
  //     query(versionCommand, err => {
  //       if (err)
  //         return res.sendStatus(500);
  //       res
  //         .status(200)
  //         .json({ n, manifest, d: tempData, url });
  //     });
  //   });
  // } catch (e) {
  //   console.error(e);
  //   return res.sendStatus(500);
  // }
  return res.sendStatus(503);
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