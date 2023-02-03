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
import jwt from 'jsonwebtoken';

/**
 * Create a signed JSON Web Token asynchronously using promises.
 * 
 * @async
 * @param {Record<string, unknown>} payload The token payload.
 * @param {jwt.Secret} secret The token secret.
 * @param {jwt.SignOptions} config The options for signing the token.
 * @returns {Promise<string>} A promise which resolves to the signed token.
 */
export function sign(payload: Record<string, unknown>, secret: jwt.Secret, config: jwt.SignOptions): Promise<string> {
  return new Promise((resolve, reject) => jwt.sign(payload, secret, config, (err, token) => {
    if (err)
      return reject(err);
    resolve(token as string);
  }));
}

/**
 * Decode a JSON Web Token asynchronously using promises.
 * 
 * @async
 * @param {string} token The token to decode.
 * @param {jwt.Secret} secret The secret used to sign the token.
 * @returns {Promise<unknown>} A promise which resolves to the payload of the token.
 */
export function decode(token: string, secret: jwt.Secret): Promise<unknown> {
  return new Promise((resolve, reject) => jwt.verify(token, secret, (err, payload) => {
    if (err)
      return reject(err);
    resolve(payload);
  }));
}