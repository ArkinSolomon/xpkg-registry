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

import { nanoid } from 'nanoid/async';
import AuthorDatabase, { AuthorData } from '../authorDatabase.js';
import MysqlDB from './mysqlDB.js';
import { format } from 'mysql2';
import NoSuchAccountError from '../../errors/noSuchAccountError.js';

/**
 * Author database implemented in MySQL.
 */
class MysqlAuthorDB extends MysqlDB implements AuthorDatabase {

  /**
   * Create a new database instance with a pool of connections.
   * 
   * @param {number} poolCount The number of connections in a connection pool.
   */
  constructor(poolCount: number) {
    super(poolCount);
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
    authorId = authorId.trim().toLowerCase();
    authorName = authorName.trim();
    const checkName = authorName.toLowerCase();
    authorEmail = authorEmail.trim().toLowerCase();
    const session = await nanoid(16);

    const query = format('INSERT INTO authors (authorId, authorName, authorEmail, password, session, checkName) VALUES (?, ?, ?, ?, ?, ?)', [authorId, authorName, authorEmail, passwordHash, session, checkName]);
    await this._query(query);
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
    authorEmail = authorEmail.trim().toLowerCase();

    const query = format('SELECT password, authorId FROM authors WHERE authorEmail=?;', [authorEmail]);
    const data = await this._query(query) as { password: string; authorId: string; }[];
    if (data.length !== 1)
      throw new NoSuchAccountError('authorEmail', authorEmail);

    return [data[0].password, data[0].authorId];
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
    authorId = authorId.trim().toLowerCase();

    const query = format('SELECT session FROM authors WHERE authorId=?;', [authorId]);
    const data = await this._query(query) as { session: string; }[];
    if (data.length !== 1)
      throw new NoSuchAccountError('authorId', authorId);

    return data[0].session;
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
    authorId = authorId.trim().toLowerCase();

    const query = format('SELECT authorId, authorName, authorEmail, verified, lastChange FROM authors WHERE authorId=?;', [authorId]);
    const data = await this._query(query);
    if (data.length !== 1)
      throw new NoSuchAccountError('authorId', authorId);
    
    return data[0] as AuthorData;
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
    authorId = authorId.trim().toLowerCase();
    newName = newName.trim();
    const checkName = newName.toLowerCase();

    try {
      const query = format('UPDATE authors SET authorName=?, checkName=?, lastChange=? WHERE authorId=?;', [newName, checkName, new Date(), authorId]);
      await Promise.all([
        this._query(query),
        this.getAuthor(authorId), // We run this in parallel, since update does nothing if it fails and there is no author
      ]);
    } catch {
      throw new NoSuchAccountError('authorId', authorId);
    }
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
    authorId = authorId.trim().toLowerCase();
    newSession = newSession.trim();

    try {
      const query = format('UPDATE authors SET session=? WHERE authorId=?;', [newSession, authorId]);
      await Promise.all([
        this._query(query),
        this.getAuthor(authorId), // See updateAuthorName
      ]);
    } catch {
      throw new NoSuchAccountError('authorId', authorId);
    }
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
    try {
      await this.getPasswordAndId(email);
      return true;
    } catch (e) {
      if (e instanceof NoSuchAccountError)
        return false;
      throw e;
    }
  }

  /**
   * Check if an author already exists with a name.
   * 
   * @async
   * @param {string} authorName The name to check for existence. Converts to lowercase.
   * @returns {Promise<boolean>} A promise which resolves to true if the name is already in use.
   */
  async nameExists(authorName: string): Promise<boolean> {
    const checkName = authorName.trim().toLowerCase();

    const query = format('SELECT verified FROM authors WHERE checkName=?;', [checkName]);
    const data = await this._query(query);
    return data.length > 0;
  }
}

const authorDatabase = new MysqlAuthorDB(25);
export default authorDatabase as AuthorDatabase;