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
  FailedFileTooLarge = 'failed_file_too_large', // Unzipped file too big
  FailedNotEnoughSpace = 'failed_not_enough_space', // Not enough space in author's storage
  FailedServer = 'failed_server', // Server error
  Aborted = 'aborted' // Job took too long
}

/**
 * Represents the different operating systems (or platforms) that a version supports.
 * 
 * @typedef {Object} PlatformSupport
 * @property {boolean} platforms.macOS True if MacOS is supported.
 * @property {boolean} platforms.windows True if Windows is supported.
 * @property {boolean} platforms.linux True if Linux is supported.
 */
export type PlatformSupport = {
  macOS: boolean;
  windows: boolean;
  linux: boolean;
};

/**
 * The data for a specific version of a package.
 * 
 * @typedef {Object} VersionData
 * @property {string} packageId The identifier of the package.
 * @property {string} packageVersion The version string of the package.
 * @property {string} hash The hexadecimal hash of the package files.
 * @property {boolean} isPublic True if the version is public.
 * @property {boolean} isStored True if the version is stored.
 * @property {string} loc The URL from which to download the package version.
 * @property {string} [privateKey] The private key of the version, if the version is private.
 * @property {number} downloads The number of times this version has been downloaded overall.
 * @property {Date} uploadDate The upload time of the package.
 * @property {VersionStatus} VersionStatus The status of the package.
 * @property {[string][string][]} dependencies The dependencies of the version.
 * @property {[string][string][]} incompatibilities The incompatibilities of the version.
 * @property {number} size The size of the xpkg file in bytes.
 * @property {number} installedSize The size of the xpkg file unzipped in bytes.
 * @property {string} xpSelection The X-Plane selection string.
 * @property {boolean} supportsMacOS True if this version supports MacOS installations of X-Plane.
 * @property {boolean} supportsWindows True if this version supports Windows installations of X-Plane.
 * @property {boolean} supportsLinux True if this version supports Linux installations of X-Plane.
 */
export type VersionData = {
  packageId: string;
  packageVersion: string;
  hash: string;
  isPublic: boolean;
  isStored: boolean;
  loc?: string;
  privateKey?: string;
  downloads: number;
  uploadDate: Date;
  status: VersionStatus;
  dependencies: [string, string][];
  incompatibilities: [string, string][];
  size: number;
  installedSize: number;
  xpSelection: string;
  platforms: PlatformSupport;
};

import mongoose, { Schema } from 'mongoose';

const platformSchema = new Schema<PlatformSupport>({
  macOS: {
    type: Boolean,
    required: true
  },
  windows: {
    type: Boolean,
    required: true
  },
  linux: {
    type: Boolean,
    required: true
  }
}, { _id: false });

const versionSchema = new Schema<VersionData>({
  packageId: {
    type: String,
    required: true,
    index: true
  },
  packageVersion: {
    type: String,
    required: true,
    index: true
  },
  hash: {
    type: String,
    required(this: VersionData) {
      return this.status === VersionStatus.Processed;
    }
  },
  isPublic: {
    type: Boolean,
    required: true
  },
  isStored: {
    type: Boolean,
    required: true
  },
  loc: {
    type: String,
    required(this: VersionData) {
      return this.status === VersionStatus.Processed && this.isStored;
    }
  },
  privateKey: {
    type: String,
    required(this: VersionData) {
      return !this.isPublic && this.isStored;
    },
  },
  downloads: {
    type: Number,
    required: true,
    default: 0
  },
  uploadDate: {
    type: Date,
    required: true,
    default: () => new Date()
  },
  status: {
    type: String,
    required: true,
    default: VersionStatus.Processing,
    enum: Object.values(VersionStatus)
  },
  dependencies: {
    type: Schema.Types.Mixed,
    required: true,
    default: []
  }, 
  incompatibilities: {
    type: Schema.Types.Mixed,
    required: true,
    default: []
  },
  size: {
    type: Number,
    required: true,
    default: 0
  },
  installedSize: {
    type: Number,
    required: true,
    default: 0
  },
  xpSelection: {
    type: String,
    required: true
  },
  platforms: {
    type: platformSchema,
    required: true
  }
}, {
  collection: 'versions'
});

const packagesDB = mongoose.connection.useDb('packages');
const VersionModel = packagesDB.model<VersionData>('version', versionSchema);
export default VersionModel;