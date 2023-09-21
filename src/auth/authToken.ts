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
 * Permissions that a token has. Remember to update the permission number validator when updating this to the maximum bitshift + 1.
 * 
 * @enum
 * @type {number}
 */
export enum TokenPermission {
  None = 0,
  Admin = 1 << 0, // Only humans (required for changing password, sending verification email, etc.)
  CreatePackage = 1 << 1,
  UploadVersionAnyPackage = 1 << 2,
  UpdateDescriptionAnyPackage = 1 << 3,
  UploadVersionSpecificPackages = 1 << 4,
  UpdateDescriptionSpecificPackages = 1 << 5,
  UploadResources = 1 << 6,
  ReadAuthorData = 1 << 7,
  UpdateAuthorData = 1 << 8,
  ViewPackages = 1 << 9,
  ViewResources = 1 << 10,
  UpdateVersionDataAnyPackage = 1 << 11,
  UpdateVersionDataSpecificPackages = 1 << 12,
  ViewAnalyticsAnyPackage = 1 << 13,
  ViewAnalyticsSpecificPackages = 1 << 14
}

/**
 * Payload of a token used for authorization.
 * 
 * @interface
 * @property {string} authorId The id of the author that generated this token.
 * @property {string} session The session of the author.
 * @property {number} permissions The permissions number (see {@link Permissions}).
 * @property {string[]} versionUploadPackages Specific packages that this token has permission to upload versions for.
 * @property {string[]} descriptionUpdatePackages Specific packages that this token has permission to update the descriptions of.
 * @property {string[]} updateVersionDataPackages Specific packages that this token has permission to update the data of versions of.
 * @property {string[]} viewAnalyticsPackages Specific packages that this token has permission to view the analytics data of.
 * @property {string} [tokenSession] The session of the token (changes for invalidation). Undefined for human authors.
 */
export type AuthTokenPayload = {
  authorId: string;
  session: string;
  permissions: number;
  versionUploadPackages: string[];
  descriptionUpdatePackages: string[];
  updateVersionDataPackages: string[]; 
  viewAnalyticsPackages: string[];
  tokenSession?: string;
}

import logger from '../logger.js';
import * as jwtPromise from '../util/jwtPromise.js';
import { getAuthorDoc } from '../database/authorDatabase.js';

const AUTH_SECRET = process.env.AUTH_SECRET;
if (!AUTH_SECRET) {
  logger.fatal('No authorization token secret provided (AUTH_SECRET)');
  process.exit(1);
}

/**
 * A new token used for authorization.
 */
export default class AuthToken {

  private _payload: AuthTokenPayload;
  private _authorDoc?: Awaited<ReturnType<typeof getAuthorDoc>>;

  /**
   * Get the id of the author who generated the token.
   * 
   * @returns {string} The id of the author who generated this token.
   */
  get authorId(): string {
    return this._payload.authorId;
  }

  /**
   * Get the author session of the token.
   * 
   * @returns {string} The author's session.
   */
  get session(): string {
    return this._payload.session;
  }

  /**
   * Get the token session of the token. Undefined if there is no token session.
   * 
   * @returns {string|undefined} The token session of the token.
   */
  get tokenSession(): string|undefined {
    return this._payload.tokenSession;
  }

  /**
   * Get the permissions number that this token has.
   * 
   * @returns {number} The permissions number that this token has.
   */
  get permissionsNumber(): number {
    return this._payload.permissions;
  }

  /**
   * Get the packages that this token can upload to.
   * 
   * @returns {string[]|undefined} The packages that this token can upload new versions to.
   */
  get versionUploadPackages(): string[] | undefined {
    return this._payload.versionUploadPackages;
  }

  /**
   * Get the packages that this token can update the descriptions of.
   * 
   * @returns {string[]|undefined} The packages that this token can update the description of.
   */
  get descriptionUpdatePackages(): string[] | undefined {
    return this._payload.descriptionUpdatePackages;
  }

  /**
   * Get the packages that this token can update the version data of.
   * 
   * @returns {string[]|undefined} The packages that this token can update the version data of.
   */
  get updateVersionDataPackages(): string[] | undefined {
    return this._payload.updateVersionDataPackages;
  }

