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
import Author from '../author.js';
import { Version } from '../util/version.js';

/**
 * Enumeration of all possible package types.
 * 
 * @name PackageType
 * @enum {string}
 */
export enum PackageType {
  Aircraft = 'aircraft',
  Executable = 'executable',
  Scenery = 'scenery',
  Plugin = 'plugin',
  Livery = 'livery',
  Other = 'other'
}

/**
 * The data for a single package which is sent to the client.
 * 
 * @typedef {Object} PackageData
 * @property {string} packageId The identifier of the package.
 * @property {string} packageName The name of the package.
 * @property {string} authorId The id of the author that uploaded the package.
 * @property {string} authorName The name of the author that uploaded the package.
 * @property {string} description The description of the package.
 * @property {PackageType} packageType The type of the package.
 */
export type PackageData = {
  packageId: string;
  packageName: string;
  authorId: string;
  authorName: string;
  description: string;
  packageType: PackageType;
};

/**
 * The data for a specific version of a package.
 * 
 * @typedef {Object} VersionData
 * @property {string} packageId The identifier of the package.
 * @property {string} version The semantic version string of the package.
 * @property {string} hash The hexadecimal hash of the package files.
 * @property {boolean} approved True if the version is approved.
 * @property {boolean} published True if the version has been published.
 * @property {boolean} private True if the version will be published later.
 * @property {string} loc The URL from which to download the package version.
 * @property {number} installs The number of installs for this version.
 * @property {Date} uploadDate The upload time of the package.
 */
export type VersionData = {
  packageId: string;
  version: string;
  hash: string;
  approved: boolean;
  published: boolean;
  private: boolean;
  loc: string;
  privateKey: string;
  installs: string;
  uploadDate: Date;
};

/**
 * Interface for all databses that deal with packages.
 * 
 * @interface PackageDatabase
 */
interface PackageDatabase {

  /**
   * Add a new package to the database.
   * 
   * @async 
   * @name PackageDatabase#insertPackage
   * @param {string} packageId The package identifier of the new package.
   * @param {string} packageName The name of the new package.
   * @param {Author} author The author that is creating the package.
   * @param {string} description The description of the new package.
   * @param {PackageType} packageType The type of the package that is being created.
   * @returns {Promise<void>} A promise which resolves if the operation is completed successfully, or rejects if it does not.
   */
  addPackage(packageId: string, packageName: string, author: Author, description: string, packageType: PackageType): Promise<void>;

  /**
   * Create a new version for a package. If both published and private are false, the package is assumed to registered only.
   * 
   * @async
   * @name PackageDatabase#insertVersion
   * @param {string} packageId The package identifier of the package that this version is for.
   * @param {Version} version The version string of the version.
   * @param {Author} author The author that created the package.
   * @param {string} hash The hash of the package as a hexadecimal string.
   * @param {string} loc The URL of the package from which to download.
   * @param {Object} accessConfig The access config of the object.
   * @param {boolean} accessConfig.isPublished True if the package is to be published.
   * @param {boolean} accessConfig.isPrivate True if the package is to be private.
   * @param {string} [accessConfig.privateKey] Access key for the version, must be provided if package is private.
   * @returns {Promise<void>} A promise which resolves if the operation is completed successfully, or rejects if it does not.
   * @throws {InvalidPackageError} Error thrown if the access config is invalid.
   */
  addPackageVersion(packageId: string, version: Version, author: Author, hash: string, loc: string, accessConfig: {
    isPublished: boolean;
    isPrivate: boolean;
    privateKey?: string;
  }): Promise<void>;

  /**
   * Get the package data for a specific package.
   * 
   * @async 
   * @name PackageDatabase#getPackageData
   * @param {string} packageId The identifier of the package to get the data for.
   * @returns {Promise<PackageData>} A promise which resolves to the data of the specified package.
   * @throws {NoSuchPackageError} Error throws if trying to get data for a non-existent package.
   */
  getPackageData(packageId: string): Promise<PackageData>;

  /**
   * Get all package data for all packages.
   * 
   * @async
   * @name PackageDatabase#getPackageData
   * @returns {Promise<PackageData[]>} The data of all of the packages on the registry. 
   */
  getPackageData(): Promise<PackageData[]>;

  /**
   * Get all packages by a certain author
   * 
   * @async
   * @name PackageDatabase#getAuthorPackages
   * @param {string} authorId The id of the author to get the data of.
   * @returns {Promise<PackageData[]>} A promise which resolves to the data of all packages created by the provided author.
   */
  getAuthorPackages(authorId: string): Promise<PackageData[]>;

  /**
   * Get the data for a specific package.
   * 
   * @async
   * @name PackageDatabase#getVersionData
   * @param {string} packageId The id of the package to get the version data for.
   * @param {Version} version The version string of the package to get the data for.
   * @returns {Promise<VersionData>} A promise which resolves to the version data for the specified version of the requested package.
   * @throws {NoSuchPackageError} Error thrown if the package does not exist, or the version does not exist.
   */
  getVersionData(packageId: string, version: Version): Promise<VersionData>;

  /**
   * Get the data for all versions of a package.
   * 
   * @async
   * @name PackageDatabase#getVersionData
   * @param {string} packageId The id of the package to get the version data for.
   * @returns {Promise<VersionData[]>} A promise which resolves to all of the version data for all versions of the specified package.
   * @throws {NoSuchPackageError} Error thrown if the package does not exist, or the version does not exist.
   */
  getVersionData(packageId: string): Promise<VersionData[]>;

  /**
   * Check if a package exists with a given id.
   * 
   * @async
   * @name PackageDatabase#packageIdExists
   * @param {string} packageId The id to check for existence.
   * @returns {Promise<boolean>} A promise which resolves to true if the package id is already in use.
   */
  packageIdExists(packageId: string): Promise<boolean>;

  /**
   * Check if the given package has the given version.
   * 
   * @async
   * @name PackageDatabase#versionExists
   * @param {string} packageId The package id to check for version existence.
   * @param {Version} version The version to check for existence.
   * @returns {Promise<boolean>} A promise which resolves to true if the package already has the version.
   * @throws {NoSuchPackageError} Error thrown if the package does not exist.
   */
  versionExists(packageId: string, version: Version): Promise<boolean>;

  /**
   * Check if a package exists with a given name.
   * 
   * @async
   * @name PackageDatabase#packageNameExists
   * @param {string} packageName The package name to check for
   * @returns {Promise<boolean>} A promise which resolves to true if the name is already in use.
   */
  packageNameExists(packageName: string): Promise<boolean>;

  /**
   * Update any packages that was made by the author with the id and change the name.
   * 
   * @async
   * @name PackageDatabase#updateAuthorName
   * @param authorId The id of the author to change the name of.
   * @param newName The new name of the author.
   * @returns {Promise<void>} A promise which resolves if the operation completes successfully.
   */
  updateAuthorName(authorId: string, newName: string): Promise<void>;
}

// We have to seperate the export because EsLint gets mad
export default PackageDatabase;