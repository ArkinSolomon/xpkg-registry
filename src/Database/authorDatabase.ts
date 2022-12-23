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
 * The data in the database for an author.
 * 
 * @typedef {Object} AuthorData 
 * @property {string} authorId The id of the author.
 * @property {string} authorName The name of the author.
 * @property {string} authorEmail The email of the author.
 * @property {boolean} verified True if the author has verified their email.
 * @property {Date} [lastChange] The point in time which the user last changed their email. Undefined if the user has never changed their name.
 */
export type AuthorData = {
  authorId: string;
  authorName: string;
  authorEmail: string;
  verified: boolean;
  lastChange?: Date;
};

/**
 * Interface that all author databases implement.
 * 
 * @interface AuthorDatabase
 */
interface AuthorDatabase {

  /**
   * Get the password hash for an author.
   * 
   * @async
   * @name AuthorDatabase#getPassword
   * @param authorId The id of the author to get the password hash of.
   * @returns {Promise<string>} A promise which resolves to the hash of the author's password.
   */  
  getPassword(authorId: string): Promise<string>;

  /**
   * Get the session of the author.
   * 
   * @async
   * @name AuthorDatabase#getSession
   * @param {string} authorId The id of the author to get the session of.
   * @returns {Promise<string>} A promise which resolves to the session of the author.
   */
  getSession(authorId: string): Promise<string>;

  /**
   * Get a bunch of the data for an author from the database.
   * 
   * @param authorId The id of the author who's data we're getting.
   * @returns {Promise<AuthorData>} A promise which resolves to all of the data of an author.
   */
  getAuthor(authorId: string): Promise<AuthorData>;

  updateAuthorPassword(authorId: string, newPassword: string): Promise<string>;

  emailExists(email: string): Promise<boolean>;

  nameExists(authorName: string): Promise<boolean>;
}

// We have to seperate the export because EsLint gets mad
export default AuthorDatabase;