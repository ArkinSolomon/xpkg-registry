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
 * The data that can exit the server for the author.
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
 * All author data stored in the database, as well as methods for the author.
 * 
 * @typedef {Object} AuthorData
 * @param {string} password The 60 character long hash of the author password.
 * @param {string} session The session of the author which is invalidated on password resets.
 * @param {(string, string) => void} sendEmail Send an email to the author, where the first argument is the email subject, and the second argument is the email content.
 * @param {() => void} createAuthToken Create a new JWT used for authorization, which expires in 6 hours.
 * @param {() => void} createVerifyToken Create a new JWT used for account verification, which expires in 12 hours.
 */
export type DatabaseAuthor = AuthorData & {
  password: string;
  session: string;
  sendEmail: (subject: string, content: string) => Promise<void>;
  createAuthToken: () => Promise<string>;
  createVerifyToken: () => Promise<string>;
};

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

import mongoose, { Schema } from 'mongoose';
import '../atlasConnect.js';
import email from '../../util/email.js';
import * as jwtPromise from '../../util/jwtPromise.js';

const authorSchema = new Schema<DatabaseAuthor>({
  authorId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  authorName: {
    type: String,
    required: true,
    unique: true // All though this is unique, it's not case-insensitive
  },
  authorEmail: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    index: true
  },
  verified: {
    type: Boolean,
    required: true,
    default: false
  },
  lastChange: Date,
  usedStorage: {
    type: Number,
    default: 0,
    validate: function (this: AuthorData, value: number) {
      return value >= 0 && value <= this.totalStorage;
    }
  },
  totalStorage: {
    type: Number,
    default: 536870912,
    required: true
  },
  password: {
    type: String,
    required: true
  },
  session: {
    type: String,
    required: true
  },
}, {
  collection: 'authors',
  methods: {
    async sendEmail(this: DatabaseAuthor, subject: string, content: string): Promise<void> {
      return email(this.authorEmail, subject, content);
    },
    async createAuthToken(this: DatabaseAuthor): Promise<string> {
      return jwtPromise.sign(<AuthTokenPayload>{
        id: this.authorId,
        name: this.authorName,
        session: await this.session,
      }, process.env.AUTH_SECRET as string, { expiresIn: '6h' });
    },
    async createVerifyToken(this: DatabaseAuthor): Promise<string> {
      return jwtPromise.sign(<AccountValidationPayload>{
        id: this.authorId
      },
        process.env.EMAIL_VERIFY_SECRET as string,
        { expiresIn: '24h' }
      );
    }
  }
});

const authorsDB = mongoose.connection.useDb('authors');
const AuthorModel = authorsDB.model<DatabaseAuthor>('author', authorSchema);

export default AuthorModel;
