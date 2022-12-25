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
import MysqlDB from './mysqlDB.js';
import PackageDatabase, { PackageData, PackageType, VersionData } from './packageDatabase.js';
import { format } from 'mysql2';
import { versionStr, Version } from '../util/version.js';
import InvalidPackageError from '../errors/invalidPackageError.js';
import NoSuchPackageError from '../errors/noSuchPackageError.js';

/**
 * Package database implemented using MySQL.
 */
class MysqlPackageDB extends MysqlDB implements PackageDatabase {

  /**
   * Create a new database instance with a pool of connections.
   * 
   * @param {number} poolCount The number of connections in a connection pool.
   */
  constructor(poolCount: number) {
    super(poolCount);
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
    packageName = packageName.trim();
    const checkPackageName = packageName.toLowerCase();
    description = description.trim();

    const query = format('INSERT INTO packages (packageId, packageName, authorId, authorName, description, packageType, checkPackageName) VALUES (?, ?, ?, ?, ?, ?, ?);', [packageId, packageName, author.id, author.name, description, packageType, checkPackageName]);
    await this._query(query);
  }

  /**
   * Create a new version for a package. If both published and private are false, the package is assumed to registered only.
   * 
   * @async
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
  async addPackageVersion(packageId: string, version: Version, author: Author, hash: string, loc: string, accessConfig: {
    isPublished: boolean;
    isPrivate: boolean;
    privateKey?: string;
  }): Promise<void> {
    packageId = packageId.trim().toLowerCase();
    hash = hash.toUpperCase();

    const versionString = versionStr(version);

    if (accessConfig.isPublished && accessConfig.isPrivate)
      throw new InvalidPackageError('published_private_version');

    if (accessConfig.isPrivate && !accessConfig.privateKey)
      throw new Error('Private version does not have a private key');

    const query = format('INSERT INTO versions (packageId, version, hash, published, private, privateKey, approved, loc, authorId, uploadDate) VALUES (?, ?, UNHEX(?), ?, ?, ?, False, ?, ?, ?);', [packageId, versionString, hash, accessConfig.isPublished, accessConfig.isPrivate, accessConfig.privateKey ?? null, loc, author.id, new Date()]);
    await this._query(query);
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
      packageId = packageId.trim().toLowerCase();
      const query = format('SELECT packageId, packageName, authorId, authorName, description, packageType FROM packages WHERE packageId=?;', [packageId]);
      const data = await this._query(query);

      if (data.length != 1)
        throw new NoSuchPackageError(packageId);

      return data[0] as PackageData;
    } else {
      const query = format('SELECT packageId, packageName, authorId, authorName, description, packageType FROM packages;');
      return this._query(query) as Promise<PackageData[]>;
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
    authorId = authorId.trim().toLowerCase();
    const query = format('SELECT packageId, packageName, authorId, authorName, description, packageType FROM packages WHERE authorId=?;', [authorId]);
    const data = await this._query(query);
    return data as PackageData[];
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
  async getVersionData(packageId: string, version?: Version): Promise<VersionData>;

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

    if (typeof version !== 'undefined') {
      const versionString = versionStr(version);
      const query = format('SELECT packageId, version, HEX(hash), approved, published, private, loc, privateKey, installs, uploadDate FROM versions WHERE packageId=? AND version=?;', [packageId, versionString]);
      const data = await this._query(query);

      if (data.length === 0)
        throw new NoSuchPackageError(packageId, versionString);

      // Convert 'HEX(hash)' to hash
      data[0].hash = data[0]['HEX(hash)'];
      delete data[0]['HEX(hash)'];
      return data[0] as VersionData;
    } else {
      const query = format('SELECT packageId, version, HEX(hash), approved, published, private, loc, privateKey, installs, uploadDate FROM versions WHERE packageId=?;', [packageId]);
      const data = await this._query(query);

      // If the package has been uploaded it *must* have an initial version.
      if (data.length === 0)
        throw new NoSuchPackageError(packageId);

      data.forEach((version: VersionData & { 'HEX(hash)': string|undefined }) => {
        version.hash = version['HEX(hash)'] as string;
        delete version['HEX(hash)'];
      });

      return data as VersionData[];
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
    try {
      await this.getVersionData(packageId);
      return true;
    } catch (e) {
      if (e instanceof NoSuchPackageError)
        return false;
      throw e;
    }
  }

  /**
   * Check if the given package has the given version.
   * 
   * @async
   * @param {string} packageId The package id to check for version existence.
   * @param {string} version The version string to check for existence.
   * @returns {Promise<boolean>} A promise which resolves to true if the package already has the version.
   * @throws {NoSuchPackageError} Error thrown if the package does not exist.
   */
  async versionExists(packageId: string, version: Version): Promise<boolean> {
    try {
      await this.getVersionData(packageId, version);
      return true;
    } catch (e) {
      if (e instanceof NoSuchPackageError)
        return false;
      throw e;
    }
  }

  /**
   * Check if a package exists with a given name.
   * 
   * @async
   * @param {string} packageName The package name to check for.
   * @returns {Promise<boolean>} A promise which resolves to true if the name is already in use.
   */
  async packageNameExists(packageName: string): Promise<boolean> {
    const checkPackageName = packageName.trim().toLowerCase();

    const query = format('SELECT packageId FROM packages WHERE checkPackageName=?;', [checkPackageName]);
    return (await this._query(query)).length > 0;
  }

  /**
   * Update any packages that was made by the author with the id and change the name.
   * 
   * @async
   * @param authorId The id of the author to change the name of.
   * @param newName The new name of the author.
   * @returns {Promise<void>} A promise which resolves if the operation completes successfully.
   */
  async updateAuthorName(authorId: string, newName: string): Promise<void> {
    authorId = authorId.trim().toLowerCase();
    newName = newName.trim();

    const query = format('UPDATE packages SET authorName=? WHERE authorId=?;', [newName, authorId]);
    await this._query(query);
  }
}

const packageDatabase = new MysqlPackageDB(25);
export default packageDatabase as PackageDatabase;