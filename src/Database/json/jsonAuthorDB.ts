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

/**
 * Data stored along with author data, that is not accessible outside of this interface.
 * 
 * @typedef {Object} InternalAuthorData
 * @property {string} hash The password hash of the author.
 * @property {number} createionDate The millisecond unix timestamp of the author's creation time.
 * @property {string} authorSession The session of the author.
 */
type InternalAuthorData = {
  hash: string;
  creationDate: number;
  authorSession: string;
};

import AuthorDatabase, { AuthorData } from '../authorDatabase.js';
import JsonDB from './jsonDB.js';
import NoSuchAccountError from '../../errors/noSuchAccountError.js';
import { nanoid } from 'nanoid/async';

/**
 * Author database created using JSON. Note that database is slow, not efficient, not secure, not scalable etc. Its bad, this is not for production use. Testing only.
 */
class JsonAuthorDB extends JsonDB<AuthorData & InternalAuthorData> implements AuthorDatabase {

  /**
   * Create a new author database.
   */
  constructor() {
    super('authors');
  }

  /**
   * Create a new author. Also initialize session randomly, and creation date to now(-ish).
   * 
   * @async
   * @param {string} authorId The id of the author to create.
   * @param {string} authorName The name of the author.
   * @param {string} authorEmail The email of the author (in lowercase).
   * @param {string} passwordHash The hash of the author's password.
   * @returns {Promise<void>} A promise which resolves when the author has been created successfully.
   */
  async createAuthor(authorId: string, authorName: string, authorEmail: string, passwordHash: string): Promise<void> {
    this._data.push({
      authorId,
      authorEmail: authorEmail.trim().toLowerCase(),
      authorName: authorName.trim(),
      hash: passwordHash,
      verified: false,
      creationDate: Date.now(),
      authorSession: await nanoid(16),
      usedStorage: 0,
      totalStorage: 536870912
    });
    await this._save();
  }

  /**
   * Get the password and id of an author from their email. Used for logins.
   * 
   * @async
   * @param authorEmail The email of the author to get the password hash of.
   * @returns {Promise<[string, string]>} A promise which resolves to the hash of the author's password first, and then the author id.
   * @throws {NoSuchAccountError} Error thrown if no account exists with the given email.
   */
  async getPasswordAndId(authorEmail: string): Promise<[string, string]> {
    const author = this._data.find(a => a.authorEmail === authorEmail);

    if (!author)
      throw new NoSuchAccountError('authorEmail', authorEmail);
    
    return [author.hash, author.authorId];
  }

  /**
   * Get the session of the author.
   * 
   * @async
   * @param {string} authorId The id of the author to get the session of.
   * @returns {Promise<string>} A promise which resolves to the session of the author.
   * @throws {NoSuchAccountError} Error thrown if no account exists with the given id.
   */
  async getSession(authorId: string): Promise<string> {
    const author = this._data.find(a => a.authorId === authorId);

    if (!author)
      throw new NoSuchAccountError('authorId', authorId);
    
    return author.authorSession;
  }

  /**
   * Get a bunch of the data for an author from the database using their id.
   * 
   * @async
   * @param authorId The id of the author to get.
   * @returns {Promise<AuthorData>} A promise which resolves to all of the data of an author.
   * @throws {NoSuchAccountError} Error thrown if no account exists with the given id.
   */
  async getAuthor(authorId: string): Promise<AuthorData> {
    const author = this._data.find(a => a.authorId === authorId);

    if (!author)
      throw new NoSuchAccountError('authorId', authorId);

    return author as AuthorData;
  }

  /**
   * Update the database to record a name change.
   * 
   * @async 
   * @param {string} authorId The id of the author who is changing their name.
   * @param {string} newName The new name of the author.
   * @returns {Promise<void>} A promise which resolves when the author's name is changed successfully.
   * @throws {NoSuchAccountError} Error thrown if no account exists with the given id.
   */
  async updateAuthorName(authorId: string, newName: string): Promise<void> {
    const author = this._data.find(a => a.authorId === authorId);

    if (!author)
      throw new NoSuchAccountError('authorId', authorId);
    
    author.authorName = newName;
    return this._save();
  }

