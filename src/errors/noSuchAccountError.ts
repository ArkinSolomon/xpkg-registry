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
 * An error which is thrown by the account database when such a user does not exist.
 */
export default class NoSuchAccountError extends Error {

  /**
   * Create a new error saying the account does not exist with the provided details.
   * 
   * @param {string} keyName The name of the key that the author was looked up by.
   * @param {string} key The value of the key that the author was looked up by.
   */
  constructor(keyName: string, key: string) {
    super(`Account does not exist with the parameters: ${keyName}=${key}`);
  }
}