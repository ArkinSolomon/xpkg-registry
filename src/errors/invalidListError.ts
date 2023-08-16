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
 * A class which contains response text, as well as a human-readable message for any errors that occur when validating or simplifying lists.
 */
export default class InvalidListError extends Error {

  private _response;
  private _message;

  /**
   * Get the response text of the message.
   * 
   * @type {string}
   */
  get response(): string { 
    return this._response;
  }

  /**
   * Get the human-readable message.
   * 
   * @type {string}
   */
  get message(): string {
    return this._message;
  }

  /**
   * Create a new error object with the response text and the message.
   * 
   * @param {string} response The response text to be sent for the error.
   * @param {string} message The human-readable error message (primarily for logging).
   */
  constructor(response: string, message: string) {
    super(`[${response}] ${message}`);
    this._response = response;
    this._message = message;
  }
}