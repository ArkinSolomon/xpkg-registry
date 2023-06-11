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
 * The payload of the JWT tokens used for authorization.
 * 
 * @typedef {Object} AuthTokenPayload
 * @property {string} id The id of the author.
 * @property {string} name The name of the author.
 * @property {string} session The current session of the user to be invalidated on password change.
 */
export type AuthTokenPayload = {
  id: string;
  name: string;
  session: string;
}

/**
 * The payload of the JWT tokens used for account validation.
 * 
 * @typedef {Object} AccountValidationPayload
 * @property {string} id The id of the author that is verifying their account.
 */
export type AccountValidationPayload = {
  id: string;
}

import { AuthorData } from './database/authorDatabase.js';
import { PackageData } from './database/packageDatabase.js';
import { authorDatabase, packageDatabase } from './database/databases.js';
import email from './util/email.js';
import { nanoid } from 'nanoid/async';
import * as jwtPromise from './util/jwtPromise.js';
import bcrypt from 'bcrypt';
import NoSuchAccountError from './errors/noSuchAccountError.js';

// When the auth token should expire
const authTokenExpiry = 2.592e9;

const GREETING_LIST = ['Hi', 'Hello', 'Howdy', 'Hola', 'Bonjour', 'Greetings', 'I hope this email finds you well', 'Hey', 'What\'s up', 'Salutations', 'Hey there'];

/**
 * This class defines a user, which is passed as req.user in authorized routes.
 */
export default class Author {

  private _id: string;
  private _name: string;
  private _email: string;
  private _verified: boolean;
  private _lastChange: Date;

  /**
   * Get the id of a user.
   * 
   * @return {string} The id of the user.
   */
  get id() {
    return this._id;
  }

  /**
   * Get the name of a user.
   * 
   * @return {string} The name of the user.
   */
  get name() {
    return this._name;
  }

  /**
   * Get the name to check for of an author, name in lowercase.
   * 
   * @return {string} The name of the user to check for duplication.
   */
  get checkName(): string {
    return this._name.toLowerCase();
  }

  /**
   * Get the email address of the user.
   * 
   * @return {string} The email of the user.
   */
  get email(): string {
    return this._email;
  }

  /**
   * Check if the user is verified.
   * 
   * @return {boolean} True if the user is has verified their email.
   */
  get isVerified(): boolean {
    return this._verified;
  }

  /**
   * The last date that the author changed their name.
   * 
   * @returns {Date} The date of the last time this author changed their name, or the Unix epoch if they never have.
   */
  get lastChangeDate(): Date {
    return this._lastChange;
  }

  /**
   * Create a new user explicitly.
   * 
   * @param {AuthorData} data The data of the author retrieved from the database.
   */
  constructor(data: AuthorData) {
    this._id = data.authorId.trim();
    this._name = data.authorName.trim();
    this._email = data.authorEmail.toLowerCase().trim();
    this._verified = data.verified;
    this._lastChange = data.lastChange ?? new Date(0);
  }

  /**
   * Create a new author and store it in the databse, and get the new {@link Author} object. Assumes that all checks have been passed (i.e. that the author does not already exist).
   * 
   * @async
   * @param {string} name The name of the new author (with casing).
   * @param {stirng} email The email of the new author (should be lowercase).
   * @param {string} passwordHash The hash of the user's password.
   * @returns {Promise<Author>} A promise which resolves to the {@link Author} object when the author is created successfully. 
   */
  static async create(name: string, email: string, passwordHash: string): Promise<Author> {
    const id = await nanoid(16);
    await authorDatabase.createAuthor(id, name, email, passwordHash);
    const author = new Author({
      authorId: id,
      authorName: name,
      authorEmail: email,
      verified: false
    });
    return author;
  }

  /**
   * Retrieve an author from the database using their id and create a new {@link Author} class with it.
   * 
   * @async
   * @param {string} authorId The id of the author to retrieve.
   * @returns {Promise<Author>} A promise which resolves to the author represented by the {@link Author} class.
   */
  static async fromDatabase(authorId: string): Promise<Author> {
    const authorData = await authorDatabase.getAuthor(authorId);
    return new Author(authorData);
  }

