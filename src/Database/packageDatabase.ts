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
 * Enumeration of all possible package types.
 * 
 * @enum {string}
 */
enum PackageType {
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
 * @property {number} installs The number of installs of the package.
 */
export type PackageData = {
  packageId: string;
  packageName: string;
  authorId: string;
  authorName: string;
  description: string;
  packageType: PackageType;
  installs: number;
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
 */
export type VersionData = {
  packageId: string;
  version: string;
  hash: string;
  approved: boolean;
  published: boolean;
  private: boolean;
  loc: string;
};

/**
 * Interface for all databses that deal with packages.
 * 
 * @interface PackageDatabase
 */
interface PackageDatabase {

  /**
   * Insert a new package into the database.
   * 
   * @async 
   * @name PackageDatabase#insertPackage
   * @param {string} packageId The package identifier of the new package.
   * @param {string} packageName The name of the new package.
   * @param {string} authorId The id of the author that is creating the package.
   * @param {string} description The description of the new package.
   * @param {string} packageType The type of the package that is being created.
   * @returns {Promise<void>} A promise which resolves if the operation is completed successfully, or rejects if it does not.
   */
  addPackage(packageId: string, packageName: string, authorId: string, authorName: string, description: string, packageType: string): Promise<void>;

  /**
   * Create a new version for a package.
   * 
   * @async
   * @name PackageDatabase#insertVersion
   * @param {string} packageId The package identifier of the package that this version is for.
   * @param {string} version The version string of the package.
   * @param {string} hash The hash of the package as a hexadecimal string.
   * @param {boolean} published True if the package is being uploaded.
   * @param {string} loc The URL of the package from which to download.
   * @param {string} authorId The id of the author of the package.
   * @returns {Promise<void>} A promise which resolves if the operation is completed successfully, or rejects if it does not.
   */
  addPackageVersion(packageId: string, version: string, hash: string, published: boolean, loc: string, authorId: string): Promise<void>;

  /**
   * Get the package data for a specific package.
   * 
   * @async 
   * @name PackageDatabase#getPackageData
   * @param {string} packageId The identifier of the package to get the data for.
   * @returns {Promise<PackageData>} A promise which resolves to the data of the package.
   */
  getPackageData(packageId: string): Promise<PackageData>;

  /**
   * Get all package data for all packages.
   * 
   * @async
   * @name PackageDatabase#getPackageData
   * @returns {Promise<PackageData>}
   */
  getPackageData(): Promise<PackageData[]>;

  /**
   * Get the data for a specific package.
   * 
   * @async
   * @name PackageDatabase#getVersionData
   * @param {string} packageId The id of the package to get the version data for.
   * @param {string} version The version string of the package to get the data for.
   * @returns {Promise<VersionData>} A promise which resolves to the version data for the specified version of the requested package.
   */
  getVersionData(packageId: string, version: string): Promise<VersionData>;

  /**
   * Get the data for all versions of a package.
   * 
   * @async
   * @name PackageDatabase#getVersionData
   * @param {string} packageId The id of the package to get the version data for.
   * @returns {Promise<VersionData[]>} A promise which resolves to all of the version data for all versions of the specified package.
   */
  getVersionData(packageId: string): Promise<VersionData[]>;

  packageIdExists(packageId: string): Promise<boolean>;
  packageNameExists(packageName: string): Promise<boolean>;

  updateAuthorName(authorId: string, newName: string): Promise<void>;
}

// We have to seperate the export because EsLint gets mad
export default PackageDatabase;