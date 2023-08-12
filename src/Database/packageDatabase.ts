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

import Version from '../util/version.js';
import NoSuchPackageError from '../errors/noSuchPackageError.js';
import PackageModel, { PackageData, PackageType } from './models/packageModel.js';
import VersionModel, { VersionData, VersionStatus } from './models/versionModel.js';

/**
   * Add a new package to the database. Does not check for existence.
   * 
   * @async 
   * @param {string} packageId The package identifier of the new package.
   * @param {string} packageName The name of the new package.
   * @param {string} authorId The id of the author that is creating the package.
   * @param {string} authorName The name of the author that is creating the package
   * @param {string} description The description of the new package.
   * @param {PackageType} packageType The type of the package that is being created.
   * @returns {Promise<void>} A promise which resolves if the operation is completed successfully, or rejects if it does not.
   */
export async function addPackage(packageId: string, packageName: string, authorId: string, authorName: string, description: string, packageType: PackageType): Promise<void> {
  const newPackage = new PackageModel({
    packageId,
    packageName,
    authorId,
    authorName,
    description,
    packageType
  });

  await newPackage.save();
}

/**
 * Create a new version for a package. If both published and private are false, the package is assumed to registered only. Does not check for package or version existence.
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
 * @param {string} xpSelection The X-Plane selection.
 * @returns {Promise<void>} A promise which resolves if the operation is completed successfully, or rejects if it does not.
 */
export async function addPackageVersion(packageId: string, version: Version, accessConfig: {
    isPublic: boolean;
    isStored: boolean;
    privateKey?: string;
  }, dependencies: [string, string][], incompatibilities: [string, string][], xpSelection: string): Promise<void> {
  const newVersion = new VersionModel({
    packageId,
    version,
    ...accessConfig,
    dependencies,
    incompatibilities,
    xpSelection
  });

  await newVersion.save();
}

/**
 * Set the information after finishing processing a package version. Also update the status to {@link VersionStatus~Processed}.
 * 
 * @async
 * @param {string} packageId The id of the package which contains the version to update.
 * @param {Version} version The version of the package to update the version data of.
 * @param {string} hash The sha256 checksum of the package.
 * @param {string} loc The URL of the package, or "NOT_STORED" if the package is not stored.
 * @param {number} size The size of the xpkg file in bytes.
 * @param {number} installedSize The size of the unzipped xpkg file in bytes.
 * @returns {Promise<void>} A promise which resolves if the operation completes successfully.
 * @throws {NoSuchPackageError} Error thrown if no package exists with the given id or version.
 */
export async function resolveVersionData(packageId: string, version: Version, hash: string, loc: string, size: number, installedSize: number): Promise<void> {
  const result = await VersionModel.findOneAndUpdate({
    packageId,
    version
  }, {
    hash,
    loc,
    size,
    installedSize,
    status: VersionStatus.Processed
  }).updateOne();

  if (!result.modifiedCount)
    throw new NoSuchPackageError(packageId, version);
}

/**
 * Update the status of a specific package version.
 * 
 * @async
 * @param {string} packageId The id of the package which contains the version to update.
 * @param {Version} version The version of the package to update the status of.
 * @param {VersionStatus} newStatus The new status to set.
 * @returns {Promise<void>} A promise which resolves if the operation completes successfully.
 * @throws {NoSuchPackageError} Error thrown if no package exists with the given id or if the package version does not exist.
 */
export async function updateVersionStatus(packageId: string, version: Version, newStatus: VersionStatus): Promise<void> {
  const result = await VersionModel.findOneAndUpdate({
    packageId,
    version
  }, {
    status: newStatus
  }).updateOne();

  if (!result.modifiedCount)
    throw new NoSuchPackageError(packageId, version);
}

/**
 * Update the private key of a package version.
 * 
 * @async 
 * @param {string} packageId The id of the package to update the private key of.
 * @param {Version} version The version of the package to update the private key of.
 * @param {string} privateKey The new private key of the version. Does not check access config.
 * @returns {Promise<void>} A promise which resolves if the operation completes.
 * @throws {NoSuchPackageError} Error thrown if no package exists with the given id or if the package version does not exist.
 */
export async function updatePrivateKey(packageId: string, version: Version, privateKey: string): Promise<void> {
  const result = await VersionModel.findOneAndUpdate({
    packageId,
    version
  }, {
    privateKey
  }).updateOne();

  if (result.modifiedCount !== 1)
    throw new NoSuchPackageError(packageId, version);
}

/**
 * Get all package data for all packages.
 * 
 * @async
 * @returns {Promise<PackageData[]>} The data of all of the packages on the registry. 
 */
export async function getPackageData(): Promise<PackageData[]>;

/**
 * Get the package data for a specific package.
 * 
 * @async 
 * @param {string} packageId The identifier of the package to get the data for.
 * @returns {Promise<PackageData>} A promise which resolves to the data of the specified package.
 * @throws {NoSuchPackageError} Error throws if trying to get data for a non-existent package.
 */
export async function getPackageData(packageId: string): Promise<PackageData>;

