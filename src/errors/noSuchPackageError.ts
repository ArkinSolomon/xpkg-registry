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
 * An error which is thrown by the account database when such a package does not exist.
 */
export default class NoSuchAccountError extends Error {

  /**
   * Create a new error saying a pacakage does not exist with the provided package id.
   * 
   * @param {string} packageId The id of the package that does not exist.
   */
  constructor(packageId: string);

  /**
   * Create a new error saying a pacakage does not exist with the provided package id and version.
   * 
   * @param {string} packageId The id of the package that does not exist.
   * @param {string} version The version of the package that does not exist
   */
  constructor(packageId: string, version: string);

  constructor(packageId: string, version?: string) {
    if (version)
      super(`Package does not exist: ${packageId}@${version}`);
    else
      super(`Package does not exist: ${packageId}`);
  }
}