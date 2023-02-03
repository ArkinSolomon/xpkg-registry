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
 * A version decomposed into sub-items.
 * 
 * @typedef {[number, number, number, ('a'|'b')?, number?]} Version
 */
export type Version = [number, number, number, ('a' | 'b')?, number?];

/**
 * Convert a version to a string.
 * 
 * @param {Version} version The version to convert to a string.
 * @returns {string} The version represented as a string.
 */
export function versionStr(version: Version): string {
  let finalStr = version.slice(0, 3).join('.');
  if (version[3])
    finalStr += version.slice(3, 5).join('');
  return finalStr;
}

/**
 * Check if a version string is valid.
 * 
 * @param {string} version The version string to check for validity.
 * @returns {Version|undefined} The version decomposed if the version is valid, otherwise none.
 */
export default function isVersionValid(version: string): Version | undefined {
  if (version !== version.trim().toLowerCase() || version.length < 1 || version.length > 15 || version.endsWith('.'))
    return;

  const versionDecomp: Version = [0, 0, 0, void (0), void (0)];

  // Quick function to make sure that a number only has 3 digits and are all *actually* digits
  const testNumStr = (s: string) => /^\d{1,3}$/.test(s);

  let semanticPart = version;
  if (version.includes('a') || version.includes('b')) {
    const matches = version.match(/([ab])/);
    const aOrB = matches?.[1] as 'a' | 'b';

    versionDecomp[3] = aOrB;
    const parts = version.split(new RegExp(aOrB));

    semanticPart = parts[0];
    const aOrBNumPart = parts[1];

    if (!testNumStr(aOrBNumPart))
      return;

    const aOrBNum = parseInt(aOrBNumPart, 10);
    if (aOrBNum <= 0)
      return;
    versionDecomp[4] = aOrBNum;
  }

  let major, minor, patch;

  const semanticParts = semanticPart.split(/\./g);
  if (semanticParts.length === 3) {
    [major, minor, patch] = semanticParts;
  } else if (semanticParts.length === 2) {
    [major, minor] = semanticParts;
  } else if (semanticParts.length === 1)
    [major] = semanticParts;
  else
    return;

  if (!testNumStr(major) || (minor && !testNumStr(minor)) || (patch && !testNumStr(patch)))
    return;

  const majorNum = parseInt(major, 10);
  const minorNum = minor ? parseInt(minor, 10) : 0;
  const patchNum = patch ? parseInt(patch, 10) : 0;

  if (majorNum < 0 || minorNum < 0 || patchNum < 0 || (majorNum | minorNum | patchNum) === 0)
    return;

  versionDecomp[0] = majorNum;
  versionDecomp[1] = minorNum;
  versionDecomp[2] = patchNum;

  return versionDecomp;
}