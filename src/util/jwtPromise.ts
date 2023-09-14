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
import * as jose from 'jose';

if (!process.env.EMAIL_VERIFY_SECRET || !process.env.AUTH_SECRET) {
  console.error('Missing token secret(s)');
  process.exit(1);
}
export const EMAIL_VERIFY_SECRET = new TextEncoder().encode(process.env.EMAIL_VERIFY_SECRET);
export const AUTH_SECRET = new TextEncoder().encode(process.env.AUTH_SECRET);

const ALGORITHM = 'HS256';

/**
 * Create a signed JSON Web Token asynchronously using promises.
 * 
 * @async
 * @param {Record<string, unknown>} payload The token payload.
 * @param {Uint8Array} secret The token secret.
 * @param {string} expiresIn A string of when the token should expire (like '24h').
 * @param {string} audience The identifier of the person who this token is for.
 * @returns {Promise<string>} A promise which resolves to the signed token.
 */
export function sign(payload: Record<string, unknown>, secret: Uint8Array, expiresIn: string): Promise<string> {
  return new jose.SignJWT(payload)
    .setProtectedHeader({ alg: ALGORITHM })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(secret);
}

/**
 * Decode a JSON Web Token asynchronously using promises.
 * 
 * @async
 * @param {string} token The token to decode.
 * @param {Uint8Array} secret The secret which was used to sign the token.
 * @returns {Promise<unknown>} A promise which resolves to the payload of the token.
 */
export async function decode(token: string, secret: Uint8Array): Promise<unknown> {
  const { payload } = await jose.jwtVerify(token, secret, {
    algorithms: [ALGORITHM]
  });

  return payload;
}