export async function getPackageData(packageId?: string): Promise<PackageData[]|PackageData> {
  if (packageId) {
    const pkg = await PackageModel.findOne({ packageId }).exec();
    if (!pkg)
      throw new NoSuchPackageError(packageId);
    return pkg;
  } 

  return PackageModel
    .find()
    .select('-_id -__v')
    .lean()
    .exec();
}

/**
 * Get the data for all versions of a package.
 * 
 * @async
 * @param {string} packageId The id of the package to get the version data for.
 * @returns {Promise<VersionData[]>} A promise which resolves to all of the version data for all versions of the specified package. If no versions exist, an empty array is returned.
 */
export async function getVersionData(packageId: string): Promise<VersionData[]>;


/**
 * Get the data for a specific version of a package.
 * 
 * @async
 * @param {string} packageId The identifier of the package to get the version data for.
 * @param {Version} version The version of the package to get the data for.
 * @returns {Promise<VersionData>} A promise which resolves to the version data for the specified version of the requested package.
 * @throws {NoSuchPackageError} Error thrown if the package does not exist, or the version does not exist.
 */
export async function getVersionData(packageId: string, version: Version): Promise<VersionData>;

export async function getVersionData(packageId: string, version?: Version): Promise<VersionData[] | VersionData> {
  if (version) {
    const versionDoc = await VersionModel.findOne({
      packageId,
      version: version.toString()
    })
      .lean()
      .select('-_id -__v')
      .exec();
    
    if (!versionDoc)
      throw new NoSuchPackageError(packageId, version);
    return versionDoc;
  }

  return VersionModel.find({ packageId })
    .lean()
    .select('-_id -__v')
    .exec();
}

/**
 * Update the incompatibilities of a package version by overwriting the old ones.
 *
 * @async
 * @param {string} packageId The identifier of the package to update the incompatibilities of.
 * @param {Version} version The version of the package to update the incompatibilities of.
 * @param {[string, string][]} incompatibilities The new incompatibilities of the package to overwrite.
 * @returns {Promise<void>} A promise which resolves if the incompatibilities are updated successfully.
 * @throws {NoSuchPackageError} Error thrown if the package does not exist, or the version does not exist.
 */
export async function updateVersionIncompatibilities(packageId: string, version: Version, incompatibilities: [string, string][]): Promise<void> {
  await VersionModel.updateOne({
    packageId,
    version: version.toString()
  }, {
    $set: {
      incompatibilities
    }
  })
    .exec();
}

/**
 * Check if a package exists with a given id.
 * 
 * @async
 * @param {string} packageId The id to check for existence.
 * @returns {Promise<boolean>} A promise which resolves to true if the package id is already in use.
 */
export async function packageIdExists(packageId: string): Promise<boolean> {
  return (await PackageModel.countDocuments({
    packageId
  }).exec()) === 1;
}

/**
 * Check if the given package has the given version.
 * 
 * @async
 * @param {string} packageId The package id to check for version existence.
 * @param {Version} version The version to check for existence.
 * @returns {Promise<boolean>} A promise which resolves to true if the package already has the version, or false if the package or version does not exist.
 */
export async function versionExists(packageId: string, version: Version): Promise<boolean> {
  return (await VersionModel.countDocuments({
    packageId,
    version
  }).exec()) === 1;
}

/**
 * Check if a package exists with a given name.
 * 
 * @async
 * @param {string} packageName The package name to check for
 * @returns {Promise<boolean>} A promise which resolves to true if the name is already in use.
 */
export async function packageNameExists(packageName: string): Promise<boolean> {
  return (await PackageModel.countDocuments({
    packageName: {
      $regex: packageName,
      $options: 'i'
    }
  }).exec()) === 1;
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
export async function updateDescription(packageId: string, newDescription: string): Promise<void> {
  const result = await PackageModel.findOneAndUpdate({
    packageId
  }, {
    description: newDescription
  }).updateOne();

  if (result.modifiedCount !== 1)
    throw new NoSuchPackageError(packageId);
}

/**
 * Get all packages by a certain author.
 * 
 * @async
 * @param {string} authorId The id of the author to get the packages of.
 * @returns {Promise<PackageData[]>} A promise which resolves to the data of all packages created by the provided author.
 */
export async function getAuthorPackages(authorId: string): Promise<PackageData[]> {
  return PackageModel
    .find({
      authorId,
    })
    .lean()
    .select('-_id -__v')
    .exec();
}

/** 
 * Determine if an author owns a package with the package id.
 * 
 * @async
 * @param {string} authorId The id of the author to determine ownership
 * @param {string} packageId The id of the package to check for.
 * @returns {Promise<boolean>} A promise which resolves to true if the author owns the package
 */
export async function doesAuthorHavePackage(authorId: string, packageId: string): Promise<boolean> {
  return !!PackageModel.exists({
    authorId,
    packageId
  });
}

/**
 * Update any packages that was made by the author with the id and change the name.
 * 
 * @async
 * @param {string} authorId The id of the author to change the name of.
 * @param {string} newName The new name of the author.
 * @returns {Promise<void>} A promise which resolves if the operation completes successfully.
 */
export async function updateAuthorName(authorId: string, newName: string): Promise<void> {
  await PackageModel.find({
    authorId
  }).updateMany({
    authorName: newName
  }).exec();
}

