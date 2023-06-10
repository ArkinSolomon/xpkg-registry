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
 * Internal package data that is not accessible from outside of this interface.
 * 
 * @typedef {Object} InternalPackageData 
 * @param {VersionData[]} versions All of the versions of the package.
 * @param {number} versions[].uploadDate The upload date of the package as a millisecond unix timestamp.
 */
type InternalPackageData = {
  versions: (Omit<VersionData, 'uploadDate'> & { uploadDate: number; })[];
};

import Author from '../../author.js';
import InvalidPackageError from '../../errors/invalidPackageError.js';
import NoSuchPackageError from '../../errors/noSuchPackageError.js';
import { Version, versionStr } from '../../util/version.js';
import PackageDatabase, { PackageData, PackageType, VersionData, VersionStatus } from '../packageDatabase.js';
import JsonDB from './jsonDB.js';

/**
 * Package database implemented in JSON. Again, not for production use.
 */
class JsonPackageDB extends JsonDB<PackageData & InternalPackageData> implements PackageDatabase {
  
  /**
   * Create a new package database.
   */
  constructor() {
    super('package');
  }

  /**
   * Add a new package to the database.
   * 
   * @async 
   * @param {string} packageId The package identifier of the new package.
   * @param {string} packageName The name of the new package.
   * @param {Author} author The author that is creating the package.
   * @param {string} description The description of the new package.
   * @param {PackageType} packageType The type of the package that is being created.
   * @returns {Promise<void>} A promise which resolves if the operation is completed successfully, or rejects if it does not.
   */
  async addPackage(packageId: string, packageName: string, author: Author, description: string, packageType: PackageType): Promise<void> {
    packageId = packageId.trim().toLowerCase();

    this._data.push({
      packageId,
      packageName,
      authorId: author.id,
      authorName: author.name,
      description,
      packageType,
      versions: []
    });

    return this._save();
  }

  /**
   * Create a new version for a package. If both published and private are false, the package is assumed to registered only.
   * 
   * @async
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
  async addPackageVersion(packageId: string, version: Version, accessConfig: {
    isPublic: boolean;
    isStored: boolean;
    privateKey?: string;
  }, dependencies: [string, string][], incompatibilities: [string, string][]): Promise<void> {
    packageId = packageId.trim().toLowerCase();
    const versionString = versionStr(version);

    if (accessConfig.isPublic && !accessConfig.isStored)
      throw new InvalidPackageError('published_private_version');

    if (!accessConfig.isPublic && accessConfig.isStored && !accessConfig.privateKey )
      throw new InvalidPackageError('no_private_key');

    const versionData: InternalPackageData['versions'][number] = {
      packageId,
      version: versionString,
      hash: '---',
      loc: '---',
      isPublic: accessConfig.isPublic,
      isStored: accessConfig.isStored,
      installs: 0,
      uploadDate: Date.now(),
      privateKey: accessConfig.privateKey || '',
      status: VersionStatus.Processing,
      dependencies,
      incompatibilities
    };

    const pkg = this._data.find(p => p.packageId === packageId);

    if (!pkg)
      throw new NoSuchPackageError(packageId);

    pkg.versions.push(versionData);
    return this._save();
  }

  /**
   * Get the package data for a specific package.
   * 
   * @async 
   * @param {string} packageId The identifier of the package to get the data for.
   * @returns {Promise<PackageData>} A promise which resolves to the data of the specified package.
   * @throws {NoSuchPackageError} Error throws if trying to get data for a non-existent package.
   */
  async getPackageData(packageId: string): Promise<PackageData>;

  /**
   * Get all package data for all packages.
   * 
   * @async
   * @returns {Promise<PackageData[]>} The data of all of the packages on the registry. 
   */
  async getPackageData(): Promise<PackageData[]>;

  async getPackageData(packageId?: string): Promise<PackageData | PackageData[]> {
    if (typeof packageId !== 'undefined') {
      const pkg = this._data.find(p => p.packageId === packageId);

      if (!pkg)
        throw new NoSuchPackageError(packageId);
      
      return JSON.parse(JSON.stringify(pkg));
    } else {
      return JSON.parse(JSON.stringify(this._data));
    }
  }

  /**
   * Get all packages by a certain author
   * 
   * @async
   * @param {string} authorId The id of the author to get the data of.
   * @returns {Promise<PackageData[]>} A promise which resolves to the data of all packages created by the provided author.
   */
  async getAuthorPackages(authorId: string): Promise<PackageData[]> {
    const packages = this._data.filter(p => p.authorId === authorId);

    return JSON.parse(JSON.stringify(packages));
  }

  /**
   * Get the data for a specific package.
   * 
   * @async
   * @param {string} packageId The id of the package to get the version data for.
   * @param {Version} version The version string of the package to get the data for.
   * @returns {Promise<VersionData>} A promise which resolves to the version data for the specified version of the requested package.
   * @throws {NoSuchPackageError} Error thrown if the package does not exist, or the version does not exist.
   */
  async getVersionData(packageId: string, version: Version): Promise<VersionData>;

  /**
   * Get the data for all versions of a package.
   * 
   * @async
   * @param {string} packageId The id of the package to get the version data for.
   * @returns {Promise<VersionData[]>} A promise which resolves to all of the version data for all versions of the specified package.
   * @throws {NoSuchPackageError} Error thrown if the package does not exist, or the version does not exist.
   */
  async getVersionData(packageId: string): Promise<VersionData[]>;

