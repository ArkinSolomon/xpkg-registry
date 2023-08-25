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
 * This is a specific range from one version to another. If the values of min and max are equal, it represents a single version range.
 * 
 * @typedef {Object} VersionRange 
 * @property {Big} min The minimum value of the range.
 * @property {Big} max The maximum value of the range.
 * @property {Version} minVersion The minimum version of the range.
 * @property {Version} maxVersion The maximum version of the range.
 */
type VersionRange = {
  min: Big;
  max: Big;
  minVersion: Version;
  maxVersion: Version;
};

import { Big } from 'big.js';
import Version from './version.js';

/**
 * This class version selection from a string, and can use it with other version selections, or versions.
 */
export default class VersionSelection {

  private _isValid = true;
  private _ranges: VersionRange[] = [];

  /**
   * Check if the provided version selection string was valid.
   * 
   * @returns {boolean} True if the provided version selection string is valid.
   */
  get isValid(): boolean {
    return this._isValid;
  }

  /**
   * Get a copy of the ranges (simplified).
   * 
   * @returns {RangeSet[]} A copy of the simplified ranges.
   */
  get ranges(): VersionRange[] {
    return this._ranges.slice();
  }

  /**
   * Create a new version selection from a string.
   * 
   * @param {string} selectionStr The selection string, comma separated.
   */
  constructor(selectionStr: string) {
    const selectionSections = selectionStr.split(',');

    for (let selection of selectionSections) {
      const allRanges: VersionRange = {
        min: new Big('0.000002'),
        max: new Big('999999999'),
        minVersion: new Version(0, 0, 1, 'a', 1),
        maxVersion: new Version(999, 999, 999)
      };

      selection = selection.trim();

      const versionParts = selection.split('-');

      if (versionParts.length === 1) {
        if (selection === '*') {
          this._ranges = [allRanges];
          break;
        }

        const version = versionParts[0].trim();

        const minVersion = Version.fromString(version);
        if (!minVersion) {
          this._isValid = false;
          break;
        }
        const maxVersion = minVersion.copy();

        if (!minVersion.isPreRelease) {
          const singleVersionParts = version.split('.');

          if (singleVersionParts.length === 1) 
            maxVersion.minor = 999;

          if (singleVersionParts.length <= 2) 
            maxVersion.patch = 999;

          if (singleVersionParts.length <= 3) 
            minVersion.preReleaseType = 'a'; 
        }

        this._ranges.push({
          max: maxVersion.toFloat(),
          min: minVersion.toFloat(),
          maxVersion,
          minVersion
        });
        continue;
      } else if (versionParts.length !== 2) {
        this._isValid = false;
        break;
      }

      let [lowerVersionStr, upperVersionStr] = versionParts;
      lowerVersionStr = lowerVersionStr.trim();
      upperVersionStr = upperVersionStr.trim();

      let lowerVersion = Version.fromString(lowerVersionStr);
      const upperVersion = Version.fromString(upperVersionStr);
      const hasLower = lowerVersionStr !== '';
      const hasUpper = upperVersionStr !== '';

      if ((!lowerVersion && hasLower) || (!upperVersion && hasUpper) || (!hasLower && !hasUpper)) {
        this._isValid = false;
        break;
      }

      const range = allRanges;

      if (hasLower && lowerVersion) {

        // Since (for instance) 1 really means everything from 1.0.0a1 and up, we can use this hack
        if (!lowerVersion.isPreRelease)
          lowerVersion = Version.fromString(lowerVersionStr + 'a1') as Version;

        range.min = lowerVersion.toFloat();
        range.minVersion = lowerVersion;
      }

      if (hasUpper && upperVersion) {

        // Similarly, since (for instance) 2 really means everything up to 2.999.999, we can use this hack
        const partLen = upperVersionStr.split('.').length;
        const hasPre = upperVersionStr.includes('a') || upperVersionStr.includes('b') || upperVersionStr.includes('r');

        if (!hasPre) {
          if (partLen < 2)
            upperVersion.minor = 999;
          if (partLen < 3)
            upperVersion.patch = 999;
        }

        range.max = upperVersion.toFloat();
        range.maxVersion = upperVersion;
      }

      if (range.min.gt(range.max)) {
        this._isValid = false;
        break;
      }

      this._ranges.push(range);
    }
    
    if (!this._isValid)
      return;
    
    this._ranges.sort(compareRanges);

    let curr = 0;
    while (this._ranges.length > 1 && curr < this._ranges.length - 1) {
      const r = tryMerge(this._ranges[curr], this._ranges[curr + 1]);
      if (!r)
        ++curr;
      else {
        this._ranges[curr] = r;
        this._ranges.splice(curr + 1, 1);
      }
    }
  }

  /**
   * Check to see whether a version falls within this selection.
   * 
   * @param {Version} version Check if a version falls within a version selection.
   * @returns {boolean} True if the number is within the selection.
   */
  containsVersion(version: Version): boolean {
    for (const range of this._ranges) {
      const versionFloat = version.toFloat();

      if (versionFloat.gte(range.min) && versionFloat.lte(range.max))
        return true;
    }
    return false;
  }

  /**
   * Get a simplified string representation of the version selection.
   * 
   * @returns {string} A simplified string representation of the version selection.
   */
  toString(): string {
    let rangeStrings: string[] = [];

    if (!this._ranges.length) 
      return '<empty version select>';

    for (const range of this._ranges) {
      if (range.minVersion.equals(range.maxVersion))
        rangeStrings.push(range.minVersion.asMinString());
      else if (range.minVersion.equals(Version.MIN_VERSION) && range.maxVersion.equals(Version.MAX_VERSION))
        return '*';
      else if (range.minVersion.equals(Version.MIN_VERSION))
        rangeStrings = ['-' + range.maxVersion.asMaxString()];
      else if (range.maxVersion.equals(Version.MAX_VERSION)) {
        rangeStrings.push(range.minVersion.asMinString() + '-');
        break;
      }
      else
        rangeStrings.push(`${range.minVersion.asMinString()}-${range.maxVersion.asMaxString()}`);
    }

    return rangeStrings.join(',');
  }
}

/**
 * Try merging two version ranges. Note that r1 must be less than or equal to r2.
 *
 * @param {VersionRange} r1 The first range to try merging.
 * @param {VersionRange} r2 The second range to try merging.
 * @return {VersionRange?} Undefined if the two range sets can not be merged, only r1 if r2 fits inside r1, or a new merged range set.
 */
function tryMerge(r1: VersionRange, r2: VersionRange): VersionRange | void {
  if (compareRanges(r1, r2) > 0)
    throw new Error('Invalid ordering of ranges');
  
  if (r1.max.lt(r2.min))
    return;
  
  if (r1.max.lt(r2.max)) {
    const newRange: VersionRange = {
      min: r1.min,
      minVersion: r1.minVersion,
      max: r2.max,
      maxVersion: r2.maxVersion
    };
    return newRange;
  }

  return r1;
}

/**
 * Compare two ranges.
 * 
 * @param {VersionRange} r1 The first range to compare.
 * @param {VersionRange} r2 The second range to compare.
 * @returns {number}  A zero if these two version ranges are equal, a negative number if r1 is considered less than r2, or a positive number otherwise.
 */
function compareRanges(r1: VersionRange, r2: VersionRange): number {
  const minComp = r1.min.cmp(r2.min);
  if (minComp === 0)
    return r1.max.cmp(r2.max);
  return minComp;
}