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
 * A single entry in the download series.
 * 
 * @typedef {Object} DownloadEntry
 * @property {string} packageId The identifier of the package that this entry is for.
 * @property {string} packageId The version of the package that this entry is for.
 * @property {string} timestamp When this collection was taken.
 * @property {string} downloads When the downloads occured.
 */
export type DownloadEntry = {
  packageId: string;
  packageVersion: string;
  timestamp: Date;
  downloads: number;
}

import mongoose, { Schema } from 'mongoose';

const downloadsSchema = new Schema<DownloadEntry>({
  packageId: {
    type: String,
    required: true,
    index: true
  },
  packageVersion: {
    type: String,
    required: true,
    index: true,
  },
  timestamp: {
    type: Date,
    required: true
  },
  downloads: {
    type: Number,
    required: true,
    min: 0
  }
}, {
  collection: 'downloads'
});

const downloadsDB = mongoose.connection.useDb('packages');
const DownloadsModel = downloadsDB.model<DownloadEntry>('downloads', downloadsSchema);

export default DownloadsModel;