  /**
   * Have a user login with their email and password, and get the author from it.
   * 
   * @async
   * @param {string} authorEmail The email of the author who is trying to login (in lowercase).
   * @param {string} authorPassword The password of the author who is trying to login (not hashed).
   * @returns {Promise<Author>} A promise which resolves to the author if the email matches the password, or rejects if the login parameters were invalid.
   */
  static async login(authorEmail: string, authorPassword: string): Promise<Author> {
    const [expectedHash, id] = await authorDatabase.getPasswordAndId(authorEmail);
    const isValid = await bcrypt.compare(authorPassword, expectedHash);

    if (!isValid)

      // We're sending 401 either way so just throw this to differentiate between 401s and 500s
      throw new NoSuchAccountError('password', '*****');

    return Author.fromDatabase(id);
  }

  /**
   * Create an authorization token.
   * 
   * @async
   * @returns {Promise<string>} A promise which resolves to the authorization token.
   */
  async createAuthToken(): Promise<string> {
    return jwtPromise.sign(<AuthTokenPayload>{
      id: this._id,
      name: this._name,
      session: await this.getSession(),
    }, process.env.AUTH_SECRET as string, { expiresIn: authTokenExpiry });
  }

  /**
   * Create a token that a user/author can use to verify their account.
   * 
   * @async
   * @returns {Promise<string>} A promise which resolves to a token which expires in 24 hours which the user can use to verify their account.
   */
  async createVerifyToken(): Promise<string> {
    return jwtPromise.sign(<AccountValidationPayload>{
      id: this._id
    },
      process.env.EMAIL_VERIFY_SECRET as string,
      { expiresIn: '24h' }
    );
  }

  /**
   * Get the session of the user. 
   * 
   * @async
   * @returns {Promise<string>} The session of the user.
   */
  async getSession(): Promise<string> {
    return authorDatabase.getSession(this._id);
  }

  /**
   * Get the packages of the author.
   * 
   * @async
   * @returns {Promise<PackageData>} A promise which resolves to the data of all packages created by this author.
   */
  async getPackages(): Promise<PackageData[]> {
    return packageDatabase.getAuthorPackages(this._id);
  }

  /**
   * Check if an author has a package.
   * 
   * @async
   * @param {string} packageId The id of the package to check if the author owns.
   * @returns {Promise<boolean>} A promise which resolves to true if the author owns a package.
   */
  async hasPackage(packageId: string): Promise<boolean> {
    packageId = packageId.trim().toLowerCase();
    return !!(await this.getPackages()).find(p => p.packageId === packageId);
  }

  /**
   * Change the name of the author, and invalidate the session.
   * 
   * @async
   * @param newName The new name of the author.
   * @returns {Promise<void>} A promise which resolves when the operation completes successfully.
   */
  async changeName(newName: string): Promise<void> {

    // We await this promise instead of returning to hide the return values.
    await Promise.all([
      authorDatabase.updateAuthorName(this._id, newName),
      packageDatabase.updateAuthorName(this._id, newName),
      this._invalidateSession()
    ]);
  }

  /**
   * Send an email to the author.
   * 
   * @async
   * @param {string} subject The subject of the email.
   * @param {string} content The content of the email.
   * @returns {Promise<void>} A promise which resolves when the email has been sent.
   */
  async sendEmail(subject: string, content: string): Promise<void> {
    return email(this._email, subject, content);
  }
  
  /**
   * Get a random greeting for the author.
   * 
   * @returns {string} A random greeting (does not include a comma at the end).
   */
  greeting(): string{
    const randomGreeting = GREETING_LIST[Math.floor(Math.random() * GREETING_LIST.length)];
    return `${randomGreeting} ${this._name}`;
  }

  /**
   * Invalidate the author's current session after making a change.
   * 
   * @async
   * @returns {Promise<void>} A promise which resolves when the session has been updated.
   */
  private async _invalidateSession(): Promise<void> {
    const newSession = await nanoid(16);
    return authorDatabase.updateAuthorSession(this._id, newSession);
  }
}