  /**
   * Get the packages that this token can view the analytics of.
   * 
   * @returns {string[]|undefined} The packages that this token can update the version data of.
   */
  get viewAnalyticsPackages(): string[] | undefined {
    return this._payload.viewAnalyticsPackages;
  }

  /**
   * Create a new authorization token instance.
   * 
   * @param {AuthTokenPayload} payload The payload of the token.
   */
  constructor(payload: AuthTokenPayload) {
    this._payload = payload; 
  }

  /**
   * Decode and verify a token, and create a new authorization token instance.
   * 
   * @async
   * @param {string} token The token to decode and verify.
   * @returns {Promise<AuthToken>} An authorization token instance.
   */
  static async verify(token: string): Promise<AuthToken> {
    const payload = await jwtPromise.decode(token, AUTH_SECRET as string);
    return new AuthToken(payload as AuthTokenPayload);
  }

  /**
   * Sign the token payload to get a JWT token string.
   * 
   * @async
   * @param {string} expires A string to define when the token expires, like "6h" or "10d".
   * @returns {Promise<string>} A promise which resolves to the JWT token string.
   */
  async sign(expires: string): Promise<string> {
    return jwtPromise.sign(this._payload, AUTH_SECRET as string, {
      expiresIn: expires,
      algorithm: 'HS384'
    });
  }

  /**
   * Check if the token bearer has permission to do something. Note that this returns true if the token has administrator permissions ({@link TokenPermission~Admin}).
   * 
   * @param permission The permission to check for.
   * @returns {boolean} True if the token bearer is authorized to perform a certain action.
   */
  public hasPermission(permission: TokenPermission): boolean {
    return (this._payload.permissions & (permission | TokenPermission.Admin)) > 0;
  }

  /**
   * Determine if the token bearer has permission to upload a version to a specific package.
   * 
   * @param {string} packageId The partial identifier of the package to check for permissions.
   * @returns {boolean} True if the bearer of this token is authorized to upload a version to the package.
   */
  public canUploadPackageVersion(packageId: string): boolean {
    return this.hasPermission(TokenPermission.UploadVersionAnyPackage) || this.hasPermission(TokenPermission.UploadVersionSpecificPackages) && (this._payload.versionUploadPackages || []).includes(packageId);
  }

  /**
   * Determine if the token bearer has permission to update the description of a package.
   * 
   * @param {string} packageId The partial identifier of the package to check for permissions.
   * @returns {boolean} True if the bearer of this token is authorized to update the description of the package.
   */
  public canUpdatePackageDescription(packageId: string): boolean {
    return this.hasPermission(TokenPermission.UpdateDescriptionAnyPackage) || this.hasPermission(TokenPermission.UpdateDescriptionSpecificPackages) && (this._payload.descriptionUpdatePackages || []).includes(packageId);
  }

  /**
   * Determine if the token bearer has permission to update the data of a package version.
   * 
   * @param {string} packageId The partial identifier of the package to check for permissions.
   * @returns {boolean} True if the bearer of this token is authorized to update the data of any version for a specific package.
   */
  public canUpdateVersionData(packageId: string): boolean {
    return this.hasPermission(TokenPermission.UpdateVersionDataAnyPackage) || this.hasPermission(TokenPermission.UpdateVersionDataSpecificPackages) && (this._payload.updateVersionDataPackages || []).includes(packageId);
  }

  /**
   * Determine if the token bearer has permission to update the data of a package version.
   * 
   * @param {string} packageId The partial identifier of the package to check.
   * @returns {boolean} True if the bearer of this token is authorized to view the analytics for a specific package.
   */
  public canViewAnalytics(packageId: string): boolean {
    return this.hasPermission(TokenPermission.ViewAnalyticsAnyPackage) || this.hasPermission(TokenPermission.ViewAnalyticsSpecificPackages) && (this._payload.viewAnalyticsPackages || []).includes(packageId);
  }

  /**
   * Get the author from the database.
   * 
   * @async
   * @returns {Promise} A promise which resolves to the Mongoose author document of the author that issued this token.
   */
  public async getAuthor() {
    if (!this._authorDoc)
      this._authorDoc = await getAuthorDoc(this._payload.authorId);    
    return this._authorDoc;
  }
}