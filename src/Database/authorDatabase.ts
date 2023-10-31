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

import { nanoid } from 'nanoid';
import AuthorModel, { AuthorData, DatabaseAuthor } from './models/authorModel.js';
import NoSuchAccountError from '../errors/noSuchAccountError.js';

/**
 * Create a new author. Also initialize session randomly.
 * 
 * @async
 * @param {string} authorId The id of the author to create.
 * @param {string} authorName The name of the author.
 * @param {string} authorEmail The email of the author (in lowercase).
 * @param {string} passwordHash The hash of the author's password.
 * @returns {Promise<void>} A promise which resolves when the author has been created successfully.
 */
export async function createAuthor(authorId: string, authorName: string, authorEmail: string, passwordHash: string) {
  const session = nanoid();

  const authorDoc = new AuthorModel({
    authorId,
    authorName,
    authorEmail,
    password: passwordHash,
    session
  });
  await authorDoc.save();

  return authorDoc;
}

/**
 * Get an author's Mongoose document from their email.
 * 
 * @async
 * @param {string} authorEmail The email of the author to get.
 * @returns {Promise<Document<DatabaseAuthor>>} A promise which resolves to the mongoose document, or null if the author does not exist.
 */
export async function getAuthorFromEmail(authorEmail: string) {
  return await AuthorModel.findOne({
    authorEmail
  })
    .exec();
}

/**
 * Get the password and id of an author from their email. Used for logins.
 * 
 * @async
 * @param authorEmail The email of the author to get the password hash of.
 * @returns {Promise<[string, string]>} A promise which resolves to the hash of the author's password first, and then the author id.
 * @throws {NoSuchAccountError} Error thrown if no account exists with the given email.
 */
export async function getPasswordAndId(authorEmail: string): Promise<[string, string]> {
  const author = await AuthorModel.findOne({
    authorEmail,
  }, 'authorId password')
    .lean()
    .exec();

  if (!author)
    throw new NoSuchAccountError('authorEmail', authorEmail);
  
  return [author.authorId, author.password];
}

/**
 * Get the session of the author.
 * 
 * @async
 * @param {string} authorId The id of the author to get the session of.
 * @returns {Promise<string>} A promise which resolves to the session of the author.
 * @throws {NoSuchAccountError} Error thrown if no account exists with the given id.
 */
export async function getSession(authorId: string): Promise<string> {
  const author = await AuthorModel.findOne({
    authorId,
  }, 'session')
    .lean()
    .exec();

  if (!author)
    throw new NoSuchAccountError('authorId', authorId);
  
  return author.session;
}

/**
 * Get a bunch of the data for an author from the database using their id.
 * 
 * @async
 * @param authorId The id of the author to get.
 * @returns {Promise<AuthorData>} A promise which resolves to all of the data of an author.
 * @throws {NoSuchAccountError} Error thrown if no account exists with the given id.
 */
export async function getAuthor(authorId: string): Promise<AuthorData> {
  const author = await AuthorModel.findOne({
    authorId,
  }, '-password -session -tokens -__v -_id')
    .lean()
    .exec();
  
  if (!author)
    throw new NoSuchAccountError('authorId', authorId);
  
  return author as AuthorData;
}

/**
 * Get the Mongoose document of an author by their id.
 * 
 * @param {string} authorId The id of the author to get the Mongoose document of.
 * @returns {Promise} The Mongoose document of the author.
 * @throws {NoSuchAccountError} Error thrown if no account exists with the given id.
 */
export async function getAuthorDoc(authorId: string) {
  const author = await AuthorModel.findOne({
    authorId,
  }, '-password')
    .exec();
  
  if (!author)
    throw new NoSuchAccountError('authorId', authorId);
  
  return author;
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
export async function updateAuthorName(authorId: string, newName: string): Promise<void> {
  const result = await AuthorModel.updateOne({
    authorId
  }, <Partial<DatabaseAuthor>>{
    authorName: newName
  })
    .exec();

  if (result.modifiedCount == 0)
    throw new NoSuchAccountError('authorId', authorId);
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
export async function updateAuthorSession(authorId: string, newSession: string): Promise<void> {
  const result = await AuthorModel.updateOne({
    authorId
  }, <Partial<DatabaseAuthor>>{
    session: newSession
  })
    .exec();

  if (result.modifiedCount == 0)
    throw new NoSuchAccountError('authorId', authorId);
}

/**
 * Check if a user exists with a given email.
 * 
 * @async
 * @param {string} email The email to check for. Does not convert to lowercase.
 * @returns {Promise<boolean>} A promise which resolves to true if the email is already in use.
 */
export async function emailExists(email: string): Promise<boolean> {
  return !!await AuthorModel.exists({
    authorEmail: email
  }).exec();
}

/**
 * Check if an author already exists with a name.
 * 
 * @async
 * @param {string} authorName The name to check for existence. Converts to lowercase.
 * @returns {Promise<boolean>} A promise which resolves to true if the name is already in use.
 */
export async function nameExists(authorName: string): Promise<boolean> {
  return !!await AuthorModel.exists({
    authorName: {
      $regex: new RegExp(`^${authorName}$`, 'i')
    }
  }).exec();
}

/**
 * Change an authors verification status to true.
 * 
 * @async
 * @param {string} authorId The id of the author to verfiy.
 * @returns {Promise<void>} A promise which resolves when the operation completes successfully.
 * @throws {NoSuchAccountError} Error thrown if an author does not exist with the given id.
 */
export async function verify(authorId: string): Promise<void> {
  const result = await AuthorModel.updateOne({
    authorId
  }, <Partial<DatabaseAuthor>>{
    verified: true
  })
    .exec();

  if (result.modifiedCount == 0)
    throw new NoSuchAccountError('authorId', authorId);
}

/**
 * Check if an author's account is verified.
 * 
 * @async
 * @param {string} authorId The id of the author to check for verification.
 * @return {Promise<boolean>} A promise which resolves to true if the author is verified, or false otherwise.
 * @throws {NoSuchAccountError} Error thrown if an author does not exist with the given id. 
 */
export async function isVerified(authorId: string): Promise<boolean> {
  const author = await AuthorModel.findOne({
    authorId
  })
    .exec();
  
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
export async function setUsedStorage(authorId: string, size: number): Promise<void> { 
  const result = await AuthorModel.updateOne({
    authorId
  }, <Partial<DatabaseAuthor>>{
    usedStorage: size
  })
    .exec();

  if (result.modifiedCount == 0)
    throw new NoSuchAccountError('authorId', authorId);
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
export async function setTotalStorage(authorId: string, size: number): Promise<void> {
  const result = await AuthorModel.updateOne({
    authorId
  }, <Partial<DatabaseAuthor>>{
    totalStorage: size
  })
    .exec();

  if (result.modifiedCount == 0)
    throw new NoSuchAccountError('authorId', authorId);
}