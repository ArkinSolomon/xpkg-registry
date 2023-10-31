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
 * The analytics data for a single hour.
 * 
 * @typedef {Object} AnalyticsData
 * @property {Date} timestamp The timestamp of the hour which the analytics data was taken in.
 * @property {number} downloads The number of downloads in the hour.
 */
type AnalyticsData = {
  timestamp: Date;
  downloads: number;
};

import { Version } from 'xpkg-common';
import { dateToUTCHour } from '../util/dateUtil.js';
import DownloadsModel from './models/downloadsModel.js';

/**
 * Increment the downloads for the current hour by one.
 * 
 * @param {string} packageId The identifier of the package of which to increment the download.
 * @param {Version} packageVersion The version of the package to mark as downloaded.
 * @returns {Promise<void>} A promise which resolves if the operation completes successfully.
 */
export async function incrementDownloadCount(packageId: string, packageVersion: Version): Promise<void> {
  const currentDate = new Date();
  const timestamp = dateToUTCHour(currentDate);
  await DownloadsModel.updateOne({
    packageId,
    packageVersion: packageVersion.toString(),
    timestamp
  }, {
    $inc: {
      downloads: 1
    }
  }, {
    upsert: true
  })
    .exec();
}

/**
 * Get analytics information for a version between two dates. Dates provided will not be rounded down to the UTC hour.
 * 
 * @param {string} packageId The partial identifier of the package to gather analytics for.
 * @param {Version} packageVersion The version of the package to gather analytics for.
 * @param {Date} after The date after which to gather analytics (inclusive).
 * @param {Date} before The date during which to gather analytics (inclusive).
 * @returns {Promise<AnalyticsData[]>} A promise which resolves to all of the requested analytics data.
 */
export async function getVersionAnalyticsData(packageId: string, packageVersion: Version, after: Date, before: Date): Promise<AnalyticsData> {
  const data = DownloadsModel.find({
    packageId,
    packageVersion: packageVersion.toString(),
    timestamp: {
      $gte: after,
      $lte: before
    }
  })
    .limit(720)
    .sort({ timestamp: 1 })
    .select('-_id timestamp downloads')
    .lean()
    .exec();

  return data as unknown as AnalyticsData;
}

