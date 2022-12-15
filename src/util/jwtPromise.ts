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
import jwt from 'jsonwebtoken';

/**
 * Decode a Json Web Token asynchronously using promises.
 * 
 * @param token The token to decode.
 * @param secret The secret used to sign the token.
 * @returns The payload of the token.
 */
export function decode(token: string, secret: string) {
  return new Promise((resolve, reject) => jwt.verify(token, secret, (err, payload) => {
    if (err)
      return reject(err);
    resolve(payload);
  }));
}