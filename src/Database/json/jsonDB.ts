/*
 * Copyright (c) 2023. Arkin Solomon.
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
import fs from 'fs/promises';
import fsSync from 'fs';
import { existsSync as fileExists, readFileSync } from 'fs';

const databaseStorage = path.resolve('.', 'databases');
await fs.mkdir(databaseStorage, { recursive: true });

/**
 * Skeleton class for creating database interfaces with JSON.
 * 
 * @abstract
 */
export default abstract class JsonDB<T> {

  private _file;
  private _lockFile;
  protected _data: T[] = [];

  /**
   * Create a new database with the given name. If data for the database already exists, load it.
   * 
   * @param {string} dbName The name of the database.
   */
  constructor(dbName: string) {
    this._file = path.join(databaseStorage, dbName + '.json');
    this._lockFile = path.join(databaseStorage, dbName + '.json.lock');

    this._aquireLock();
    if (fileExists(this._file)) {
      const content = readFileSync(this._file, 'utf-8');
      this._data = JSON.parse(content) as T[];
    } 
    this._releaseLock();
  }

  /**
   * Lock the file.
   */
  private _aquireLock() {
    while (fsSync.existsSync(this._lockFile)) {
      // Wait
    }
    fsSync.writeFileSync(this._lockFile, '');
  }

  /**
   * Unlock the file.
   */
  private _releaseLock() {
    fsSync.unlinkSync(this._lockFile);
  }

  /**
   * Save the JSON data.
   * 
   * @async
   * @returns {Promise<void>} A promise which resolves when the operation completes successfully.
   */
  protected async _save(): Promise<void> {
    this._aquireLock();
    await fs.writeFile(this._file, JSON.stringify(this._data, null, 4), 'utf-8');
    this. _releaseLock();
    return;
  }
}