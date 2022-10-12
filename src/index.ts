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
import dotenv from 'dotenv';
dotenv.config();

import mysql from 'mysql';
import Express from 'express';
import fs from 'fs/promises';
import path from 'path';
// import { nanoid } from 'nanoid/async';

const connection = mysql.createConnection({
  host: '127.0.0.1',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: 'xpkg_packages'
});
await new Promise<void>((resolve, reject) => {
  connection.connect(err => {
    if (err)
      reject(err);
    resolve();
  });
});

const app = Express();
const storeFile = path.resolve('./data.json');
app.get('/packages/', (_, res) => {
  res.sendFile(storeFile);
});

/**
 * Update the JSON file which is storing all of the data.
 */
function updateJSON(): Promise<void> {
  return new Promise((resolve, reject) => {
    connection.query('SELECT * FROM packages;', async (err, data) => {
      if (err) {
        console.error(err);
        return reject(err);
      }

      await fs.writeFile(storeFile, JSON.stringify(data), 'utf-8');
      resolve();
    });
  });
}

// for (let i = 0; i < 1000; ++i){
//   const id = await nanoid(32);
//   const name = await nanoid(16);
//   new Promise<void>((resolve, reject) => {
//     connection.query(`INSERT INTO packages (packageId, packageName, authorId, authorName, description) VALUES ("${id}", "package${name}", "user${name}", "name${name}", "A generic description that really doesn't matter what it is anyway since these are only test values and will ultimately be replaced at some point these are very very very very very very large descriptions wow");`, err => {
//       if (err)
//         return reject(err);
//       resolve();
//     });
//   });
// }

await updateJSON();
setInterval(updateJSON, 60 * 1000);
app.listen(5020);