  async getVersionData(packageId: string, version?: Version): Promise<VersionData | VersionData[]> {
    packageId = packageId.trim().toLowerCase();
    const pkg = this._data.find(p => p.packageId == packageId);

    if (!pkg)
      throw new NoSuchPackageError(packageId);
    
    if (typeof version !== 'undefined') {
      const versionString = versionStr(version);

      const vData = pkg.versions.find(v => v.version === versionString);
      const retData = JSON.parse(JSON.stringify(vData)) as unknown as VersionData;
      retData.uploadDate = new Date(vData?.uploadDate as number);
      return JSON.parse(JSON.stringify(vData));
    } else {
      const versions = pkg.versions.map(v => {
        const newData = JSON.parse(JSON.stringify(v)) as VersionData;
        newData.uploadDate = new Date(v.uploadDate);
        return newData;
      });
      return versions;
    }
  }
  
  /**
   * Check if a package exists with a given id.
   * 
   * @async
   * @param {string} packageId The id to check for existence.
   * @returns {Promise<boolean>} A promise which resolves to true if the package id is already in use.
   */
  async packageIdExists(packageId: string): Promise<boolean> {
    packageId = packageId.trim().toLowerCase();
    return !!this._data.find(p => p.packageId === packageId);
  }

  /**
   * Check if the given package has the given version.
   * 
   * @async
   * @param {string} packageId The package id to check for version existence.
   * @param {Version} version The version to check for existence.
   * @returns {Promise<boolean>} A promise which resolves to true if the package already has the version.
   * @throws {NoSuchPackageError} Error thrown if the package does not exist.
   */
  async versionExists(packageId: string, version: Version): Promise<boolean> {
    packageId = packageId.trim().toLowerCase();

    const pkg = this._data.find(p => p.packageId === packageId);

    if (!pkg)
      throw new NoSuchPackageError(packageId);

    const versionString = versionStr(version);
    return !!pkg.versions.find(v => v.version === versionString);
  }

  /**
   * Check if a package exists with a given name.
   * 
   * @async
   * @param {string} packageName The package name to check for
   * @returns {Promise<boolean>} A promise which resolves to true if the name is already in use.
   */
  async packageNameExists(packageName: string): Promise<boolean> {
    packageName = packageName.trim().toLowerCase();
    return !!this._data.find(p => p.packageName.trim().toLowerCase() === packageName);
  }

  /**
   * Update any packages that was made by the author with the id and change the name.
   * 
   * @async
   * @param {string} authorId The id of the author to change the name of.
   * @param {string} newName The new name of the author.
   * @returns {Promise<void>} A promise which resolves if the operation completes successfully.
   */
  async updateAuthorName(authorId: string, newName: string): Promise<void> {
    authorId = authorId.trim();
    newName = newName.trim();

    // We don't use getAuthorPackages() since it returns a copy
    const authorPackages = this._data.filter(p => p.authorId === authorId);
    for (const pkg of authorPackages)
      pkg.authorName = newName;

    return this._save();
  }

  /**
   * Update the description for a package.
   * 
   * @async
   * @param {string} packageId The id of the package which we're changing the description of.
   * @param {string} newDescription The new description of the package.
   * @returns {Promise<void>} A promise which resolves if the operation completes successfully.
   * @throws {NoSuchPackageError} Error thrown if no package exists with the given id.
   */
  async updateDescription(packageId: string, newDescription: string): Promise<void> {
    packageId = packageId.trim().toLowerCase();
    newDescription = newDescription.trim();

    const pkg = this._data.find(p => p.packageId === packageId);
    
    if (!pkg)
      throw new NoSuchPackageError(packageId);

    pkg.description = newDescription;
    
    return this._save();
  }

  /**
   * Set the information after finishing processing a package version. Also update the status to {@link VersionStatus#Processed}.
   * 
   * @async
   * @param {string} packageId The id of the package which contains the version to update.
   * @param {Version} version The version of the package to update the version data of.
   * @param {string} hash The sha256 checksum of the package.
   * @param {string} loc The URL of the package, or "NOT_STORED" if the package is not stored.
   * @returns {Promise<void>} A promise which resolves if the operation completes successfully.
   * @throws {NoSuchPackageError} Error thrown if no package exists with the given id or version.
   */
  async resolveVersionData(packageId: string, version: Version, hash: string, loc: string): Promise<void> {
    packageId = packageId.trim().toLowerCase();

    const pkg = this._data.find(p => p.packageId === packageId);
    
    if (!pkg)
      throw new NoSuchPackageError(packageId);
    
    const versionString = versionStr(version);
    const pkgVersion = pkg.versions.find(v => v.version === versionString);

    if (!pkgVersion)
      throw new NoSuchPackageError(packageId, versionString);
    
    pkgVersion.hash = hash.toUpperCase();
    pkgVersion.loc = loc;
    return this._save();
  }

  /**
   * Update the status of a specific package version.
   * 
   * @async
   * @param {string} packageId The id of the package which contains the version to update.
   * @param {Version} version The version of the package to update the status of.
   * @param {VersionStatus} newStatus The new status to set.
   * @returns {Promise<void>} A promise which resolves if the operation completes successfully.
   * @throws {NoSuchPackageError} Error thrown if no package exists with the given id.
   */
  async updatePackageStatus(packageId: string, version: Version, newStatus: VersionStatus): Promise<void> {
    packageId = packageId.trim().toLowerCase();

    const pkg = this._data.find(p => p.packageId === packageId);
    
    if (!pkg)
      throw new NoSuchPackageError(packageId);
    
    const versionString = versionStr(version);
    const pkgVersion = pkg.versions.find(v => v.version === versionString);

    if (!pkgVersion)
      throw new NoSuchPackageError(packageId, versionString);
    
    pkgVersion.status = newStatus;
    return this._save();
  }
}

const packageDatabase = new JsonPackageDB();
export default packageDatabase;
