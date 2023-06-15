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
 * Enumeration of all statuses for package versions.
 * 
 * @name VersionStatus
 * @enum {string}
 */
export enum VersionStatus {
  Processing = 'processing', 
  Processed = 'processed',
  Removed = 'removed', // The version has been removed 
  FailedMACOSX = 'failed_macosx', // The version failed due to having only a __MACOSX file
  FailedNoFileDir = 'failed_no_file_dir', // No directory with the package id present
  FailedManifestExists = 'failed_manifest_exists', // Can not have a manifest.json file
  FailedInvalidFileTypes = 'failed_invalid_file_types', // Can not have symbolic links or executables
  FailedServer = 'failed_server', // Server error
  Aborted = 'aborted' // Job took too long
}

import Author from '../author.js';
import Version from '../util/version.js';

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
 * @property {boolean} isPublic True if the version is public.
 * @property {boolean} isStored True if the version is stored.
 * @property {string} loc The URL from which to download the package version.
 * @property {number} installs The number of installs for this version.
 * @property {Date} uploadDate The upload time of the package.
 * @property {VersionStatus} VersionStatus The status of the package.
 * @property {[string][string][]} dependencies The dependencies of the version.
 * @property {[string][string][]} incompatibilities The incompatibilities of the version.
 */
export type VersionData = {
  packageId: string;
  version: string;
  hash: string;
  isPublic: boolean;
  isStored: boolean;
  loc: string;
  privateKey: string;
  installs: number;
  uploadDate: Date;
  status: VersionStatus;
  dependencies: [string, string][];
  incompatibilities: [string, string][];
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
   * @param {Object} accessConfig The access config of the package version.
   * @param {boolean} accessConfig.isPublic True if the package is to be public.
   * @param {boolean} accessConfig.isStored True if the package is to be stored, must be true if public is true.
   * @param {string} [accessConfig.privateKey] Access key for the version, must be provided if package is private and stored.
   * @param {[string][string][]} [dependencies] The dependencies of the version.
   * @param {[string][string][]} [incompatibilities] The incompatibilities of the version.
   * @returns {Promise<void>} A promise which resolves if the operation is completed successfully, or rejects if it does not.
   * @throws {InvalidPackageError} Error thrown if the access config is invalid.
   * @throws {NoSuchPackageError} Error thrown if the package does not exist.
   */
  addPackageVersion(packageId: string, version: Version, accessConfig: {
    isPublic: boolean;
    isStored: boolean;
    privateKey?: string;
  }, dependencies: [string, string][], incompatibilities: [string, string][]): Promise<void>;

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
   * @returns {Promise<VersionData[]>} A promise which resolves to all of the version data for all versions of the specified package. If no versions exist, an empty array is returned.
   * @throws {NoSuchPackageError} Error thrown if the package does not exist.
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
   * @param {string} authorId The id of the author to change the name of.
   * @param {string} newName The new name of the author.
   * @returns {Promise<void>} A promise which resolves if the operation completes successfully.
   */
  updateAuthorName(authorId: string, newName: string): Promise<void>;

  /**
   * Update the description for a package.
   * 
   * @async
   * @name PackageDatabase#updateDescription
   * @param {string} packageId The id of the package which we're changing the description of.
   * @param {string} newDescription The new description of the package.
   * @returns {Promise<void>} A promise which resolves if the operation completes successfully.
   * @throws {NoSuchPackageError} Error thrown if no package exists with the given id.
   */
  updateDescription(packageId: string, newDescription: string): Promise<void>;

  /**
   * Set the information after finishing processing a package version. Also update the status to {@link VersionStatus#Processed}.
   * 
   * @async
   * @name PackageDatabase#resolveVersionData
   * @param {string} packageId The id of the package which contains the version to update.
   * @param {Version} version The version of the package to update the version data of.
   * @param {string} hash The sha256 checksum of the package.
   * @param {string} loc The URL of the package, or "NOT_STORED" if the package is not stored.
   * @returns {Promise<void>} A promise which resolves if the operation completes successfully.
   * @throws {NoSuchPackageError} Error thrown if no package exists with the given id or version.
   */
  resolveVersionData(packageId: string, version: Version, hash: string, loc: string): Promise<void>;

  /**
   * Update the status of a specific package version.
   * 
   * @async
   * @name PackageDatabase#updateStatus
   * @param {string} packageId The id of the package which contains the version to update.
   * @param {Version} version The version of the package to update the status of.
   * @param {VersionStatus} newStatus The new status to set.
   * @returns {Promise<void>} A promise which resolves if the operation completes successfully.
   * @throws {NoSuchPackageError} Error thrown if no package exists with the given id or version.
   */
  updatePackageStatus(packageId: string, version: Version, newStatus: VersionStatus): Promise<void>;
}

// We have to seperate the export because EsLint gets mad
export default PackageDatabase;