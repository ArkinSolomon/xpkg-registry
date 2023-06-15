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

/**
 * The data that can exit the server for the author. All other author data should remain on the server.
 * 
 * @typedef {Object} AuthorData 
 * @property {string} authorId The id of the author.
 * @property {string} authorName The name of the author.
 * @property {string} authorEmail The email of the author.
 * @property {boolean} verified True if the author has verified their email.
 * @property {Date} [lastChange] The point in time which the user last changed their email. Undefined if the user has never changed their name.
 * @property {number} usedStorage The amount of storage the author has used.
 * @property {number} totalStorage The total amount of storage that the author has.
 */
export type AuthorData = {
  authorId: string;
  authorName: string;
  authorEmail: string;
  verified: boolean;
  lastChange?: Date;
  usedStorage: number;
  totalStorage: number;
};

/**
 * Interface that all author databases implement.
 * 
 * @interface AuthorDatabase
 */
interface AuthorDatabase {

  /**
   * Create a new author. Also initialize session randomly, and creation date to now(-ish).
   * 
   * @async
   * @name AuthorDatabase#createAuthor
   * @param {string} authorId The id of the author to create.
   * @param {string} authorName The name of the author.
   * @param {string} authorEmail The email of the author (in lowercase).
   * @param {string} passwordHash The hash of the author's password.
   * @returns {Promise<void>} A promise which resolves when the author has been created successfully.
   */
  createAuthor(authorId: string, authorName: string, authorEmail: string, passwordHash: string): Promise<void>;

  /**
   * Get the password and id of an author from their email. Used for logins.
   * 
   * @async
   * @name AuthorDatabase#getPassword
   * @param authorEmail The email of the author to get the password hash of.
   * @returns {Promise<[string, string]>} A promise which resolves to the hash of the author's password first, and then the author id.
   * @throws {NoSuchAccountError} Error thrown if no account exists with the given email.
   */
  getPasswordAndId(authorEmail: string): Promise<[string, string]>;

  /**
   * Get the session of the author.
   * 
   * @async
   * @name AuthorDatabase#getSession
   * @param {string} authorId The id of the author to get the session of.
   * @returns {Promise<string>} A promise which resolves to the session of the author.
   * @throws {NoSuchAccountError} Error thrown if no account exists with the given id.
   */
  getSession(authorId: string): Promise<string>;

  /**
   * Get a bunch of the data for an author from the database using their id.
   * 
   * @async
   * @name AuthorDatabase#getAuthor
   * @param authorId The id of the author to get.
   * @returns {Promise<AuthorData>} A promise which resolves to all of the data of an author.
   * @throws {NoSuchAccountError} Error thrown if no account exists with the given id.
   */
  getAuthor(authorId: string): Promise<AuthorData>;

  /**
   * Update the database to record a name change.
   * 
   * @async 
   * @name AuthorDatabase#updateAuthorName
   * @param {string} authorId The id of the author who is changing their name.
   * @param {string} newName The new name of the author.
   * @returns {Promise<void>} A promise which resolves when the author's name is changed successfully.
   * @throws {NoSuchAccountError} Error thrown if no account exists with the given id.
   */
  updateAuthorName(authorId: string, newName: string): Promise<void>;

  /**
   * Change the author's session.
   * 
   * @async
   * @name AuthorDatabase#updateAuthorSession
   * @param {string} authorId The id of the author who's session is being updated.
   * @param {string} newSession The new session id of the author.
   * @returns {Promise<void>} A promise which resolves when the author's session is successfully updated.
   * @throws {NoSuchAccountError} Error thrown if no account exists with the given id.
   */
  updateAuthorSession(authorId: string, newSession: string): Promise<void>;

  /**
   * Check if a user exists with a given email.
   * 
   * @async
   * @name AuthorDatabase#emailExists
   * @param {string} email The email to check for. Does not convert to lowercase.
   * @returns {Promise<boolean>} A promise which resolves to true if the email is already in use.
   */
  emailExists(email: string): Promise<boolean>;

  /**
   * Check if an author already exists with a name.
   * 
   * @async
   * @name AuthorDatabase#nameExists
   * @param {string} authorName The name to check for existence. Converts to lowercase.
   * @returns {Promise<boolean>} A promise which resolves to true if the name is already in use.
   */
  nameExists(authorName: string): Promise<boolean>;

  /**
   * Change an authors verification status to true.
   * 
   * @async
   * @name AuthorDatabase#verify
   * @param {string} authorId The id of the author to verfiy.
   * @returns {Promise<void>} A promise which resolves when the operation completes successfully.
   * @throws {NoSuchAccountError} Error thrown if an author does not exist with the given id.
   */
  verify(authorId: string): Promise<void>;

  /**
   * Check if an author's account is verified.
   * 
   * @async
   * @name AuthorDatabase#isVerified
   * @param {string} authorId The id of the author to check for verification.
   * @return {Promise<boolean>} A promise which resolves to true if the author is verified, or false otherwise.
   * @throws {NoSuchAccountError} Error thrown if an author does not exist with the given id. 
   */
  isVerified(authorId: string): Promise<boolean>;

  /**
   * Set the amount of storage the author has used. Does not check if the author is allowed to use that much storage.
   * 
   * @async
   * @name AuthorDatabase#setUsedStorage
   * @param {string} authorId The id of the author who's used storage to set.
   * @param {number} size The amount of storage to set as used, in bytes.
   * @returns {Promise<void>} A promise which resolves when the database has been updated with the new used storage.
   * @throws {NoSuchAccountError} Error thrown if an author does not exist with the given id. 
   */
  setUsedStorage(authorId: string, size: number): Promise<void>;

  /**
   * Set the amount of total storage the author has. 
   * 
   * @async
   * @name AuthorDatabase#setTotalStorage
   * @param {string} authorId The id of the author who's storage to set.
   * @param {number} size The total storage the author has, in bytes.
   * @returns {Promise<void>} A promise which resolves when the storage has been set.
   * @throws {NoSuchAccountError} Error thrown if an author does not exist with the given id. 
   */
  setTotalStorage(authorId: string, size: number): Promise<void>;
}

export default AuthorDatabase;