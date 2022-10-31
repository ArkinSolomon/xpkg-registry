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
 * The data returned from the SQL server.
 * 
 * @property {string} packageId The id of the package.
 * @property {string} packageName The name of the package.
 * @property {string} authorName The name of the author that published this package.
 * @property {string} description The description of the package.
 * @property {string[]?} versions All of the versions of the package.
 */
type DatabaseRecord = {
  packageId: string,
  packageName: string,
  authorName: string,
  description: string,
  versions?: string[]
};

import dotenv from 'dotenv';
dotenv.config();

import mysql from 'mysql2';
import Express from 'express';
import fs from 'fs/promises';
import path from 'path';
import query from './database.js';
// import crypto from 'crypto';
// import { nanoid } from 'nanoid/async';

// const connection = mysql.createConnection({
//   host: '127.0.0.1',
//   user: process.env.DB_USER,
//   password: process.env.DB_PASSWORD,
//   database: 'xpkg_packages',
//   multipleStatements: false
// });
// await new Promise<void>((resolve, reject) => {
//   connection.connect(err => {
//     if (err)
//       reject(err);
//     resolve();
//   });
// });

const app = Express();
const storeFile = path.resolve('./data.json');

import main from './routes/main.js';
import packages from './routes/packages.js';
app.use('/', main);
app.use('/packages', packages);

/**
 * Update the JSON file which is storing all of the data.
 */
async function updateJSON(): Promise<void> {
  const data: DatabaseRecord[] = [];

  const packageData = await new Promise<DatabaseRecord[]>((resolve, reject) => {
    query('SELECT packageId, packageName, authorName, description FROM packages;', (err, data: DatabaseRecord[]) => {
      if (err)
        return reject(err);
      resolve(data);
    });
  });

  for (const i in packageData) {
    const d = packageData[i];
    d.versions = await getVersions(d.packageId);

    if (d.versions.length)
      data.push(d);
  }

  await fs.writeFile(storeFile, JSON.stringify({ data }), 'utf-8');
}

/**
 * Get all of the versions that a package has.
 * 
 * @param {string} packageId The id of the package to get the version of.
 * @returns {Promise<string[]>} All of the versions of the pacakge.
 */
async function getVersions(packageId: string): Promise<string[]> {
  return new Promise<string[]>((resolve, reject) => {
    const queryStr = mysql.format('SELECT version FROM versions WHERE packageId = ? AND approved = true AND published = true;', [packageId]);
    query(queryStr, (err, d: { version: string }[]) => {
      if (err)
        return reject(err);
      const data = d.map(v => v.version);
      resolve(data);
    });
  });
}

// for (let i = 0; i < 1000; ++i) {
//   const id = await nanoid(32);
//   const name = await nanoid(16);
//   new Promise<void>((resolve, reject) => {
//     connection.query(`INSERT INTO packages (packageId, packageName, authorId, authorName, description, packageType) VALUES ("${id}", "package${name}", "user${name}", "name${name}", "A generic description that really doesn't matter what it is anyway since these are only test values and will ultimately be replaced at some point these are very very very very very very large descriptions wow", "other");`, err => {
//       if (err)
//         return reject(err);

//       for (let i = 0; i < 12; ++i) {

//         new Promise<void>((resolve, reject) => {
//           const major = randomIntFromInterval(1, 5),
//             minor = randomIntFromInterval(0, 10),
//             patch = randomIntFromInterval(0, 10);
//           const v = `${major}.${minor}.${patch}`;
//           const hash = crypto.createHash('sha256').update(v).digest('hex');
//           const url = 'https://xpkgregistrydev.s3.us-east-2.amazonaws.com/arkin.test_package.xpkg?response-content-disposition=inline&X-Amz-Security-Token=IQoJb3JpZ2luX2VjEFUaCXVzLWVhc3QtMiJGMEQCICko%2FO89xA7rsd6TZnbvnL0tc1EECh53FxxtJRmulyU2AiAeZiW38wMEj8e5aVEZGiV0Lsw3k8wLdioc9xm5W%2Br48CrkAgguEAAaDDk1MjIxNzY4OTg2NyIMVlzqdtYUdKaS%2BJHGKsECKDka6jUhNvyttt8vLcKwECXcBMSodWbSbIQ%2FRwygG1vosuNQ5FK2ZP2UuCEOuFDKjsQWUqf8Cj%2F6yF8%2FRRGBvpg0rAE9alkRsVXiI8nEuZVFGTw0SH881dJCISGW4MS%2BMPdyQYjJa76zqNU5vdWwdm5djRL%2FjDeqKhYdbQqgSnbYcl0YmcYckv3Dz45ScgW79w7YFjvy5cPr4BgWHlurJNMgILzVHKaDqQwVyvSQe1qU4oUfA7r7UYTMU89Sc0aQuJhrp2vumBdA4MXaLVQyEJuyLSqwLrm%2F6TPgDL9x5DQ%2B6eJ6CseRLQMldB9awy%2FZtGSfc5VEnZABe2M4DO2%2BB1vcVd%2FEaMAWuGNMYfUM2ayhUzLDCDYGKlsrGViQJI2a6hssvbxTBjvugQZwe%2FvzsDrNYN9y4k%2FObB9SBqmnVPg5ML%2FJupoGOrQCjv41Lv0WBBd1qM4rIvPQf%2FbgZMts0VeYCn48HrYzcp1e4jmiVP0gtWNWNVWR0r3FKod9X2HVkOMtLQFrbHhW31a2txdYWQdLFkJYavnFB8xR5eWbrOmj8TI5eX3OPpEhwYoemcFrRlobIH2QiG9DlhtAyPGgjpR%2BUjWJVOifvEQDBhN1Tgwjy7btqtLUoEOZxXMqnxeLhGKMhGei%2B7fUkTIKaeHgVAvsdD3wL8r2%2BUlhoTn2%2BKQJ0MOSIE55%2F2mPqSzBIFjjkaF9gksltd7rQkBR1H09o4eM364F4neRVtUY3BEyW9g8n0lMGzNh0lW5aom4VBxx%2BLu%2B4SGhGT5%2FCfy6an2h8bLbRQPq1txwFojDUllw3J5R8j%2F8kJ2TUEJri1vA%2BDZom23yuQexgt06dkvMfgk%3D&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Date=20221018T131343Z&X-Amz-SignedHeaders=host&X-Amz-Expires=43199&X-Amz-Credential=ASIA53NEY34F2XG5IJ62%2F20221018%2Fus-east-2%2Fs3%2Faws4_request&X-Amz-Signature=3f276410305d830e572b2ff16425f3b992a1714ff5b871a94929b9e5ff5a3920';
//           connection.query('INSERT INTO versions (packageId, version, hash, published, approved, loc) VALUES (?, ?, UNHEX(?), True, True, ?);', [id, v, hash, url], err => {
//             if (err)
//               return reject(err);
//             resolve();
//           });
//         });
//       }
//       resolve();
//     });
//   });
// }

// /**
//  * Get a random integer between a minimum and maximum.
//  * 
//  * @param {number} min The minimum number (inclusive).
//  * @param {number} max The maximum number (inclusive).
//  * @returns {number} A random number between `min` and `max` inclusive.
//  */
// function randomIntFromInterval(min: number, max: number) {
//   return Math.floor(Math.random() * (max - min + 1) + min);
// }

await updateJSON();
setInterval(updateJSON, 60 * 1000);
app.listen(5020, () => {
  console.log('Server started');
});