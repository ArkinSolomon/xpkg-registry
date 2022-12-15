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
export default class XPkgInvalidPackageError extends Error {

  private _shortMessage: string;

  /**
   * Get the short message to be sent to the user.
   * 
   * @type {string}
   */
  public get shortMessage(): string {
    return this._shortMessage;
  }

  /**
   * This class creates an exception specifically for when a package provided by the user is invalid.
   * 
   * @param shortMessage The short message of the error, to be sent to the user.
   */
  constructor(shortMessage: string) {
    super('Invalid package provided: ' + shortMessage);

    this._shortMessage = shortMessage;
  }
}