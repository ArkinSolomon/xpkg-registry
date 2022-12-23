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
import AuthorDatabase from './Database/authorDatabase.js';

const authorDatabase: AuthorDatabase = null as unknown as AuthorDatabase;

/**
 * This class defines a user, which is passed as {@code req.user} in authorized routes.
 */
export default class Author {

  private _id: string;
  private _name: string;
  private _email: string;
  private _verified: boolean;

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
   * Get the name to check for of an author, {@code name} in lowercase.
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
   * @return {boolean} True if the user is verified.
   */
  get isVerified(): boolean {
    return this._verified;
  }

  /**
   * Create a new user explicitly.
   * 
   * @param {string} id The id of the user.
   * @param {string} name The name of the user.
   * @param {string} email The email of the user.
   * @param {boolean} verified True if the user is verified.
   */
  constructor(id: string, name: string, email: string, verified: boolean) {
    this._id = id.trim();
    this._name = name.trim();
    this._email = email.toLowerCase().trim();
    this._verified = verified;
  }
}