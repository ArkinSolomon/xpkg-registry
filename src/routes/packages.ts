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

import path from 'path';
import query from '../database.js';
import { Router } from 'express';
import mysql from 'mysql2';
import multer from 'multer';
import os from 'os';

const storeFile = path.resolve('./data.json');
const route = Router();
const upload = multer({ dest: os.tmpdir() });

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

route.post('/upload', upload.single('file'), (req, res) => {

  const file = req.file;
  console.log(file);
  res.sendStatus(200);
});

export default route;