  /**
   * Change the author's session.
   * 
   * @async
   * @param {string} authorId The id of the author who's session is being updated.
   * @param {string} newSession The new session id of the author.
   * @returns {Promise<void>} A promise which resolves when the author's session is successfully updated.
   * @throws {NoSuchAccountError} Error thrown if no account exists with the given id.
   */
  async updateAuthorSession(authorId: string, newSession: string): Promise<void> {
    const author = this._data.find(a => a.authorId === authorId);

    if (!author)
      throw new NoSuchAccountError('authorId', authorId);
    
    author.authorSession = newSession;
    return this._save();
  }

  /**
   * Check if a user exists with a given email.
   * 
   * @async
   * @param {string} email The email to check for. Does not convert to lowercase.
   * @returns {Promise<boolean>} A promise which resolves to true if the email is already in use.
   */
  async emailExists(email: string): Promise<boolean> {
    email = email.trim().toLowerCase();
    return !!this._data.find(a => a.authorEmail === email);
  }

  /**
   * Check if an author already exists with a name.
   * 
   * @async
   * @name AuthorDatabase#nameExists
   * @param {string} authorName The name to check for existence. Converts to lowercase.
   * @returns {Promise<boolean>} A promise which resolves to true if the name is already in use.
   */
  async nameExists(authorName: string): Promise<boolean> {
    authorName = authorName.trim().toLowerCase();
    return !!this._data.find(a => a.authorName.toLowerCase() === authorName);
  }

  /**
   * Change an authors verification status to true.
   * 
   * @async
   * @param {string} authorId The id of the author to verfiy.
   * @returns {Promise<void>} A promise which resolves when the operation completes successfully.
   * @throws {NoSuchAccountError} Error thrown if an author does not exist with the given id.
   */
  async verify(authorId: string): Promise<void> {
    authorId = authorId.trim();
    
    const author = this._data.find(a => a.authorId === authorId); 
    if (!author)
      throw new NoSuchAccountError('authorId', authorId);

    author.verified = true;
    return this._save();
  }

  /**
    * Check if an author's account is verified. Does not care if the author is already verified.
    * 
    * @async
    * @param {string} authorId The id of the author to check for verification.
    * @return {Promise<boolean>} A promise which resolves to true if the author is verified, or false otherwise.
    * @throws {NoSuchAccountError} Error thrown if an author does not exist with the given id. 
    */
  async isVerified(authorId: string): Promise<boolean> {
    authorId = authorId.trim();
    
    const author = this._data.find(a => a.authorId === authorId); 
    if (!author)
      throw new NoSuchAccountError('authorId', authorId);
    
    return author.verified;
  }

  /**
   * Set the amount of storage the author has used. Does not check if the author is allowed to use that much storage.
   * 
   * @async
   * @param {string} authorId The id of the author who's used storage to set.
   * @param {number} size The amount of storage to set as used, in bytes.
   * @returns {Promise<void>} A promise which resolves when the database has been updated with the new used storage.
   * @throws {NoSuchAccountError} Error thrown if an author does not exist with the given id. 
   */
  async setUsedStorage(authorId: string, size: number): Promise<void> {
    throw new Error('NOT IMPLEMENTED');
  }

  /**
   * Set the amount of total storage the author has. 
   * 
   * @async
   * @param {string} authorId The id of the author who's storage to set.
   * @param {number} size The total storage the author has, in bytes.
   * @returns {Promise<void>} A promise which resolves when the storage has been set.
   * @throws {NoSuchAccountError} Error thrown if an author does not exist with the given id. 
   */
  async setTotalStorage(authorId: string, size: number): Promise<void> {
    throw new Error('NOT IMPLEMENTED');
  }
}

const authorDatabase = new JsonAuthorDB();
export default authorDatabase;