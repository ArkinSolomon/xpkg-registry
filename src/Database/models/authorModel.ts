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
 * @param {TokenInformation} tokens The author's tokens.
 * @param {(string, string) => Promise<void>} sendEmail Send an email to the author, where the first argument is the email subject, and the second argument is the email content.
 * @param {() => Promise<string>} createAuthToken Create a new JWT used for authorization, which expires in 6 hours.
 * @param {() => Promise<string>} createVerifyToken Create a new JWT used for account verification, which expires in 12 hours.
 * @param {(string) => Promise<void>} changeName Change the name of the author.
 * @param {(AuthToken, number, string, [string])} registerNewToken Register a token on the author. 
 * @param {(string) => boolean} hasTokenName A function which rreturns true if the author already has a token with the name.
 * @param {(number) => Promise<boolean>} tryConsumeStorage Try to consume some of the author's storage, if there is space.
 * @param {(number) => Promise<void>} freeStorage Free up some of the author's storage space, or set it to zero if attempting to free too much.
 */
export type DatabaseAuthor = AuthorData & {
  password: string;
  session: string;
  tokens: TokenInformation[];
  sendEmail: (subject: string, content: string) => Promise<void>;
  createAuthToken: () => Promise<string>;
  createVerifyToken: () => Promise<string>;
  changeName: (newName: string) => Promise<void>;
  registerNewToken: (token: AuthToken, tokenExpiry: number, tokenName: string, tokenDescription?: string) => Promise<void>;
  hasTokenName: (tokenName: string) => boolean;
  tryConsumeStorage: (size: number) => Promise<boolean>;
  freeStorage: (size: number) => Promise<void>;
};

/**
 * The data for a single token.
 * 
 * @typedef {Object} TokenInformation
 * @property {string} tokenSession The session of the token.
 * @property {string} tokenName The name of the token.
 * @property {string} [tokenDescription] The description of the token.
 * @property {number} permissions The permissions of the token.
 * @property {string[]} versionUploadPackages Specific packages that this token has permission to upload versions for.
 * @property {string[]} descriptionUpdatePackages Specific packages that this token has permission to update the descriptions of.
 * @property {string[]} updateVersionDataPackages Specific packages that this token has permission to update the data of the versions.
 * @property {number} tokenExpiry A non-zero number which is the amount of days until the token expires. 
 */
type TokenInformation = {
  tokenSession: string;
  tokenName: string;
  tokenDescription?: string;
  permissions: number;
  versionUploadPackages: string[];
  descriptionUpdatePackages: string[];
  updateVersionDataPackages: string[];
  tokenExpiry: number;
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
import AuthToken, { TokenPermission } from '../../auth/authToken.js';
import * as packageDatabase from '../packageDatabase.js';

const tokenInformationSchema = new Schema<TokenInformation>({
  tokenSession: {
    type: String,
    required: true,
    unique: true
  },
  tokenName: {
    type: String,
    required: true,
    lowercase: true,
    unique: true,
    minlength: 3,
    maxlength: 32
  },
  tokenDescription: {
    type: String,
    required: false,
    maxlength: 256
  },
  permissions: {
    type: Number,
    required: true
  },
  versionUploadPackages: {
    type: [String],
    required: true
  },
  descriptionUpdatePackages: {
    type: [String],
    required: true
  },
  updateVersionDataPackages: {
    type: [String],
    required: true
  },
  tokenExpiry: {
    type: Number,
    required: true
  }
}, { _id : false });

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
    unique: true
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
  tokens: {
    type: [tokenInformationSchema],
    required: true
  }
}, {
  collection: 'authors',
  methods: {
    sendEmail: async function(subject: string, content: string): Promise<void> {
      return email(this.authorEmail, subject, content);
    },
    createAuthToken: async function(): Promise<string> {
      const token = new AuthToken({
        authorId: this.authorId,
        session: this.session,
        permissions: TokenPermission.Admin,
        versionUploadPackages: [],
        descriptionUpdatePackages: [],
        updateVersionDataPackages: []
      });

      return await token.sign('6h');
    },
    createVerifyToken: async function(): Promise<string> {
      return jwtPromise.sign(<AccountValidationPayload>{
        id: this.authorId
      },
        process.env.EMAIL_VERIFY_SECRET as string,
        { expiresIn: '24h' }
      );
    },
    changeName: async function(newName: string): Promise<void> {
      this.authorName = newName;
      await Promise.all([
        this.save(),
        packageDatabase.updateAuthorName(this.authorId, newName),
      ]);
    },
    registerNewToken: async function (token: AuthToken, tokenExpiry: number, tokenName: string, description?: string): Promise<void> {
      const tokenSession = token.tokenSession;
      if (!tokenSession)
        throw new Error('Can not register a token for an author without a token session');

      let { versionUploadPackages, descriptionUpdatePackages, updateVersionDataPackages } = token;
      versionUploadPackages ??= [];
      descriptionUpdatePackages ??= [];
      updateVersionDataPackages ??= [];

      await AuthorModel.updateOne({
        authorId: this.authorId,
      }, {
        $push: {
          tokens: {
            tokenSession,
            tokenName,
            tokenDescription: description,
            permissions: token.permissionsNumber,
            versionUploadPackages,
            descriptionUpdatePackages,
            updateVersionDataPackages,
            tokenExpiry
          }
        }
      });
    },
    hasTokenName: function (tokenName: string): boolean {
      return !!this.tokens.find(t => t.tokenName === tokenName);
    },
    tryConsumeStorage: async function(size: number): Promise<boolean> {
      if (this.usedStorage + size > this.totalStorage)
        return false;
      this.usedStorage += size;
      await this.save();
      return true;
    },
    freeStorage: async function (size: number): Promise<void> {
      this.usedStorage = Math.max(this.usedStorage - size, 0);
      await this.save();
    }
  }
});

const authorsDB = mongoose.connection.useDb('authors');
const AuthorModel = authorsDB.model<DatabaseAuthor>('author', authorSchema);

export default AuthorModel;
